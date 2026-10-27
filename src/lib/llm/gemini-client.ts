import { createHash } from "node:crypto";
import { GoogleGenAI, type Content } from "@google/genai";
import { z } from "zod";
import { geminiConfig, type GeminiConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { CircuitBreaker } from "./gemini-breaker";
import {
  BlockedContentError,
  classifyGeminiError,
  InvalidOutputError,
  type ClassifiedGeminiError,
} from "./gemini-errors";

export { classifyGeminiError } from "./gemini-errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Requête envoyée à un modèle (identique pour chaque modèle de la chaîne). */
export type GeminiTransportRequest = {
  model: string;
  system: string;
  contents: Content[];
  jsonSchema: unknown;
  temperature: number;
  signal: AbortSignal;
};

export type GeminiTransportResponse = {
  text?: string;
  finishReason?: string;
  blockReason?: string;
  promptTokens?: number;
  outputTokens?: number;
};

/** Appel brut à l'API (SDK en production, faux client dans les tests). */
export type GeminiTransport = (request: GeminiTransportRequest) => Promise<GeminiTransportResponse>;

export type GeminiCallRecord = {
  videoId?: string;
  purpose: string;
  model: string;
  attempt: number;
  outcome: "SUCCESS" | "ERROR" | "SKIPPED";
  errorKind?: string;
  httpStatus?: number;
  durationMs: number;
  delayMs?: number;
  promptTokens?: number;
  outputTokens?: number;
};

export type GeminiCacheStore = {
  get(hash: string): Promise<{ model: string; data: unknown } | null>;
  set(hash: string, entry: { purpose: string; model: string; data: unknown }): Promise<void>;
};

export type StructuredRequest<T> = {
  /** Usage de l'appel (« selection »…), pour le cache et les logs. */
  purpose: string;
  /** Version du prompt : la changer invalide le cache. */
  promptVersion: string;
  system: string;
  prompt: string;
  /** Validation stricte de la réponse. */
  schema: z.ZodType<T>;
  /** Schéma JSON indicatif envoyé à Gemini (responseJsonSchema). */
  jsonSchema: unknown;
  temperature?: number;
  signal?: AbortSignal;
  videoId?: string;
  /** Ignorer le cache (régénération) ; le nouveau résultat le remplace. */
  bypassCache?: boolean;
};

export type StructuredResult<T> = { data: T; model: string; attempts: number; cached: boolean };

export type GeminiClientDeps = {
  config: Omit<GeminiConfig, "apiKey">;
  transport: GeminiTransport;
  breaker?: CircuitBreaker;
  cache?: GeminiCacheStore | null;
  recordCall?: (record: GeminiCallRecord) => void | Promise<void>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Backoff exponentiel avec jitter « full » : aléatoire entre 0 et min(max, base × 2^n). */
export function backoffDelay(retry: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(maxMs, baseMs * 2 ** retry));
}

/** Attente non bloquante, interrompue si le signal est annulé. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const BLOCKING_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

/** Valide le texte JSON d'une réponse ; lève InvalidOutputError ou BlockedContentError. */
function parseOutput<T>(response: GeminiTransportResponse, schema: z.ZodType<T>): T {
  if (response.blockReason) throw new BlockedContentError(response.blockReason);
  if (response.finishReason && BLOCKING_FINISH_REASONS.has(response.finishReason)) {
    throw new BlockedContentError(response.finishReason);
  }
  const text = response.text?.trim();
  if (!text) throw new InvalidOutputError(`réponse vide (finishReason : ${response.finishReason ?? "inconnu"})`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidOutputError(
      response.finishReason === "MAX_TOKENS" ? "réponse tronquée (MAX_TOKENS)" : "JSON invalide",
    );
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new InvalidOutputError(z.prettifyError(result.error));
  return result.data;
}

/** Message utilisateur d'un échec définitif (QUOTA_EXHAUSTED, FATAL). */
function fatalError(error: ClassifiedGeminiError, model: string, cause: unknown): AppError {
  if (error.kind === "QUOTA_EXHAUSTED") {
    return new AppError(
      "LLM_QUOTA",
      `Quota Gemini atteint pour « ${model} » (quota journalier ou plafond de dépenses) : réessaie demain ou augmente le plafond dans Google AI Studio.`,
      { cause },
    );
  }
  if (cause instanceof BlockedContentError) {
    return new AppError("LLM_ERROR", `Gemini a refusé de traiter cette transcription (${cause.message}).`, { cause });
  }
  if (error.httpStatus === 404) {
    return new AppError("LLM_CONFIG", `Modèle Gemini « ${model} » introuvable : vérifie GEMINI_MODELS.`, { cause });
  }
  if (error.httpStatus === 401 || error.httpStatus === 403 || /api key/i.test(error.detail)) {
    return new AppError("LLM_CONFIG", `Gemini refuse la clé API (HTTP ${error.httpStatus}) : vérifie GEMINI_API_KEY.`, { cause });
  }
  return new AppError(
    "LLM_ERROR",
    `Requête refusée par Gemini${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""} : ${error.detail.slice(0, 300)}`,
    { cause },
  );
}

const TRANSIENT_MESSAGES: Record<string, string> = {
  OVERLOADED: "Gemini est surchargé",
  RATE_LIMITED: "Limite de requêtes Gemini atteinte",
  TIMEOUT: "Gemini ne répond pas (délai dépassé)",
  NETWORK: "Gemini est injoignable (réseau)",
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type GeminiClient = {
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
};

export function createGeminiClient(deps: GeminiClientDeps): GeminiClient {
  const { config, transport } = deps;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const wait = deps.sleep ?? sleep;
  const breaker = deps.breaker ?? new CircuitBreaker(config.breakerThreshold, config.breakerCooldownMs, now);

  const record = async (entry: GeminiCallRecord) => {
    console.log(JSON.stringify({ scope: "gemini", ...entry }));
    try {
      await deps.recordCall?.(entry);
    } catch (error) {
      console.error("[gemini] journalisation impossible :", error);
    }
  };

  async function generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const { purpose, system, prompt, schema, jsonSchema, signal, videoId } = request;
    const temperature = request.temperature ?? 0.4;
    const hash = createHash("sha256")
      .update(JSON.stringify([purpose, request.promptVersion, system, prompt, jsonSchema]))
      .digest("hex");

    // Cache : une réponse déjà validée pour exactement la même requête.
    if (deps.cache && !request.bypassCache) {
      const hit = await deps.cache.get(hash).catch(() => null);
      const parsed = hit ? schema.safeParse(hit.data) : null;
      if (hit && parsed?.success) {
        console.log(JSON.stringify({ scope: "gemini", purpose, videoId, model: hit.model, outcome: "CACHE_HIT" }));
        return { data: parsed.data, model: hit.model, attempts: 0, cached: true };
      }
    }

    let attempts = 0;
    let lastTransient: ClassifiedGeminiError | undefined;
    let lastInvalid: ClassifiedGeminiError | undefined;
    const tried: string[] = [];

    for (const model of config.models) {
      if (!breaker.tryAcquire(model)) {
        await record({ videoId, purpose, model, attempt: 0, outcome: "SKIPPED", errorKind: "OVERLOADED", durationMs: 0 });
        lastTransient ??= { kind: "OVERLOADED", detail: "modèle temporairement écarté (coupe-circuit)" };
        continue;
      }
      tried.push(model);
      const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
      let retries = 0;
      let invalidRetried = false;

      while (true) {
        signal?.throwIfAborted();
        attempts++;
        const started = now();
        const timeout = AbortSignal.timeout(config.timeoutMs);
        const callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let response: GeminiTransportResponse | undefined;

        try {
          response = await transport({ model, system, contents, jsonSchema, temperature, signal: callSignal });
          const data = parseOutput(response, schema);
          breaker.recordSuccess(model);
          await record({
            videoId, purpose, model, attempt: attempts, outcome: "SUCCESS", durationMs: now() - started,
            promptTokens: response.promptTokens, outputTokens: response.outputTokens,
          });
          await deps.cache?.set(hash, { purpose, model, data }).catch(() => {});
          return { data, model, attempts, cached: false };
        } catch (error) {
          // Annulation par l'appelant (vidéo supprimée) : on arrête tout, sans la classer.
          if (signal?.aborted) throw signal.reason;
          const classified = classifyGeminiError(error);
          const base = {
            videoId, purpose, model, attempt: attempts, outcome: "ERROR" as const, errorKind: classified.kind,
            httpStatus: classified.httpStatus, durationMs: now() - started,
            promptTokens: response?.promptTokens, outputTokens: response?.outputTokens,
          };

          if (classified.kind === "QUOTA_EXHAUSTED" || classified.kind === "FATAL") {
            breaker.recordOtherFailure(model);
            await record(base);
            throw fatalError(classified, model, error);
          }

          if (classified.kind === "INVALID_OUTPUT") {
            breaker.recordOtherFailure(model);
            await record(base);
            lastInvalid = classified;
            if (invalidRetried) break; // modèle suivant, avec le prompt d'origine
            invalidRetried = true;
            contents.push(
              { role: "model", parts: [{ text: response?.text ?? "" }] },
              {
                role: "user",
                parts: [{ text: `Ta réponse est invalide (${classified.detail.slice(0, 500)}). Renvoie uniquement un objet JSON conforme au schéma demandé.` }],
              },
            );
            continue;
          }

          // Erreurs temporaires : OVERLOADED, RATE_LIMITED, TIMEOUT, NETWORK.
          lastTransient = classified;
          let opened = false;
          if (classified.kind === "OVERLOADED") opened = breaker.recordOverload(model);
          else breaker.recordOtherFailure(model);
          const advised = classified.kind === "RATE_LIMITED" ? classified.retryAfterMs : undefined;
          const giveUp =
            opened || retries >= config.maxRetries || (advised !== undefined && advised > config.backoffMaxMs);
          if (giveUp) {
            await record(base);
            break; // modèle suivant
          }
          const delayMs = advised ?? backoffDelay(retries, config.backoffBaseMs, config.backoffMaxMs, random);
          retries++;
          await record({ ...base, delayMs });
          await wait(delayMs, signal);
        }
      }
    }

    // Toute la chaîne a échoué.
    if (lastTransient) {
      throw new AppError(
        "LLM_ERROR",
        `${TRANSIENT_MESSAGES[lastTransient.kind] ?? "Gemini indisponible"} (modèles essayés : ${tried.join(", ") || "aucun, tous écartés"}).`,
        { retryable: true },
      );
    }
    throw new AppError(
      "LLM_INVALID",
      `Gemini a renvoyé une réponse invalide (${(lastInvalid?.detail ?? "inconnue").slice(0, 300)}).`,
    );
  }

  return { generateStructured };
}

// ---------------------------------------------------------------------------
// Client par défaut (SDK + base de données)
// ---------------------------------------------------------------------------

function sdkTransport(apiKey: string): GeminiTransport {
  // Retry du SDK désactivé (1 tentative) : c'est ce module qui décide des nouvelles tentatives.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  return async ({ model, system, contents, jsonSchema, temperature, signal }) => {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        temperature,
        abortSignal: signal,
      },
    });
    return {
      text: response.text,
      finishReason: response.candidates?.[0]?.finishReason,
      blockReason: response.promptFeedback?.blockReason,
      promptTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  };
}

