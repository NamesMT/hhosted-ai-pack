/**
 * Matcher for 9router's minified account-fallback gate — step 3 of
 * `scripts/patch-9router.js`, kept here so `pnpm run test:patch` can pin the shape it rewrites.
 *
 * The bundle is minified, so the rewrite is anchored on the exact code 0.5.81 ships: a release whose
 * gate is already the request-scoped allowlist (or whose minifier reshapes it) matches nothing and is
 * left alone. `--check` turns that into a loud failure instead of a silent one.
 */

/** Statuses that describe the request itself; only these suppress account fallback. */
export const REQUEST_SCOPED_STATUSES = [400, 405, 406, 413, 414, 415, 422]

const GUARD_RE = /([A-Za-z_$][\w$]*)>=400&&\1<500&&401!==\1&&402!==\1&&403!==\1&&429!==\1\?\{shouldFallback:!1,cooldownMs:0\}/g

/** Rewrites every copy of the gate in `source`. Returns `{ source, changed, count }`. */
export function patchFallbackGuard(source) {
  const matches = source.match(GUARD_RE)
  if (matches === null)
    return { source, changed: false, count: 0 }
  return {
    source: source.replace(
      GUARD_RE,
      `[${REQUEST_SCOPED_STATUSES.join(',')}].includes($1)?{shouldFallback:!1,cooldownMs:0}`,
    ),
    changed: true,
    count: matches.length,
  }
}
