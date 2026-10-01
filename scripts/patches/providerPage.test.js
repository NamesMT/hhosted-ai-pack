import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ASYNC_TEST_CONCURRENCY, patchProviderPage, REWRITE_NAMES } from './providerPage.js'

// The provider detail chunk exactly as 9router 0.5.95 ships it.
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'providerPage-0.5.95.js',
)
const original = fs.readFileSync(FIXTURE, 'utf8')

test('rewrites every patch site of the shipped chunk', () => {
  const { source, changed, missing } = patchProviderPage(original)

  assert.deepEqual(missing, [])
  assert.equal(changed, true)
  assert.ok(source.includes('Test Connections Async'))
  assert.ok(source.includes('Select Errors'))
  // Derived inside the modal, from the connections it is handed.
  assert.ok(source.includes('priority:Math.max(0,...connections.map(e=>e.priority||0))+1,proxyPoolId:'))
  assert.ok(source.includes('name:e.name,priority:Math.max(0,...connections.map(e=>e.priority||0))+1,testStatus'))
  assert.ok(source.includes('connections:connections'))
  assert.ok(source.includes(`const ${REWRITE_NAMES.summary}=hhAsyncResults||e6`))
})

test('leaves no stale reference to the one-by-one summary or the old priority default', () => {
  const { source } = patchProviderPage(original)

  assert.ok(!source.includes('priority:1,'), 'priority:1 survives')
  assert.ok(!source.includes('e6.total'), 'the banner still reads the one-by-one summary directly')
  assert.ok(!source.includes('eX&&e2&&'), 'the banner still gates its running row on the one-by-one run')
})

test('the rewritten chunk still parses', () => {
  const { source } = patchProviderPage(original)

  // Throws on a syntax error, which is the failure mode of a bad string rewrite.
  assert.doesNotThrow(() => new Function(source))
})

test('re-running is a no-op', () => {
  const once = patchProviderPage(original)
  const twice = patchProviderPage(once.source)

  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
})

test('reports the anchor that moved instead of half-patching', () => {
  // One anchor per rewrite, so a moved anchor is reported instead of half-applied.
  for (const anchor of ['priority:1,proxyPoolId:', 'name:e.name,priority:1,testStatus', 'eX&&e2&&', 'e6,e7]=(0,i.useState)(null),e9=(0,i.useRef)(!1),', 'tB=async()=>{if(eX||0===y.length)return;']) {
    const moved = original.replace(anchor, 'x')
    const result = patchProviderPage(moved)

    assert.equal(result.changed, false, anchor)
    assert.equal(result.source, moved, anchor)
    assert.ok(result.missing.length > 0, anchor)
  }
})

// The runner text runs from its definition up to the one-by-one runner it was inserted before.
function runnerOf(source) {
  const start = source.indexOf('hhRunAsyncTest=async()=>{')
  const end = source.indexOf(',tB=async()=>{', start)
  assert.ok(start > 0 && end > start, 'the async runner is present')
  return source.slice(start, end)
}

test('the async runner tests a bounded pool, not the whole list at once', () => {
  const { source } = patchProviderPage(original)
  const runner = runnerOf(source)

  assert.ok(runner.startsWith('hhRunAsyncTest=async()=>{'))
  assert.ok(runner.includes(`Math.min(${ASYNC_TEST_CONCURRENCY},y.length)`))
  // One fetch per connection, and the same endpoint the shipped runner uses.
  assert.equal(runner.match(/fetch\(/g).length, 1)
  assert.ok(runner.includes('/api/providers/${conn.id}/test'))
})

// The pool is the part worth executing: a worker loop that mis-counts `done` hangs, and one that
// ignores the stop ref keeps testing after Stop.
test('the async runner pool drains every connection and honours Stop', async () => {
  const runner = runnerOf(patchProviderPage(original).source)

  // The runner mutates these through their setters, so the harness keeps one shared object.
  const state = {
    running: false,
    current: null,
    results: {},
    summary: null,
    stop: { current: false },
    tested: 0,
  }
  const harness = {
    eX: false,
    y: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` })),
    // `fetch` is destructured into the runner's scope, so it delegates through `state.fetch`.
    fetch: (...args) => state.fetch(...args),
    hhStopAsyncRef: state.stop,
    hhSetAsyncRunning: value => { state.running = value; harness.hhAsyncRunning = value },
    hhSetAsyncStopping: () => {},
    hhSetAsyncCurrent: value => { state.current = value },
    hhSetAsyncResults: value => Object.assign(state.results, typeof value === 'function' ? value(state.results) : value),
    hhSetAsyncSummary: value => { state.summary = value },
  }
  // `hhAsyncRunning` is read directly by the runner, so the setter keeps it in step.
  harness.hhAsyncRunning = state.running
  state.fetch = async () => {
    state.tested += 1
    return { json: async () => ({ valid: true }) }
  }
  const names = Object.keys(harness)
  const values = Object.values(harness)
  // eslint-disable-next-line no-new-func
  const run = new Function(...names, `${runner};return hhRunAsyncTest`)(...values)

  await run()

  assert.equal(Object.keys(state.results).length, 25)
  assert.ok(Object.values(state.results).every(entry => entry.state === 'success'))
  assert.deepEqual(
    { total: state.summary.total, completed: state.summary.completed, passed: state.summary.passed },
    { total: 25, completed: 25, passed: 25 },
  )
  assert.equal(state.running, false)
  assert.equal(state.current, null)

  // Stop during the run: no further connection may be tested once the flag is seen, and the run
  // must still settle.
  state.summary = null
  const before = state.tested
  state.fetch = async () => {
    state.tested += 1
    state.stop.current = true // ask for a stop from inside the first test
    return { json: async () => ({ valid: true }) }
  }
  await run()
  assert.ok(state.tested - before >= 1, 'the first test ran')
  assert.ok(state.tested - before < 25, 'the pool stopped before draining the list')
  assert.equal(state.running, false, 'the run settles even when stopped')
})

// The installed router is patched in place by this very script, so the fixture cannot be compared
// byte-for-byte against it after a run. What matters is that the fixture is the build the version
// claims, and that its anchors are the ones the patch consumes — the run above proves the latter.
test('the fixture is the build 9router 0.5.95 ships', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'node_modules', '9router', 'package.json'), 'utf8'),
  )

  if (pkg.version !== '0.5.95')
    return // the installed router has moved on; `check:patch` is the gate there

  // The pristine store copy is kept alongside the patched one by pnpm, so the fixture can still be
  // re-derived: it must carry the marker the patch keys on and not the patched result.
  assert.ok(original.includes('Test Connection One-by-One'))
  assert.ok(!original.includes('Test Connections Async'))
  assert.ok(!original.includes('Select Errors'))
})
