import { describe, expect, test } from "vitest";
import { resolveSandboxProvider } from "../../cli/src/lib/sandbox/provider.js";
import {
  resolveTenkiAuth,
  runTenkiCommand,
  runTenkiHarness,
  type TenkiSession,
  type TenkiSessionFactory,
} from "../../cli/src/lib/sandbox/tenki.js";

const encoder = new TextEncoder();

function fakeFactory(overrides?: {
  exitCode?: number;
  files?: Record<string, string>;
  onCreate?: (opts: Parameters<TenkiSessionFactory>[0]) => void;
}): { factory: TenkiSessionFactory; calls: { run: string[][]; closed: boolean[] } } {
  const calls = { run: [] as string[][], closed: [] as boolean[] };
  const factory: TenkiSessionFactory = async (opts) => {
    overrides?.onCreate?.(opts);
    const session: TenkiSession = {
      run: async (argv) => {
        calls.run.push(argv);
        return {
          exitCode: overrides?.exitCode ?? 0,
          stdout: encoder.encode("tenki-ok\n"),
          stderr: new Uint8Array(0),
        };
      },
      readFile: async (path) => {
        const content = overrides?.files?.[path];
        if (content === undefined) {
          throw new Error(`no such file: ${path}`);
        }
        return encoder.encode(content);
      },
      close: async () => {
        calls.closed.push(true);
      },
    };
    return session;
  };
  return { factory, calls };
}

describe("resolveSandboxProvider", () => {
  test("explicit flag and env win, invalid values throw", () => {
    expect(resolveSandboxProvider("tenki", {} as NodeJS.ProcessEnv)).toBe("tenki");
    expect(
      resolveSandboxProvider(undefined, {
        KIMIRELAY_SANDBOX_PROVIDER: "tenki",
      } as NodeJS.ProcessEnv),
    ).toBe("tenki");
    expect(() => resolveSandboxProvider("docker", {} as NodeJS.ProcessEnv)).toThrow(
      /Unknown sandbox provider/,
    );
  });

  test("defaults to tenki - credentials never switch providers, explicit contree works", () => {
    expect(resolveSandboxProvider(undefined, {} as NodeJS.ProcessEnv)).toBe("tenki");
    expect(resolveSandboxProvider(undefined, { NEBIUS_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe(
      "tenki",
    );
    expect(resolveSandboxProvider("contree", {} as NodeJS.ProcessEnv)).toBe("contree");
    expect(
      resolveSandboxProvider(undefined, {
        KIMIRELAY_SANDBOX_PROVIDER: "contree",
      } as NodeJS.ProcessEnv),
    ).toBe("contree");
  });
});

describe("runTenkiCommand", () => {
  test("wraps the command in sh -lc, closes the session, maps exit codes", async () => {
    const { factory, calls } = fakeFactory();
    const result = await runTenkiCommand({ command: "echo hi" }, factory, "tk_test");
    expect(calls.run).toEqual([["sh", "-lc", "echo hi"]]);
    expect(calls.closed).toEqual([true]);
    expect(result.status.state).toBe("succeeded");
    expect(result.status.stdout).toBe("tenki-ok\n");
  });

  test("reads --fetch artifacts from the live session and reports misses", async () => {
    const { factory } = fakeFactory({ files: { "/work/out.txt": "artifact!" } });
    const result = await runTenkiCommand(
      { command: "make", fetches: ["/work/out.txt", "/work/missing.txt"] },
      factory,
      "tk_test",
    );
    expect(new TextDecoder().decode(result.artifacts.get("/work/out.txt"))).toBe("artifact!");
    expect(result.fetchErrors.get("/work/missing.txt")).toMatch(/no such file/);
  });

  test("closes the session even when the run fails", async () => {
    const { factory, calls } = fakeFactory({ exitCode: 3 });
    const result = await runTenkiCommand({ command: "false" }, factory, "tk_test");
    expect(result.status.state).toBe("failed");
    expect(result.status.exitCode).toBe(3);
    expect(calls.closed).toEqual([true]);
  });

  test("refuses to run without a credential", async () => {
    const { factory } = fakeFactory();
    await expect(runTenkiCommand({ command: "echo" }, factory, undefined)).rejects.toThrow(
      /TENKI_API_KEY/,
    );
  });
});

describe("runTenkiHarness", () => {
  test("carries keys in the session env (request body), never the command", async () => {
    let created: Parameters<TenkiSessionFactory>[0] | undefined;
    const { factory, calls } = fakeFactory({ onCreate: (opts) => (created = opts) });
    await runTenkiHarness(
      {
        harness: "claude",
        passthrough: ["-p", "task"],
        repoUrl: "https://github.com/o/r.git",
        apiKey: "nebius-secret",
        tavilyApiKey: "tvly-secret",
      },
      factory,
      "tk_test",
    );
    expect(created?.env).toEqual({
      NEBIUS_API_KEY: "nebius-secret",
      TAVILY_API_KEY: "tvly-secret",
    });
    const script = calls.run[0]?.[2] ?? "";
    expect(script).toContain("git clone");
    expect(script).toContain("klaude");
    expect(script).not.toContain("nebius-secret");
    expect(script).not.toContain("tvly-secret");
  });
});

describe("resolveTenkiAuth", () => {
  test("prefers TENKI_AUTH_TOKEN over TENKI_API_KEY", () => {
    expect(
      resolveTenkiAuth({
        TENKI_AUTH_TOKEN: "ory_st_1",
        TENKI_API_KEY: "tk_2",
      } as NodeJS.ProcessEnv),
    ).toBe("ory_st_1");
    expect(resolveTenkiAuth({ TENKI_API_KEY: "tk_2" } as NodeJS.ProcessEnv)).toBe("tk_2");
    expect(resolveTenkiAuth({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
