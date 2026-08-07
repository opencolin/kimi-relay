import { describe, expect, test } from "vitest";
import { TAVILY_MCP_BASE_URL, resolveTavilyMcpKey } from "../../cli/src/lib/tavily-mcp-key.js";
import { codexTavilyMcpConfigArgs } from "../../cli/src/lib/codex/core.js";
import { buildOpencodeConfigJson } from "../../cli/src/lib/opencode/core.js";

describe("resolveTavilyMcpKey", () => {
  test("returns the trimmed key when set", () => {
    expect(resolveTavilyMcpKey({ TAVILY_API_KEY: " tvly-x " } as NodeJS.ProcessEnv)).toBe("tvly-x");
  });

  test("returns undefined without a key or with the opt-out", () => {
    expect(resolveTavilyMcpKey({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveTavilyMcpKey({ TAVILY_API_KEY: "  " } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      resolveTavilyMcpKey({
        TAVILY_API_KEY: "tvly-x",
        KIMIRELAY_DISABLE_TAVILY_MCP: "1",
      } as NodeJS.ProcessEnv),
    ).toBeUndefined();
  });
});

describe("codexTavilyMcpConfigArgs", () => {
  test("defines the remote server via env-var bearer auth, never the key itself", () => {
    const args = codexTavilyMcpConfigArgs();
    expect(args).toEqual([
      "-c",
      `mcp_servers.tavily.url="${TAVILY_MCP_BASE_URL}"`,
      "-c",
      `mcp_servers.tavily.bearer_token_env_var="TAVILY_API_KEY"`,
    ]);
    expect(args.join(" ")).not.toContain("tvly-");
  });
});

describe("opencode Tavily MCP config", () => {
  test("adds the remote server with env-interpolated bearer auth when enabled", () => {
    const config = buildOpencodeConfigJson({ tavilyMcp: true }) as {
      mcp?: Record<string, { type: string; url: string; headers: Record<string, string> }>;
    };
    expect(config.mcp?.tavily?.type).toBe("remote");
    expect(config.mcp?.tavily?.url).toBe(TAVILY_MCP_BASE_URL);
    expect(config.mcp?.tavily?.headers).toEqual({
      Authorization: "Bearer {env:TAVILY_API_KEY}",
    });
    // The config JSON must carry an env reference, never key material.
    expect(JSON.stringify(config)).not.toContain("tvly-");
  });

  test("omits the mcp block by default", () => {
    expect((buildOpencodeConfigJson() as { mcp?: unknown }).mcp).toBeUndefined();
  });
});
