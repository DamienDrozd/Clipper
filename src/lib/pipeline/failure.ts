import { isRetryable, userMessage } from "@/lib/errors";

export type FailureOutcome =
  /** Erreur temporaire : la vidéo attend la reprise planifiée par pg-boss. */
  | { status: "WAITING_RETRY"; message: string }
  /** Erreur définitive ou reprises épuisées. */
  | { status: "FAILED"; message: string };

/**
 * Que faire d'une erreur du pipeline ? `retryCount` = nombre de reprises déjà faites par pg-boss,
 * `maxAttempts` = tentatives autorisées au total (première exécution comprise).
 */
export function decideFailure(error: unknown, retryCount: number, maxAttempts: number): FailureOutcome {
  const attempt = retryCount + 1;
  const message = userMessage(error);

  if (isRetryable(error)) {
    if (attempt < maxAttempts) {
      return { status: "WAITING_RETRY", message: `${message} (tentative ${attempt}/${maxAttempts})` };
    }
    return {
      status: "FAILED",
      message: `${message} Toujours en échec après ${attempt} tentatives : réessaie plus tard avec « Relancer maintenant ».`,
    };
  }
  return { status: "FAILED", message: attempt > 1 ? `${message} (échec après ${attempt} tentatives)` : message };
}
