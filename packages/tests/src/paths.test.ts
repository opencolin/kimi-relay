import { describe, expect, test } from "vitest";
import { kimirelayHome, isProcessAlive } from "@kimirelay/cli/dist/lib/paths.js";

describe("paths.ts - single source of truth for home + liveness (#7)", () => {
  test("kimirelayHome honors KIMIRELAY_HOME env", () => {
    const original = process.env.KIMIRELAY_HOME;
    process.env.KIMIRELAY_HOME = "/tmp/kimirelay-test-home-xyz";
    try {
      expect(kimirelayHome()).toBe("/tmp/kimirelay-test-home-xyz");
    } finally {
      if (original === undefined) delete process.env.KIMIRELAY_HOME;
      else process.env.KIMIRELAY_HOME = original;
    }
  });

  test("kimirelayHome falls back to ~/.kimirelay when env unset", () => {
    const original = process.env.KIMIRELAY_HOME;
    delete process.env.KIMIRELAY_HOME;
    try {
      const home = kimirelayHome();
      expect(home.endsWith("/.kimirelay")).toBe(true);
    } finally {
      if (original !== undefined) process.env.KIMIRELAY_HOME = original;
    }
  });

  test("isProcessAlive returns false for a dead pid (ESRCH)", () => {
    // pid 0 is never a valid kill target on unix; use a very large unused pid.
    expect(isProcessAlive(999_999_999)).toBe(false);
  });

  test("isProcessAlive returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
