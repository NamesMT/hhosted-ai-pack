import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { patchBatchDelete, patchProviderRoute } from './batchDelete.js'
import { balancedEnd } from './providerPage.js'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const routeOriginal = fs.readFileSync(path.join(FIXTURES, 'providersRoute-0.5.104.js'), 'utf8')
const pageOriginal = fs.readFileSync(path.join(FIXTURES, 'providerPage-0.5.104.js'), 'utf8')

const routePatched = patchProviderRoute(routeOriginal)
const pagePatched = patchBatchDelete(pageOriginal, balancedEnd)

test('exports a DELETE handler on the providers route', () => {
  assert.deepEqual(routePatched.missing, [])
  assert.equal(routePatched.changed, true)
  assert.ok(routePatched.source.includes('DELETE:()=>hhDeleteMany'))
  // GET and POST keep their own exports, so a single delete still resolves.
  assert.ok(/c\.d\(b,\{GET:\(\)=>\w+,POST:\(\)=>\w+,DELETE:\(\)=>hhDeleteMany,dynamic:/.test(routePatched.source))
  // The DB adapter is pulled from the module the store itself uses.
  assert.ok(routePatched.source.includes('var hhDb=c(36366)'))
})

test('the DELETE handler deletes in one transaction and renumbers once per provider', () => {
  const { source } = routePatched

  // One transaction, not one per id: that is the whole point of the rewrite.
  assert.equal(source.match(/\.transaction\(/g).length, 1)
  // `id` is the per-request id; the handler's own parameter must not collide with a loop variable,
  // which is what made `a.run` undefined when this was first written.
  assert.ok(source.includes('async function hhDeleteMany(req)'))
  assert.ok(source.includes('for(let id of ids)'))
  // A provider whose rows were touched is renumbered exactly once, after the deletes.
  assert.ok(source.includes('for(let provider of providers)hhRenumber(db,provider)'))
  assert.ok(source.includes('UPDATE providerConnections SET priority = ? WHERE id = ?'))
})

test('the rewritten route still parses and is a no-op on a second run', () => {
  assert.doesNotThrow(() => new Function(routePatched.source))
  const twice = patchProviderRoute(routePatched.source)

  assert.equal(twice.changed, false)
  assert.equal(twice.source, routePatched.source)
})

test('reports a moved anchor on the route instead of half-patching', () => {
  for (const anchor of ['c.d(b,{GET:()=>l,POST:()=>m,dynamic:()=>j})', 'var d=c(23211)', 'let j="force-dynamic";']) {
    assert.ok(routeOriginal.includes(anchor), `fixture must carry ${anchor}`)
    const result = patchProviderRoute(routeOriginal.replace(anchor, 'x'))

    assert.equal(result.changed, false, anchor)
    assert.ok(result.missing.length > 0, anchor)
  }
})

test('rewires the dashboard batch delete to one request', () => {
  assert.deepEqual(pagePatched.missing, [])
  assert.equal(pagePatched.changed, true)
  const { source } = pagePatched

  assert.ok(source.includes('fetch("/api/providers",{method:"DELETE"'))
  assert.ok(source.includes('body:JSON.stringify({ids:e})'))
  // Only what the server confirmed is removed from the list, so a refused id stays visible.
  assert.ok(source.includes('d=Array.isArray(s?.deletedIds)?s.deletedIds:[]'))
  assert.ok(source.includes('e=>e.filter(e=>!d.includes(e.id))'))
  // The serial loop is gone.
  assert.ok(!source.includes('for(let s of t)try'))
})

test('the rewired page still parses and is a no-op on a second run', () => {
  assert.doesNotThrow(() => new Function(pagePatched.source))
  const twice = patchBatchDelete(pagePatched.source, balancedEnd)

  assert.equal(twice.changed, false)
  assert.equal(twice.source, pagePatched.source)
})

test('the serial loop is what identifies the handler, not a bare onConfirm', () => {
  // The page has several `onConfirm:async()=>{` handlers; only the delete one loops per id.
  const moved = pageOriginal.replace(
    /for\(let \w+ of \w+\)try\{\(await fetch\(`\/api\/providers\/\$\{\w+\}`,/,
    'for(let x of y)try{(await fetch(`/api/other/${x}`,',
  )
  const result = patchBatchDelete(moved, balancedEnd)

  assert.equal(result.changed, false)
  assert.deepEqual(result.missing, ['the serial batch delete loop'])
})

// The installed router is patched in place by this very script, so the fixtures carry the builds
// the version claims; `check:patch` is the gate once the install moves on.
test('the fixtures are the builds 9router 0.5.104 ships', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'node_modules', '9router', 'package.json'), 'utf8'),
  )

  if (pkg.version !== '0.5.104')
    return

  // Pristine: the exports table has no DELETE, and the page still has the serial loop.
  assert.ok(routeOriginal.includes('c.d(b,{GET:()=>l,POST:()=>m,dynamic:()=>j})'))
  assert.ok(!routeOriginal.includes('hhDeleteMany'))
  assert.ok(pageOriginal.includes('for(let s of t)try'))
  assert.ok(!pageOriginal.includes('deletedIds'))
})
