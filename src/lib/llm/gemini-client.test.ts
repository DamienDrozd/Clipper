import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@google/genai";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { backoffDelay, createGeminiClient } = await import("./gemini-client");
const { CircuitBreaker } = await import("./gemini-breaker");
const { AppError, isRetryable } = await import("@/lib/errors");
import type { GeminiCacheStore, GeminiCallRecord, GeminiTransport, GeminiTransportRequest } from "./gemini-client";

const schema = z.object({ ok: z.boolean() });
const jsonSchema = { type: "object" };

const overloaded = () =>
  new ApiError({ status: 503, message: JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "high demand" } }) });
const rateLimited = (retryDelay?: string) =>
  new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : [],
      },
    }),
  });
const dailyQuota = () =>
  new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }],
      },
    }),
  });
const notFound = () => new ApiError({ status: 404, message: JSON.stringify({ error: { code: 404, status: "NOT_FOUND" } }) });
const ok = { text: '{"ok":true}', finishReason: "STOP", promptTokens: 100, outputTokens: 10 };

type Step = Error | { text?: string; finishReason?: string; blockReason?: string };

/** Faux transport : réponses scriptées par modèle (la dernière est répétée). */
function fakeTransport(script: Record<string, Step[]>) {
  const calls: GeminiTransportRequest[] = [];
  const counters: Record<string, number> = {};
  const transport: GeminiTransport = async (request) => {
    calls.push({ ...request, contents: [...request.contents] });
    const steps = script[request.model] ?? [new Error(`modèle inattendu ${request.model}`)];
    const i = counters[request.model] ?? 0;
    counters[request.model] = i + 1;
    const step = steps[Math.min(i, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  return { transport, calls };
}

function setup(script: Record<string, Step[]>, options: { models?: string[]; cache?: GeminiCacheStore; now?: () => number; breaker?: InstanceType<typeof CircuitBreaker> } = {}) {
  const { transport, calls } = fakeTransport(script);
  const delays: number[] = [];
  const records: GeminiCallRecord[] = [];
  const client = createGeminiClient({
    config: {
      models: options.models ?? ["modele-a", "modele-b"],
      maxRetries: 3,
      backoffBaseMs: 2000,
      backoffMaxMs: 30_000,
      timeoutMs: 120_000,
      breakerThreshold: 3,
      breakerCooldownMs: 300_000,
    },
    transport,
    breaker: options.breaker,
    cache: options.cache ?? null,
    recordCall: (r) => void records.push(r),
    sleep: async (ms) => void delays.push(ms),
    random: () => 0.5,
    now: options.now,
  });
  const request = { purpose: "test", promptVersion: "1", system: "sys", prompt: "prompt", schema, jsonSchema };
  return { client, calls, delays, records, request };
}

describe("backoffDelay", () => {
  it("jitter « full » entre 0 et min(max, base × 2^n)", () => {
    expect(backoffDelay(0, 2000, 30_000, () => 0.999)).toBe(1998);
    expect(backoffDelay(2, 2000, 30_000, () => 0.5)).toBe(4000);
    expect(backoffDelay(10, 2000, 30_000, () => 0.5)).toBe(15_000);
    expect(backoffDelay(3, 2000, 30_000, () => 0)).toBe(0);
  });
});

describe("generateStructured", () => {
  it("503, 503 puis succès : même modèle, 3 tentatives, attentes croissantes", async () => {
    const { client, calls, delays, request } = setup({ "modele-a": [overloaded(), overloaded(), ok] });
    const result = await client.generateStructured(request);
    expect(result).toEqual({ data: { ok: true }, model: "modele-a", attempts: 3, cached: false });
    expect(calls.map((c) => c.model)).toEqual(["modele-a", "modele-a", "modele-a"]);
    expect(delays).toEqual([1000, 2000]); // random = 0,5 → moitié de 2 s puis de 4 s
  });

  it("503 en continu : coupe-circuit au 3e échec, bascule sur le modèle suivant avec le même prompt", async () => {
    const { client, calls, request } = setup({ "modele-a": [overloaded()], "modele-b": [ok] });
    const result = await client.generateStructured(request);
    expect(result.model).toBe("modele-b");
    expect(calls.map((c) => c.model)).toEqual(["modele-a", "modele-a", "modele-a", "modele-b"]);
    expect(calls[3].contents).toEqual(calls[0].contents);
    expect(calls[3].system).toBe(calls[0].system);
    expect(calls[3].jsonSchema).toBe(calls[0].jsonSchema);
  });

  it("toute la chaîne surchargée : erreur réessayable (→ WAITING_RETRY)", async () => {
    const { client, request } = setup({ "modele-a": [overloaded()], "modele-b": [overloaded()] });
    const error = await client.generateStructured(request).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(isRetryable(error)).toBe(true);
    expect(error.message).toBe("Gemini est surchargé (modèles essayés : modele-a, modele-b).");
  });

  it("coupe-circuit : modèle écarté directement, puis un seul appel test après le cooldown", async () => {
    let clock = 0;
    const now = () => clock;
    const breaker = new CircuitBreaker(3, 300_000, now);
    const first = setup({ "modele-a": [overloaded()], "modele-b": [ok] }, { breaker, now });
    await first.client.generateStructured(first.request);

    // Pendant le cooldown : modèle A sauté sans appel.
    const second = setup({ "modele-a": [ok], "modele-b": [ok] }, { breaker, now });
    expect((await second.client.generateStructured(second.request)).model).toBe("modele-b");
    expect(second.calls.map((c) => c.model)).toEqual(["modele-b"]);
    expect(second.records[0]).toMatchObject({ model: "modele-a", outcome: "SKIPPED" });

    // Après le cooldown : un appel test, réussi → le modèle redevient principal.
    clock = 300_001;
    const third = setup({ "modele-a": [ok], "modele-b": [ok] }, { breaker, now });
    expect((await third.client.generateStructured(third.request)).model).toBe("modele-a");
    expect(breaker.isOpen("modele-a")).toBe(false);
  });

  it("coupe-circuit : l'appel test en échec rouvre le modèle aussitôt", () => {
    let clock = 0;
    const breaker = new CircuitBreaker(3, 1000, () => clock);
    for (let i = 0; i < 3; i++) breaker.recordOverload("m");
    expect(breaker.tryAcquire("m")).toBe(false);
    clock = 1001;
    expect(breaker.tryAcquire("m")).toBe(true); // appel test
    expect(breaker.tryAcquire("m")).toBe(false); // un seul à la fois
    expect(breaker.recordOverload("m")).toBe(true);
    expect(breaker.tryAcquire("m")).toBe(false);
  });

  it("429 avec délai conseillé : attend ce délai plutôt que le backoff", async () => {
    const { client, delays, request } = setup({ "modele-a": [rateLimited("5s"), ok] });
    expect((await client.generateStructured(request)).model).toBe("modele-a");
    expect(delays).toEqual([5000]);
  });

  it("429 avec délai conseillé trop long : passe directement au modèle suivant", async () => {
    const { client, calls, delays, request } = setup({ "modele-a": [rateLimited("60s")], "modele-b": [ok] });
    expect((await client.generateStructured(request)).model).toBe("modele-b");
    expect(calls.map((c) => c.model)).toEqual(["modele-a", "modele-b"]);
    expect(delays).toEqual([]);
  });

  it("quota journalier : arrêt immédiat de toute la chaîne, sans reprise", async () => {
    const { client, calls, request } = setup({ "modele-a": [dailyQuota()], "modele-b": [ok] });
    const error = await client.generateStructured(request).catch((e) => e);
    expect(calls).toHaveLength(1);
    expect(isRetryable(error)).toBe(false);
    expect(error.message).toMatch(/Quota Gemini atteint/);
  });

  it("erreur fatale (404) : arrêt immédiat, message utile", async () => {
    const { client, calls, request } = setup({ "modele-a": [notFound()], "modele-b": [ok] });
    const error = await client.generateStructured(request).catch((e) => e);
    expect(calls).toHaveLength(1);
    expect(error.message).toMatch(/GEMINI_MODELS/);
  });

  it("contenu bloqué : FATAL", async () => {
    const { client, request } = setup({ "modele-a": [{ blockReason: "SAFETY" }] });
    const error = await client.generateStructured(request).catch((e) => e);
    expect(isRetryable(error)).toBe(false);
    expect(error.message).toMatch(/refusé/);
  });

  it("réponse invalide : une nouvelle tentative avec l'erreur renvoyée au modèle", async () => {
    const { client, calls, delays, request } = setup({ "modele-a": [{ text: "pas du json" }, ok] });
    expect((await client.generateStructured(request)).attempts).toBe(2);
    expect(calls[1].contents).toHaveLength(3);
    expect(JSON.stringify(calls[1].contents[2])).toMatch(/Ta réponse est invalide/);
    expect(delays).toEqual([]);
  });

  it("réponse invalide deux fois : modèle suivant ; partout invalide → échec non réessayable", async () => {
    const invalid = { text: '{"ok":"oui"}' };
    const fallback = setup({ "modele-a": [invalid], "modele-b": [ok] });
    expect((await fallback.client.generateStructured(fallback.request)).model).toBe("modele-b");

    const everywhere = setup({ "modele-a": [invalid], "modele-b": [invalid] });
    const error = await everywhere.client.generateStructured(everywhere.request).catch((e) => e);
    expect(error.code).toBe("LLM_INVALID");
    expect(isRetryable(error)).toBe(false);
  });

  it("cache : réponse réutilisée sans appel ; ignoré si bypassCache", async () => {
    const store = new Map<string, { model: string; data: unknown }>();
    const cache: GeminiCacheStore = {
      get: async (hash) => store.get(hash) ?? null,
      set: async (hash, entry) => void store.set(hash, entry),
    };
    const first = setup({ "modele-a": [ok] }, { cache });
    await first.client.generateStructured(first.request);
    expect(store.size).toBe(1);

    const second = setup({ "modele-a": [ok] }, { cache });
    const hit = await second.client.generateStructured(second.request);
    expect(hit).toMatchObject({ cached: true, attempts: 0, model: "modele-a" });
    expect(second.calls).toHaveLength(0);

    const third = setup({ "modele-a": [ok] }, { cache });
    expect((await third.client.generateStructured({ ...third.request, bypassCache: true })).cached).toBe(false);
    expect(third.calls).toHaveLength(1);

    const other = setup({ "modele-a": [ok] }, { cache });
    await other.client.generateStructured({ ...other.request, promptVersion: "2" });
    expect(other.calls).toHaveLength(1); // nouvelle version du prompt → pas de cache
  });

  it("annulation par l'appelant (vidéo supprimée) : propage la raison, sans classement ni retry", async () => {
    const controller = new AbortController();
    const reason = new Error("vidéo supprimée");
    const { client, calls, request } = setup({ "modele-a": [overloaded()] });
    const transportError = client.generateStructured({ ...request, signal: controller.signal });
    controller.abort(reason);
    await expect(transportError).rejects.toBe(reason);
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("journalise chaque tentative (modèle, type d'erreur, code HTTP, délai, tokens)", async () => {
    const { client, records, request } = setup({ "modele-a": [overloaded(), ok] });
    await client.generateStructured(request);
    expect(records[0]).toMatchObject({ model: "modele-a", attempt: 1, outcome: "ERROR", errorKind: "OVERLOADED", httpStatus: 503, delayMs: 1000 });
    expect(records[1]).toMatchObject({ model: "modele-a", attempt: 2, outcome: "SUCCESS", promptTokens: 100, outputTokens: 10 });
  });
});
