import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { BlockedContentError, classifyGeminiError, InvalidOutputError } from "./gemini-errors";

/** ApiError telle que le SDK la construit : corps JSON de Google dans `message`. */
const apiError = (status: number, error: object) => new ApiError({ status, message: JSON.stringify({ error }) });

describe("classifyGeminiError", () => {
  it("503 UNAVAILABLE → OVERLOADED", () => {
    const result = classifyGeminiError(
      apiError(503, { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." }),
    );
    expect(result).toMatchObject({ kind: "OVERLOADED", httpStatus: 503, apiStatus: "UNAVAILABLE" });
  });

  it("500 INTERNAL → OVERLOADED", () => {
    expect(classifyGeminiError(apiError(500, { code: 500, status: "INTERNAL" })).kind).toBe("OVERLOADED");
  });

  it("429 limite par minute avec RetryInfo → RATE_LIMITED + délai conseillé", () => {
    const result = classifyGeminiError(
      apiError(429, {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
        ],
      }),
    );
    expect(result).toMatchObject({ kind: "RATE_LIMITED", retryAfterMs: 34_000 });
  });

  it("429 sans détails → RATE_LIMITED sans délai", () => {
    const result = classifyGeminiError(apiError(429, { code: 429, status: "RESOURCE_EXHAUSTED" }));
    expect(result.kind).toBe("RATE_LIMITED");
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("429 quota journalier → QUOTA_EXHAUSTED", () => {
    const result = classifyGeminiError(
      apiError(429, {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3600s" },
        ],
      }),
    );
    expect(result.kind).toBe("QUOTA_EXHAUSTED");
  });

  it("429 plafond de dépenses → QUOTA_EXHAUSTED", () => {
    const result = classifyGeminiError(
      apiError(429, { code: 429, status: "RESOURCE_EXHAUSTED", message: "Your project has exceeded its monthly spending cap." }),
    );
    expect(result.kind).toBe("QUOTA_EXHAUSTED");
  });

  it.each([400, 401, 403, 404])("%i → FATAL", (status) => {
    expect(classifyGeminiError(apiError(status, { code: status, status: "INVALID_ARGUMENT" })).kind).toBe("FATAL");
  });

  it("504 / DEADLINE_EXCEEDED → TIMEOUT", () => {
    expect(classifyGeminiError(apiError(504, { code: 504, status: "DEADLINE_EXCEEDED" })).kind).toBe("TIMEOUT");
  });

  it("corps d'erreur non JSON : classement sur le code HTTP", () => {
    expect(classifyGeminiError(new ApiError({ status: 503, message: "Service Unavailable" })).kind).toBe("OVERLOADED");
  });

  it("timeout de l'AbortSignal → TIMEOUT", () => {
    expect(classifyGeminiError(new DOMException("signal timed out", "TimeoutError")).kind).toBe("TIMEOUT");
  });

  it("coupure réseau → NETWORK", () => {
    expect(classifyGeminiError(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })).kind).toBe("NETWORK");
  });

  it("réponse invalide → INVALID_OUTPUT ; contenu bloqué → FATAL", () => {
    expect(classifyGeminiError(new InvalidOutputError("JSON invalide")).kind).toBe("INVALID_OUTPUT");
    expect(classifyGeminiError(new BlockedContentError("SAFETY")).kind).toBe("FATAL");
  });

  it("erreur inconnue (bug probable) → FATAL", () => {
    expect(classifyGeminiError(new Error("undefined is not a function")).kind).toBe("FATAL");
  });
});
