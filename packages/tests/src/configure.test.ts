import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { checkNebiusKey, runConfigure } from "../../cli/src/lib/commands/global.js";
import { readGlobalConfig, resolveStoredTavilyApiKey } from "../../cli/src/lib/global-config.js";

const temporaryHomes: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

describe("kimirelay configure", () => {
  test("persists an Exa key across a cold start even when configure reads it from the environment", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "kimirelay-configure-"));
    temporaryHomes.push(home);
    vi.stubEnv("NEBIUS_API_KEY", "nebius-test-key");
    vi.stubEnv("TAVILY_API_KEY", "exa-test-key");

    await runConfigure(home, async () => "valid");

    vi.stubEnv("TAVILY_API_KEY", "");
    const stored = (await readGlobalConfig(home)).tavilyApiKey;

    expect(stored).toBe("exa-test-key");
    expect(resolveStoredTavilyApiKey(stored)).toBe("exa-test-key");
  });

  test("keeps a stored key that validates, without prompting", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "kimirelay-configure-"));
    temporaryHomes.push(home);
    vi.stubEnv("NEBIUS_API_KEY", "stored-key");
    vi.stubEnv("TAVILY_API_KEY", "t");
    await runConfigure(home, async () => "valid");
    const checked: string[] = [];
    const ok = await runConfigure(home, async (key) => {
      checked.push(key);
      return "valid";
    });
    expect(ok).toBe(true);
    expect(checked).toEqual(["stored-key"]);
  });

  test("keeps an unverifiable key instead of discarding it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "kimirelay-configure-"));
    temporaryHomes.push(home);
    vi.stubEnv("NEBIUS_API_KEY", "maybe-fine-key");
    vi.stubEnv("TAVILY_API_KEY", "t");
    const ok = await runConfigure(home, async () => "unreachable");
    expect(ok).toBe(true);
    const { readGlobalConfig: readCfg } = await import("../../cli/src/lib/global-config.js");
    expect((await readCfg(home)).apiKey).toBe("maybe-fine-key");
  });
});

describe("checkNebiusKey", () => {
  const respond = (status: number) => async () => new Response("{}", { status });

  test("maps HTTP outcomes to key verdicts", async () => {
    expect(await checkNebiusKey("k", respond(200))).toBe("valid");
    expect(await checkNebiusKey("k", respond(401))).toBe("invalid");
    expect(await checkNebiusKey("k", respond(403))).toBe("invalid");
    expect(await checkNebiusKey("k", respond(500))).toBe("unreachable");
  });

  test("network failure is unreachable, never invalid", async () => {
    expect(
      await checkNebiusKey("k", async () => {
        throw new Error("offline");
      }),
    ).toBe("unreachable");
  });

  test("sends the key as a bearer header to the models endpoint", async () => {
    const seen: { url?: string; auth?: string | null } = {};
    await checkNebiusKey("secret-k", async (input, init) => {
      seen.url = String(input);
      seen.auth = new Headers(init?.headers).get("authorization");
      return new Response("{}", { status: 200 });
    });
    expect(seen.url).toBe("https://api.tokenfactory.nebius.com/v1/models");
    expect(seen.auth).toBe("Bearer secret-k");
  });
});
