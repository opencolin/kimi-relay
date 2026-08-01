#!/usr/bin/env node
import os from "node:os";
import { loadEnvFile } from "../lib/load-env.js";
import { parseArgs } from "../lib/parse-args.js";
import { printHelp, runConfigure } from "../lib/commands/global.js";
import { dispatchHarnessCommand } from "../lib/commands/harness.js";
import { isHarnessCommand, resolveHarnessInvocation } from "../lib/commands/harness-invocation.js";
import {
  readGlobalConfig,
  resolveStoredTavilyApiKey,
  resolveStoredApiKey,
} from "../lib/global-config.js";
import { maybeSelfUpdate } from "../lib/autoupdate.js";
import { getInstallId, sendTelemetryEvent } from "../lib/telemetry.js";
import { VERSION } from "../lib/version.js";

async function daemonStop(): Promise<void> {
  const { resolveDaemonPort, daemonUrl, daemonPidPath } = await import("../lib/daemon/server.js");
  const { readFile, unlink } = await import("node:fs/promises");
  const pidPath = daemonPidPath();
  const port = resolveDaemonPort();
  let pid: number | undefined;
  try {
    const raw = (await readFile(pidPath, "utf8")).trim();
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    pid = Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    pid = undefined;
  }
  if (pid === undefined) {
    console.log(`kimirelay daemon: not running (no pid file at ${pidPath}).`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      try {
        await unlink(pidPath);
      } catch {
        // ignore
      }
      console.log(`kimirelay daemon: not running (stale pid file removed).`);
      return;
    }
    throw err;
  }
  // Best-effort: the daemon removes its own pid file on SIGTERM. Give it a
  // moment, then clear a leftover if the signal was lost.
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    await unlink(pidPath);
  } catch {
    // already cleaned by the daemon
  }
  console.log(`kimirelay daemon: stopped (pid ${pid}) on ${daemonUrl(port)}.`);
}

async function loadStoredTavilyKey(): Promise<void> {
  if (process.env.TAVILY_API_KEY) {
    return;
  }
  try {
    const { tavilyApiKey } = await readGlobalConfig(process.env.HOME);
    const resolved = resolveStoredTavilyApiKey(tavilyApiKey);
    if (resolved) {
      process.env.TAVILY_API_KEY = resolved;
    }
  } catch {
    // No config yet (e.g. before first `configure`) - nothing to do.
  }
}

async function hasNebiusApiKey(): Promise<boolean> {
  try {
    const home = process.env.HOME;
    if (!home) {
      return Boolean(process.env.NEBIUS_API_KEY?.trim());
    }
    const existing = resolveStoredApiKey((await readGlobalConfig(home)).apiKey);
    return Boolean(existing || process.env.NEBIUS_API_KEY?.trim());
  } catch {
    return Boolean(process.env.NEBIUS_API_KEY?.trim());
  }
}

async function ensureConfiguredForInteractiveLaunch(): Promise<boolean> {
  if (await hasNebiusApiKey()) {
    return true;
  }
  if (!isInteractive()) {
    return false;
  }

  const configured = await runConfigure();
  await loadStoredTavilyKey();
  return configured && (await hasNebiusApiKey());
}

