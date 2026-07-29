> Provenance: this plan originated in opencolin/claude-codex-nebius-proxy PR #1
> and moved here when kimi-relay was forked from nebius-tf-relay on 2026-07-29.

# Plan: Kimi K3 installer — `klaude`, `kodex`, `openkode` (+ Tenki sandbox)

Status: draft for discussion — nothing here is implemented yet.
Date: 2026-07-29 (facts below verified against live sources on this date).

## Goal

A one-step installer that lets someone run Kimi K3 with the coding agent they
already know, on non-Chinese hosting, with an optional disposable-VM sandbox:

- `klaude` — Claude Code driven by Kimi K3
- `kodex` — Codex CLI driven by Kimi K3
- `openkode` — OpenCode driven by Kimi K3 (stretch)
- optional: Tenki sandbox integration so agents run in a disposable VM

The pitch: *"Try Kimi K3 in your favorite coding agent in 60 seconds. EU or US
hosting. No Chinese provider in the data path. Optionally fully sandboxed."*

## Verified facts (2026-07-29)

| Fact | Status |
| --- | --- |
| Kimi K3: 2.8T-param MoE (16/896 experts active), 1M context, native vision, always-on "thinking" mode, OpenAI-SDK compatible | Released; weights public since 2026-07-27 |
| Nebius Token Factory | **Day-0 K3 partner, live now.** OpenAI-compatible only (`/v1/chat/completions`) — no Anthropic `/v1/messages` surface. EU hosting. |
| Vercel AI Gateway | `moonshotai/kimi-k3` and `moonshotai/kimi-k3-fast` live, served by Baseten + Fireworks (both US). Exposes **both** an OpenAI-compatible `/v1` **and a native Anthropic-compatible `/v1/messages`** at `https://ai-gateway.vercel.sh`. |
| Google (Vertex AI MaaS) | Kimi K2 Thinking is on Vertex; **K3 is not yet available**. Treat Google as a future provider slot, not a launch provider. |
| Tenki (tenki.cloud) | Disposable hardware-isolated Linux VMs for AI agents. CLI: `curl -fsSL https://tenki.cloud/install.sh \| bash`, then `tenki onboard`. Documents Claude Code + Codex support. |

Consequence that shapes the whole architecture: **the proxy in this repo is
only required for the Nebius path.** Vercel's gateway speaks Anthropic
`/v1/messages` natively, so `klaude`-via-Vercel is pure environment variables —
no local process at all.

## Per-command wiring matrix

| Command | Nebius (EU) | Vercel (US) |
| --- | --- | --- |
| `klaude` (Claude Code) | Start this repo's proxy; `ANTHROPIC_BASE_URL=http://localhost:8083`, `ANTHROPIC_AUTH_TOKEN=claude-local`, `BIG_MODEL=<K3 id on Nebius>` | No proxy. `ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh`, `ANTHROPIC_AUTH_TOKEN=<gateway key>`, `ANTHROPIC_API_KEY=""`, `ANTHROPIC_MODEL=moonshotai/kimi-k3` |
| `kodex` (Codex CLI) | Existing `/v1/responses` bridge (proxy), or direct `wire_api = "chat"` against Nebius. Recommend the proxy for its tool-compat/repair layer. | Direct: `[model_providers.kimi-vercel]` with `base_url = "https://ai-gateway.vercel.sh/v1"`, `wire_api = "chat"` |
| `openkode` (OpenCode) | Direct custom provider (OpenAI-compatible) in opencode config | Direct: Vercel AI Gateway is a documented OpenCode provider |

Implementation shape for the commands themselves:

- Ship them as small executables in `~/.local/bin` (not shell-profile
  functions): they work in every shell, are trivially uninstallable, and never
  touch the user's normal `claude` / `codex` login.
- `kodex` should use a **Codex profile** (`codex --profile kimi-k3`) written
  into `~/.codex/config.toml` rather than mutating the default profile — the
  user's stock `codex` keeps working untouched. This repo's
  `write_codex_config` helper already writes this file; extend it to write a
  named profile instead of top-level keys.
- `klaude` on the Nebius path reuses the existing session-forwarder machinery
  (`scripts/session_forwarder.py`) and auto-starts the proxy if it isn't
  running.

## Installer UX

Extend the existing Textual TUI (`./install.sh`) rather than building new:

1. **New first screen: provider picker** — Nebius (EU) / Vercel (US) /
   "Google — coming when K3 lands on Vertex". Copy states plainly where
   inference runs and why OpenRouter isn't offered (routes to Chinese
   providers).
