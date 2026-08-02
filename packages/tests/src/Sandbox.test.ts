import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ContreeClient,
  SandboxAccessError,
  SandboxApiError,
  normalizeOperation,
} from "../../cli/src/lib/sandbox/contree.js";
import {
  buildHarnessBootstrap,
  createOutputRenderer,
  shellQuote,
  writeAdvisoryBlock,
} from "../../cli/src/lib/sandbox/run.js";

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

describe("ContreeClient", () => {
  test("sends bearer auth and maps 403 to the beta-access error", async () => {
    const seen: { url?: string; auth?: string | null } = {};
    const client = new ContreeClient({
      apiKey: "test-key",
      fetchImpl: async (input, init) => {
        seen.url = String(input);
        seen.auth = new Headers(init?.headers).get("authorization");
        return jsonResponse({ detail: "forbidden" }, { status: 403 });
      },
    });
    await expect(client.checkAccess()).rejects.toBeInstanceOf(SandboxAccessError);
    expect(seen.url).toBe("https://api.tokenfactory.nebius.com/sandboxes/v1/operations");
    expect(seen.auth).toBe("Bearer test-key");
  });

  test("spawnInstance takes the operation id from the Location header", async () => {
    const client = new ContreeClient({
      apiKey: "k",
      fetchImpl: async () =>
        jsonResponse(
          { uuid: "body-uuid" },
          { status: 201, headers: { location: "/v1/operations/op-123" } },
        ),
    });
    const spawned = await client.spawnInstance({ image: "tag:ubuntu:latest", command: "true" });
    expect(spawned.operationId).toBe("op-123");
  });

  test("spawnInstance falls back to the body uuid without a Location header", async () => {
    const client = new ContreeClient({
      apiKey: "k",
      fetchImpl: async () => jsonResponse({ uuid: "body-uuid" }, { status: 201 }),
    });
    const spawned = await client.spawnInstance({ image: "tag:ubuntu:latest", command: "true" });
    expect(spawned.operationId).toBe("body-uuid");
  });

  test("waitForOperation polls until a terminal state and surfaces output", async () => {
    const states = [
      { state: "running", result: { stdout: "he" } },
      { state: "running", result: { stdout: "hello " } },
      { state: "succeeded", result: { stdout: "hello world", exit_code: 0 } },
    ];
    let call = 0;
    const client = new ContreeClient({
      apiKey: "k",
      fetchImpl: async () => jsonResponse(states[Math.min(call++, states.length - 1)]),
    });
    const chunks: string[] = [];
    const render = createOutputRenderer(
      (chunk) => chunks.push(chunk),
      () => {},
    );
    const status = await client.waitForOperation("op", { intervalMs: 1, onPoll: render });
    expect(status.state).toBe("succeeded");
    expect(status.exitCode).toBe(0);
    expect(chunks.join("")).toBe("hello world");
  });

  test("non-auth HTTP errors become SandboxApiError with detail", async () => {
    const client = new ContreeClient({
      apiKey: "k",
      fetchImpl: async () => new Response("image not found", { status: 404 }),
    });
    await expect(
      client.spawnInstance({ image: "tag:nope", command: "true" }),
    ).rejects.toMatchObject({ name: "SandboxApiError", status: 404 });
  });
});

describe("normalizeOperation", () => {
  test("decodes base64 stream payloads", () => {
    const status = normalizeOperation({
      state: "succeeded",
      result: { stdout: { value: Buffer.from("hi\n").toString("base64"), encoding: "base64" } },
    });
    expect(status.stdout).toBe("hi\n");
  });

  test("tolerates unknown shapes", () => {
    const status = normalizeOperation({ done: false });
    expect(status.state).toBe("running");
    expect(status.stdout).toBe("");
  });
});

describe("harness bootstrap", () => {
  test("quotes passthrough args and keeps keys out of the script", () => {
    const script = buildHarnessBootstrap({
      harness: "claude",
      passthrough: ["-p", `fix the "auth" bug; don't break tests`],
      repoUrl: "https://github.com/example/repo.git",
      branch: "main",
      apiKey: "secret-key",
    });
    expect(script).toContain("curl -fsSL https://kimirelay.com/install.sh | sh");
    expect(script).toContain(
      "git clone --depth 1 -b 'main' 'https://github.com/example/repo.git' /work",
    );
    expect(script).toContain(`klaude '-p' 'fix the "auth" bug; don'\\''t break tests'`);
    expect(script).not.toContain("secret-key");
  });

  test("codex bootstrap installs the codex CLI", () => {
    const script = buildHarnessBootstrap({
      harness: "codex",
      passthrough: ["exec", "task"],
      repoUrl: "git@github.com:example/repo.git",
      apiKey: "k",
    });
    expect(script).toContain("npm install -g @openai/codex");
    expect(script).toContain("kodex 'exec' 'task'");
  });
});

describe("shellQuote", () => {
  test("survives single quotes", () => {
    expect(shellQuote("don't")).toBe(`'don'\\''t'`);
  });
});

describe("writeAdvisoryBlock", () => {
  test("appends once and is idempotent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kimirelay-advisory-"));
    const target = path.join(dir, "nested", "CLAUDE.md");
    expect(await writeAdvisoryBlock(target)).toBe("written");
    expect(await writeAdvisoryBlock(target)).toBe("already-present");
    const content = await readFile(target, "utf8");
    expect(content.match(/kimirelay:sandbox-advisory/g)).toHaveLength(1);
    expect(content).toContain("Sandboxed execution");
  });
});

describe("Project header handling (live-observed API behavior)", () => {
  test("sends the Project header when configured", async () => {
    const seen: { project?: string | null } = {};
    const client = new ContreeClient({
      apiKey: "test-key",
      project: "my-project",
      fetchImpl: async (_input, init) => {
        seen.project = new Headers(init?.headers).get("project");
        return jsonResponse({ operations: [] });
      },
    });
    await client.checkAccess();
    expect(seen.project).toBe("my-project");
  });

  test("400 missing-Project-header responses carry the --project hint", async () => {
    const client = new ContreeClient({
      apiKey: "test-key",
      fetchImpl: async () =>
        jsonResponse({ status: 400, error: 'Missing \\"Project\\" header' }, { status: 400 }),
    });
    const err = await client.checkAccess().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SandboxApiError);
    expect((err as Error).message).toContain("--project");
    expect((err as Error).message).toContain("NEBIUS_PROJECT");
  });

  test("insufficient-permission 403s explain the key/project fix, not beta access", async () => {
    const client = new ContreeClient({
      apiKey: "test-key",
      project: "default",
      fetchImpl: async () =>
        jsonResponse(
          { status: 403, error: "Insufficient permissions: spawn_disposable or spawn" },
          { status: 403 },
        ),
    });
    const err = await client.checkAccess().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SandboxAccessError);
    expect((err as Error).message).toContain("Insufficient permissions");
    expect((err as Error).message).toContain("Token Factory console");
    expect((err as Error).message).not.toContain("Request access");
  });

  test("plain 403s still point at the beta access request", async () => {
    const client = new ContreeClient({
      apiKey: "test-key",
      fetchImpl: async () => jsonResponse({ detail: "forbidden" }, { status: 403 }),
    });
    const err = await client.checkAccess().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SandboxAccessError);
    expect((err as Error).message).toContain("Request access");
  });
});
