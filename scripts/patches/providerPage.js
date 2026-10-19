/**
 * Matcher for 9router's provider detail page — the dashboard rewrites of
 * `scripts/patch-9router.js`, kept here so `pnpm run test:patch` can pin the shape they rewrite.
 *
 * Three changes, in the minified React chunk and in its server-rendered twin:
 *
 * 1. New keys land last. `AddApiKeyModal` hardcodes `priority: 1` on both the single and the bulk
 *    add path, and the pool is served in ascending priority — so a fresh key is tried *before* the
 *    keys that already work. The connections list is threaded in as a `connections` prop and the
 *    next free priority (`MAX(priority) + 1`) is derived from it, which is the slot the API hands
 *    out when the field is omitted.
 *
 * 2. Select Errors. The bulk bar already had a Select All checkbox; this adds the same control for
 *    the connections whose last test failed (`testStatus: "error"`), so a broken batch is one click
 *    to select.
 *
 * 3. Test Connections Async. The shipped runner walks the pool one connection at a time with a 1s
 *    sleep between calls. A worker pool of `ASYNC_TEST_CONCURRENCY` hits the same
 *    `/api/providers/:id/test` endpoint concurrently, reusing the one-by-one result shape, summary
 *    and Stop behaviour.
 *
 * Every release re-minifies the chunk and renames its locals, so each site is matched by *shape*:
 * the identifiers a rewrite needs are read out of the match, never quoted. A release that reshapes
 * the code reports the anchor that moved and is otherwise left alone, and `--check` turns that into
 * a loud failure instead of a silent one. Re-running is a no-op.
 */

/** Connections tested at once by the async run. */
export const ASYNC_TEST_CONCURRENCY = 10

