export type AppErrorCode =
  | "INVALID_INPUT"
  | "VIDEO_NOT_FOUND"
  | "NOT_OWNER"
  | "NO_CHANNEL"
  | "LIVE_VIDEO"
  | "QUOTA_EXCEEDED"
  | "AUTH_EXPIRED"
  | "NO_CAPTIONS"
  | "YOUTUBE_ERROR"
  | "LLM_CONFIG"
  | "LLM_QUOTA"
  | "LLM_ERROR"
  | "LLM_INVALID"
  | "NO_CLIPS";

/** Erreur métier dont le message (en français) peut être montré tel quel à l'utilisateur. */
export class AppError extends Error {
  /** Erreur passagère (surcharge, réseau…) : le worker réessaiera automatiquement. */
  readonly retryable: boolean;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.retryable = options?.retryable ?? false;
  }
}

/** Message lisible pour l'UI, quelle que soit l'erreur. */
export function userMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  return `Erreur inattendue : ${detail.slice(0, 300)}`;
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

/** Coupure réseau (en remontant la chaîne des `cause`). */
export function isNetworkError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
    if (message === "fetch failed") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** L'erreur mérite-t-elle une nouvelle tentative automatique plus tard ? */
export function isRetryable(error: unknown): boolean {
  return error instanceof AppError ? error.retryable : isNetworkError(error);
}
