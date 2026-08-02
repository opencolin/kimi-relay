# kimirelay roadmap

Status: **for review** — updated 2026-08-02. The previous revision of this file
was the pre-launch planning document; its decision history is preserved at the
bottom. This revision reflects what has shipped and proposes what comes next.

## Where we are (shipped as of 2026-08-02)

- **The relay**, forked from nebius-tf-relay: a local daemon translating
  Anthropic `/v1/messages` and OpenAI `/v1/responses` to Nebius Token Factory
  chat completions, with per-session cost tracking, live model catalog with
  modality-aware routing, context trimming, retries/fallback, and
  Tavily-backed `web_search` emulation streaming real Anthropic citation
  blocks.
- **Four harnesses, all stable**: `klaude` (Claude Code), `kodex` (Codex CLI),
  `openkode` (OpenCode), `kpi` (Pi Code) - beta flags dropped 2026-08-02 after
  the full live gauntlet went green in CI (all five suites, real Nebius
  inference). Cursor shipped as a
  documented recipe (`docs/CURSOR.md`) — `cursor-agent` has no endpoint
  override to inject; revisit if that changes.
- **Remote sessions on Token Factory Sandboxes** (first pass): `kimirelay
sandbox status|run|advisory` plus headless `klaude --sandbox` /
  `kodex --sandbox` against pushed git state (`docs/SANDBOXES.md`).
  Interactive TTY, artifact download, and prebaked images remain open; live
  verification is blocked on beta access.
- **Distribution**: `curl -fsSL https://kimirelay.com/install.sh | sh`
  (POSIX-sh safe, self-updating, v0.10.1), serving from kimirelay.com and
  kimi.guide via Vercel git deploys. Launcher wrappers are self-locating
  (bun found via PATH or `~/.bun/bin`) and self-heal: the installed bundle
  rewrites stale wrappers on its hourly update check.
- **The site**: dark landing page ("Kimi K3 for ⟨agent⟩" with the robot
  mascot), benchmark section, community showcase at `/showcase`
  (PR-submittable), $25+$25 Token Factory/Tavily credits promo, and the
  hosting trust row (SOC 2-compliant data centers, Paris, zero data
  retention supported).

## Now

### 1. Tavily MCP auto-inject for `klaude`

**Status (2026-08-02): shipped in v0.11.0; extended to `kodex` and `openkode` in v0.12.0 (`kpi` excluded - pi rejects MCP by design).**

The relay already emulates Claude Code's native `web_search` via Tavily. When
a Tavily key is configured, `klaude` additionally injects Tavily's remote MCP
server per run (generated `--mcp-config`, ephemeral like everything else),
giving Kimi K3 the explicit `tavily_search` / `tavily_extract` toolset
alongside the emulated native search. Opt out with
`KIMIRELAY_DISABLE_TAVILY_MCP=1`; never injected when the session passes
`--strict-mcp-config`. ~Small; no relay changes needed.

### 2. Beta → stable for `klaude` and `kodex`

**Status (2026-08-02): shipped.** The live gauntlet runs in CI against real
Nebius inference (secrets in the repo's `production` environment; dispatch
from the Actions tab or push `trigger/live-gauntlet`). Getting to green took
three runs: run 1 caught latent test-package type errors, run 2 caught a test
asserting a retry mechanism Nebius has since engineered away server-side
(their backend now auto-clamps `max_tokens`; verified by direct probe), run 3
passed all five suites. Beta badges dropped from the site and docs.

## Next

### 3. Sandboxes round 2

**Status (2026-08-02): features shipped in v0.13.0; live spawn pending one
console grant.** Artifact download (`--keep` / `--fetch` / `sandbox fetch`
via the inspect API on result images), `sandbox prebake` (tagged checkpoint
images that skip the cold bootstrap), whoami-based `sandbox status`
permission reports, and `--project` / `NEBIUS_PROJECT` plumbing. Interactive
TTY is documented as unsupported by API design (no PTY/attach surface;
line-mode exec over stdin+SSE remains an option). Beta access is confirmed
live; the API key still needs Sandboxes permissions (`spawn`,
`set_image_tag`) granted for the project in the Token Factory console -
`kimirelay sandbox status` shows the exact grants. Because of that double
gate, tenki.cloud ships as a second, open-signup provider (M1 in
`docs/TENKI-SANDBOXES-PRD.md`; interactive SSH sessions and snapshots are
its M2).

### 4. Distribution beyond curl

npm package and/or Homebrew tap for the CLI. Homebrew in particular removes
the "curl | sh" trust objection and gives macOS users upgrades via
`brew upgrade`.

## Later

- **Showcase growth**: keep merging community project PRs
  (`site/src/showcase/projects/`); consider surfacing GitHub stars on cards.
- **Upstream sandbox support** to nebius-tf-relay now that the first pass
  exists — per the decision log, the fork's delta is branding + sandboxing,
  and upstreaming keeps the fork thin.
- **Google provider slot** if/when Kimi K3 lands on Vertex AI (multi-provider
  remains out of scope until then; see decision log).

## Open questions (for Collin)

1. Sandboxes: opt-in `--sandbox`, or sandbox-by-default with `--local` as the
   escape hatch? (Carried over, still undecided.)
2. Sandboxes: grant the API key `spawn` / `set_image_tag` permissions for the
   project in the Token Factory console so live verification can finish.

## Decision log

### 2026-08-02

- **Sandbox layer goes dual-provider**: the 2026-07-29 "not Tenki" decision
  is revised. Token Factory Sandboxes stays the inference-affine default,
  but its double gate (beta access + per-key permission grants) means the
  feature is dormant for real users; tenki.cloud (open signup, official
  TypeScript SDK) makes it real today. Rationale and design:
  `docs/TENKI-SANDBOXES-PRD.md`.

### 2026-08-01

- **Cursor ships as a recipe, not a harness**: `cursor-agent` exposes no
  base-URL/provider override, so there is nothing to inject
  (`docs/CURSOR.md` has the full reasoning). Revisit on CLI changes.
- **Sandboxes shipped headless-first**: `--sandbox` runs `-p`/`exec` style
  sessions against pushed git state; interactive TTY deferred to round 2.

### 2026-07-29 (condensed from the original plan)

- **Fork nebius-tf-relay** as `opencolin/kimi-relay` (full-history port)
  rather than extending the Python proxy's installer; the relay engine and
  `curl | sh` distribution come from upstream (MIT, credited in README and on
  the site).
- **Nebius-only**: the Vercel AI Gateway multi-provider path was cut. The
  fork's delta over upstream is K-branding + sandboxing.
- **Sandbox layer is Token Factory Sandboxes**, not Tenki — same Nebius
  account/key as inference.
- Canonical planning record:
  [opencolin/claude-codex-nebius-proxy#1](https://github.com/opencolin/claude-codex-nebius-proxy/pull/1).
  Nebius serves K3 at 262K context (not the 1M headline) and without vision;
  K2.6 is the vision flagship there — both facts encoded in the relay's live
  catalog handling.