2. **New screen: agent picker** — Claude Code / Codex / OpenCode /
   all-of-the-above, detected from `PATH`, with install hints for missing ones.
3. **API key screen** (exists) — becomes provider-aware: validates the key
   against the picked provider's `/v1/models` (the live-dropdown machinery in
   `fetch_nebius_models` generalizes to any OpenAI-compatible `/v1/models`).
4. **Model screen** (exists) — default BIG/MIDDLE to the provider's K3 id,
   SMALL to something cheap, VISION to K3 itself (it is natively multimodal).
5. **Venv/deps/proxy screens** (exist) — **skipped entirely on the
   Vercel-only path**; nothing to run locally.
6. **New optional screen: Tenki sandbox** — see below.
7. **Done screen** — prints the new commands and a one-line smoke test each.

The Vercel-only path therefore installs in seconds: pick provider → paste key
→ get `klaude`/`kodex` on PATH. That is the viral-tweet path; keep it free of
Python/venv friction.

## Tenki sandbox integration (opt-in step)

Two mechanisms, layered — the wrapper is the enforcement, AGENTS.md is the
advisory:

1. **Wrapper-level (reliable):** `klaude --sandbox` / `kodex --sandbox` run
   the agent *inside* a Tenki VM instead of locally. This is the interesting
   product angle: full-permission / yolo-mode agents driving a brand-new
   third-party model are exactly what you want inside a disposable,
   hardware-isolated VM. The installer offers to install the Tenki CLI and run
   `tenki onboard`. Optionally: a "sandbox by default" toggle that makes bare
   `klaude` sandboxed with `--local` as the escape hatch.
2. **AGENTS.md-level (advisory):** the installer offers to append a short
   block to the user's global agent instructions (`~/.claude/CLAUDE.md`,
   `~/.codex/AGENTS.md`) telling the agent to prefer executing risky/untrusted
   commands inside a Tenki sandbox when one is available. Honest framing:
   instructions steer the model but do not enforce anything — the wrapper does.

**Needs a spike before committing to this design:** exact mechanics of running
Claude Code/Codex inside a Tenki session with the user's project present
(clone into the VM? file sync? what does `tenki onboard` actually configure?),
auth handoff (the provider API key must reach the VM), and latency/cost. The
spike outcome decides whether sandbox mode is Phase 2 or gets cut to a
documented recipe.

## Phases

### Phase 1 — ship while the hype is hot (days)

- Provider picker + agent picker screens; provider-aware key validation.
- K3 defaults: model ids, `*_CONTEXT_LIMIT` read from the provider (Nebius
  serves K3 at 262K context, not the model's headline 1M — see prior-art
  section), K3 entry in `MODEL_PRICES_JSON`, sane `MAX_TOKENS_LIMIT` for an
  always-thinking model.
- `klaude` + `kodex` launchers in `~/.local/bin`; Codex named profile.
- Vercel no-proxy path end to end.
- **Verification matrix** (this is the real work): K3 through the proxy on
  Nebius — streaming tool calls, interleaved thinking + tool use
  (`docs/TOOL_CALL_FORMAT.md` paths), context truncation at 1M, vision. Same
  matrix direct against Vercel. Automated where possible in `tests/`.
- README repositioning: lead with "Run Kimi K3 in Claude Code / Codex", keep
  the generic Nebius-proxy story secondary.

### Phase 2 — Tenki sandbox

- Spike (above), then: TUI step installing Tenki CLI + onboard, `--sandbox`
  flag in the launchers, AGENTS.md/CLAUDE.md advisory block, docs page.

### Phase 3 — reach

- `openkode` (OpenCode config writer + launcher).
- Google provider slot when K3 lands on Vertex AI.
- One-liner distribution beyond git-clone: publish installer to PyPI
  (`uvx ...`) and/or a Homebrew tap. The Vercel path has no repo dependency at
  all, so the installer itself is the only thing to package.

## Risks / open questions

- **K3 thinking + tool calls through the conversion layer** is the highest
  technical risk — an always-on reasoning model exercises exactly the fragile
  SSE paths this repo exists to handle. Phase 1's verification matrix gates
  the announcement.
- **Nebius K3 model id and pricing** must be read live from `/v1/models` at
  install time (ids rotate; the TUI already does this — keep it).
- **Naming**: check `klaude` / `kodex` / `openkode` for collisions on
  npm/PyPI/brew before publishing anything under those names. Parody names are
  probably fine as shell commands; publishing packages under them deserves a
  minute of thought.
- **Truth in advertising**: "non-Chinese hosting" claims should name the
  actual inference operators (Nebius EU; Baseten/Fireworks US via Vercel) in
  the README, not just the storefront.
