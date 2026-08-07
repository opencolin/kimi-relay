import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  TAVILY_MCP_URL,
  cleanupTavilyMcpConfig,
  shouldInjectTavilyMcp,
  writeTavilyMcpConfig,
} from "../../cli/src/lib/claude/tavily-mcp.js";

describe("shouldInjectTavilyMcp", () => {
  const withKey = { TAVILY_API_KEY: "tvly-test" } as NodeJS.ProcessEnv;

  test("injects when a key is configured", () => {
    expect(shouldInjectTavilyMcp([], withKey)).toBe(true);
    expect(shouldInjectTavilyMcp(["-p", "hi"], withKey)).toBe(true);
  });

  test("skips without a key", () => {
    expect(shouldInjectTavilyMcp([], {} as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldInjectTavilyMcp([], { TAVILY_API_KEY: "  " } as NodeJS.ProcessEnv)).toBe(false);
  });

  test("skips on the opt-out env var", () => {
    expect(
      shouldInjectTavilyMcp([], {
        ...withKey,
        KIMIRELAY_DISABLE_TAVILY_MCP: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  test("skips when the user passed --strict-mcp-config", () => {
    expect(
      shouldInjectTavilyMcp(["--mcp-config", "own.json", "--strict-mcp-config"], withKey),
    ).toBe(false);
  });
});

describe("writeTavilyMcpConfig", () => {
  test("writes an owner-only config with the key in the server url", () => {
    const { path: configPath, dir } = writeTavilyMcpConfig("tvly-abc/+123");
    try {
      expect(path.basename(configPath)).toBe("mcp.json");
      expect(statSync(configPath).mode & 0o777).toBe(0o600);

      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
        mcpServers: { tavily: { type: string; url: string } };
      };
      expect(parsed.mcpServers.tavily.type).toBe("http");
      expect(parsed.mcpServers.tavily.url).toBe(
        `${TAVILY_MCP_URL}?tavilyApiKey=${encodeURIComponent("tvly-abc/+123")}`,
      );
    } finally {
      cleanupTavilyMcpConfig(dir);
    }
  });

  test("cleanup removes the temp dir and tolerates repeats", () => {
    const { path: configPath, dir } = writeTavilyMcpConfig("tvly-test");
    cleanupTavilyMcpConfig(dir);
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    cleanupTavilyMcpConfig(dir);
  });
});
