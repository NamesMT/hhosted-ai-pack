<div align="center">

# 🧠 hhosted-9router-dsh

**A self-contained home AI stack: [9router](https://github.com/decolua/9router) as the gateway, [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) as the agent harness, both kept alive by [home-hosted](https://github.com/NamesMT/home-hosted).**

Two processes, one JSON file, one panel on <http://127.0.0.1:4399>.

</div>

---

```bash
pnpm install    # installs the stack, then patches 9router
pnpm run up     # panel + both servers, detached
```

| | |
| --- | --- |
| **9router** · `:4300` | one OpenAI-compatible endpoint in front of every provider you hold keys for |
| **dsh** · `:4374` | the harness web UI — sessions, skills and storages live in this repo |
| **home-hosted** · `:4399` | the panel that starts them, restarts them when they die, streams their logs |

`pnpm run status` shows where everything is, `pnpm run down` stops the lot.

> [!NOTE]
> The panel boots with the password `hh`. Change it under **Settings → Authentication** before the
> panel is reachable from anything but `127.0.0.1`.

**Self-contained by design** — every path is `{projectDir}`-relative, so panel state (`state/`), the
gateway (`data/.9router`) and the harness (`data/.dsh`) all live here. Nothing lands in `~/.9router`,
`~/.dsh` or any other global directory. The repo *is* the setup: copy it, back it up, delete it whole.

---

## 🚀 First run

1. `pnpm install`, then `pnpm run up` and sign in to <http://127.0.0.1:4399> with `hh`.
2. **Settings → Authentication**: set a real password, and generate an API token if scripts or agents
   should drive the panel.
3. <http://127.0.0.1:4300> — add the provider keys you want behind the gateway.
4. dsh's token URL, from its log:

   ```bash
   grep -oE 'http://127\.0\.0\.1:4374/\?token=[A-Za-z0-9_-]+' state/.logs/dsh.log | tail -1
   ```

After that, `autostart` brings both back with the panel.

---

## 🔌 The two entries

Everything home-hosted needs is in `state/servers.config.json`:

```json
{ "id": "9router", "command": "9router", "port": 4300, "bind": "lan", "autostart": true,
  "dataEnvs": { "DATA_DIR": "{projectDir}/data/.9router" },
  "onPortConflict": "follow",
  "stop": { "killGroup": true, "graceMs": 8000, "killPortHolders": true },
  "health": { "enabled": true, "startTimeoutMs": 300000 } }

{ "id": "dsh", "command": "dsh", "port": 4374, "autostart": true,
  "dataEnvs": { "DSH_HOME": "{projectDir}/data/.dsh" },
  "onPortConflict": "follow",
  "stop": { "killGroup": true, "graceMs": 8000, "killPortHolders": true } }
```

- **`dataEnvs`** declares a data directory once: it is exported to the process *and* picked up by
  **Backups**.
- **`stop`** covers the process the CLI re-launches detached — `killGroup` for the tree,
  `killPortHolders` for a listener that outlives it.
- **`onPortConflict: "follow"`** — the dsh market plugin restarts the harness by spawning a new
  detached process. Instead of blocking on the port that process holds, the panel adopts it
  (`detached` in the UI) and starts its own again when it exits. Prefer a fully supervised copy with
  live logs? `"reclaim"` stops the successor and starts one.
  [SERVERS.md → when a program restarts itself](https://github.com/NamesMT/home-hosted/blob/main/SERVERS.md#when-a-program-restarts-itself)
- `9router` binds to `lan` so your other devices can use the gateway; the panel stays on loopback.

Every other field, placeholder and policy: [SERVERS.md](https://github.com/NamesMT/home-hosted/blob/main/SERVERS.md).

---

## 🩹 Why `postinstall` patches 9router

`scripts/patch-9router.js` rewrites three things in 9router's bundled chunks, idempotently:

- **`vision` for the deepseek ids** — a model with no exact capability entry is resolved through an
  ordered glob list, and 0.5.75's `*deepseek-v4*` entry carries `reasoning` without `vision`, so
  `deepseek-v4.1-flash` and its `deepseek-v4p1-flash` alias both report `vision: false` and refuse
  image input. The patch inserts a vision-carrying pattern for each id *ahead* of the generic one,
  and also clones the exact-table entry into the alias.
- **the process-safety fix** from [9router#4294](https://github.com/decolua/9router/pull/4294)
  ([issue #4295](https://github.com/decolua/9router/issues/4295)): `killProcessOnPort()` killed the
  first pid `lsof` handed it — clients included — and the panel health-checks that port, so restarting
  the router used to take the panel down with it. The sweep's "is this one of ours?" test was also
  loose enough to match the *panel* itself — its path carries this folder's name
  (`…/hhosted-9router-dsh/node_modules/home-hosted/dist/cli.js`) — so it is anchored to a real
  `9router` package path now.

`pnpm run patch:9router` re-applies them by hand, `pnpm run check:patch` fails if one is missing, and
`pnpm run test:patch` covers the matcher.

> [!NOTE]
> `9router` is pinned to an exact `0.5.75` instead of a range: versions above it currently regress
> **auto key fallback**, and the patch is written against this build.

---

## ⚙️ Requirements

Node 24 or newer and pnpm. `home-hosted` comes from npm, so a plain clone runs:

```bash
pnpm install && pnpm run up
```
