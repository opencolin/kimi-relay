import os from "node:os";
import path from "node:path";
import { resolveNebiusApiKey } from "../nebius-core.js";
import { readGlobalConfig, resolveStoredTavilyApiKey } from "../global-config.js";
import { ContreeClient, SANDBOX_ACCESS_HINT } from "../sandbox/contree.js";
import {
  SANDBOX_ADVISORY_BLOCK,
  createOutputRenderer,
  detectGitOrigin,
  runHarnessInSandbox,
  runSandboxCommand,
  writeAdvisoryBlock,
} from "../sandbox/run.js";

const USAGE = `Usage:
  kimirelay sandbox status                    Check Sandboxes access for your key
  kimirelay sandbox run [--image <tag>] [--timeout <s>] <command...>
                                              Run a shell command in a disposable sandbox
  kimirelay sandbox advisory [--write]        Print (or append) the agent-instructions
                                              block steering agents toward sandboxes

Remote harness sessions (headless, requires a pushed git repo):
  klaude --sandbox -p "<task>"                Claude Code on Kimi K3 inside a sandbox
  kodex --sandbox exec "<task>"               Codex inside a sandbox

Sandboxes is a Nebius Token Factory beta; access: https://tokenfactory.nebius.com/sandboxes/about`;

type SandboxCliOptions = {
  image?: string;
  timeoutSeconds?: number;
  apiKey?: string;
  write?: boolean;
  rest: string[];
};

function parseSandboxArgs(args: string[]): SandboxCliOptions {
  const opts: SandboxCliOptions = { rest: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === undefined) {
      continue;
    }
    if (token === "--image" || token === "--timeout" || token === "--api-key") {
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
    if (token === "--") {
      opts.rest.push(...args.slice(i + 1));
      break;
    }
    opts.rest.push(token);
  }
  return opts;
}

async function buildClient(apiKeyFlag?: string): Promise<ContreeClient> {
  const apiKey = await resolveNebiusApiKey({ apiKey: apiKeyFlag, home: os.homedir() });
  if (!apiKey) {
    throw new Error("No Nebius API key found. Run `kimirelay configure` or set NEBIUS_API_KEY.");
  }
  return new ContreeClient({ apiKey });
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
    const client = await buildClient(opts.apiKey);
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
    const client = await buildClient(opts.apiKey);
    const status = await runSandboxCommand(
      client,
      { command, image: opts.image, timeoutSeconds: opts.timeoutSeconds },
      createOutputRenderer(),
    );
    if (status.exitCode !== undefined && status.exitCode !== 0) {
      process.exitCode = status.exitCode;
    } else if (status.state && status.state.toLowerCase() === "failed") {
      process.exitCode = 1;
    }
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
 * Entry point for `klaude --sandbox ...` / `kodex --sandbox ...`: runs the
 * harness headlessly inside a disposable Token Factory Sandbox against the
 * project's pushed git state. Interactive TUI sessions are not supported over
 * the beta API's polling surface - pass a headless prompt (e.g. `-p` for
 * Claude Code).
 */
export async function runHarnessSandbox(
  harness: "claude" | "codex",
  passthrough: string[],
  flags: { apiKey?: string | undefined; image?: string | undefined },
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
  const client = new ContreeClient({ apiKey });
  try {
    await client.checkAccess();
  } catch (err) {
    if (err instanceof Error && err.name === "SandboxAccessError") {
      throw new Error(SANDBOX_ACCESS_HINT);
    }
    throw err;
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
    },
    createOutputRenderer(),
  );
  if (status.exitCode !== undefined && status.exitCode !== 0) {
    process.exitCode = status.exitCode;
  } else if (status.state && status.state.toLowerCase() === "failed") {
    process.exitCode = 1;
  }
}
