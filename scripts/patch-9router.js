#!/usr/bin/env node
import fs from 'node:fs'
/**
 * Patches the installed `9router` package.
 *
 * 1. Capability aliases: model ids that only differ from a known one still inherit its
 *    capabilities (`deepseek-v4p1-flash` ← `deepseek-v4.1-flash`, which upstream declares with
 *    `vision: true`). Only objects carrying `vision:` are cloned, so pricing tables and provider
 *    model lists are untouched.
 *
 * 2. Vision for the deepseek ids (`GENERIC_CAPS_PATTERN`): a model with no exact capability entry
 *    is resolved through an ordered glob pattern list, and 0.5.75's `*deepseek-v4*` entry declares
 *    `reasoning` without `vision` — so `deepseek-v4.1-flash` and its `deepseek-v4p1-flash` alias
 *    both report `vision: false` and refuse image input. This inserts a vision-carrying pattern for
 *    each id ahead of the generic one. A release whose generic pattern already has `vision:` needs
 *    nothing, and the patch then leaves the list alone.
 *
 * 3. Process safety (`scripts/patches/processScan.cjs`): the CLI kills processes it should not.
 *    Its stale-process sweep takes a pid from the second whitespace token of a matched `ps` line,
 *    and `killProcessOnPort()` runs `lsof -ti:<port>` — which lists *clients* as well as
 *    listeners — then kills the first pid. A supervisor that health-checks that port is such a
 *    client, so starting the router killed the panel that started it. Reported upstream
 *    (decolua/9router#4295, fixed by #4294); this keeps the fix in place until a release has it.
 *
 * Re-running is a no-op. Every file is replaced through a temp file + rename: pnpm hardlinks
 * package files from its content-addressed store, and editing in place would corrupt it.
 */
// @ts-check
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const ALIASES = [
  { from: 'deepseek-v4.1-flash', to: 'deepseek-v4p1-flash' },
]

/**
 * The caps-pattern list is matched in order and the first hit wins, so the two deepseek ids
 * need their own entries *before* the generic one they fall through to. 0.5.75's
 * `*deepseek-v4*` carries `reasoning` but no `vision`, which is the capability both ids lose.
 */
const GENERIC_CAPS_PATTERN = '*deepseek-v4*'
const VISION_CAPS_PATTERNS = ['*deepseek-v4.1-flash*', '*deepseek-v4p1-flash*']

const BUNDLE_DIR = ['app', '.next-cli-build']
const VENDOR_MODULE = ['patches', 'processScan.cjs']
const MODULE_TARGET = ['src', 'lib', 'processScan.js']
const CLI_TARGET = 'cli.js'

const argv = new Set(process.argv.slice(2))
const checkOnly = argv.has('--check')
const optional = argv.has('--optional')

// Escape hatch for installs that did not ask for the 9router integration.
if (process.env.HOME_HOSTED_SKIP_9ROUTER_PATCH === '1')
  process.exit(0)

const require = createRequire(import.meta.url)

function resolveRouterDir() {
  try {
    return path.dirname(require.resolve('9router/package.json'))
  }
  catch {
    const fallback = path.join(process.cwd(), 'node_modules', '9router')
    return fs.existsSync(fallback) ? fallback : null
  }
}

function walkJs(dir) {
  if (!fs.existsSync(dir))
    return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...walkJs(full))
    else if (entry.isFile() && entry.name.endsWith('.js'))
      out.push(full)
  }
  return out
}

