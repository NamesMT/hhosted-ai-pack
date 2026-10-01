/**
 * Matcher for 9router's provider detail page — the dashboard rewrites of
 * `scripts/patch-9router.js`, kept here so `pnpm run test:patch` can pin the shape they rewrite.
 *
 * Three changes, all in the same minified React chunk (and in its server-rendered twin):
 *
 * 1. New keys land last. `AddApiKeyModal` hardcodes `priority: 1` on both the single and the bulk
 *    add path, and the pool is served in ascending priority — so a fresh key is tried *before* the
 *    keys that already work. The next free priority is threaded in as a `nextPriority` prop
 *    (`MAX(priority) + 1`), which is exactly the slot the API hands out when the field is omitted.
 *
 * 2. Select Errors. The bulk bar already had a Select All checkbox; this adds the same control for
 *    the connections whose last test failed (`testSingleConnection` writes `testStatus: "error"`),
 *    so a broken batch can be selected in one click.
 *
 * 3. Test Connections Async. The shipped runner walks the pool one connection at a time with a 1s
 *    sleep between calls. A worker pool of `ASYNC_TEST_CONCURRENCY` hits the same
 *    `/api/providers/:id/test` endpoint concurrently, reusing the one-by-one result shape, summary
 *    and Stop behaviour.
 *
 * The bundle is minified, so every rewrite is anchored on the exact code 0.5.95 ships; a release
 * that reshapes it reports the anchor that moved and is otherwise left alone, and `--check` turns
 * that into a loud failure instead of a silent one. Re-running is a no-op.
 */

/** Connections tested at once by the async run. */
export const ASYNC_TEST_CONCURRENCY = 10

// The Add API Key modal is its own component, so `nextPriority` has to be derived inside it from
// the connections it is handed; a name defined in the page component is not in its scope.
const MODAL_CALL_ANCHOR = 'proxyPools:O,error:G,existingNames:y.map(e=>e.name).filter(Boolean),onSave:tV'
const MODAL_CALL_REPLACEMENT = 'proxyPools:O,connections:y,error:G,existingNames:y.map(e=>e.name).filter(Boolean),onSave:tV'
const MODAL_SIG_ANCHOR = 'proxyPools:p,error:u,existingNames:x,onSave:h'
const MODAL_SIG_REPLACEMENT = 'proxyPools:p,connections:connections,error:u,existingNames:x,onSave:h'
const FORM_ANCHOR = 'priority:1,proxyPoolId:'
const FORM_REPLACEMENT = 'priority:Math.max(0,...connections.map(e=>e.priority||0))+1,proxyPoolId:'
const BULK_ADD_ANCHOR = 'name:e.name,priority:1,testStatus'
const BULK_ADD_REPLACEMENT = 'name:e.name,priority:Math.max(0,...connections.map(e=>e.priority||0))+1,testStatus'
const NEXT_PRIORITY_ANCHOR = 't0=y.length>0&&eN.length===y.length;'

const CHECKBOX_CLASS = 'h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary'

// The Select Errors control rides in the toolbar beside the test buttons. Making it a sibling of
// the Select All checkbox would mean re-nesting the label/div pair, and the minified JSX only
// tolerates that through exact bracket surgery; a toolbar button needs none.
const SELECT_ERRORS_ANCHOR = 'children:eX?"Testing Connection One-by-One...":"Test Connection One-by-One"})'
const SELECT_ERRORS_REPLACEMENT = `${SELECT_ERRORS_ANCHOR},(0,a.jsx)(c.$n,{size:"sm",variant:"secondary",icon:"error",onClick:()=>{let e=y.filter(e=>"error"===e.testStatus).map(e=>e.id);eN.length>0&&eN.length===e.length?eC([]):eC(e)},title:"Select every connection whose last test failed",children:"Select Errors"})`

