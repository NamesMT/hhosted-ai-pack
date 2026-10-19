/**
 * Batch delete for 9router's provider connections — step 4 of `scripts/patch-9router.js`.
 *
 * The dashboard's "Delete Selected" walks the selection one id at a time and `await`s each
 * `DELETE /api/providers/:id`. Every one of those is a separate HTTP round trip *and* a separate
 * `deleteProviderConnection`, which renumbers the provider's whole pool inside its own transaction —
 * so the work is O(n) network plus O(n²) row updates, and a 57-key pool took ~390 ms locally to
 * grow to seconds on a slower disk.
 *
 * Two rewrites, both idempotent:
 *
 * 1. **Server**: `DELETE /api/providers` with `{ ids }` deletes the set in one transaction and
 *    renumbers each touched provider once, returning `{ deletedIds, deleted, missing, total }`.
 *    Contiguity is not required by anything that reads `priority` — every consumer sorts by the
 *    number — so one renumber per touched provider is enough to keep the UI's `#n` labels tidy.
 *
 * 2. **Client**: the confirmation handler posts that one request instead of the serial loop, and
 *    filters the pool by the ids the server reports as deleted rather than everything it tried.
 *
 * Anchors are shape-based for the same reason as the provider page: a release re-minifies and
 * renames. A release that moves them reports the anchor and is left alone.
 */

/** Exports table of the providers route module (`app/api/providers/route.js`). */
const ROUTE_EXPORTS_RE = /(c\.d\(b,\{GET:\(\)=>\w+,POST:\(\)=>\w+)(,dynamic:\(\)=>\w+\}\))/
/** The module id holding the DB adapter (`getDb()`), reached through the bundle's require. */
const DB_MODULE = '36366'
const ROUTE_VARS_RE = /var (\w+)=c\(23211\)/
/** Everything the injected code is appended after. */
const DYNAMIC_ANCHOR_RE = /let (\w+)="force-dynamic";/

const HANDLERS = `async function hhDeleteMany(req){try{let payload=await req.json(),ids=Array.isArray(payload?.ids)?[...new Set(payload.ids.filter(k=>"string"==typeof k&&k.length>0))]:[];if(0===ids.length)return hhNext.NextResponse.json({error:"ids is required"},{status:400});let db=await (0,hhDb.c)(),deleted=[],missing=[],providers=new Set;db.transaction(()=>{for(let id of ids){let row=db.get("SELECT provider FROM providerConnections WHERE id = ?",[id]);if(!row){missing.push(id);continue}db.run("DELETE FROM providerConnections WHERE id = ?",[id]),deleted.push(id),row.provider&&providers.add(row.provider)}for(let provider of providers)hhRenumber(db,provider)});return hhNext.NextResponse.json({deletedIds:deleted,deleted:deleted.length,missing:missing.length,total:ids.length})}catch(err){return console.log("Error deleting connections:",err),hhNext.NextResponse.json({error:"Failed to delete connections"},{status:500})}}function hhRenumber(db,provider){let rows=db.all("SELECT id, priority, updatedAt FROM providerConnections WHERE provider = ?",[provider]);rows.sort((a,b)=>{let c=(a.priority||0)-(b.priority||0);return 0!==c?c:new Date(b.updatedAt||0)-new Date(a.updatedAt||0)}),rows.forEach((row,i)=>{let next=i+1;(row.priority||0)!==next&&db.run("UPDATE providerConnections SET priority = ? WHERE id = ?",[next,row.id])})}`

/**
 * Rewrites the providers route module to export `DELETE`.
 *
 * Returns `{ source, changed, missing }`; `missing` names the anchor that moved.
 */
