<div align="center">

# 🧠 hhosted-ai-pack

**A self-contained home AI pack: [OmniRoute](https://github.com/diegosouzapw/OmniRoute) and [9router](https://github.com/decolua/9router) as gateways, [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) as the agent harness, all kept alive by [home-hosted](https://github.com/NamesMT/home-hosted).**

Three servers, one JSON file, one panel on <http://127.0.0.1:4399>.

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

`pnpm run status` shows where everything is, `pnpm run down` stops the lot.

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
   grep -oE 'http://127\.0\.0\.1:4374/\?token=[A-Za-z0-9_-]+' state/.logs/dsh.log | tail -1
   ```

`autostart` brings all three back with the panel.

---

## 🔌 The three entries

`state/servers.config.json` is the whole setup:

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

`scripts/patch-9router.js` rewrites three things in 9router's bundled chunks, idempotently:

- **Capability aliases** — a model id that only differs from a known one still inherits its
  capabilities (`deepseek-v4p1-flash` ← `deepseek-v4.1-flash`). Only objects carrying `vision:` are
  cloned, so pricing tables and provider model lists are untouched.
- **`vision` for the deepseek ids** — 0.5.75's `*deepseek-v4*` glob entry carries `reasoning` without
  `vision`, so both ids report `vision: false` and refuse image input; a vision-carrying pattern is
  inserted ahead of the generic one.
- **Process safety** from [9router#4294](https://github.com/decolua/9router/pull/4294)
  ([#4295](https://github.com/decolua/9router/issues/4295)): `killProcessOnPort()` killed the first
  pid `lsof` returned — clients included — and the panel health-checks that port, so restarting the
  router took the panel down with it. The sweep's "is this one of ours?" test also matched the *panel*
  itself, so it is anchored to a real `9router` package path now.

`pnpm run patch:9router` re-applies them by hand, `pnpm run check:patch` fails if one is missing, and
`pnpm run test:patch` covers the matcher.

> [!NOTE]
> `9router` is pinned to an exact `0.5.75`: versions above it currently regress **auto key fallback**,
> and the patch is written against this build.

---

## ⚙️ Requirements

Node 24 or newer and pnpm. `home-hosted` comes from npm, so a plain clone runs:

```bash
pnpm install && pnpm run up
```
