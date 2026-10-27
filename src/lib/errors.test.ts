import { describe, expect, it } from "vitest";
import { AppError, isRetryable } from "./errors";
import { toYouTubeError } from "./youtube/errors";
import { renderRetryDelayUpperBound, MAX_PROCESS_ATTEMPTS, MAX_RENDER_ATTEMPTS } from "./jobs/boss";

const googleError = (status: number, reason?: string) => ({
  message: "erreur",
  response: { status, data: { error: { message: "erreur", errors: reason ? [{ reason }] : [] } } },
});

describe("isRetryable — YouTube", () => {
  it("ne réessaie pas le quota journalier ni un accès révoqué", () => {
    expect(isRetryable(toYouTubeError(googleError(403, "quotaExceeded"), "x"))).toBe(false);
    expect(isRetryable(toYouTubeError(googleError(401), "x"))).toBe(false);
    expect(isRetryable(toYouTubeError(googleError(404, "videoNotFound"), "x"))).toBe(false);
  });

  it("réessaie les limites de débit et les erreurs serveur", () => {
    expect(isRetryable(toYouTubeError(googleError(403, "rateLimitExceeded"), "x"))).toBe(true);
    expect(isRetryable(toYouTubeError(googleError(503), "x"))).toBe(true);
    expect(isRetryable(toYouTubeError(googleError(500, "backendError"), "x"))).toBe(true);
  });
});

describe("isRetryable — autres erreurs", () => {
  it("se fie au drapeau des AppError", () => {
    expect(isRetryable(new AppError("NO_CAPTIONS", "x"))).toBe(false);
    expect(isRetryable(new AppError("LLM_INVALID", "x", { retryable: true }))).toBe(true);
  });

  it("ne réessaie pas une erreur inconnue (bug probable)", () => {
    expect(isRetryable(new Error("undefined is not a function"))).toBe(false);
  });
});

describe("politiques de reprise", () => {
  it("rendu : délai doublé à chaque reprise, plafonné à 10 min", () => {
    expect([0, 1, 2, 3, 4, 5].map(renderRetryDelayUpperBound)).toEqual([60, 120, 240, 480, 600, 600]);
    expect(MAX_RENDER_ATTEMPTS).toBe(5);
  });

  it("pipeline : 5 tentatives au total", () => {
    expect(MAX_PROCESS_ATTEMPTS).toBe(5);
  });
});
