/**
 * ApiError — thrown for every non-2xx API response.
 * Mirrors the contract's error envelope:
 *   { code, message, message_ar, details, correlation_id } + HTTP status.
 */
export interface ApiErrorInit {
  code: string;
  message: string;
  messageAr: string;
  details: unknown;
  correlationId: string | null;
  httpStatus: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly messageAr: string;
  readonly details: unknown;
  readonly correlationId: string | null;
  readonly httpStatus: number;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.messageAr = init.messageAr;
    this.details = init.details;
    this.correlationId = init.correlationId;
    this.httpStatus = init.httpStatus;
    // Keep a proper prototype chain when targeting ES2022 downlevels.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Prefer the Arabic message when the UI language is Arabic. */
  localizedMessage(lang: "ar" | "en"): string {
    if (lang === "ar" && this.messageAr) return this.messageAr;
    return this.message || this.code;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Build an ApiError from a raw fetch response that failed. */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> | null = null;
  try {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const get = (k: string): string | null =>
    body && typeof body[k] === "string" ? (body[k] as string) : null;
  return new ApiError({
    code: get("code") ?? "UNKNOWN_ERROR",
    message: get("message") ?? `Request failed with status ${res.status}`,
    messageAr: get("message_ar") ?? "",
    details: body ? body["details"] ?? null : null,
    correlationId: get("correlation_id"),
    httpStatus: res.status,
  });
}