export function patchProviderRoute(source) {
  const ready = source.includes('hhDeleteMany')
  if (ready)
    return { source, changed: false, missing: [] }

  const exportsMatch = ROUTE_EXPORTS_RE.exec(source)
  const varsMatch = ROUTE_VARS_RE.exec(source)
  const dynamicMatch = DYNAMIC_ANCHOR_RE.exec(source)
  const missing = []
  if (exportsMatch === null)
    missing.push('the route module exports table')
  if (varsMatch === null)
    missing.push('the route module requires')
  if (dynamicMatch === null)
    missing.push('the route module force-dynamic marker')
  if (missing.length > 0)
    return { source, changed: false, missing }

  const next = varsMatch[1]
  const handlers = HANDLERS.replaceAll('hhNext', next)

  let out = source
  out = out.replace(exportsMatch[0], `${exportsMatch[1]},DELETE:()=>hhDeleteMany${exportsMatch[2]}`)
  out = out.replace(varsMatch[0], `var hhDb=c(${DB_MODULE}),${varsMatch[0].slice(4)}`)
  out = out.replace(dynamicMatch[0], `${dynamicMatch[0]}${handlers}`)

  if (!out.includes('DELETE:()=>hhDeleteMany') || !out.includes(`var hhDb=c(${DB_MODULE})`))
    return { source, changed: false, missing: ['the route rewrite did not apply cleanly'] }

  return { source: out, changed: true, missing: [] }
}

/**
 * The batch-delete handler, identified by the loop it runs rather than by `onConfirm`, which the
 * page uses for several unrelated confirmations.
 */
const CLIENT_LOOP_RE = /onConfirm:async\(\)=>\{([^{}]*?)for\(let (\w+) of (\w+)\)try\{\(await fetch\(`\/api\/providers\/\$\{\2\}`,/

/** Reads the identifiers the handler body binds, so the rewrite keeps them. */
function clientIdentifiers(body) {
  const clear = /^(\w+)\(null\)/.exec(body)
  const loop = /let (\w+)=0,(\w+)=\[\.\.\.(\w+)\];for\(let \w+ of \2\)/.exec(body)
  const filter = /(\w+)\(\w+=>\w+\.filter\(\w+=>!\w+\.includes\(\w+\.id\)\)\)/.exec(body)
  const clearSelection = /,(\w+)\(\[\]\),/.exec(body)
  if (clear === null || loop === null || filter === null || clearSelection === null)
    return null
  return { clear: clear[1], ids: loop[2], selected: loop[3], setConnections: filter[1], setSelected: clearSelection[1] }
}

/**
 * Rewrites the dashboard's batch-delete handler to one request.
 *
 * Returns `{ source, changed, missing }`; `missing` names what no longer matches.
 */
export function patchBatchDelete(source, endOf) {
  // Already rewired: the handler reads the ids the endpoint reports back.
  if (source.includes('deletedIds'))
    return { source, changed: false, missing: [] }

  const match = CLIENT_LOOP_RE.exec(source)
  if (match === null)
    return { source, changed: false, missing: ['the serial batch delete loop'] }

  const bodyStart = match.index + 'onConfirm:async()=>{'.length
  const open = bodyStart - 1
  const close = endOf(source, open)
  if (close < 0)
    return { source, changed: false, missing: ['the batch delete handler that does not balance'] }

  const body = source.slice(bodyStart, close)
  const ids = clientIdentifiers(body)
  if (ids === null)
    return { source, changed: false, missing: ['the batch delete handler identifiers'] }

  const replacement = `{${ids.clear}(null);let e=[...${ids.selected}],d=[];try{let r=await fetch("/api/providers",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:e})}),s=await r.json().catch(()=>({}));if(!r.ok)throw Error(s?.error||"Batch delete failed");d=Array.isArray(s?.deletedIds)?s.deletedIds:[]}catch(r){console.log("Error deleting connections:",r)}${ids.setConnections}(e=>e.filter(e=>!d.includes(e.id))),${ids.setSelected}([]),d.length<e.length&&alert(\`Deleted \${d.length} connection(s), \${e.length-d.length} failed.\`)}`

  const out = source.slice(0, open) + replacement + source.slice(close)
  if (!out.includes('deletedIds'))
    return { source, changed: false, missing: ['the batch delete rewrite did not apply cleanly'] }

  return { source: out, changed: true, missing: [] }
}
