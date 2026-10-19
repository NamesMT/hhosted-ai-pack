import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ASYNC_TEST_CONCURRENCY, balancedEnd, jsxElementEnd, patchProviderPage, REWRITE_NAMES } from './providerPage.js'

// The provider detail chunk exactly as 9router 0.5.104 ships it.
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'providerPage-0.5.104.js',
)
const original = fs.readFileSync(FIXTURE, 'utf8')
const patched = patchProviderPage(original)

test('rewrites every patch site of the shipped chunk', () => {
  assert.deepEqual(patched.missing, [])
  assert.equal(patched.changed, true)
  assert.ok(patched.source.includes('Test Connections Async'))
  assert.ok(patched.source.includes('Select Errors'))
  // Derived inside the modal, from the connections it is handed.
  assert.ok(patched.source.includes('priority:Math.max(0,...connections.map(e=>e.priority||0))+1,proxyPoolId:'))
  assert.ok(patched.source.includes('name:e.name,priority:Math.max(0,...connections.map(e=>e.priority||0))+1,testStatus'))
  assert.ok(patched.source.includes('connections:connections'))
  // The same connections list the modal already receives is the one it derives from.
  assert.ok(patched.source.includes(`connections:${patched.identifiers.list},`))
})

test('leaves no stale reference to the one-by-one summary or the old priority default', () => {
  const { source, identifiers } = patched

  assert.ok(!source.includes('priority:1,'), 'priority:1 survives')
  // The banner reads whichever run is reporting, and its running row follows the async one.
  assert.ok(source.includes(`(hhAsyncResults||${identifiers.summary}).total`))
  assert.ok(!source.includes(`${identifiers.running}&&${identifiers.current}&&`), 'the banner still gates on the one-by-one run')
})

test('the rewritten chunk still parses', () => {
  // Throws on a syntax error, which is the failure mode of a bad string rewrite.
  assert.doesNotThrow(() => new Function(patched.source))
})

test('re-running is a no-op', () => {
  const twice = patchProviderPage(patched.source)

  assert.equal(twice.changed, false)
  assert.equal(twice.source, patched.source)
})

test('reports the anchor that moved instead of half-patching', () => {
  // One anchor per rewrite, so a moved anchor is reported instead of half-applied.
  for (const anchor of [
    'priority:1,proxyPoolId:',
    'name:e.name,priority:1,testStatus',
    'children:["Running: ",',
    `Object.fromEntries(${patched.identifiers.list}.map`,
  ]) {
    assert.ok(original.includes(anchor), `fixture must carry ${anchor}`)
    const moved = original.replace(anchor, 'x')
    const result = patchProviderPage(moved)

    assert.equal(result.changed, false, anchor)
    assert.equal(result.source, moved, anchor)
    assert.ok(result.missing.length > 0, anchor)
  }
})

test('refuses a build whose sites name different objects', () => {
  // The toolbar's list and the runner's have to be the same one; a rename of either must not be
  // silently wired to another page's connections.
  const moved = original.replace(
    `${patched.identifiers.stopRef}.current=!0`,
    'otherRef.current=!0',
  )
  const result = patchProviderPage(moved)

  assert.equal(result.changed, false)
  assert.deepEqual(result.missing, ['the test sites disagree about their identifiers'])
})

test('balancedEnd measures a whole expression and jsxElementEnd the element it builds', () => {
  // A minified element is a chain: the factory lookup is its own balanced group.
  const text = 'a(0,f.jsx)(Comp,{children:[1,2]})b'
  const start = text.indexOf('(0,')

  assert.equal(balancedEnd(text, start), text.indexOf('(Comp'))
  assert.equal(jsxElementEnd(text, start), text.length - 1)
})

// The async runner's text, from its definition up to the serial runner that follows it.
function runnerOf(source) {
  const start = source.indexOf(`${REWRITE_NAMES.runner}=async()=>{`)
  assert.ok(start > 0, 'the async runner is present')
  // The serial runner is the only `=async()=>{if(<x>||0===<y>.length)return;let ` in the build.
  const serial = /=async\(\)=>\{if\(\w+\|\|0===\w+\.length\)return;let /.exec(source.slice(start))
  assert.ok(serial !== null, 'the serial runner follows it')
  // The serial runner's name starts at the identifier before its `=`; drop the separating comma.
  return source.slice(start, start + source.slice(start).lastIndexOf(',', serial.index))
}

test('the async runner tests a bounded pool, not the whole list at once', () => {
  const runner = runnerOf(patched.source)

  assert.ok(runner.startsWith(`${REWRITE_NAMES.runner}=async()=>{`))
  assert.ok(runner.includes(`Math.min(${ASYNC_TEST_CONCURRENCY},${patched.identifiers.list}.length)`))
  // One fetch per connection, and the same endpoint the shipped runner uses.
  assert.equal(runner.match(/fetch\(/g).length, 1)
  assert.ok(runner.includes('/api/providers/${conn.id}/test'))
})

// The pool is the part worth executing: a worker loop that mis-counts `done` hangs, and one that
// ignores the stop ref keeps testing after Stop.
test('the async runner pool drains every connection and honours Stop', async () => {
  const runner = runnerOf(patched.source)
  const { identifiers } = patched

  // The runner mutates these through their setters, so the harness keeps one shared object.
  const state = { running: false, current: null, results: {}, summary: null, stop: { current: false }, tested: 0 }
  const harness = {
    hhStopAsyncRef: state.stop,
    hhSetAsyncRunning: (value) => { state.running = value; harness.hhAsyncRunning = value },
    hhSetAsyncStopping: () => {},
    hhSetAsyncCurrent: (value) => { state.current = value },
    hhSetAsyncResults: value => Object.assign(state.results, typeof value === 'function' ? value(state.results) : value),
    hhSetAsyncSummary: (value) => { state.summary = value },
    fetch: (...args) => state.fetch(...args),
    hhAsyncRunning: false,
  }
  // The runner reads the shipped identifiers directly: its guard, the list it drains, and the
  // summary/current the banner is wired to.
  harness[identifiers.running] = false
  harness[identifiers.list] = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }))
  harness[identifiers.summary] = null
  harness[identifiers.current] = null
  state.fetch = async () => {
    state.tested += 1
    return { json: async () => ({ valid: true }) }
  }
  const names = Object.keys(harness)
  const values = Object.values(harness)
  // eslint-disable-next-line no-new-func
  const callable = new Function(...names, `${runner};return ${REWRITE_NAMES.runner}`)(...values)

  await callable()

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
  await callable()
  assert.ok(state.tested - before >= 1, 'the first test ran')
  assert.ok(state.tested - before < 25, 'the pool stopped before draining the list')
  assert.equal(state.running, false, 'the run settles even when stopped')
})

// The installed router is patched in place by this very script, so the fixture cannot be compared
// byte-for-byte against it after a run. What matters is that the fixture is the build the version
// claims, and that its anchors are the ones the patch consumes — the run above proves the latter.
test('the fixture is the build 9router 0.5.104 ships', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'node_modules', '9router', 'package.json'), 'utf8'),
  )

  if (pkg.version !== '0.5.104')
    return // the installed router has moved on; `check:patch` is the gate there

  assert.ok(original.includes('Test Connection One-by-One'))
  assert.ok(!original.includes('Test Connections Async'))
  assert.ok(!original.includes('Select Errors'))
})
