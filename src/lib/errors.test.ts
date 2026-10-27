import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { AppError, isRetryable } from "./errors";
import { toYouTubeError } from "./youtube/errors";
import { toLlmError } from "./llm/gemini";
import { retryDelayUpperBound, MAX_ATTEMPTS } from "./jobs/boss";

const apiError = (status: number, message = "erreur") => new ApiError({ status, message });
const googleError = (status: number, reason?: string) => ({
  message: "erreur",
  response: { status, data: { error: { message: "erreur", errors: reason ? [{ reason }] : [] } } },
});

describe("isRetryable — Gemini", () => {
  it.each([429, 500, 502, 503, 504])("réessaie une erreur %i", (status) => {
    expect(isRetryable(toLlmError(apiError(status), "m"))).toBe(true);
  });

  it.each([400, 401, 403, 404])("ne réessaie pas une erreur %i (configuration)", (status) => {
    expect(isRetryable(toLlmError(apiError(status, "API key not valid"), "m"))).toBe(false);
  });

  it("réessaie une coupure réseau", () => {
    const error = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    expect(isRetryable(toLlmError(error, "m"))).toBe(true);
  });

  it("donne un message lisible pour la surcharge", () => {
    expect(toLlmError(apiError(503), "gemini-x").message).toBe("Le modèle Gemini « gemini-x » est surchargé.");
  });
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

describe("retryDelayUpperBound", () => {
  it("double à chaque tentative, plafonné à 10 min", () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelayUpperBound)).toEqual([60, 120, 240, 480, 600, 600]);
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