const prismaCache: GeminiCacheStore = {
  async get(hash) {
    const row = await prisma.llmCache.findUnique({ where: { hash } });
    return row ? { model: row.model, data: row.data } : null;
  },
  async set(hash, { purpose, model, data }) {
    const json = data as object;
    await prisma.llmCache.upsert({
      where: { hash },
      create: { hash, purpose, model, data: json },
      update: { purpose, model, data: json, createdAt: new Date() },
    });
  },
};

let defaultClient: GeminiClient | undefined;

/** Client Gemini du worker : chaîne de modèles, retries, coupe-circuit, cache et journal en base. */
export function getGeminiClient(): GeminiClient {
  if (!defaultClient) {
    const { apiKey, ...config } = geminiConfig();
    defaultClient = createGeminiClient({
      config,
      transport: sdkTransport(apiKey),
      cache: prismaCache,
      recordCall: async (entry) => {
        await prisma.llmCallLog.create({
          data: {
            videoId: entry.videoId,
            purpose: entry.purpose,
            model: entry.model,
            attempt: entry.attempt,
            outcome: entry.outcome,
            errorKind: entry.errorKind,
            httpStatus: entry.httpStatus,
            durationMs: entry.durationMs,
            promptTokens: entry.promptTokens,
            outputTokens: entry.outputTokens,
          },
        });
      },
    });
  }
  return defaultClient;
}

/** Appel structuré à Gemini, via le client par défaut. */
export function generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  return getGeminiClient().generateStructured(request);
}
