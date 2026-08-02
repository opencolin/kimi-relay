# PRD: Tenki Cloud sandbox provider for kimirelay

Status: **for review** — authored 2026-08-02. Milestone 1 ships alongside this
document; milestones 2-3 land after review.

## Background & problem

kimirelay's sandbox layer (`kimirelay sandbox …`, `klaude --sandbox`,
`kodex --sandbox`) is built exclusively on Nebius Token Factory Sandboxes
(ConTree). That product is a **gated private beta**, and live verification
surfaced a second gate behind the first: even with beta access granted at the
account level, the API key needs per-project permissions (`spawn`,
`set_image_tag`, …) granted in the console — `GET /v1/whoami` against the
real account currently reports every permission `false`. Until both gates
open, every sandbox feature we ship is dormant for real users.

[Tenki Cloud](https://tenki.cloud) offers the same core primitive —
disposable Firecracker microVMs with network access — **without the gate**,
plus a strictly larger capability surface: SSH with port forwarding, file
read/write, snapshots, pause/resume, volumes, templates + a registry, preview
URLs, an official TypeScript SDK (`@tenkicloud/sandbox`), a CLI, and an
85-tool MCP server (`@tenkicloud/mcp`).

## Goals

1. `kimirelay sandbox …` and `--sandbox` harness sessions work **today** for
   any user with a `tk_…` Tenki key — no beta approval loop.
2. Token Factory Sandboxes remains a first-class provider; when Nebius's
   gates open, nothing regresses. Users choose, or the CLI picks sensibly.
3. Tenki's richer surface closes the round-2 gaps ConTree cannot:
   **interactive sessions** (SSH allocates a real PTY; ConTree has no
   PTY/attach surface at all) and **first-class file I/O** (read/write on a
   live session instead of post-hoc result-image inspection).
4. Keys never appear in argv or on-disk config, matching every other
   kimirelay credential path.

## Non-goals

- Replacing ConTree. Nebius is the inference home; its sandbox product
  shares the account/key with inference and stays the default _when usable_.
- Wrapping all 85 Tenki MCP tools or the full CLI surface. kimirelay needs
  five verbs, not a Tenki client.
- Vendor-neutral plugin API for arbitrary future sandbox providers. Two
  concrete providers; abstraction only as far as they force it.

## Users & stories

- **Blocked TF user (today's reality)**: "I ran `kimirelay sandbox status`,
  saw every permission denied, and stopped. With a Tenki key,
  `klaude --sandbox -p 'fix the test'` just works."
- **Safety-first user**: "I want yolo-mode agents in a disposable VM, not on
  my laptop. Whichever provider is configured, `--sandbox` is the one flag I
  remember."
- **Interactive user (M2)**: "`klaude --sandbox` without `-p` drops me into
  a real remote TUI session instead of erroring 'headless only'."
- **Agent-driven sandboxes (M3)**: "My klaude session can spawn its own
  scratch VMs via the Tenki MCP tools when a task needs risky execution."

## Design

### Provider model

A `provider` axis on the existing sandbox layer, no rewrite:

- `contree` — existing `ContreeClient` (REST, Bearer `NEBIUS_API_KEY`,
  `Project` header).
- `tenki` — new, built on the official `@tenkicloud/sandbox` TypeScript SDK
  (lazy-imported; auth `TENKI_API_KEY` / `TENKI_AUTH_TOKEN`, `tk_…` keys).

Selection (first match wins):

1. `--provider tenki|contree` on any sandbox command / `--sandbox` hoist
2. `KIMIRELAY_SANDBOX_PROVIDER` env
3. Default: `contree`. No credential sniffing — a `TENKI_API_KEY` in the env
   never switches providers on its own (Collin, 2026-08-02: sandboxes and
   providers alike are explicit opt-in, in the spirit of `--sandbox` itself).

`kimirelay sandbox status` reports both providers' auth/permission state and
which one the current flags/env select.

### Why the SDK (not the CLI, not the MCP server)

- **SDK**: typed, npm-installable dependency; no external binary for users to
  install; `create({ env })` carries secrets in the API request body over
  TLS — never argv (`ps`-safe), never on-disk; streamed stdout/stderr;
  files, snapshots, images, pause all exposed. Chosen.
- **CLI** (`tenki`): would force every kimirelay user to install a second
  tool, and `--env KEY=value` puts secrets in argv. Reserved for the M2
  interactive path only (`tenki sandbox ssh` for PTY + port forwarding),
  where a real terminal is the point.
- **MCP server**: wrong shape for kimirelay-internal calls, right shape for
  _agents_ — that's M3's auto-inject, not the provider backend.

### Feature mapping

| kimirelay surface              | contree (today)                        | tenki (M1 unless noted)                                                     |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| `sandbox status`               | `/v1/whoami` permission map            | credential presence + SDK reachability; both shown side by side             |
| `sandbox run <cmd>`            | spawn instance, poll operation         | `create()` → `run(["sh","-lc",cmd])` streamed → `close()`                   |
| harness `--sandbox` (headless) | bootstrap script in instance           | same `buildHarnessBootstrap` script, env via `create({env})`                |
| `--fetch <path>`               | result-image inspect API after the run | `session.readFile()` **before** `close()` — simpler and works mid-lifecycle |
| `sandbox fetch <ref> <path>`   | any past result image                  | M2: snapshots (`snapshot create` → read later)                              |
| `sandbox prebake`              | tag result image                       | M2: template/snapshot + `create({image})`                                   |
| Interactive TTY                | impossible (no PTY/attach in API)      | M2: `tenki sandbox ssh` handoff (real PTY, port forwarding)                 |
| Agent-driven sandboxes         | —                                      | M3: auto-inject `@tenkicloud/mcp` (same pattern as Tavily MCP)              |

### Security

- Nebius/Tavily keys reach the Tenki sandbox via `create({ env })` — request
  body over TLS, mirrored from how ConTree receives them (instance env in
  the POST body). Never argv, never written locally.
- The Tenki credential itself is read from env only (`TENKI_API_KEY` /
  `TENKI_AUTH_TOKEN`); `kimirelay configure` storage can follow later if
  users ask.
- Sessions are always `close()`d in a `finally`; `maxDurationMs` is set from
  `--timeout` so orphans self-expire server-side.
- M3 MCP inject ships with the audit knob documented and respects
  `KIMIRELAY_DISABLE_TAVILY_MCP`-style opt-out conventions.

## Milestones

- **M1 (this PR)**: provider selection (`--provider` /
  `KIMIRELAY_SANDBOX_PROVIDER` / auto), Tenki backend for `sandbox status`,
  `sandbox run` (incl. `--fetch` via live-session `readFile`), and headless
  `klaude --sandbox` / `kodex --sandbox`. Offline tests with an injected SDK
  stub; live verification the moment a `tk_…` key is available.
- **M2**: interactive sessions via `tenki sandbox ssh` handoff (detect CLI,
  print install pointer when missing); snapshots for post-hoc `sandbox
fetch` and `sandbox prebake` on tenki; pause/resume surfacing.
- **M3**: `@tenkicloud/mcp` auto-inject for klaude/kodex/openkode when a
  Tenki credential is configured (mirrors the Tavily MCP inject:
  ephemeral, opt-out env, banner + identity-prompt note).

## Risks & mitigations

- **SDK churn** (v0.5.x): pin the minor version; the provider wraps the SDK
  behind kimirelay's own five-verb interface so upgrades stay contained.
- **Bundle growth**: the SDK is bundled into the distributed `kimirelay.js`;
  lazy `import()` keeps cold-start cost off non-sandbox commands; measure at
  build time.
- **Two-provider drift**: the shared bootstrap script (`command -v`-guarded)
  is provider-agnostic by construction; gauntlet-style live checks can run
  per provider once keys exist in CI.
- **Cost surprises**: tenki sessions bill while running; `maxDurationMs`
  always set, `close()` always called, and the session id printed so a leak
  is traceable.

## Open questions — resolved 2026-08-02 (Collin), except 3

1. **Answered.** `TENKI_API_KEY` now lives in the repo's `production`
   environment; the live gauntlet runs a tenki smoke
   (`sandbox run --provider tenki`) whenever the secret resolves.
2. **Answered.** No auto-selection at all: providers are explicit opt-in
   (`--provider tenki` / `KIMIRELAY_SANDBOX_PROVIDER=tenki`), default
   `contree`. The credential-based fallback M1 briefly shipped was removed.
3. **Still open.** M3 MCP inject default-on vs opt-in
   (`KIMIRELAY_TENKI_MCP=1`): Collin is undecided; PRD keeps leaning
   **opt-in** for cost safety, to be settled before M3 starts.

## Decision-log update

The 2026-07-29 decision "Sandbox layer is Token Factory Sandboxes, not
Tenki" is revised: TF remains the inference-affine default, but its double
gate (beta access + per-key permissions) makes a second, ungated provider
necessary for the feature to exist in practice. Revision recorded in
`docs/ROADMAP.md`'s decision log with this PRD as rationale.
