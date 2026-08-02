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
 * First match wins: explicit flag → KIMIRELAY_SANDBOX_PROVIDER → contree.
 * Deliberately no credential sniffing: a TENKI_API_KEY in the env never
 * switches providers on its own (2026-08-02 decision, see the PRD) - tenki
 * runs only when explicitly requested.
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
      `Unknown sandbox provider "${requested}". Expected "contree" (Nebius Token Factory) or "tenki".`,
    );
  }
  return "contree";
}
