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
 * First match wins: explicit flag → KIMIRELAY_SANDBOX_PROVIDER → auto.
 * Auto prefers Nebius (inference-account affinity) and falls back to tenki
 * when a Tenki credential exists - practically: TF stays default for the few
 * with granted access, tenki serves everyone else without a beta queue.
 */
export function resolveSandboxProvider(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  nebiusUsable = false,
): SandboxProviderName {
  const requested = (flag ?? env.KIMIRELAY_SANDBOX_PROVIDER)?.trim().toLowerCase();
  if (requested === "tenki" || requested === "contree") {
    return requested;
  }
  if (requested) {
    throw new Error(
      `Unknown sandbox provider "${requested}". Expected "contree" (Nebius Token Factory) or "tenki".`,
    );
  }
  const hasTenki = Boolean(env.TENKI_AUTH_TOKEN?.trim() || env.TENKI_API_KEY?.trim());
  if (!nebiusUsable && hasTenki) {
    return "tenki";
  }
  return "contree";
}