// The one-by-one runner, verbatim from the 0.5.95 chunk.
const RUN_ANCHOR = 'tB=async()=>{if(eX||0===y.length)return;let e=Object.fromEntries(y.map(e=>[e.id,{state:"queued",error:null}]));e9.current=!1,eY(!0),e1(!1),e5(null),e4(e),e7({total:y.length,completed:0,passed:0,failed:0,stopped:!1});let t=0,s=0;try{for(let e=0;e<y.length;e+=1){if(e9.current){e7({total:y.length,completed:e,passed:t,failed:s,stopped:!0});break}let a=y[e];e5(a.id),e4(e=>({...e,[a.id]:{state:"testing",error:null}}));try{let e=await fetch(`/api/providers/${a.id}/test`,{method:"POST"}),i=await e.json(),l=!!i.valid;l?t+=1:s+=1,e4(e=>({...e,[a.id]:{state:l?"success":"failed",error:l?null:i.error||null}}))}catch(e){s+=1,e4(t=>({...t,[a.id]:{state:"failed",error:e.message||"Test failed"}}))}e7({total:y.length,completed:e+1,passed:t,failed:s,stopped:!1}),e<y.length-1&&await new Promise(e=>setTimeout(e,1e3))}}finally{e5(null),eY(!1),e1(!1),e9.current=!1}},'

// The state block ends at the one-by-one stop ref; the async run gets its own set beside it.
const STATE_ANCHOR = 'e6,e7]=(0,i.useState)(null),e9=(0,i.useRef)(!1),'
const STATE_REPLACEMENT = `${STATE_ANCHOR}[hhAsyncRunning,hhSetAsyncRunning]=(0,i.useState)(!1),[hhAsyncStopping,hhSetAsyncStopping]=(0,i.useState)(!1),[hhAsyncCurrent,hhSetAsyncCurrent]=(0,i.useState)(null),[hhAsyncResults,hhSetAsyncResults]=(0,i.useState)(null),[hhAsyncSummary,hhSetAsyncSummary]=(0,i.useState)(null),hhStopAsyncRef=(0,i.useRef)(!1),`

// Same queued/testing/success/failed states and Stop semantics as the shipped runner, driven by a
// pool of ASYNC_TEST_CONCURRENCY workers instead of a 1s-per-key serial loop.
const RUN_REPLACEMENT = `hhRunAsyncTest=async()=>{if(eX||hhAsyncRunning||0===y.length)return;hhStopAsyncRef.current=!1,hhSetAsyncRunning(!0),hhSetAsyncStopping(!1),hhSetAsyncCurrent(null),hhSetAsyncResults(Object.fromEntries(y.map(e=>[e.id,{state:"queued",error:null}]))),hhSetAsyncSummary({total:y.length,completed:0,passed:0,failed:0,stopped:!1});let done=0,passed=0,failed=0;await Promise.all(Array.from({length:Math.min(${ASYNC_TEST_CONCURRENCY},y.length)},async()=>{for(;;){if(hhStopAsyncRef.current)return;let idx=done;if(done+=1,idx>=y.length)return;let conn=y[idx];hhSetAsyncCurrent(conn.id),hhSetAsyncResults(e=>({...e,[conn.id]:{state:"testing",error:null}}));try{let res=await fetch(\`/api/providers/\${conn.id}/test\`,{method:"POST"}),data=await res.json(),valid=!!data.valid;valid?passed+=1:failed+=1,hhSetAsyncResults(e=>({...e,[conn.id]:{state:valid?"success":"failed",error:valid?null:data.error||null}}))}catch(err){failed+=1,hhSetAsyncResults(e=>({...e,[conn.id]:{state:"failed",error:err.message||"Test failed"}}))}hhSetAsyncSummary({total:y.length,completed:passed+failed,passed,failed,stopped:!1})}})),hhSetAsyncCurrent(null),hhSetAsyncRunning(!1),hhSetAsyncStopping(!1),hhStopAsyncRef.current=!1},${RUN_ANCHOR}`

// The shipped summary banner, verbatim: rendered from the one-by-one run only.
const SUMMARY_ANCHOR = 'e6&&(0,a.jsx)("div",{className:"mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]",children:(0,a.jsxs)("div",{className:"flex flex-wrap items-center gap-3",children:[(0,a.jsxs)("span",{children:["Total: ",e6.total]}),(0,a.jsxs)("span",{children:["Completed: ",e6.completed]}),(0,a.jsxs)("span",{children:["Passed: ",e6.passed]}),(0,a.jsxs)("span",{children:["Failed: ",e6.failed]}),e6.stopped&&(0,a.jsx)("span",{className:"text-amber-600 dark:text-amber-400",children:"Stopped"}),eX&&e2&&(0,a.jsxs)("span",{children:["Running: ",y.find(e=>e.id===e2)?.name||e2]})]})}),'
const SUMMARY_VARIABLE = 'hhActiveTestSummary'

