/**
 * Sandbox provider selection. Two backends share the sandbox surface:
 * `contree` (Nebius Token Factory Sandboxes - gated beta, same key as
 * inference) and `tenki` (tenki.cloud - open signup). See
 * docs/TENKI-SANDBOXES-PRD.md for the design and rationale.
 */

export type SandboxProviderName = "contree" | "tenki";

export const SANDBOX_DEFAULT_TENKI_CPU = 2;
export const SANDBOX_DEFAULT_TENKI_MEMORY_MB = 4096;

/**
 * First match wins: explicit flag → KIMIRELAY_SANDBOX_PROVIDER → tenki.
 * Deliberately no credential sniffing: credentials in the env never switch
 * providers on their own (2026-08-02 decision, see the PRD). Tenki is the
 * default (2026-08-02, Collin): open signup and CI-verified live, while
 * ConTree stays double-gated (beta access + per-key grants) - select it
 * explicitly with --provider contree.
 */
export function resolveSandboxProvider(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SandboxProviderName {
  const requested = (flag ?? env.KIMIRELAY_SANDBOX_PROVIDER)?.trim().toLowerCase();
  if (requested === "tenki" || requested === "contree") {
    return requested;
  }
  if (requested) {
    throw new Error(
      `Unknown sandbox provider "${requested}". Expected "tenki" (tenki.cloud) or "contree" (Nebius Token Factory).`,
    );
  }
  return "tenki";
}