- **Vercel account friction**: the US path requires a Vercel account + AI
  Gateway key; the copy should say so up front.
- **Tenki unknowns**: platform support, pricing, project-file sync — spike
  before promising.

## Prior art: nebius-tf-relay (reviewed 2026-07-29)

[shivaylamba/nebius-tf-relay](https://github.com/shivaylamba/nebius-tf-relay)
(MIT, TypeScript/Bun monorepo, ~30k LOC, last commit 2026-07-28) is
essentially this plan's Phase 1 + most of Phase 3, already shipped —
**Nebius-only**. `curl | sh` installer from
[nebius-tf-relay.vercel.app](https://nebius-tf-relay.vercel.app) installs
`nebiusrelay` + `nclaude` / `ncodex` / `nopencode` / `npi`; a shared local
daemon (sqlite session registry) translates Anthropic `/v1/messages` and
OpenAI `/v1/responses` to Nebius chat completions; OpenCode/Pi are "spawned
harnesses" launched with generated provider config, no proxy — the same
proxied-vs-direct split this plan arrived at independently. Also already
built: per-session cost tracking, live model catalog with vision-modality
detection, Tavily-backed `web_search` streaming real Anthropic citation
blocks, context trimming, retry + automatic model fallback, self-updating
binary, `llms.txt`. 50+ test files including live smoke tests, and a domain
glossary (`CONTEXT.md`) — this is a designed codebase, not a hack.

What it does **not** have (our differentiators): multi-provider choice
(Vercel/US path; its Nebius coupling runs through ~8 modules and the model
catalog uses Nebius's `/v1/models?verbose=true`), any sandbox story (Tenki),
and the K-branding. Its own `TODO.md` explicitly wants "a proper provider
abstraction". What our Python proxy has that it lacks: observability
dashboard, ensemble racing, statusline integration, request optimizations.

Factual corrections it surfaced: on Nebius, Kimi K3 is served at **262K
context** (1M is the model's headline, not Nebius's serving config) and
**without vision** — Kimi K2.6 is the vision flagship there. Vision-capable
routing for image blocks is something the relay already handles per-modality
from the live catalog.

Options:

- **A. Borrow ideas** into this repo: `curl | sh` distribution, per-session
  config injection (never permanently rewriting agent configs — our TUI
  writes shell profiles and `~/.codex/config.toml` durably; theirs doesn't),
  live catalog with modality detection, model fallback, `llms.txt`.
- **B. Fork it** as the engine for `klaude`/`kodex`/`openkode`: rebrand, add
  a provider abstraction (Nebius EU / Vercel US — the Vercel Claude path is
  pure env vars, which the spawned-harness family almost models already), add
  Tenki `--sandbox`. Distribution and the hard wire-format work come free;
  cost is adopting a 30k-LOC TS/Bun codebase and diverging from an active
  upstream, and our Python proxy's extras don't come along.
- **C. Contribute upstream** (provider abstraction + sandbox) and keep only a
  thin branded installer of our own.

Recommendation: **B with C manners** — fork it as the base, but contact the
author first/simultaneously about upstreaming the provider abstraction (their
TODO invites it). Our differentiators are additive layers on their engine;
re-implementing their engine in Python during a one-week hype window is the
worst use of the time. This repo then stays what it already is — the
dashboard/ensemble power tool — rather than becoming the installer.

## Decision points (for Collin)

1. Same repo or new repo? This plan assumes **same repo** (the proxy is the
   Nebius path's engine; the TUI already exists). A later split stays possible
   because the Vercel path has no dependency on the proxy.
2. Sandbox-by-default with `--local` escape hatch, or opt-in `--sandbox`?
3. Is `openkode`/OpenCode in scope for launch, or Phase 3 as planned here?
4. Distribution ambition for Phase 1: is `git clone && ./install.sh`
   acceptable for launch, or is a `uvx`/`curl | bash` one-liner a launch
   requirement? (Moot if we fork nebius-tf-relay — it ships this already.)
5. **Fork nebius-tf-relay or borrow from it?** See the prior-art section —
   recommendation is fork-plus-upstream-conversation. This decision reshapes
   Phase 1 entirely, so it comes first.

**Decided 2026-07-29:** points 1 and 5 — fork nebius-tf-relay as this repo
(`opencolin/kimi-relay`, public, full-history port). The "Installer UX"
section above described extending the Python proxy's Textual TUI and is
superseded: this relay and its installer are now the base, and the
multi-provider seam, Tenki sandbox, and K-command rebrand land here.
Points 2–4 remain open.
