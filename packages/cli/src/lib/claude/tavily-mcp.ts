/**
 * Tavily MCP auto-inject for klaude. The proxy already emulates Claude Code's
 * native web_search via Tavily; this additionally hands the session Tavily's
 * remote MCP server (tavily_search / tavily_extract / ...) when a key is
 * configured. The config is written to an ephemeral 0600 temp file passed via
 * `--mcp-config` - argv never carries the key, and nothing durable is written.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/";

export function shouldInjectTavilyMcp(args: string[], env: NodeJS.ProcessEnv): boolean {
  if (env.KIMIRELAY_DISABLE_TAVILY_MCP === "1") {
    return false;
  }
  if (!env.TAVILY_API_KEY?.trim()) {
    return false;
  }
  // --strict-mcp-config means "use exactly the servers I passed" - injecting
  // ours alongside would violate that.
  if (args.includes("--strict-mcp-config")) {
    return false;
  }
  return true;
}

export function writeTavilyMcpConfig(tavilyApiKey: string): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "kimirelay-tavily-mcp-"));
  const path = join(dir, "mcp.json");
  // Tavily's remote MCP authenticates via the tavilyApiKey query parameter.
  const url = `${TAVILY_MCP_URL}?tavilyApiKey=${encodeURIComponent(tavilyApiKey)}`;
  writeFileSync(path, JSON.stringify({ mcpServers: { tavily: { type: "http", url } } }), {
    mode: 0o600,
  });
  return { path, dir };
}

export function cleanupTavilyMcpConfig(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
