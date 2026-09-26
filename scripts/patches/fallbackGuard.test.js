import assert from 'node:assert/strict'
import { test } from 'node:test'
import { patchFallbackGuard, REQUEST_SCOPED_STATUSES } from './fallbackGuard.js'

// Shape 9router 0.5.91 ships, verbatim from a server chunk.
const guard = name => `return ${name}>=400&&${name}<500&&401!==${name}&&402!==${name}&&403!==${name}&&429!==${name}?{shouldFallback:!1,cooldownMs:0}:{shouldFallback:!0,cooldownMs:d.wf}`

test('rewrites the gate to the request-scoped allowlist', () => {
  const { source, changed, count } = patchFallbackGuard(guard('a'))

  assert.equal(changed, true)
  assert.equal(count, 1)
  assert.equal(source, `return [${REQUEST_SCOPED_STATUSES.join(',')}].includes(a)?{shouldFallback:!1,cooldownMs:0}:{shouldFallback:!0,cooldownMs:d.wf}`)
})

test('keeps whatever name the minifier chose', () => {
  for (const name of ['$x', '_e2', 'e$t']) {
    const { source, changed } = patchFallbackGuard(guard(name))

    assert.equal(changed, true)
    assert.ok(source.includes(`.includes(${name})`), name)
  }
})

test('rewrites every copy in a file', () => {
  const { count } = patchFallbackGuard(`${guard('a')}\n${guard('b')}`)

  assert.equal(count, 2)
})

test('leaves an already-patched or reshaped gate alone', () => {
  const patched = patchFallbackGuard(guard('a')).source

  for (const source of [patched, 'return a>=400?a:1', 'const shouldFallback = true;']) {
    assert.deepEqual(patchFallbackGuard(source), { source, changed: false, count: 0 })
  }
})

// The rewrite has to behave, not just look right: 412 (Fireworks "account is suspended") must reach
// the next connection, while a request-scoped 400 is still handed back to the caller.
test('the rewritten gate rotates accounts for account-scoped 4xx only', () => {
  const { source } = patchFallbackGuard(guard('a'))
  const decide = new Function('a', 'd', source)
  const d = { wf: 30_000 }

  assert.deepEqual(decide(412, d), { shouldFallback: true, cooldownMs: 30_000 })
  assert.deepEqual(decide(409, d), { shouldFallback: true, cooldownMs: 30_000 })
  assert.deepEqual(decide(503, d), { shouldFallback: true, cooldownMs: 30_000 })
  for (const status of REQUEST_SCOPED_STATUSES)
    assert.deepEqual(decide(status, d), { shouldFallback: false, cooldownMs: 0 }, `${status}`)
})
