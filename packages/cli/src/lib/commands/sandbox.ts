import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveNebiusApiKey } from "../nebius-core.js";
import { readGlobalConfig, resolveStoredTavilyApiKey } from "../global-config.js";
import {
  ContreeClient,
  SandboxAccessError,
  SandboxApiError,
  type OperationStatus,
} from "../sandbox/contree.js";
import {
  SANDBOX_ADVISORY_BLOCK,
  buildPrebakeBootstrap,
  createOutputRenderer,
  detectGitOrigin,
  runHarnessInSandbox,
  runSandboxCommand,
  writeAdvisoryBlock,
} from "../sandbox/run.js";

const USAGE = `Usage:
  kimirelay sandbox status [--project <id>]   Report your key's Sandboxes permissions
  kimirelay sandbox run [--image <tag>] [--timeout <s>] [--keep] [--fetch <path>]... <command...>
                                              Run a shell command in a sandbox. --keep
                                              snapshots the filesystem into a result image;
                                              --fetch (implies --keep) downloads files from
                                              it afterwards
  kimirelay sandbox fetch <image-uuid> <path> [--out <file>]
                                              Download one file from a result/checkpoint image
  kimirelay sandbox prebake [--image <base>] [--tag <name>]
                                              Bake kimirelay + both agent CLIs into a reusable
                                              image (default tag kimirelay:prebaked); later runs
                                              with --image tag:kimirelay:prebaked skip the cold
                                              bootstrap
  kimirelay sandbox advisory [--write]        Print (or append) the agent-instructions
                                              block steering agents toward sandboxes

Some accounts require a Nebius project on every Sandboxes call; pass it with
--project or set NEBIUS_PROJECT (the id is in the Token Factory console).

Remote harness sessions (headless, requires a pushed git repo):
  klaude --sandbox -p "<task>"                Claude Code on Kimi K3 inside a sandbox
  kodex --sandbox exec "<task>"               Codex inside a sandbox

Sandboxes is a Nebius Token Factory beta; access: https://tokenfactory.nebius.com/sandboxes/about`;

type SandboxCliOptions = {
  image?: string;
  timeoutSeconds?: number;
  apiKey?: string;
  project?: string;
  write?: boolean;
  keep?: boolean;
  fetches: string[];
  out?: string;
  tag?: string;
  rest: string[];
};

/**
 * The Nebius project the Sandboxes API should bill/authorize against. Some
 * accounts require it on every call (the API answers 400 "Missing Project
 * header" otherwise); find the id in the Token Factory console.
 */
export function resolveSandboxProject(flag?: string): string | undefined {
  return flag?.trim() || process.env.NEBIUS_PROJECT?.trim() || undefined;
}

function parseSandboxArgs(args: string[]): SandboxCliOptions {
  const opts: SandboxCliOptions = { fetches: [], rest: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === undefined) {
      continue;
    }
    if (
      token === "--image" ||
      token === "--timeout" ||
      token === "--api-key" ||
      token === "--project" ||
      token === "--fetch" ||
      token === "--out" ||
      token === "--tag"
    ) {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error(`Flag ${token} expects a value`);
      }
      if (token === "--image") {
        opts.image = value;
      } else if (token === "--timeout") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`--timeout expects a positive number of seconds, got "${value}"`);
        }
        opts.timeoutSeconds = parsed;
      } else if (token === "--project") {
        opts.project = value;
      } else if (token === "--fetch") {
        opts.fetches.push(value);
      } else if (token === "--out") {
        opts.out = value;
      } else if (token === "--tag") {
        opts.tag = value;
      } else {
        opts.apiKey = value;
      }
      i += 1;
      continue;
    }
    if (token === "--write") {
      opts.write = true;
      continue;
    }
    if (token === "--keep") {
      opts.keep = true;
      continue;
    }
    if (token === "--") {
      opts.rest.push(...args.slice(i + 1));
      break;
    }
    opts.rest.push(token);
  }
  return opts;
}

async function buildClient(apiKeyFlag?: string, projectFlag?: string): Promise<ContreeClient> {
  const apiKey = await resolveNebiusApiKey({ apiKey: apiKeyFlag, home: os.homedir() });
  if (!apiKey) {
    throw new Error("No Nebius API key found. Run `kimirelay configure` or set NEBIUS_API_KEY.");
  }
  const project = resolveSandboxProject(projectFlag);
  return new ContreeClient({ apiKey, ...(project ? { project } : {}) });
}

async function resolveTavilyKey(): Promise<string | undefined> {
  if (process.env.TAVILY_API_KEY) {
    return process.env.TAVILY_API_KEY;
  }
  try {
    const { tavilyApiKey } = await readGlobalConfig(os.homedir());
    return resolveStoredTavilyApiKey(tavilyApiKey) || undefined;
  } catch {
    return undefined;
  }
}