// Replaces the inode instead of editing in place: pnpm hardlinks package files
// from its content-addressed store, and in-place writes would corrupt the store.
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.hh-patch-${process.pid}`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Clones the capability object under the alias, unless already cloned. */
function patchSource(source) {
  let patched = 0
  let skipped = 0
  for (const { from, to } of ALIASES) {
    const re = new RegExp(`"${escapeRegExp(from)}":(\\{[^{}]*\\})`, 'g')
    source = source.replace(re, (match, body, offset, whole) => {
      if (!body.includes('vision:'))
        return match
      if (whole.slice(0, offset).endsWith(`"${to}":${body},`)) {
        skipped++
        return match
      }
      patched++
      return `"${to}":${body},${match}`
    })
  }
  return { source, patched, skipped }
}

function capabilityBody(source, id) {
  const re = new RegExp(`"${escapeRegExp(id)}":(\\{[^{}]*\\})`, 'g')
  for (const match of source.matchAll(re)) {
    if (match[1].includes('vision:'))
      return match[1]
  }
  return null
}

/**
 * Adds a vision-carrying pattern for each deepseek id ahead of the generic one.
 *
 * The lookup walks the list in order and returns on the first hit, so position is the whole
 * point: the specific entries have to sit before `*deepseek-v4*` to ever be reached. Idempotent,
 * and a no-op on a release whose generic pattern already declares `vision:`.
 */
function patchCapPatterns(source) {
  const generic = new RegExp(`\\{pattern:"${escapeRegExp(GENERIC_CAPS_PATTERN)}",caps:(\\{[^{}]*\\})\\}`)
  const match = generic.exec(source)
  if (match === null)
    return { source, changed: false }

  // Already inserted by a previous run, or upstream grew the capability itself.
  if (source.includes(`{pattern:"${VISION_CAPS_PATTERNS[0]}"`) || match[1].includes('vision:'))
    return { source, changed: false }

  const caps = `{vision:!0,${match[1].slice(1)}`
  const inserted = VISION_CAPS_PATTERNS
    .map(pattern => `{pattern:"${pattern}",caps:${caps}},`)
    .join('')
  return { source: source.replace(match[0], `${inserted}${match[0]}`), changed: true }
}

const REQUIRE_ANCHOR = 'const { ensureTrayRuntime } = require("./hooks/trayRuntime");'
const SWEEP_ANCHOR = '      const platform = process.platform;\n      let pids = [];'
const SWEEP_KILL = '      // Kill all found processes\n      if (pids.length > 0) {'
const SWEEP_LOOP = `        pids.forEach(pid => {
          try {
            if (platform === "win32") {
              execSync(\`taskkill /F /PID \${pid} 2>nul\`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
            } else {
              execSync(\`kill -9 \${pid} 2>/dev/null\`, { stdio: 'ignore', timeout: 3000 });
            }
          } catch (err) {
            // Process already dead or can't kill - continue
          }
        });`
const PORT_OLD = `          const pidOutput = execSync(\`lsof -ti:\${port}\`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          if (pidOutput) {
            pid = pidOutput.split('\\n')[0];
            execSync(\`kill -9 \${pid} 2>/dev/null\`, { stdio: 'ignore', timeout: 3000 });
          }`
const PORT_WAIT = '      // Wait for port to be released\n      setTimeout(() => resolve(), 500);'

/** Rewrites the CLI's two kill paths. Returns `{ source, changed, problems }`. */
function patchCli(source) {
  if (source.includes('processScan'))
    return { source, changed: false, problems: [] }

  const problems = []
  for (const [anchor, label] of [
    [REQUIRE_ANCHOR, 'the trayRuntime require line'],
    [SWEEP_ANCHOR, 'the stale-process sweep'],
    [SWEEP_KILL, 'the sweep kill loop'],
    [SWEEP_LOOP, 'the sweep kill statement'],
    [PORT_OLD, 'the port-holder kill'],
    [PORT_WAIT, 'the port wait'],
  ]) {
    if (!source.includes(anchor))
      problems.push(`${label} moved`)
  }
  if (problems.length > 0)
    return { source, changed: false, problems }

  let out = source
  out = out.replace(
    REQUIRE_ANCHOR,
    `${REQUIRE_ANCHOR}\nconst { collectAppPids, killAppPids, portOccupantToKill } = require("./src/lib/processScan");`,
  )

  const sweepStart = out.indexOf(SWEEP_ANCHOR)
  const sweepEnd = out.indexOf(SWEEP_KILL, sweepStart)
  out = out.slice(0, sweepStart) + `      let pids = [];
      try {
        pids = collectAppPids();
      } catch {
        /* no processes */
      }

` + out.slice(sweepEnd)
  out = out.replace(SWEEP_KILL, '      if (pids.length > 0) {')
  out = out.replace(SWEEP_LOOP, '        killAppPids(pids);')

  out = out.replace(PORT_OLD, `          const pidOutput = execSync(\`lsof -ti tcp:\${port} -sTCP:LISTEN\`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          if (pidOutput) pid = Number(pidOutput.split('\\n')[0]);`)
  out = out.replace(PORT_WAIT, `      const occupant = portOccupantToKill(pid);
      if (occupant.reason === "own-process-tree") {
        console.warn(\`[port \${port}] is held by pid \${pid}, part of our own process tree — leaving it alone\`);
      } else if (occupant.pid !== null && platform === "win32") {
        execSync(\`taskkill /F /PID \${occupant.pid} 2>nul\`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
      } else if (occupant.pid !== null) {
        execSync(\`kill -9 \${occupant.pid} 2>/dev/null\`, { stdio: 'ignore', timeout: 3000 });
      }

${PORT_WAIT}`)

  if (!out.includes('killAppPids(pids)') || !out.includes('portOccupantToKill(pid)'))
    return { source, changed: false, problems: ['the rewrite did not apply cleanly'] }

  return { source: out, changed: true, problems: [] }
}

const routerDir = resolveRouterDir()
if (!routerDir) {
  if (optional)
    process.exit(0)
  console.error('[patch:9router] 9router is not installed. Run `pnpm install` first.')
  process.exit(1)
}

// ---- 1. capability aliases -------------------------------------------------
const bundleRoot = path.join(routerDir, ...BUNDLE_DIR)
const files = walkJs(bundleRoot)

if (files.length === 0) {
  console.error(`[patch:9router] no bundle found under ${bundleRoot} — 9router layout changed.`)
  process.exit(optional ? 0 : 1)
}

const { from, to } = ALIASES[0]
const pending = []
const aliasFiles = []
const patternFiles = []
const unpatched = []
let capabilityFiles = 0
let patternTables = 0
let occurrences = 0

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8')
  let source = original

  // The caps pattern list is what resolves a model that has no exact capability entry.
  if (original.includes(`pattern:"${GENERIC_CAPS_PATTERN}"`)) {
    patternTables++
    const patterns = patchCapPatterns(source)
    if (patterns.changed) {
      source = patterns.source
      patternFiles.push(path.relative(routerDir, file))
    }
  }

  if (original.includes(`"${from}"`)) {
    const originalBody = capabilityBody(original, from)
    if (originalBody !== null) {
      capabilityFiles++
      const aliased = patchSource(source)
      if (aliased.patched > 0) {
        occurrences += aliased.patched
        source = aliased.source
        aliasFiles.push(path.relative(routerDir, file))
      }
      if (aliased.skipped > 0 && capabilityBody(original, to) !== originalBody)
        unpatched.push(path.relative(routerDir, file))
    }
  }

  if (source !== original)
    pending.push({ file, content: source })
}

if (capabilityFiles === 0 && patternTables === 0) {
  console.error(`[patch:9router] found neither a "${from}" capability table nor the caps pattern list — 9router layout changed.`)
  process.exit(optional ? 0 : 1)
}

// ---- 2. process safety ----------------------------------------------------
const vendorFile = path.join(SCRIPT_DIR, ...VENDOR_MODULE)
const moduleTarget = path.join(routerDir, ...MODULE_TARGET)
const cliFile = path.join(routerDir, CLI_TARGET)
const safety = { problems: [], writes: [] }

if (!fs.existsSync(vendorFile))
  safety.problems.push(`vendored module missing: ${path.relative(SCRIPT_DIR, vendorFile)}`)
else if (!fs.existsSync(cliFile))
  safety.problems.push(`${CLI_TARGET} not found — 9router layout changed`)
else {
  const moduleSource = fs.readFileSync(vendorFile, 'utf8')
  if (!fs.existsSync(moduleTarget) || fs.readFileSync(moduleTarget, 'utf8') !== moduleSource)
    safety.writes.push({ file: moduleTarget, content: moduleSource })

  const patched = patchCli(fs.readFileSync(cliFile, 'utf8'))
  safety.problems.push(...patched.problems)
  if (patched.changed)
    safety.writes.push({ file: cliFile, content: patched.source })
}

if (checkOnly) {
  let failed = false
  if (aliasFiles.length > 0) {
    failed = true
    console.error(`[patch:9router] alias "${to}" missing in ${aliasFiles.length} file(s):`)
    for (const file of aliasFiles) console.error(`  - ${file}`)
  }
  if (patternFiles.length > 0) {
    failed = true
    console.error(`[patch:9router] vision missing from the caps pattern list in: ${patternFiles.join(', ')}`)
  }
  if (unpatched.length > 0) {
    failed = true
    console.error(`[patch:9router] alias present but with different capabilities in: ${unpatched.join(', ')}`)
  }
  if (safety.problems.length > 0) {
    failed = true
    console.error(`[patch:9router] process safety: ${safety.problems.join('; ')}`)
  }
  if (safety.writes.length > 0) {
    failed = true
    console.error(`[patch:9router] process safety missing in: ${safety.writes.map(entry => path.relative(routerDir, entry.file)).join(', ')}`)
  }
  if (failed) {
    console.error('[patch:9router] run `pnpm run patch:9router` to apply')
    process.exit(1)
  }
  console.log(`[patch:9router] ok — ${capabilityFiles} capability file(s), the vision caps pattern list and the process-safety patch are in place`)
  process.exit(0)
}

for (const { file, content } of pending)
  atomicWrite(file, content)
for (const { file, content } of safety.writes)
  atomicWrite(file, content)

if (safety.problems.length > 0)
  console.error(`[patch:9router] process safety: ${safety.problems.join('; ')}`)

console.log(
  `[patch:9router] ${occurrences} alias occurrence(s) in ${aliasFiles.length} file(s); `
  + `${capabilityFiles} capability file(s) verified ("${from}" -> "${to}"); `
  + `vision caps pattern added in ${patternFiles.length} file(s); `
  + `process safety: ${safety.writes.length} file(s) written`,
)
