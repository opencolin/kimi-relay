/**
 * Tenki Cloud sandbox provider - the ungated alternative to Token Factory
 * Sandboxes (see docs/TENKI-SANDBOXES-PRD.md). Built on the official
 * `@tenkicloud/sandbox` SDK, lazy-imported so non-sandbox commands never pay
 * for it. Secrets travel via `create({ env })` - the API request body over
 * TLS - never argv and never disk, matching how ConTree receives them.
 */

import type { OperationStatus } from "./contree.js";
import { SANDBOX_DEFAULT_TENKI_CPU, SANDBOX_DEFAULT_TENKI_MEMORY_MB } from "./provider.js";
import { buildHarnessBootstrap, type HarnessSandboxSpec } from "./run.js";

export const TENKI_DOCS_URL = "https://tenki.cloud/docs/sandbox/cli";

/** The Tenki credential from env, or undefined (tk_… key or session token). */
export function resolveTenkiAuth(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.TENKI_AUTH_TOKEN?.trim() || env.TENKI_API_KEY?.trim() || undefined;
}

/**
 * The slice of the SDK the provider uses, injectable for tests. The real
 * factory lazy-imports `@tenkicloud/sandbox` and adapts it to this shape.
 */
export type TenkiSession = {
  run(
    argv: string[],
    opts?: { env?: Record<string, string> },
  ): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>;
  readFile(path: string): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type TenkiSessionFactory = (opts: {
  authToken: string;
  env?: Record<string, string> | undefined;
  maxDurationMs: number;
  cpuCores: number;
  memoryMb: number;
}) => Promise<TenkiSession>;

async function realSessionFactory(opts: Parameters<TenkiSessionFactory>[0]): Promise<TenkiSession> {
  const { TenkiSandbox } = await import("@tenkicloud/sandbox");
  const client = new TenkiSandbox({ authToken: opts.authToken });
  const session = await client.create({
    cpuCores: opts.cpuCores,
    memoryMb: opts.memoryMb,
    maxDurationMs: opts.maxDurationMs,
    allowOutbound: true,
    ...(opts.env ? { env: opts.env } : {}),
  });
  return {
    run: async (argv, runOpts) => {
      const result = await session.run(argv, runOpts);
      return {
        exitCode: result.exitCode,
        stdout: toBytes(result.stdout),
        stderr: toBytes(result.stderr),
      };
    },
    readFile: async (path: string) => toBytes(await session.readFile(path)),
    close: () => session.close(),
  };
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array(0);
}

export type TenkiRunSpec = {
  command: string;
  env?: Record<string, string> | undefined;
  timeoutSeconds?: number | undefined;
  /** Files to read out of the live session after the command finishes. */
  fetches?: string[] | undefined;
};

export type TenkiRunResult = {
  status: OperationStatus;
  /** Fetched file contents keyed by requested path (missing files omitted). */
  artifacts: Map<string, Uint8Array>;
  /** Per-path errors for fetches that failed. */
  fetchErrors: Map<string, string>;
};

/**
 * One command in a disposable Tenki session: create → run (sh -lc) → read any
 * requested artifact files while the session is still alive → close. Returns
 * the same OperationStatus shape the contree path produces so the command
 * layer renders both providers identically.
 */
export async function runTenkiCommand(
  spec: TenkiRunSpec,
  factory: TenkiSessionFactory = realSessionFactory,
  auth: string | undefined = resolveTenkiAuth(),
): Promise<TenkiRunResult> {
  if (!auth) {
    throw new Error(
      `No Tenki credential found. Set TENKI_API_KEY (a tk_… key from tenki.cloud) - see ${TENKI_DOCS_URL}`,
    );
  }
  const timeoutSeconds = spec.timeoutSeconds ?? 900;
  const session = await factory({
    authToken: auth,
    env: spec.env,
    maxDurationMs: timeoutSeconds * 1000,
    cpuCores: SANDBOX_DEFAULT_TENKI_CPU,
    memoryMb: SANDBOX_DEFAULT_TENKI_MEMORY_MB,
  });
  const artifacts = new Map<string, Uint8Array>();
  const fetchErrors = new Map<string, string>();
  try {
    const result = await session.run(["sh", "-lc", spec.command]);
    for (const path of spec.fetches ?? []) {
      try {
        artifacts.set(path, await session.readFile(path));
      } catch (err) {
        fetchErrors.set(path, err instanceof Error ? err.message : String(err));
      }
    }
    const decoder = new TextDecoder();
    return {
      status: {
        raw: {},
        state: result.exitCode === 0 ? "succeeded" : "failed",
        stdout: decoder.decode(result.stdout),
        stderr: decoder.decode(result.stderr),
        exitCode: result.exitCode,
        resultImageUuid: undefined,
      },
      artifacts,
      fetchErrors,
    };
  } finally {
    await session.close().catch(() => {});
  }
}

/**
 * Headless harness session on Tenki: the exact same command -v-guarded
 * bootstrap script the contree path uses (install tooling, clone pushed
 * state, run the harness), with the Nebius/Tavily keys carried in the
 * session's env - request body over TLS, never argv.
 */
export async function runTenkiHarness(
  spec: HarnessSandboxSpec & { fetches?: string[] | undefined },
  factory: TenkiSessionFactory = realSessionFactory,
  auth: string | undefined = resolveTenkiAuth(),
): Promise<TenkiRunResult> {
  const env: Record<string, string> = {
    NEBIUS_API_KEY: spec.apiKey,
    ...(spec.tavilyApiKey ? { TAVILY_API_KEY: spec.tavilyApiKey } : {}),
  };
  return runTenkiCommand(
    {
      command: buildHarnessBootstrap(spec),
      env,
      timeoutSeconds: spec.timeoutSeconds ?? 1800,
      fetches: spec.fetches,
    },
    factory,
    auth,
  );
}
