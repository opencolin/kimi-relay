import os from "node:os";
import * as clack from "@clack/prompts";
import { ALL_HARNESSES, HARNESS_LABEL, type HarnessId } from "../harness.js";
import { isHarnessImplemented } from "../harness-registry.js";
import { detectInstalledHarnesses } from "../detect.js";
import {
  readGlobalConfig,
  setGlobalApiKey,
  resolveStoredApiKey,
  resolveStoredTavilyApiKey,
  setGlobalTavilyApiKey,
} from "../global-config.js";
import { resolveNebiusBaseUrl } from "../nebius-core.js";
import { VERSION } from "../version.js";

export type NebiusKeyCheck = "valid" | "invalid" | "unreachable";

/**
 * Live-check a Nebius key against the models endpoint. Only a definitive
 * 401/403 marks it invalid - server errors and network failures return
 * "unreachable" so configure never blocks or discards a key it cannot judge.
 */
export async function checkNebiusKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NebiusKeyCheck> {
  try {
    const res = await fetchImpl(`${resolveNebiusBaseUrl()}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return "valid";
    }
    if (res.status === 401 || res.status === 403) {
      return "invalid";
    }
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export function printHelp() {
  console.log(`kimirelay v${VERSION} - Nebius Token Factory for coding CLIs

Usage:
  kimirelay configure
  kimirelay whoami
  kimirelay chatgpt [--model <model>] [--restore]  (alpha)
  kimirelay codex [...]       (alias: kodex)
  kimirelay claude [...]      (alias: klaude)
  kimirelay pi [...]          (alias: kpi)
  kimirelay opencode [...]    (alias: openkode)
  kimirelay sandbox status|project|run|fetch|prebake|advisory
                              Cloud sandboxes - tenki.cloud by default (set TENKI_API_KEY);
                              Nebius Token Factory Sandboxes via --provider contree (gated beta)

Extra args after codex/claude/pi/opencode are passed through.

Sandbox sessions (default provider: tenki.cloud - open signup, set TENKI_API_KEY;
Nebius Token Factory with --provider contree needs Sandboxes beta access):
  klaude --sandbox -p "<task>"    Claude Code on Kimi K3 in a disposable microVM,
                                  against your repo's pushed state. Headless only.
  kodex --sandbox exec "<task>"   Same for Codex.
ChatGPT App support is alpha; run \`kimirelay chatgpt --restore\` (alias: codex-app) to restore the previous desktop config.

Codex flags:
  --no-mcp   Skip your ~/.codex/config.toml MCP servers for a fast startup
             (maps to codex --ignore-user-config; also skips other codex config).

Your last-used model is remembered per tool: change it with /model (or --model
before the harness) and the next launch reuses it.

Docs: https://kimirelay.com/llms.txt
  LLM-readable documentation - if you are an AI agent asked to install, configure,
  or use kimirelay (including headless use), read that file first.
`);
}

export async function runConfigure(
  home = os.homedir(),
  checkKey: (apiKey: string) => Promise<NebiusKeyCheck> = checkNebiusKey,
): Promise<boolean> {
  clack.intro("kimirelay configure");

  const detected = detectInstalledHarnesses();
  const notImplemented = ALL_HARNESSES.filter((h) => !isHarnessImplemented(h));

  const lines = ALL_HARNESSES.map((h) => {
    const found = detected[h].installed ? "found" : "not found";
    const support = isHarnessImplemented(h) ? " (ephemeral settings)" : " (support coming later)";
    return `  ${HARNESS_LABEL[h]}: ${found}${support}`;
  });
  clack.log.info(`Detected tools:\n${lines.join("\n")}`);

  const existing = resolveStoredApiKey((await readGlobalConfig(home)).apiKey);
  let apiKey = existing || process.env.NEBIUS_API_KEY || "";
  // Live-check an existing key so a rotated/revoked one re-opens the prompt -
  // without this, configure silently keeps a dead stored key forever (the
  // stored key beats the environment, so even a fresh export can't fix it).
  if (apiKey) {
    const check = await checkKey(apiKey);
    if (check === "invalid") {
      clack.log.warn(
        "Your existing Nebius key was rejected by the API (unauthorized) - it may have been rotated or revoked. Enter a new one.",
      );
      apiKey = "";
    } else if (check === "valid") {
      clack.log.success("Nebius key: valid.");
    } else {
      clack.log.warn("Could not reach Nebius to verify the existing key - keeping it.");
    }
  }
  while (!apiKey) {
    const entered = await clack.password({
      message: "Nebius API key (from https://tokenfactory.nebius.com/?modals=create-api-key):",
      validate: (value) => (value.trim() ? undefined : "An API key is required"),
    });
    if (clack.isCancel(entered)) {
      clack.cancel("Cancelled.");
      return false;
    }
    const candidate = entered.trim();
    const check = await checkKey(candidate);
    if (check === "invalid") {
      clack.log.warn("That key was rejected by Nebius (unauthorized) - check it and try again.");
      continue;
    }
    if (check === "valid") {
      clack.log.success("Nebius key: valid.");
    } else {
      clack.log.warn("Could not reach Nebius to verify the key - storing it anyway.");
    }
    apiKey = candidate;
  }
  await setGlobalApiKey(home, apiKey);

  // Tavily powers the proxy's native web_search emulation for Claude Code and
  // Codex. It's optional - without it, searches return a clear "TAVILY_API_KEY
  // not set" error rather than failing silently - so allow skipping.
  const existingTavily = resolveStoredTavilyApiKey((await readGlobalConfig(home)).tavilyApiKey);
  let tavilyApiKey = existingTavily || process.env.TAVILY_API_KEY || "";
  if (!tavilyApiKey) {
    const enteredTavily = await clack.password({
      message:
        "Tavily API key - OPTIONAL, press Enter to skip (recommended: unlocks live web search + Tavily tools; free key at https://app.tavily.com):",
      validate: (value) => (value.trim() || value === "" ? undefined : undefined),
    });
    if (clack.isCancel(enteredTavily)) {
      clack.cancel("Cancelled.");
      return false;
    }
    tavilyApiKey = enteredTavily.trim();
  }
  // `configure` is the explicit persistent-credential flow. Store the resolved
  // Tavily key just like the Nebius key above so it survives a cold start even
  // when the current shell's TAVILY_API_KEY does not. (This fixes the papercut
  // where a daemon started before configure kept failing web search.)
  await setGlobalTavilyApiKey(home, tavilyApiKey);
  if (tavilyApiKey) {
    clack.log.success("Tavily web search enabled.");
  } else {
    clack.log.info(
      "Tavily key skipped - agents run fine without it, just with no live web search. Add one anytime with `kimirelay configure`.",
    );
  }

  const launchable = ALL_HARNESSES.filter(
    (h) => isHarnessImplemented(h) && detected[h as HarnessId].installed,
  );
  if (launchable.length > 0) {
    clack.log.info(
      `Ready to launch: ${launchable
        .map((h) => HARNESS_LABEL[h])
        .join(", ")}. Run \`kimirelay <harness>\` to start - nothing is written to disk.`,
    );
  }

  if (notImplemented.length > 0) {
    clack.log.info(
      `${notImplemented.map((h) => HARNESS_LABEL[h]).join(" and ")} support is coming in a later phase (needs a local translation proxy).`,
    );
  }

  clack.outro("Done.");
  return true;
}
