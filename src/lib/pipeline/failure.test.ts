import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { decideFailure } from "./failure";

const transient = new AppError("LLM_ERROR", "Gemini est surchargé (modèles essayés : a, b).", { retryable: true });
const definitive = new AppError("LLM_QUOTA", "Quota Gemini atteint.");

describe("decideFailure", () => {
  it("erreur temporaire avec des reprises restantes → WAITING_RETRY", () => {
    expect(decideFailure(transient, 0, 5)).toEqual({
      status: "WAITING_RETRY",
      message: "Gemini est surchargé (modèles essayés : a, b). (tentative 1/5)",
    });
    expect(decideFailure(transient, 3, 5).status).toBe("WAITING_RETRY");
  });

  it("reprises épuisées → FAILED avec la marche à suivre", () => {
    const outcome = decideFailure(transient, 4, 5);
    expect(outcome.status).toBe("FAILED");
    expect(outcome.message).toMatch(/après 5 tentatives.*Relancer maintenant/);
  });

  it("erreur définitive → FAILED immédiatement", () => {
    expect(decideFailure(definitive, 0, 5)).toEqual({ status: "FAILED", message: "Quota Gemini atteint." });
  });
});
