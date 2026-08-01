# kimirelay roadmap

Status: **for review** — updated 2026-08-01. The previous revision of this file
was the pre-launch planning document; its decision history is preserved at the
bottom. This revision reflects what has shipped and proposes what comes next.

## Where we are (shipped as of 2026-08-01)

- **The relay**, forked from nebius-tf-relay: a local daemon translating
  Anthropic `/v1/messages` and OpenAI `/v1/responses` to Nebius Token Factory
  chat completions, with per-session cost tracking, live model catalog with
  modality-aware routing, context trimming, retries/fallback, and
  Tavily-backed `web_search` emulation streaming real Anthropic citation
  blocks.
- **Four harnesses**: `klaude` (Claude Code, beta), `kodex` (Codex CLI, beta),
  `openkode` (OpenCode, stable), `kpi` (Pi Code, stable).
- **Distribution**: `curl -fsSL https://kimirelay.com/install.sh | sh`
  (POSIX-sh safe, self-updating v0.9.1), serving from kimirelay.com and
  kimi.guide via Vercel git deploys.
- **The site**: dark landing page ("Kimi K3 for ⟨agent⟩"), benchmark section,
  community showcase at `/showcase` (PR-submittable), $25+$25
  Token Factory/Tavily credits promo.

## Now

### 1. Cursor support (`kursor`)

Add Cursor as the fifth harness. Two candidate mechanisms, spike decides:

- **Cursor CLI (`cursor-agent`)**: if it honors an OpenAI-compatible base URL
  override (env or config), it slots into the spawned-harness family like
  OpenCode/Pi — per-run config injection, nothing durable written.
- **Cursor editor**: custom OpenAI base URL exists in settings but is a
  durable, GUI-level change and disables some Cursor-native features (Tab
  completions run on Cursor's own backend regardless). If the CLI path works,
  the editor gets a documented recipe rather than automation.

Spike questions: does `cursor-agent` accept base-URL/model overrides per
invocation; which wire format does it speak (chat completions vs responses);
does the relay's existing Codex bridge cover it. Deliverable: `kursor` command

- site/README updates, or an honest write-up of why it's recipe-only.

### 2. Remote sessions on Token Factory Sandboxes

The flagship differentiator (see decision log): run the harness _inside_ a
[Token Factory Sandbox](https://tokenfactory.nebius.com/sandboxes/about)
microVM instead of locally — same Nebius account/key as inference, 0.4–2s
cold start, branchable execution state, instant rollback.

- `klaude --sandbox` / `kodex --sandbox` (or `--remote`): the wrapper starts a
  sandbox, syncs the project in, runs the agent there, streams the TUI back.
  Disposable full-permission/yolo sessions become safe by construction;
  branchable state gives checkpoint/rollback on top.
- Advisory layer: optional block in `~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md`
  steering agents to prefer sandboxes for risky commands (steering, not
  enforcement — the wrapper enforces).
- **Spike first** (unchanged from the original plan): project sync mechanics
  (clone vs file sync), key handoff into the sandbox, interactive TUI over the
  wire, latency/cost, beta access approval. Spike outcome decides whether this
  ships as a flag or as a documented recipe.

## Next

### 3. Tavily MCP auto-inject for `klaude`

The relay already emulates Claude Code's native `web_search` via Tavily. When
a Tavily key is configured, `klaude` can additionally inject the official
Tavily MCP server per run (generated `--mcp-config`, ephemeral like everything
else), giving Kimi K3 the explicit `tavily_search` / `tavily_extract` toolset
alongside the emulated native search. ~Small; no relay changes needed.

### 4. Beta → stable for `klaude` and `kodex`

A verification matrix run in CI against live Nebius: streaming tool calls,
interleaved thinking + tool use, context trimming at the served 262K, vision
routing via the modality-aware catalog (K2.6 carries vision on Nebius, K3 is
text-only there). Green matrix flips the Beta badges on the site.

## Later

- **Showcase growth**: keep merging community project PRs
  (`site/src/showcase/projects/`); consider surfacing GitHub stars on cards.
- **Distribution beyond curl**: npm package and/or Homebrew tap for the CLI.
- **Upstream sandbox support** to nebius-tf-relay once the sandbox spike
  proves out — per the decision log, the fork's delta is branding + sandboxing,
  and upstreaming keeps the fork thin.
- **Google provider slot** if/when Kimi K3 lands on Vertex AI (multi-provider
  remains out of scope until then; see decision log).

## Open questions (for Collin)

1. Cursor: is CLI-only support acceptable for launch, with the editor as a
   documented recipe?
2. Sandboxes: opt-in `--sandbox`, or sandbox-by-default with `--local` as the
   escape hatch? (Carried over from the original plan, still undecided.)
3. Does Sandboxes beta access exist for the account yet? The spike is blocked
   on it.

## Decision log (2026-07-29, condensed from the original plan)

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