async function runInteractiveLauncher(): Promise<void> {
  if (!isInteractive()) {
    printHelp();
    return;
  }

  if (!(await ensureConfiguredForInteractiveLaunch())) {
    return;
  }

  const clack = await import("@clack/prompts");
  const choice = await clack.select({
    message: "What do you want to run?",
    options: [
      { value: "codex", label: "Codex", hint: "kodex" },
      { value: "claude", label: "Claude Code", hint: "klaude" },
      { value: "pi", label: "Pi Code", hint: "kpi" },
      { value: "opencode", label: "OpenCode", hint: "openkode" },
      { value: "chatgpt", label: "ChatGPT Desktop", hint: "chatgpt" },
      { value: "configure", label: "Configure", hint: "API keys and detected tools" },
    ],
  });
  if (clack.isCancel(choice)) {
    clack.cancel("Cancelled.");
    return;
  }
  if (choice === "configure") {
    await runConfigure();
    return;
  }
  if (choice === "chatgpt") {
    // ChatGPT Desktop (the former Codex desktop app, merged in 2026). Routes
    // to the same codex-app flow as `kimirelay chatgpt` / `codex-app`.
    const { runCodexAppCommand } = await import("../lib/codex-app.js");
    const result = await runCodexAppCommand({ home: os.homedir() });
    if (result.message) {
      console.log(result.message);
    }
    if (result.payload) {
      console.log(JSON.stringify(result.payload, null, 2));
    }
    return;
  }

  await dispatchHarnessCommand(choice, undefined, {});
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function main() {
  // Self-update first (throttled, bounded, never throws). Placed before arg
  // parsing so even `kimirelay help` keeps an install current, but it's a
  // no-op unless this is the installed bundle and the throttle window passed.
  // Keep this before loading project .env files so a repo cannot redirect the
  // updater with KIMIRELAY_MANIFEST_URL / KIMIRELAY_HOME.
  await maybeSelfUpdate();

  // Load a .env (cwd → repo root) after self-update, and only for approved
  // credential keys, so local project env files cannot control the CLI runtime.
  loadEnvFile();

  // If TAVILY_API_KEY still isn't set (not in the env or .env), fall back to the
  // key stored by `kimirelay configure`, so the proxy's web search works
  // without the user re-sourcing .env every session.
  await loadStoredTavilyKey();

  const parsed = parseArgs(process.argv.slice(2));
  const [rawCommand, rawVerb] = parsed.positional;
  // `chatgpt` is the canonical command now that the Codex desktop app merged
  // into the ChatGPT desktop app; `codex-app` (and `chatgpt-app`) stay as
  // backward-compatible aliases. The internal command id / config markers /
  // backup dir keep the stable "codex-app" string so restore still finds old
  // config blocks written by previous versions.
  const command =
    rawCommand === "picode"
      ? "pi"
      : rawCommand === "chatgpt" || rawCommand === "chatgpt-app"
        ? "codex-app"
        : rawCommand;

  if (!command) {
    await runInteractiveLauncher();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`kimirelay v${VERSION}\n`);
    return;
  }

  if (command === "whoami") {
    process.stdout.write(`${await getInstallId()}\n`);
    return;
  }

  if (command === "configure") {
    await runConfigure();
    return;
  }

  // Internal entry point run by install.sh right after a successful install
  // verification. Not user-facing; emits the one-time install event.
  if (command === "__telemetry-install-completed") {
    await sendTelemetryEvent({ event: "install_completed" });
    return;
  }

  // Internal entry point: the daemon self-spawns with `--daemon` via
  // ensureDaemon() (launch.ts). Runs the shared proxy server forever; never
  // returns. Keep this before any command that needs a key - the daemon needs
  // no daemon-wide credentials (each session registers its own).
  if (command === "--daemon") {
    const { runDaemon } = await import("../lib/daemon/server.js");
    await runDaemon();
    return;
  }

  // User-facing daemon control. Not a harness, so handle it before the harness
  // dispatch (which would reject "daemon" as an unknown harness). Inlined from
  // the former daemon/cli.ts (a shallow pass-through with exactly one caller):
  // `serve` is already covered by the `--daemon` branch above, so only `stop`
  // reaches here.
  if (command === "daemon") {
    const verb = rawVerb;
    if (verb === undefined) {
      throw new Error('Unknown "daemon" command. Expected: stop.');
    }
    if (verb === "stop") {
      await daemonStop();
      return;
    }
    if (verb === "serve") {
      const { runDaemon } = await import("../lib/daemon/server.js");
      await runDaemon();
      return;
    }
    throw new Error(`Unknown "daemon ${verb}" command. Expected: stop.`);
  }

  // Token Factory Sandboxes: `kimirelay sandbox <status|run|advisory>`.
  if (command === "sandbox") {
    const { runSandboxCli } = await import("../lib/commands/sandbox.js");
    const index = process.argv.indexOf("sandbox");
    await runSandboxCli(index === -1 ? [] : process.argv.slice(index + 1));
    return;
  }

  if (command === "codex-app") {
    if (!parsed.flags.restore && !(await ensureConfiguredForInteractiveLaunch())) {
      throw new Error("No Nebius API key found. Run `kimirelay configure` or set NEBIUS_API_KEY.");
    }
    const { runCodexAppCommand } = await import("../lib/codex-app.js");
    const result = await runCodexAppCommand({ home: os.homedir(), ...parsed.flags });
    if (result.message) {
      console.log(result.message);
    }
    if (result.payload) {
      console.log(JSON.stringify(result.payload, null, 2));
    }
    return;
  }

  const invocation = resolveHarnessInvocation(parsed.positional, parsed.flags);

  // `klaude --sandbox ...` / `kodex --sandbox ...`: the wrapper scripts put
  // everything after the harness token into passthrough, so a leading
  // --sandbox there selects the remote Token Factory Sandbox session instead
  // of a local launch. Remaining passthrough goes to the harness inside the
  // sandbox.
  if (
    (invocation.command === "claude" || invocation.command === "codex") &&
    invocation.flags.passthrough?.[0] === "--sandbox"
  ) {
    let rest = invocation.flags.passthrough.slice(1);
    let image: string | undefined;
    if (rest[0] === "--image" && rest[1] !== undefined) {
      image = rest[1];
      rest = rest.slice(2);
    }
    if (rest[0] === "--") {
      rest = rest.slice(1);
    }
    if (!(await ensureConfiguredForInteractiveLaunch())) {
      throw new Error("No Nebius API key found. Run `kimirelay configure` or set NEBIUS_API_KEY.");
    }
    void sendTelemetryEvent({ event: "cli_started", agent: `${invocation.command}-sandbox` });
    const { runHarnessSandbox } = await import("../lib/commands/sandbox.js");
    await runHarnessSandbox(invocation.command, rest, {
      apiKey: invocation.flags.apiKey,
      image,
    });
    return;
  }

  // First-run key setup only matters for the harness-launching commands.
  if (
    (invocation.command === "claude" ||
      invocation.command === "codex" ||
      invocation.command === "opencode" ||
      invocation.command === "pi") &&
    invocation.command !== undefined
  ) {
    if (!(await ensureConfiguredForInteractiveLaunch())) {
      throw new Error("No Nebius API key found. Run `kimirelay configure` or set NEBIUS_API_KEY.");
    }
  }

  if (isHarnessCommand(invocation.command)) {
    void sendTelemetryEvent({ event: "cli_started", agent: invocation.command });
  }

  await dispatchHarnessCommand(invocation.command, undefined, invocation.flags);
}

main().catch((err: unknown) => {
  if (!(err instanceof Error)) {
    console.error(`Error: ${String(err)}`);
    process.exitCode = 1;
    return;
  }
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
