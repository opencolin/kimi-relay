/**
 * Minimal REST client for Nebius Token Factory Sandboxes (ConTree).
 *
 * API reference: https://docs.tokenfactory.nebius.com/api-reference/sandboxes/
 * Auth is the same NEBIUS_API_KEY used for inference. The product is in beta
 * behind an access request (https://tokenfactory.nebius.com/sandboxes/about),
 * so 401/403 responses are mapped to a SandboxAccessError with that pointer
 * instead of a bare HTTP error.
 */

export const CONTREE_DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/sandboxes";

export const SANDBOX_ACCESS_HINT =
  "Token Factory Sandboxes is in beta and needs access approval for your Nebius account. " +
  "Request access at https://tokenfactory.nebius.com/sandboxes/about, then retry.";

export const SANDBOX_PROJECT_HINT =
  "Pass your Nebius project via `--project <id>` or `NEBIUS_PROJECT=<id>` " +
  "(shown in the Token Factory console).";

export class SandboxAccessError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail = "") {
    // Live-observed distinction: a granted account can still get 403s of the
    // form `{"error": "Insufficient permissions: spawn"}` when the key lacks
    // Sandboxes permissions for the addressed project. That is a key/project
    // configuration problem, not a beta-access problem - say so instead of
    // pointing at the access-request form.
    const insufficient = /insufficient permissions/i.test(detail);
    super(
      insufficient
        ? `Sandboxes API returned ${status} (${detail.trim().slice(0, 200)}). The key ` +
            "authenticates but lacks this permission - check the project " +
            "(`--project` / `NEBIUS_PROJECT`) and grant the API key Sandboxes " +
            "permissions in the Token Factory console."
        : `Sandboxes API returned ${status}. ${SANDBOX_ACCESS_HINT}`,
    );
    this.name = "SandboxAccessError";
    this.status = status;
    this.detail = detail;
  }
}

