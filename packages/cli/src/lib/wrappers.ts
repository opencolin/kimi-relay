/**
 * Launcher wrapper maintenance. The installer (scripts/install.sh) writes tiny
 * sh wrappers next to the bundle; the installed bundle rewrites them on the
 * hourly update check so wrapper improvements reach existing installs too.
 * The bundle self-updates, but a wrapper written at install time would
 * otherwise stay frozen forever - that is how pre-0.10 installs kept dying
 * with "exec: bun: not found" even after the bundle updated underneath them.
 *
 * Keep the generated text in lockstep with write_launcher in
 * scripts/install.sh so a fresh install and a refresh produce identical files.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const LAUNCHERS: ReadonlyArray<{ name: string; subcommand: string }> = [
  { name: "kimirelay", subcommand: "" },
  { name: "klaude", subcommand: "claude" },
  { name: "openkode", subcommand: "opencode" },
  { name: "kodex", subcommand: "codex" },
  { name: "kpi", subcommand: "pi" },
];

export function launcherScript(binDir: string, subcommand: string): string {
  const bundle = path.join(binDir, "kimirelay.js");
  const args = subcommand ? ` ${subcommand}` : "";
  return `#!/usr/bin/env sh
# kimirelay launcher - runs the installed Bun-target JS bundle.
BUN_BIN="$(command -v bun 2>/dev/null || true)"
[ -n "$BUN_BIN" ] || BUN_BIN="$HOME/.bun/bin/bun"
if [ ! -x "$BUN_BIN" ]; then
  echo "kimirelay: the bun runtime was not found (looked on PATH and in ~/.bun/bin)." >&2
  echo "Install it with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 127
fi
exec "$BUN_BIN" "${bundle}"${args} "$@"
`;
}

/**
 * Rewrite any launcher whose on-disk content differs from the current format
 * (also recreating missing ones). Returns how many files were (re)written.
 * Writes are atomic (tmp + rename) with the executable bit set.
 */
export async function refreshLauncherWrappers(binDir: string): Promise<number> {
  let updated = 0;
  for (const { name, subcommand } of LAUNCHERS) {
    const dest = path.join(binDir, name);
    const desired = launcherScript(binDir, subcommand);
    let current: string | undefined;
    try {
      current = await readFile(dest, "utf8");
    } catch {
      current = undefined;
    }
    if (current === desired) {
      continue;
    }
    const tmp = `${dest}.new-${process.pid}`;
    await writeFile(tmp, desired, { mode: 0o755 });
    await rename(tmp, dest);
    updated += 1;
  }
  return updated;
}
