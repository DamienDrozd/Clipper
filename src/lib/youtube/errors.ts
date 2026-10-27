import { AppError } from "@/lib/errors";

type GoogleErrorShape = {
  message?: string;
  status?: number;
  code?: number | string;
  response?: {
    status?: number;
    data?: {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
  };
};

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

/** Convertit une erreur googleapis / google-auth-library en AppError lisible. */
export function toYouTubeError(error: unknown, context: string): AppError {
  if (error instanceof AppError) return error;

  const e = (error ?? {}) as GoogleErrorShape;
  const status = e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
  const data = e.response?.data;
  const apiError = typeof data?.error === "object" ? data.error : undefined;
  const reason = apiError?.errors?.[0]?.reason;
  const detail = apiError?.message ?? data?.error_description ?? e.message ?? "erreur inconnue";

  if (reason && QUOTA_REASONS.has(reason)) {
    return new AppError(
      "QUOTA_EXCEEDED",
      "Quota de l'API YouTube dépassé pour aujourd'hui. Réessaie après sa remise à zéro (minuit, heure du Pacifique).",
      { cause: error },
    );
  }
  if (data?.error === "invalid_grant" || status === 401) {
    return new AppError(
      "AUTH_EXPIRED",
      "L'accès à ton compte YouTube a expiré ou a été révoqué : déconnecte-toi puis reconnecte-toi.",
      { cause: error },
    );
  }
  if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
    return new AppError(
      "AUTH_EXPIRED",
      "Clipper n'a pas l'autorisation YouTube nécessaire : reconnecte-toi en acceptant l'accès YouTube.",
      { cause: error },
    );
  }
  return new AppError("YOUTUBE_ERROR", `Erreur de l'API YouTube (${context}) : ${detail}`, { cause: error });
}
