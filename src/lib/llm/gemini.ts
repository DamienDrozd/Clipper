import { ApiError, GoogleGenAI, type Content, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { geminiConfig } from "@/lib/env";
import { AppError, isNetworkError } from "@/lib/errors";
import { llmResponseJsonSchema, llmResponseSchema, type LlmResponse } from "./schema";

let client: GoogleGenAI | undefined;

function getClient(): { ai: GoogleGenAI; model: string } {
  const { apiKey, model } = geminiConfig();
  // Le SDK réessaie lui-même les erreurs 408/429/5xx (5 tentatives, attente exponentielle).
  client ??= new GoogleGenAI({ apiKey });
  return { ai: client, model };
}

export function toLlmError(error: unknown, model: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return new AppError("LLM_CONFIG", `Modèle Gemini « ${model} » introuvable : vérifie GEMINI_MODEL.`, { cause: error });
    }
    if (error.status === 400 && /api key/i.test(error.message)) {
      return new AppError("LLM_CONFIG", "Clé API Gemini invalide : vérifie GEMINI_API_KEY.", { cause: error });
    }
    if (error.status === 401 || error.status === 403) {
      return new AppError("LLM_CONFIG", `Accès à Gemini refusé (${error.status}) : vérifie GEMINI_API_KEY.`, { cause: error });
    }
    if (error.status === 429) {
      return new AppError("LLM_QUOTA", "Quota Gemini dépassé.", { cause: error, retryable: true });
    }
    if (error.status === 503) {
      return new AppError("LLM_ERROR", `Le modèle Gemini « ${model} » est surchargé.`, { cause: error, retryable: true });
    }
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new AppError("LLM_ERROR", `Erreur de l'API Gemini : ${detail.slice(0, 300)}`, {
    cause: error,
    retryable: (error instanceof ApiError && error.status >= 500) || isNetworkError(error),
  });
}

function validate(text: string | undefined): { data?: LlmResponse; problem?: string } {
  if (!text?.trim()) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problem: "JSON invalide" };
  }
  const result = llmResponseSchema.safeParse(json);
  return result.success ? { data: result.data } : { problem: z.prettifyError(result.error) };
}

/**
 * Appelle Gemini en sortie JSON structurée. Si la réponse est vide, mal formée ou non
 * conforme au schéma zod, une seule nouvelle tentative est faite en renvoyant l'erreur
 * au modèle ; ensuite, échec explicite.
 */
export async function generateClipSelection(
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const { ai, model } = getClient();
  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  let lastProblem = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: GenerateContentResponse;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: llmResponseJsonSchema,
          temperature: 0.4,
          abortSignal: signal,
        },
      });
    } catch (error) {
      throw toLlmError(error, model);
    }

    const text = response.text;
    const { data, problem } = validate(text);
    if (data) return data;
    lastProblem = text?.trim()
      ? problem!
      : `réponse vide, finishReason ${response.candidates?.[0]?.finishReason ?? "inconnu"}`;
    console.warn(`[gemini] réponse invalide (tentative ${attempt}/2) : ${lastProblem}`);

    contents.push(
      { role: "model", parts: [{ text: text ?? "" }] },
      {
        role: "user",
        parts: [{ text: `Ta réponse est invalide (${lastProblem}). Renvoie uniquement un objet JSON conforme au schéma demandé.` }],
      },
    );
  }

  throw new AppError(
    "LLM_INVALID",
    `Gemini a renvoyé une réponse invalide deux fois de suite (${lastProblem.slice(0, 300)}).`,
    { retryable: true },
  );
}
