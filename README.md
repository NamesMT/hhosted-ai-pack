<div align="center">

# 🧠 hhosted-ai-pack

**A self-contained home AI pack: [OmniRoute](https://github.com/diegosouzapw/OmniRoute) and [9router](https://github.com/decolua/9router) as gateways, [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) as the agent harness, all kept alive by [home-hosted](https://github.com/NamesMT/home-hosted).**

Three servers, one workspace, one panel on <http://127.0.0.1:4399>.

</div>

---

```bash
pnpm install    # installs the pack, then patches 9router
pnpm run up     # panel + all three servers, detached
```

| | |
| --- | --- |
| **OmniRoute** · `:4367` | one OpenAI-compatible endpoint in front of hundreds of providers, with quota-aware auto-fallback |
| **9router** · `:4397` | a second OpenAI-compatible gateway, for the providers you hold keys for |
| **dsh** · `:4374` | the harness web UI — sessions, skills and storages live in this repo |
| **home-hosted** · `:4399` | the panel that starts them, restarts them when they die, streams their logs |

**Fact**: the ports are partially derived from numpad keys: `43*67*` is *or*, `4*374*` is *dsh*.

`pnpm run status` shows where everything is, `pnpm run down` stops the lot, and `pnpm run start <id>` /
`pnpm run stop <id>` move one server on its own.

> [!NOTE]
> The panel boots with the password `hh` — change it under **Settings → Authentication**.
> Both gateways bind to `lan`: OmniRoute's `/v1` answers `401` without a key and its dashboard is
> login-gated, but set an admin password and an API key before trusting the network you are on.

**Self-contained by design** — every path is `{projectDir}`-relative, so panel state (`state/`), the
gateways (`data/.omniroute`, `data/.9router`) and the harness (`data/.dsh`) all live here. Nothing
lands in `~/.omniroute`, `~/.9router`, `~/.dsh` or any other global directory. The repo *is* the
setup: copy it, back it up, delete it whole.

---

## 🚀 First run

1. `pnpm install`, then `pnpm run up` and sign in to <http://127.0.0.1:4399> with `hh`.
2. **Settings → Authentication**: set a real password, and generate an API token if scripts or agents
   should drive the panel.
3. Add provider keys at <http://127.0.0.1:4367> (OmniRoute) and <http://127.0.0.1:4397> (9router).
4. dsh's token URL, from its log:

   ```bash
   grep -oE 'http://127\.0\.0\.1:4374/\?token=[A-Za-z0-9_-]+' state/.hh/default/.logs/dsh.log | tail -1
   ```

`autostart` brings all three back with the panel.

---

## 🗂 State, one workspace per setup

home-hosted 0.7 split its state into **workspaces**: a workspace owns its servers, settings, secrets,
logs and nanny state, while the listener, auth, TLS, backups and the installed UI stay global.

```text
state/.hh/                  # global — settings.json, workspaces.json, .control-secrets.json, .ui/, run.json
state/.hh/default/          # the workspace this pack uses
    servers.config.json     #   the three entries below
    settings.json           #   server defaults, logs, notifications, DDNS
```

Only the definitions are committed (`settings.json`, `workspaces.json`, and each
`<workspace>/servers.config.json`/`settings.json`); secrets, logs, TLS keys, backups and `run.json`
stay out.

```bash
pnpm run migrate --dry-run   # print the steps, write nothing
pnpm run migrate             # ask, then write — a .bak sits beside each rewritten file
```

Each file carries the release that wrote it (`meta.writtenBy`) and its shape (`meta.schema`), and a
schema-bumping release refuses to start until `migrate` has lifted them — silently running defaults
that differ from the file is worse than stopping. 0.9 folds the
`notifications.{telegram,webhooks}` pair into one `destinations` list; this pack sets none, so the
step is a stamp rewrite.

> [!NOTE]
> **Why every script passes `--project .`** — `{projectDir}` resolves from `HHOSTED_PROJECT` before it
> falls back to the current directory, and a panel exports that variable to the servers it supervises.
> Run `pnpm run up` from a shell that lives under such a panel and the gateways' `dataEnvs`
> (`{projectDir}/data/.9router`) point at *that* project instead, quietly starting a second copy with
> an empty database. Pinning `--project .` in `package.json` makes the repo the answer, whoever
> launches it.

---

## 🔌 The three entries

`state/.hh/default/servers.config.json` is the whole setup:

| entry | port | bind | data directory |
| --- | --- | --- | --- |
| `omniroute` | 4367 | lan | `data/.omniroute` · `DATA_DIR` |
| `9router` | 4397 | lan | `data/.9router` · `DATA_DIR` |
| `dsh` | 4374 | local | `data/.dsh` · `DSH_HOME` |

- **`dataEnvs`** declares a data directory once: it is exported to the process *and* picked up by
  **Backups**.
- **`stop`** covers the process each CLI re-launches detached — `killGroup` for the tree,
  `killPortHolders` for a listener that outlives it. Both gateways serve through a child that holds
  the port, so that child is the real target.
- **OmniRoute needs `OMNIROUTE_SERVER_HOST` from `{host}`**: it binds `0.0.0.0` otherwise, whatever
  the policy says. `serve --no-open --log` keeps it in the foreground and feeds its log to the panel.
- **`onPortConflict: "follow"`** — the dsh market plugin restarts the harness by spawning a new
  detached process. Instead of blocking on the port that process holds, the panel adopts it
  (`detached` in the UI) and starts its own again when it exits; `"reclaim"` stops the successor and
  starts a supervised one instead.
  [SERVERS.md → when a program restarts itself](https://github.com/NamesMT/home-hosted/blob/main/SERVERS.md#when-a-program-restarts-itself)

Every other field, placeholder and policy: [SERVERS.md](https://github.com/NamesMT/home-hosted/blob/main/SERVERS.md).

---

## 🩹 Why `postinstall` patches 9router

`scripts/patch-9router.js` rewrites these in 9router's bundled chunks, idempotently:

- **Capability aliases** — a model id that only differs from a known one still inherits its
  capabilities (`deepseek-v4p1-flash` ← `deepseek-v4.1-flash`). Only objects carrying `vision:` are
  cloned, so pricing tables and provider model lists are untouched.
- **`vision` for the deepseek ids** — the `*deepseek-v4*` glob entry carries `reasoning` without
  `vision`, so both ids report `vision: false` and refuse image input; a vision-carrying pattern is
  inserted ahead of the generic one. 0.5.104 added a `*deepseek-v4.*` pattern that already carries
  `vision`, so the alias resolves through it and this step is only needed for the dotted form.
- **Account-scoped `4xx`** — 0.5.81 gated fallback on "any `4xx` that matched no rule", so a provider
  holding several keys stopped falling back as soon as one key answered a `412` (Fireworks: *account is
  suspended*). The gate is rewritten to the request-scoped allowlist, as upstream
  [#4378](https://github.com/decolua/9router/pull/4378) does.
- **New keys land last** — the Add API Key modal hardcodes `priority: 1` for both single and bulk
  adds, and the pool is served in ascending priority, so a fresh key was tried *before* the working
  ones. The next free priority (`MAX(priority) + 1`) is derived inside the modal instead.
- **Select Errors** — a toolbar button that selects every connection whose last test failed
  (`testStatus: "error"`), so a broken batch is one click to delete or re-test.
- **Test Connections Async** — the shipped runner walks the pool one key at a time with a 1s sleep;
  this adds a second button that tests 10 at a time, with the same progress banner and Stop.
- **Batch delete** — "Delete Selected" `await`ed one `DELETE /api/providers/:id` per key, and each of
  those is a round trip plus a `deleteProviderConnection` that renumbers the provider's whole pool in
  its own transaction: O(n) network and O(n²) row writes. A `DELETE /api/providers` taking `{ ids }`
  now deletes the set in one transaction and renumbers each touched provider once — 57 keys went from
  ~390 ms to ~50 ms. Nothing requires contiguous priorities (every reader sorts the number), so one
  renumber per provider is enough to keep the `#n` labels tidy.
- **Process safety** from [9router#4294](https://github.com/decolua/9router/pull/4294)
  ([#4295](https://github.com/decolua/9router/issues/4295)): `killProcessOnPort()` killed the first
  pid `lsof` returned — clients included — and the panel health-checks that port, so restarting the
  router took the panel down with it. The sweep's "is this one of ours?" test also matched the *panel*
  itself, so it is anchored to a real `9router` package path now.

`pnpm run patch:9router` re-applies them by hand, `pnpm run check:patch` fails if one is missing, and
`pnpm run test:patch` covers the matchers.

> [!NOTE]
> `9router` is pinned to an exact `0.5.104`: the patches are written against this build. Every release
> re-minifies the dashboard chunks and renames their locals, so the matchers read the identifiers they
> need out of a shape-based match (`priority:1,proxyPoolId:`, the one-by-one runner's `queued` seed)
> instead of quoting them — which is also why the client chunk and its server-rendered twin are both
> patched now, where 0.5.95 only got the client.
> The `4xx` fix is upstream as [#4378](https://github.com/decolua/9router/pull/4378) — still open, so
> the patch and the pin stay until a release carries it.

---

## 🔌 dsh 0.2 gates profile plugins

dsh 0.2 preflights every profile bundle against its own version and **disables** one whose
`@deepseek-ai/dsh*` peer range rejects the runtime — logging `dsh: skipping profile bundle "<name>"`
and carrying on without it. The profile's `dshmarket` sat at `1.65.1`, whose
`@deepseek-ai/dsh-settings` peer stops at `^0.1.2-alpha.2`, so the market plugin vanished from the
UI; `1.66.4`+ accepts `^0.2.0-rc.1`. Update the plugin, not the entry:

```bash
DSH_HOME="$PWD/data/.dsh" dsh plugin --profile web update dshmarket
```

The `dsh` entry needs no change for 0.2: `web`, `--port`, `--host`, `--no-open` and a repeatable
`--trusted-host` are unchanged, and `sessions/`, `storages/` and `profiles/` are read as-is.

---

## ⚙️ Requirements

Node 24 or newer and pnpm. `home-hosted` comes from npm, so a plain clone runs:

```bash
pnpm install && pnpm run up
```
