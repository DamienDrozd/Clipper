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
  constructor(
    readonly code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

/** Message lisible pour l'UI, quelle que soit l'erreur. */
export function userMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  return `Erreur inattendue : ${detail.slice(0, 300)}`;
}