export async function runSandboxCli(args: string[]): Promise<void> {
  const [verb, ...rest] = args;
  if (!verb || verb === "help" || verb === "--help") {
    console.log(USAGE);
    return;
  }

  if (verb === "status") {
    const opts = parseSandboxArgs(rest);
    const client = await buildClient(opts.apiKey, opts.project);
    try {
      const who = await client.whoami();
      const granted = Object.entries(who.permissions)
        .filter(([, ok]) => ok)
        .map(([name]) => name);
      const denied = Object.entries(who.permissions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);
      if (granted.length === 0) {
        console.log(
          "Sandboxes access: key and project accepted, but the key holds NO Sandboxes " +
            `permissions (all of ${denied.join(", ")} are denied). Grant the API key ` +
            "Sandboxes permissions for this project in the Token Factory console.",
        );
        process.exitCode = 1;
        return;
      }
      console.log(`Sandboxes access: OK. Permissions granted: ${granted.join(", ")}.`);
      if (denied.length > 0) {
        console.log(`Not granted: ${denied.join(", ")}.`);
      }
      const timeout = who.limits.instance_max_timeout;
      const concurrency = who.limits.instance_max_concurrency;
      if (timeout || concurrency) {
        console.log(
          `Limits: max timeout ${timeout ?? "?"}s, max concurrent instances ${concurrency ?? "?"}.`,
        );
      }
      return;
    } catch (err) {
      // Older deployments may not serve /whoami - fall back to the probe.
      if (!(err instanceof SandboxApiError && err.status === 404)) {
        throw err;
      }
    }
    await client.checkAccess();
    console.log("Sandboxes access: OK - your Nebius key can use Token Factory Sandboxes.");
    return;
  }

  if (verb === "run") {
    const opts = parseSandboxArgs(rest);
    const command = opts.rest.join(" ").trim();
    if (!command) {
      throw new Error(`sandbox run needs a command.\n\n${USAGE}`);
    }
    const keep = Boolean(opts.keep) || opts.fetches.length > 0;
    const client = await buildClient(opts.apiKey, opts.project);
    const status = await runSandboxCommand(
      client,
      { command, image: opts.image, timeoutSeconds: opts.timeoutSeconds, keep },
      createOutputRenderer(),
    );
    if (status.exitCode !== undefined && status.exitCode !== 0) {
      process.exitCode = status.exitCode;
    } else if (status.state && status.state.toLowerCase() === "failed") {
      process.exitCode = 1;
    }
    await handleRunArtifacts(client, status, opts);
    return;
  }

  if (verb === "fetch") {
    const opts = parseSandboxArgs(rest);
    const [imageUuid, remotePath] = opts.rest;
    if (!imageUuid || !remotePath) {
      throw new Error(`sandbox fetch needs an image uuid and a file path.\n\n${USAGE}`);
    }
    const client = await buildClient(opts.apiKey, opts.project);
    const bytes = await client.downloadFile(imageUuid, remotePath);
    const dest = opts.out ?? path.basename(remotePath);
    await writeFile(dest, bytes);
    console.log(`${remotePath} → ${dest} (${bytes.byteLength} bytes)`);
    return;
  }

  if (verb === "prebake") {
    const opts = parseSandboxArgs(rest);
    const tag = opts.tag ?? "kimirelay:prebaked";
    const client = await buildClient(opts.apiKey, opts.project);
    console.log("Prebaking: installing kimirelay + agent CLIs into a reusable image…");
    const status = await runSandboxCommand(
      client,
      {
        command: buildPrebakeBootstrap(),
        image: opts.image,
        timeoutSeconds: opts.timeoutSeconds ?? 900,
        keep: true,
      },
      createOutputRenderer(),
    );
    if (
      (status.exitCode !== undefined && status.exitCode !== 0) ||
      (status.state && status.state.toLowerCase() === "failed")
    ) {
      throw new Error("Prebake run failed - see the output above.");
    }
    if (!status.resultImageUuid) {
      throw new Error(
        "Prebake finished but the operation reported no result image; cannot tag. " +
          "Check that the run was non-disposable and succeeded.",
      );
    }
    await client.tagImage(status.resultImageUuid, tag);
    console.log(`Prebaked image ready: ${status.resultImageUuid} tagged as ${tag}.`);
    console.log(`Use it with: klaude --sandbox --image tag:${tag} -p "<task>"`);
    return;
  }

  if (verb === "advisory") {
    const opts = parseSandboxArgs(rest);
    if (!opts.write) {
      console.log(SANDBOX_ADVISORY_BLOCK);
      console.log("Append it to your agent instructions with: kimirelay sandbox advisory --write");
      return;
    }
    const home = os.homedir();
    const targets = [
      path.join(home, ".claude", "CLAUDE.md"),
      path.join(home, ".codex", "AGENTS.md"),
    ];
    for (const target of targets) {
      const result = await writeAdvisoryBlock(target);
      console.log(`${target}: ${result === "written" ? "advisory added" : "already present"}`);
    }
    return;
  }

  throw new Error(`Unknown "sandbox ${verb}" command.\n\n${USAGE}`);
}

