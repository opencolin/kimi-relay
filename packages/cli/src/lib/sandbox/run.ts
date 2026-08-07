import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ContreeClient, type OperationStatus } from "./contree.js";

export const SANDBOX_DEFAULT_IMAGE = "tag:ubuntu:latest";

/** Renders incremental output as poll snapshots grow. */
export function createOutputRenderer(
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
  writeErr: (chunk: string) => void = (chunk) => process.stderr.write(chunk),
): (status: OperationStatus) => void {
  let stdoutSeen = 0;
  let stderrSeen = 0;
  return (status) => {
    if (status.stdout.length > stdoutSeen) {
      write(status.stdout.slice(stdoutSeen));
      stdoutSeen = status.stdout.length;
    }
    if (status.stderr.length > stderrSeen) {
      writeErr(status.stderr.slice(stderrSeen));
      stderrSeen = status.stderr.length;
    }
  };
}

export type SandboxRunSpec = {
  command: string;
  image?: string | undefined;
  env?: Record<string, string> | undefined;
  timeoutSeconds?: number | undefined;
  /**
   * Non-disposable runs snapshot their filesystem into a result image on
   * success (the artifact-download / checkpoint path). Default: disposable.
   */
  keep?: boolean | undefined;
};

/** Runs one shell command in a networked sandbox instance. */
export async function runSandboxCommand(
  client: ContreeClient,
  spec: SandboxRunSpec,
  onPoll?: (status: OperationStatus) => void,
): Promise<OperationStatus> {
  const { operationId } = await client.spawnInstance({
    image: spec.image ?? SANDBOX_DEFAULT_IMAGE,
    command: spec.command,
    shell: true,
    env: spec.env,
    networking: { enabled: true },
    disposable: !spec.keep,
    ...(spec.timeoutSeconds ? { timeout: spec.timeoutSeconds } : {}),
  });
  return client.waitForOperation(operationId, {
    timeoutMs: (spec.timeoutSeconds ?? 900) * 1000 + 60_000,
    onPoll,
  });
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type HarnessSandboxSpec = {
  harness: "claude" | "codex";
  passthrough: string[];
  repoUrl: string;
  branch?: string | undefined;
  apiKey: string;
  tavilyApiKey?: string | undefined;
  image?: string | undefined;
  timeoutSeconds?: number | undefined;
  /** Keep a result-image snapshot for artifact download (default disposable). */
  keep?: boolean | undefined;
};

/** Per-harness agent CLI install command used inside the sandbox bootstrap. */
const HARNESS_INSTALL: Record<
  HarnessSandboxSpec["harness"],
  { install: string; bin: string; binary: string }
> = {
  claude: { install: "npm install -g @anthropic-ai/claude-code", bin: "klaude", binary: "claude" },
  codex: { install: "npm install -g @openai/codex", bin: "kodex", binary: "codex" },
};

/**
 * Shared tooling-install preamble. Every install is `command -v`-guarded so
 * a prebaked image (see buildPrebakeBootstrap) skips straight past the cold
 * bootstrap - the same script costs ~a minute on tag:ubuntu:latest and ~0s
 * on tag:kimirelay:prebaked.
 */
function bootstrapPreamble(): string[] {
  return [
    "set -eu",
    "export DEBIAN_FRONTEND=noninteractive",
    'export PATH="$HOME/.kimirelay/bin:$HOME/.bun/bin:$PATH"',
    // ubuntu base ships without curl/git/node; install quietly when missing.
    "command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }",
    "command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }",
    "command -v npm >/dev/null 2>&1 || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs; }",
    "command -v kimirelay >/dev/null 2>&1 || curl -fsSL https://kimirelay.com/install.sh | sh",
  ];
}

/**
 * Builds the bootstrap script for a remote harness session: install kimirelay
 * via the public one-liner, install the agent CLI, clone the project, run the
 * harness headlessly with the caller's passthrough args. Keys travel via the
 * instance env (never embedded in the command string).
 */
export function buildHarnessBootstrap(spec: HarnessSandboxSpec): string {
  const { install, bin, binary } = HARNESS_INSTALL[spec.harness];
  const branchArg = spec.branch ? `-b ${shellQuote(spec.branch)} ` : "";
  const args = spec.passthrough.map(shellQuote).join(" ");
  return [
    ...bootstrapPreamble(),
    `command -v ${binary} >/dev/null 2>&1 || ${install}`,
    `git clone --depth 1 ${branchArg}${shellQuote(spec.repoUrl)} /work`,
    "cd /work",
    `${bin} ${args}`.trim(),
  ].join("\n");
}

/**
 * Builds the one-time prebake script: install ALL the tooling (kimirelay and
 * both harness CLIs), verify, and exit. Run non-disposably, the result image
 * is a warm checkpoint; tagged (kimirelay:prebaked by default), later
 * `--sandbox --image tag:<tag>` runs skip the cold bootstrap entirely thanks
 * to the command -v guards above.
 */
export function buildPrebakeBootstrap(): string {
  return [
    ...bootstrapPreamble(),
    HARNESS_INSTALL.claude.install,
    HARNESS_INSTALL.codex.install,
    "kimirelay --version",
    "echo kimirelay-prebake-complete",
  ].join("\n");
}

export async function runHarnessInSandbox(
  client: ContreeClient,
  spec: HarnessSandboxSpec,
  onPoll?: (status: OperationStatus) => void,
): Promise<OperationStatus> {
  const env: Record<string, string> = {
    NEBIUS_API_KEY: spec.apiKey,
    ...(spec.tavilyApiKey ? { TAVILY_API_KEY: spec.tavilyApiKey } : {}),
  };
  return runSandboxCommand(
    client,
    {
      command: buildHarnessBootstrap(spec),
      image: spec.image,
      env,
      timeoutSeconds: spec.timeoutSeconds ?? 1800,
      keep: spec.keep,
    },
    onPoll,
  );
}

/** Resolves the origin URL + current branch of the git repo containing cwd. */
export function detectGitOrigin(cwd: string): { repoUrl: string; branch: string } | undefined {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  if (url.status !== 0) {
    return undefined;
  }
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" });
  const repoUrl = url.stdout.trim();
  if (!repoUrl) {
    return undefined;
  }
  return {
    repoUrl,
    branch: branch.status === 0 ? branch.stdout.trim() : "",
  };
}

const ADVISORY_MARKER = "<!-- kimirelay:sandbox-advisory -->";

export const SANDBOX_ADVISORY_BLOCK = `${ADVISORY_MARKER}
## Sandboxed execution

When a Nebius Token Factory Sandbox is available (kimirelay's \`--sandbox\`
mode or the \`contree\` tooling), prefer running risky or untrusted commands -
installers, unreviewed scripts, destructive operations - inside a disposable
sandbox instead of on the host. This is advisory: the sandbox wrapper, not
this note, is the enforcement boundary.
`;

/** Appends the advisory block to an agent-instructions file, idempotently. */
export async function writeAdvisoryBlock(filePath: string): Promise<"written" | "already-present"> {
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    // File missing - we'll create it (and its directory) below.
  }
  if (existing.includes(ADVISORY_MARKER)) {
    return "already-present";
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const separator =
    existing && !existing.endsWith("\n\n") ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
  await appendFile(filePath, `${separator}${SANDBOX_ADVISORY_BLOCK}`);
  return "written";
}
