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
- **Four harnesses**: `klaude` (Claude Code, beta), `kodex` (Codex CLI, beta),
  `openkode` (OpenCode, stable), `kpi` (Pi Code, stable). Cursor shipped as a
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

**Status (2026-08-02): shipped in v0.11.0.**

The relay already emulates Claude Code's native `web_search` via Tavily. When
a Tavily key is configured, `klaude` additionally injects Tavily's remote MCP
server per run (generated `--mcp-config`, ephemeral like everything else),
giving Kimi K3 the explicit `tavily_search` / `tavily_extract` toolset
alongside the emulated native search. Opt out with
`KIMIRELAY_DISABLE_TAVILY_MCP=1`; never injected when the session passes
`--strict-mcp-config`. ~Small; no relay changes needed.

### 2. Beta → stable for `klaude` and `kodex`

A verification matrix run against live Nebius: streaming tool calls,
interleaved thinking + tool use, context trimming at the served 262K, vision
routing via the modality-aware catalog (K2.6 carries vision on Nebius, K3 is
text-only there). Green matrix flips the Beta badges on the site.

**Blocked on keys**: the matrix needs `NEBIUS_API_KEY` (and `TAVILY_API_KEY`
for the search leg) available where it runs — either as GitHub Actions
secrets for a CI job, or run locally by someone holding the keys
(`packages/tests` already contains the live gauntlet; it currently fails
offline by design).

## Next

### 3. Sandboxes round 2

Once beta access lands (`kimirelay sandbox status` confirms): live
verification of the shipped first pass, then the deferred pieces —
interactive TTY over the wire, artifact download from finished sessions, and
prebaked images to cut the cold bootstrap (apt + installer + agent install on
every run today).

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
2. Does Sandboxes beta access exist for the account yet? Round 2 is blocked
   on it.
3. Beta → stable: add `NEBIUS_API_KEY` / `TAVILY_API_KEY` as GitHub Actions
   secrets so the live matrix can run in CI, or prefer running it locally?

## Decision log

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