// One summary banner and one Stop button, shared by both runs.
const TEST_BUTTON_ANCHOR = 'children:eX?"Testing Connection One-by-One...":"Test Connection One-by-One"}),eX&&(0,a.jsx)(c.$n,{size:"sm",variant:"ghost",icon:"stop",onClick:()=>{eX&&(e9.current=!0,e1(!0))},disabled:e0,children:e0?"Stopping...":"Stop"})'
const TEST_BUTTON_REPLACEMENT = `${TEST_BUTTON_ANCHOR},(0,a.jsx)(c.$n,{size:"sm",variant:"secondary",icon:"bolt",onClick:hhRunAsyncTest,disabled:eX||hhAsyncRunning,children:hhAsyncRunning?"Testing Connections Async...":"Test Connections Async"}),hhAsyncRunning&&(0,a.jsx)(c.$n,{size:"sm",variant:"ghost",icon:"stop",onClick:()=>{hhAsyncRunning&&(hhStopAsyncRef.current=!0,hhSetAsyncStopping(!0))},disabled:hhAsyncStopping,children:hhAsyncStopping?"Stopping...":"Stop"})`

/**
 * Rewrites every patch site in `source`.
 *
 * Returns `{ source, changed, missing }`, where `missing` names each anchor that no longer matches —
 * the signal that 9router reshaped the page and the rewrite has to be re-derived.
 */
export function patchProviderPage(source) {
  const anchors = [
    [MODAL_CALL_ANCHOR, 'the Add API Key modal call'],
    [MODAL_SIG_ANCHOR, 'the Add API Key modal props'],
    [FORM_ANCHOR, 'the Add API Key priority default'],
    [BULK_ADD_ANCHOR, 'the bulk-add priority'],
    [NEXT_PRIORITY_ANCHOR, 'the selection helpers'],
    [SELECT_ERRORS_ANCHOR, 'the one-by-one test button'],
    [STATE_ANCHOR, 'the one-by-one test state'],
    [RUN_ANCHOR, 'the one-by-one test runner'],
    [SUMMARY_ANCHOR, 'the test summary'],
    [TEST_BUTTON_ANCHOR, 'the test button row'],
  ]

  if (source.includes('Test Connections Async'))
    return { source, changed: false, missing: [] }

  const missing = anchors.filter(([anchor]) => !source.includes(anchor)).map(([, label]) => label)
  if (missing.length > 0)
    return { source, changed: false, missing }

  // Scoped to the banner, so the `e2`/`e6` state pairs keep their own names everywhere else.
  const summary = SUMMARY_ANCHOR
    .replace(/e6/g, SUMMARY_VARIABLE)
    .replace(/eX&&e2&&/g, 'hhAsyncRunning&&hhAsyncCurrent&&')
    .replace(/e2/g, 'hhAsyncCurrent')

  const out = source
    .replace(MODAL_CALL_ANCHOR, MODAL_CALL_REPLACEMENT)
    .replace(MODAL_SIG_ANCHOR, MODAL_SIG_REPLACEMENT)
    .replace(FORM_ANCHOR, FORM_REPLACEMENT)
    .replace(BULK_ADD_ANCHOR, BULK_ADD_REPLACEMENT)
    .replace(
      NEXT_PRIORITY_ANCHOR,
      `${NEXT_PRIORITY_ANCHOR}const ${SUMMARY_VARIABLE}=hhAsyncResults||e6;`,
    )
    .replace(STATE_ANCHOR, STATE_REPLACEMENT)
    .replace(RUN_ANCHOR, RUN_REPLACEMENT)
    .replace(SUMMARY_ANCHOR, summary)
    .replace(TEST_BUTTON_ANCHOR, TEST_BUTTON_REPLACEMENT)
    .replace(SELECT_ERRORS_ANCHOR, SELECT_ERRORS_REPLACEMENT)

  return { source: out, changed: true, missing: [] }
}

/** The derived names the rewrite introduces, exported so the test can pin them. */
export const REWRITE_NAMES = { summary: SUMMARY_VARIABLE, nextPriority: 'nextPriority' }
