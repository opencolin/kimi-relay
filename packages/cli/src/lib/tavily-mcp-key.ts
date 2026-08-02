/**
 * Shared bits of the per-harness Tavily MCP auto-inject. Each harness injects
 * Tavily's remote MCP server its own way (klaude: ephemeral --mcp-config file;
 * kodex: `-c mcp_servers.*` launch flags; openkode: generated config block),
 * but they share the endpoint and the decision of whether a usable key exists.
 * Pi is deliberately excluded: pi has no MCP support by design, and kpi
 * launches it with --no-extensions.
 */

export const TAVILY_MCP_BASE_URL = "https://mcp.tavily.com/mcp/";

/**
 * The Tavily key to use for MCP injection, or undefined when injection should
 * not happen (no key, or the user opted out via KIMIRELAY_DISABLE_TAVILY_MCP).
 */
export function resolveTavilyMcpKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.KIMIRELAY_DISABLE_TAVILY_MCP === "1") {
    return undefined;
  }
  const key = env.TAVILY_API_KEY?.trim();
  return key || undefined;
}