export class SandboxApiError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Sandboxes API error ${status}: ${detail}`);
    this.name = "SandboxApiError";
    this.status = status;
  }
}

export type ContreeClientOptions = {
  apiKey: string;
  /** Nebius project id, sent as the Project header when set. */
  project?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type SpawnInstanceSpec = {
  /** Image reference, e.g. "tag:ubuntu:latest" or an image UUID. */
  image: string;
  command: string;
  shell?: boolean | undefined;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
  networking?: { enabled: boolean } | undefined;
  timeout?: number | undefined;
  truncate_output_at?: number | undefined;
  disposable?: boolean | undefined;
};

export type SpawnedInstance = {
  operationId: string;
  body: Record<string, unknown>;
};

export type OperationStatus = {
  raw: Record<string, unknown>;
  state: string | undefined;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  /** Snapshot image produced by non-disposable runs (set on SUCCESS only). */
  resultImageUuid: string | undefined;
};

/** GET /v1/whoami - token permission map + account limits. */
export type SandboxWhoAmI = {
  raw: Record<string, unknown>;
  permissions: Record<string, boolean>;
  limits: Record<string, number>;
};

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled", "error", "done", "finished"]);

export class ContreeClient {
  private readonly apiKey: string;
  private readonly project: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ContreeClientOptions) {
    this.apiKey = options.apiKey;
    this.project = options.project;
    this.baseUrl = (options.baseUrl ?? CONTREE_DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...(this.project ? { Project: this.project } : {}),
      ...extra,
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers({
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...((init?.headers as Record<string, string>) ?? {}),
      }),
    });
    if (res.status === 401 || res.status === 403) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      throw new SandboxAccessError(res.status, detail);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      // Live-observed: some accounts require a Project header on every call.
      // The raw body escapes the quotes (Missing \"Project\" header), so match
      // loosely across any non-letter junk between the words.
      const withHint = /missing[^a-z]*project[^a-z]*header/i.test(detail)
        ? `${detail} - ${SANDBOX_PROJECT_HINT}`
        : detail;
      throw new SandboxApiError(res.status, withHint || res.statusText);
    }
    return res;
  }

  /**
   * Cheap access probe: lists operations. Succeeds (possibly empty) for
   * accounts with Sandboxes access; throws SandboxAccessError otherwise.
   */
  async checkAccess(): Promise<void> {
    await this.request("/v1/operations", { method: "GET" });
  }

  /**
   * GET /v1/whoami - the definitive access report: which Sandboxes
   * permissions (spawn, spawn_disposable, list, import, set_image_tag,
   * cancel) this key holds for the addressed project, plus account limits.
   */
  async whoami(): Promise<SandboxWhoAmI> {
    const res = await this.request("/v1/whoami", { method: "GET" });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const permissions = (raw.permissions ?? {}) as Record<string, boolean>;
    const limits = (raw.limits ?? {}) as Record<string, number>;
    return { raw, permissions, limits };
  }

  /**
   * GET /v1/inspect/{imageUUID}/download?path=... - read one file out of a
   * result/checkpoint image (the artifact-download path for finished
   * non-disposable runs).
   */
  async downloadFile(imageUuid: string, filePath: string): Promise<Uint8Array> {
    const res = await this.request(
      `/v1/inspect/${encodeURIComponent(imageUuid)}/download?path=${encodeURIComponent(filePath)}`,
      { method: "GET" },
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * PATCH /v1/images/{imageUUID}/tag - name a checkpoint image so it can be
   * reused via `image: "tag:<name>"` and survives the 180-day untagged
   * retention window.
   */
  async tagImage(imageUuid: string, tag: string): Promise<void> {
    await this.request(`/v1/images/${encodeURIComponent(imageUuid)}/tag`, {
      method: "PATCH",
      body: JSON.stringify({ tag }),
    });
  }

  /** POST /v1/instances - spawn a container instance running `spec.command`. */
  async spawnInstance(spec: SpawnInstanceSpec): Promise<SpawnedInstance> {
    const res = await this.request("/v1/instances", {
      method: "POST",
      body: JSON.stringify(spec),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const location = res.headers.get("location") ?? "";
    const fromLocation = /\/v1\/operations\/([^/?#]+)/.exec(location)?.[1];
    const operationId = fromLocation ?? (typeof body.uuid === "string" ? body.uuid : undefined);
    if (!operationId) {
      throw new SandboxApiError(res.status, "spawn response had no operation id");
    }
    return { operationId, body };
  }

  /** GET /v1/operations/{id} - normalized status + captured output. */
  async getOperation(operationId: string): Promise<OperationStatus> {
    const res = await this.request(`/v1/operations/${operationId}`, { method: "GET" });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return normalizeOperation(raw);
  }

  /**
   * Polls the operation until it reaches a terminal state (or `timeoutMs`
   * elapses). Calls `onPoll` with each snapshot so callers can render
   * incremental output.
   */
  async waitForOperation(
    operationId: string,
    opts?: {
      timeoutMs?: number | undefined;
      intervalMs?: number | undefined;
      onPoll?: ((status: OperationStatus) => void) | undefined;
    },
  ): Promise<OperationStatus> {
    const timeoutMs = opts?.timeoutMs ?? 15 * 60 * 1000;
    const intervalMs = opts?.intervalMs ?? 2000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await this.getOperation(operationId);
      opts?.onPoll?.(status);
      if (status.state && TERMINAL_STATES.has(status.state.toLowerCase())) {
        return status;
      }
      if (Date.now() >= deadline) {
        throw new SandboxApiError(408, `operation ${operationId} did not finish in ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/**
 * The beta API's operation payload shape is still settling; pull the fields
 * we rely on defensively so a rename degrades output rather than crashing.
 */
export function normalizeOperation(raw: Record<string, unknown>): OperationStatus {
  const result = asRecord(raw.result) ?? raw;
  const state =
    firstString(raw.state, raw.status, result.state, result.status) ??
    (typeof raw.done === "boolean" ? (raw.done ? "done" : "running") : undefined);
  return {
    raw,
    state,
    stdout: extractStream(result.stdout),
    stderr: extractStream(result.stderr),
    exitCode: firstNumber(result.exit_code, result.exitCode, result.code),
    resultImageUuid: firstString(raw.result_image_uuid, result.result_image_uuid),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function extractStream(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  const text = firstString(record.text, record.data, record.value);
  if (text === undefined) {
    return "";
  }
  if (record.encoding === "base64") {
    try {
      return Buffer.from(text, "base64").toString("utf8");
    } catch {
      return text;
    }
  }
  return text;
}