// The Add API Key modal is its own component, so `connections` has to be handed to it; a name
// defined in the page component is not in its scope. `.map(e=>e.name)` identifies the list by the
// use it is already put to.
const MODAL_CALL_RE = /proxyPools:(\w+),error:(\w+),existingNames:(\w+)\.map\(\w+=>\w+\.name\)\.filter\(Boolean\),onSave:(\w+),onBulkDone:/
const MODAL_SIG_RE = /proxyPools:(\w+),error:(\w+),existingNames:(\w+),onSave:(\w+),onBulkDone:(\w+),onClose:(\w+)\}\)\{/
const FORM_RE = /priority:1,proxyPoolId:/
const BULK_ADD_RE = /name:(\w+)\.name,priority:1,testStatus/

// The one-by-one test button and the Stop beside it, identified by the labels they carry.
const TEST_BUTTON_RE = /\(0,([\w$]+\.jsx)\)\(([\w$.]+),\{size:"sm",variant:"secondary",icon:"sync",onClick:(\w+),disabled:(\w+),children:\4\?"Testing Connection One-by-One\.\.\.":"Test Connection One-by-One"\}\)/
const STOP_BUTTON_RE = /\(\)=>\{(\w+)&&\((\w+)\.current=!0,(\w+)\(!0\)\)\},disabled:(\w+),children:\4\?"Stopping\.\.\.":"Stop"\}\)/
// `const [summary, setSummary] = useState(null), stopRef = useRef(false)` — the one-by-one trio.
const TEST_STATE_RE = /\[(\w+),(\w+)\]=\(0,(\w+)\.useState\)\(null\),(\w+)=\(0,\3\.useRef\)\(!1\),/
// The serial runner the async one replaces.
const RUNNER_RE = /(\w+)=async\(\)=>\{if\(\w+\|\|0===(\w+)\.length\)return;let \w+=Object\.fromEntries\(\2\.map\(\w+=>\[\w+\.id,\{state:"queued",error:null\}\]\)\);/
const BANNER_RE = /(\w+)&&\(0,(\w+)\.jsx\)\("div",\{className:"mb-4 rounded-lg border border-black\/10 bg-black\/\[0\.02\] px-3 py-2 text-xs text-text-muted dark:border-white\/10 dark:bg-white\/\[0\.03\]",children:/
const RUNNING_ROW_RE = /(\w+)&&(\w+)&&\(0,[\w$]+\.jsxs\)\("span",\{children:\["Running: ",/
const SELECT_ALL_RE = /checked:(\w+),onChange:\(\)=>\{\1\?(\w+)\(\[\]\):\2\((\w+)\.map\(\w+=>\w+\.id\)\)\}/

/** Connections whose last test failed, one click — the toolbar button beside the test pair. */
const selectErrors = (jsx, component, list, setSelected) => `,(0,${jsx})(${component},{size:"sm",variant:"secondary",icon:"error",onClick:()=>{${setSelected}(${list}.filter(e=>"error"===e.testStatus).map(e=>e.id))},title:"Select every connection whose last test failed",children:"Select Errors"})`

/**
 * The async pair: a run button and its Stop, inserted after the one-by-one Stop so both live in the
 * same toolbar. Same result shape, same banner, same Stop semantics.
 */
const testButtons = (jsx, component, running) => `,(0,${jsx})(${component},{size:"sm",variant:"secondary",icon:"bolt",onClick:hhRunAsyncTest,disabled:${running}||hhAsyncRunning,children:hhAsyncRunning?"Testing Connections Async...":"Test Connections Async"}),hhAsyncRunning&&(0,${jsx})(${component},{size:"sm",variant:"ghost",icon:"stop",onClick:()=>{hhAsyncRunning&&(hhStopAsyncRef.current=!0,hhSetAsyncStopping(!0))},disabled:hhAsyncStopping,children:hhAsyncStopping?"Stopping...":"Stop"})`

/** `queued`/`testing`/`success`/`failed` states, drained by a bounded pool instead of a serial loop. */
const asyncRunner = (list, running, stopRef) => `hhRunAsyncTest=async()=>{if(${running}||hhAsyncRunning||0===${list}.length)return;hhStopAsyncRef.current=!1,hhSetAsyncRunning(!0),hhSetAsyncStopping(!1),hhSetAsyncCurrent(null),hhSetAsyncResults(Object.fromEntries(${list}.map(e=>[e.id,{state:"queued",error:null}]))),hhSetAsyncSummary({total:${list}.length,completed:0,passed:0,failed:0,stopped:!1});let done=0,passed=0,failed=0;await Promise.all(Array.from({length:Math.min(${ASYNC_TEST_CONCURRENCY},${list}.length)},async()=>{for(;;){if(hhStopAsyncRef.current)return;let idx=done;if(done+=1,idx>=${list}.length)return;let conn=${list}[idx];hhSetAsyncCurrent(conn.id),hhSetAsyncResults(e=>({...e,[conn.id]:{state:"testing",error:null}}));try{let res=await fetch(\`/api/providers/\${conn.id}/test\`,{method:"POST"}),data=await res.json(),valid=!!data.valid;valid?passed+=1:failed+=1,hhSetAsyncResults(e=>({...e,[conn.id]:{state:valid?"success":"failed",error:valid?null:data.error||null}}))}catch(err){failed+=1,hhSetAsyncResults(e=>({...e,[conn.id]:{state:"failed",error:err.message||"Test failed"}}))}hhSetAsyncSummary({total:${list}.length,completed:passed+failed,passed,failed,stopped:!1})}})),hhSetAsyncCurrent(null),hhSetAsyncRunning(!1),hhSetAsyncStopping(!1),hhStopAsyncRef.current=!1},`

const asyncState = react => `[hhAsyncRunning,hhSetAsyncRunning]=(0,${react}.useState)(!1),[hhAsyncStopping,hhSetAsyncStopping]=(0,${react}.useState)(!1),[hhAsyncCurrent,hhSetAsyncCurrent]=(0,${react}.useState)(null),[hhAsyncResults,hhSetAsyncResults]=(0,${react}.useState)(null),[hhAsyncSummary,hhSetAsyncSummary]=(0,${react}.useState)(null),hhStopAsyncRef=(0,${react}.useRef)(!1),`

const OPENING = { '(': ')', '[': ']', '{': '}' }

/**
 * Index just past the bracket matched by the one at `openIndex`, or -1.
 *
 * A rewrite replaces whole JSX elements and a minified element has no end marker; counting brackets
 * is what survives a re-minification. Quoted text is skipped so a `}` in a className cannot close a
 * block.
 */
export function balancedEnd(source, openIndex) {
  const stack = []
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i]
    if (char === '"' || char === '\'' || char === '`') {
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === '\\') {
          i += 1
          continue
        }
        if (source[i] === char)
          break
      }
      continue
    }
    if (OPENING[char]) {
      stack.push(OPENING[char])
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== char)
        return -1
      if (stack.length === 0)
        return i + 1
    }
  }
  return -1
}

/**
 * End of the whole JSX call starting at `callStart`.
 *
 * A minified element is a chain — `(0,f.jsx)(Component,{…})` — so the first balanced group is only
 * the factory lookup; the argument list that follows is the element.
 */
export function jsxElementEnd(source, callStart) {
  let at = callStart
  for (;;) {
    const end = balancedEnd(source, at)
    if (end < 0)
      return -1
    if (source[end] !== '(')
      return end
    at = end
  }
}

/**
 * Rewrites every patch site in `source`.
 *
 * Returns `{ source, changed, missing }`, where `missing` names each anchor that no longer matches —
 * the signal that 9router reshaped the page and the rewrite has to be re-derived.
 */
export function patchProviderPage(source) {
  if (source.includes('Test Connections Async'))
    return { source, changed: false, missing: [] }

  const missing = []
  /** `{ text, groups }` for the first hit of `re`, or null with `missing` recorded. */
  const site = (re, label) => {
    const match = re.exec(source)
    if (match === null) {
      missing.push(label)
      return null
    }
    return { text: match[0], index: match.index, groups: match.slice(1) }
  }

  const modalCall = site(MODAL_CALL_RE, 'the Add API Key modal call')
  const modalSig = site(MODAL_SIG_RE, 'the Add API Key modal props')
  const form = site(FORM_RE, 'the Add API Key priority default')
  const bulkAdd = site(BULK_ADD_RE, 'the bulk-add priority')
  const testButton = site(TEST_BUTTON_RE, 'the one-by-one test button')
  const stopButton = site(STOP_BUTTON_RE, 'the one-by-one Stop')
  const testState = site(TEST_STATE_RE, 'the one-by-one test state')
  const runner = site(RUNNER_RE, 'the one-by-one test runner')
  const banner = site(BANNER_RE, 'the test summary')
  const runningRow = site(RUNNING_ROW_RE, 'the summary running row')
  const selectAll = site(SELECT_ALL_RE, 'the Select All checkbox')

  if (missing.length > 0)
    return { source, changed: false, missing }

  const [jsx, component, , running] = testButton.groups
  const [summary, , react, stopRef] = testState.groups
  const [, current] = runningRow.groups
  const [list, setSelected] = [selectAll.groups[2], selectAll.groups[1]]
  const [stopRunning, stopRefUsed] = stopButton.groups

  // The sites rewrite each other's identifiers, so they have to describe the same objects.
  const consistent = stopRunning === running && stopRefUsed === stopRef && runner.groups[1] === list
  if (!consistent)
    return { source, changed: false, missing: ['the test sites disagree about their identifiers'] }

  // Whole JSX elements are replaced, so each one's end has to be found by balance.
  const testButtonStart = source.indexOf('(0,', testButton.index)
  const testButtonEnd = jsxElementEnd(source, testButtonStart)
  const stopButtonStart = source.indexOf('(0,', stopButton.index)
  const stopButtonEnd = jsxElementEnd(source, stopButtonStart)
  const bannerStart = source.indexOf('(0,', banner.index)
  const bannerEnd = jsxElementEnd(source, bannerStart)
  if (testButtonEnd < 0 || stopButtonEnd < 0 || bannerEnd < 0)
    return { source, changed: false, missing: ['a JSX element that does not balance'] }

  const priority = 'Math.max(0,...connections.map(e=>e.priority||0))+1'

  // Replacements go through a function so a `$` in minified output is never read as a pattern.
  const swap = (out, anchor, replacement) => out.replace(anchor, () => replacement)
  let out = source

  // The banner is shared: it shows whichever run is reporting, and its running row follows the
  // async one. Rewritten inside its own slice, so both identifiers keep their meaning elsewhere.
  const bannerSlice = source.slice(bannerStart, bannerEnd)
  const sharedBanner = bannerSlice
    .replaceAll(`${summary}.`, `(hhAsyncResults||${summary}).`)
    .replace(`${running}&&${current}&&`, 'hhAsyncRunning&&hhAsyncCurrent&&')
    .replaceAll(`===${current})`, '===hhAsyncCurrent)')
    .replace(`||${current}]`, '||hhAsyncCurrent]')
  out = swap(out, bannerSlice, sharedBanner)

  // Select Errors and the async pair ride in the same toolbar as the shipped buttons.
  out = swap(out, source.slice(testButtonStart, testButtonEnd), source.slice(testButtonStart, testButtonEnd) + selectErrors(jsx, component, list, setSelected))
  out = swap(out, source.slice(stopButtonStart, stopButtonEnd), source.slice(stopButtonStart, stopButtonEnd) + testButtons(jsx, component, running))

  // The async runner goes right before the serial one it replaces, and its state beside that trio.
  out = swap(out, runner.text, asyncRunner(list, running, stopRef) + runner.text)
  out = swap(out, testState.text, testState.text + asyncState(react))

  // New keys land last, on both add paths.
  out = swap(out, bulkAdd.text, `name:${bulkAdd.groups[0]}.name,priority:${priority},testStatus`)
  out = swap(out, form.text, `priority:${priority},proxyPoolId:`)

  // The modal is handed the connections it derives the next priority from.
  out = swap(
    out,
    modalSig.text,
    `proxyPools:${modalSig.groups[0]},connections:connections,error:${modalSig.groups[1]},existingNames:${modalSig.groups[2]},onSave:${modalSig.groups[3]},onBulkDone:${modalSig.groups[4]},onClose:${modalSig.groups[5]}}){`,
  )
  out = swap(
    out,
    modalCall.text,
    `proxyPools:${modalCall.groups[0]},connections:${modalCall.groups[2]},error:${modalCall.groups[1]},existingNames:${modalCall.groups[2]}.map(e=>e.name).filter(Boolean),onSave:${modalCall.groups[3]},onBulkDone:`,
  )

  // A rewrite that missed would leave the page half-patched; refuse it instead.
  if (!out.includes('hhRunAsyncTest') || !out.includes('Select Errors') || !out.includes('connections:connections'))
    return { source, changed: false, missing: ['the rewrite did not apply cleanly'] }

  // The identifiers this build uses, so a caller (the test) can drive the rewritten page without
  // hardcoding names that the next minification will change.
  const identifiers = { running, list, stopRef, summary, current, setSelected, component, jsx }
  return { source: out, changed: true, missing: [], identifiers }
}

/** The derived names the rewrite introduces, exported so the test can pin them. */
export const REWRITE_NAMES = {
  summary: 'hhAsyncResults',
  current: 'hhAsyncCurrent',
  running: 'hhAsyncRunning',
  runner: 'hhRunAsyncTest',
}
