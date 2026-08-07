import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { LAUNCHERS, launcherScript, refreshLauncherWrappers } from "../../cli/src/lib/wrappers.js";

describe("launcherScript", () => {
  test("locates bun itself and falls back to ~/.bun/bin", () => {
    const script = launcherScript("/home/u/.kimirelay/bin", "");
    expect(script.startsWith("#!/usr/bin/env sh\n")).toBe(true);
    expect(script).toContain('BUN_BIN="$(command -v bun 2>/dev/null || true)"');
    expect(script).toContain('[ -n "$BUN_BIN" ] || BUN_BIN="$HOME/.bun/bin/bun"');
    expect(script).toContain("exit 127");
    expect(script).toContain('exec "$BUN_BIN" "/home/u/.kimirelay/bin/kimirelay.js" "$@"');
  });

  test("inserts the harness subcommand before passthrough args", () => {
    const script = launcherScript("/home/u/.kimirelay/bin", "claude");
    expect(script).toContain('exec "$BUN_BIN" "/home/u/.kimirelay/bin/kimirelay.js" claude "$@"');
  });
});

describe("refreshLauncherWrappers", () => {
  test("rewrites stale wrappers, creates missing ones, and is idempotent", async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "kimirelay-wrappers-"));

    // A pre-0.10 wrapper that assumed `bun` was on PATH.
    await writeFile(
      path.join(binDir, "klaude"),
      `#!/usr/bin/env sh\nexec bun "${binDir}/kimirelay.js" claude "$@"\n`,
      { mode: 0o755 },
    );

    const updated = await refreshLauncherWrappers(binDir);
    expect(updated).toBe(LAUNCHERS.length);

    for (const { name, subcommand } of LAUNCHERS) {
      const dest = path.join(binDir, name);
      expect(await readFile(dest, "utf8")).toBe(launcherScript(binDir, subcommand));
      const mode = (await stat(dest)).mode;
      expect(mode & 0o111).not.toBe(0);
    }

    expect(await refreshLauncherWrappers(binDir)).toBe(0);
  });
});