/**
 * Post-run artifact handling for `sandbox run`: report the result image of a
 * kept run, and download any --fetch paths from it.
 */
async function handleRunArtifacts(
  client: ContreeClient,
  status: OperationStatus,
  opts: { keep?: boolean | undefined; fetches: string[]; out?: string | undefined },
): Promise<void> {
  const kept = Boolean(opts.keep) || opts.fetches.length > 0;
  if (!kept) {
    return;
  }
  if (!status.resultImageUuid) {
    if (opts.fetches.length > 0) {
      console.error(
        "No result image was produced (the run must SUCCEED to snapshot), so --fetch " +
          "paths cannot be downloaded.",
      );
      process.exitCode = process.exitCode || 1;
    }
    return;
  }
  console.log(
    `Result image: ${status.resultImageUuid} (fetch more later with ` +
      `\`kimirelay sandbox fetch ${status.resultImageUuid} <path>\`)`,
  );
  for (const remotePath of opts.fetches) {
    const dest = path.join(opts.out ?? ".", path.basename(remotePath));
    try {
      const bytes = await client.downloadFile(status.resultImageUuid, remotePath);
      await writeFile(dest, bytes);
      console.log(`${remotePath} → ${dest} (${bytes.byteLength} bytes)`);
    } catch (err) {
      console.error(`Fetch failed for ${remotePath}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = process.exitCode || 1;
    }
  }
}

/**
 * Entry point for `klaude --sandbox ...` / `kodex --sandbox ...`: runs the
 * harness headlessly inside a disposable Token Factory Sandbox against the
 * project's pushed git state. Interactive TUI sessions are not supported over
 * the beta API's polling surface - pass a headless prompt (e.g. `-p` for
 * Claude Code).
 */
export async function runHarnessSandbox(
  harness: "claude" | "codex",
  passthrough: string[],
  flags: {
    apiKey?: string | undefined;
    image?: string | undefined;
    project?: string | undefined;
    keep?: boolean | undefined;
  },
): Promise<void> {
  if (passthrough.length === 0) {
    throw new Error(
      `--sandbox runs are headless: pass the harness a task, e.g. ` +
        (harness === "claude"
          ? `klaude --sandbox -p "fix the failing test"`
          : `kodex --sandbox exec "fix the failing test"`),
    );
  }
  const origin = detectGitOrigin(process.cwd());
  if (!origin) {
    throw new Error(
      "--sandbox needs a git repo with an `origin` remote (the sandbox clones your pushed state). " +
        "Run it from inside a pushed repository.",
    );
  }
  const apiKey = await resolveNebiusApiKey({ apiKey: flags.apiKey, home: os.homedir() });
  if (!apiKey) {
    throw new Error("No Nebius API key found. Run `kimirelay configure` or set NEBIUS_API_KEY.");
  }
  const project = resolveSandboxProject(flags.project);
  const client = new ContreeClient({ apiKey, ...(project ? { project } : {}) });
  try {
    await client.checkAccess();
  } catch (err) {
    // A list-permission 403 does not block spawning (live-observed); anything
    // else propagates with its already-actionable message (beta access,
    // missing Project header, or missing spawn permission).
    if (
      !(err instanceof SandboxAccessError && /insufficient permissions: list/i.test(err.detail))
    ) {
      throw err;
    }
  }

  console.log(
    `Sandbox session: cloning ${origin.repoUrl}${origin.branch ? ` (${origin.branch})` : ""} - ` +
      `local uncommitted changes are NOT included.`,
  );
  const status = await runHarnessInSandbox(
    client,
    {
      harness,
      passthrough,
      repoUrl: origin.repoUrl,
      branch: origin.branch || undefined,
      apiKey,
      tavilyApiKey: await resolveTavilyKey(),
      image: flags.image,
      keep: flags.keep,
    },
    createOutputRenderer(),
  );
  if (status.exitCode !== undefined && status.exitCode !== 0) {
    process.exitCode = status.exitCode;
  } else if (status.state && status.state.toLowerCase() === "failed") {
    process.exitCode = 1;
  }
  if (flags.keep && status.resultImageUuid) {
    console.log(
      `Result image: ${status.resultImageUuid} - download files with ` +
        `\`kimirelay sandbox fetch ${status.resultImageUuid} <path>\` (the repo lives at /work).`,
    );
  }
}
