# Kimi K3 in Cursor (recipe)

Status: **recipe, not a `kursor` command** — spiked 2026-08-01, see "Why no
kursor" below.

## Editor recipe

Cursor's editor can talk to Nebius Token Factory directly — Nebius speaks the
OpenAI chat-completions format Cursor's custom-model path uses, so no relay
process is needed:

1. Cursor → Settings → **Models**.
2. In **Override OpenAI Base URL**, enter `https://api.tokenfactory.nebius.com/v1`
   (the `/v1` suffix matters — Cursor appends `/chat/completions`).
3. In the **OpenAI API Key** field, paste your Nebius Token Factory key
   (despite the label, the key is sent to the URL you configured).
4. Add a custom model named `moonshotai/Kimi-K3` (and any other id from
   Nebius's `/v1/models`) and select it in the AI panel.

Caveats, stated plainly:

- Only the **custom-model / OpenAI slot** honors the override. Cursor's
  provider-native models (Anthropic, Gemini, and Cursor's own) ignore it, and
  **Tab completions always run on Cursor's backend** regardless.
- This is a durable editor setting, not a per-run injection — toggling back
  means clearing the override. That is exactly the kind of config mutation
  kimirelay's harnesses avoid, which is why this is a recipe rather than a
  wrapper.
- Because Cursor talks to Nebius directly, relay features (per-session cost
  tracking, Tavily web-search emulation, context trimming) do not apply.

## Why no `kursor`

The Cursor CLI (`cursor-agent`) exposes `--api-key`/`CURSOR_API_KEY` (Cursor's
own accounts), `--model`, `--header`, and sandbox/workspace flags — but **no
OpenAI-compatible base-URL override and no third-party provider mechanism**
([CLI parameter reference](https://cursor.com/docs/cli/reference/parameters)).
Without an injectable endpoint there is nothing for a spawned-harness wrapper
to inject, and shipping a `kursor` that silently ran Cursor's own models would
be worse than not shipping one.

If Cursor adds provider overrides to `cursor-agent`, the spawned-harness
family (see `packages/cli/src/lib/harnesses/opencode.ts` for the pattern)
gives `kursor` a ready-made shape: per-run env/config injection, nothing
durable written.
