import { ApiError } from "@google/genai";
import { isNetworkError } from "@/lib/errors";

export type GeminiErrorKind =
  | "OVERLOADED"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_OUTPUT"
  | "FATAL";

export type ClassifiedGeminiError = {
  kind: GeminiErrorKind;
  /** Code HTTP renvoyé par l'API, s'il y en a un. */
  httpStatus?: number;
  /** Statut Google (UNAVAILABLE, RESOURCE_EXHAUSTED…). */
  apiStatus?: string;
  /** Délai conseillé par l'API avant de réessayer (RetryInfo). */
  retryAfterMs?: number;
  /** Détail lisible, pour les logs et les messages. */
  detail: string;
};

/** Réponse reçue mais inexploitable (JSON invalide, schéma zod non respecté, réponse vide). */
export class InvalidOutputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "InvalidOutputError";
  }
}

/** Réponse refusée par les filtres de sécurité de Gemini. */
export class BlockedContentError extends Error {
  constructor(reason: string) {
    super(`contenu bloqué par Gemini (${reason})`);
    this.name = "BlockedContentError";
  }
}

type GoogleErrorDetail = {
  "@type"?: string;
  retryDelay?: string;
  reason?: string;
  violations?: { quotaId?: string; quotaMetric?: string; description?: string }[];
};

type GoogleError = { code?: number; message?: string; status?: string; details?: GoogleErrorDetail[] };

/**
 * Corps d'erreur Google. Le SDK le sérialise en JSON dans `ApiError.message`
 * (les en-têtes, dont Retry-After, ne sont pas conservés).
 */
function parseGoogleError(error: ApiError): GoogleError | undefined {
  try {
    const body = JSON.parse(error.message) as { error?: GoogleError };
    return body.error && typeof body.error === "object" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

const detailOfType = (details: GoogleErrorDetail[] | undefined, type: string) =>
  details?.filter((d) => d["@type"]?.endsWith(`google.rpc.${type}`)) ?? [];

/** "34s", "1.5s" (Duration protobuf) → millisecondes. */
function parseDuration(value: string | undefined): number | undefined {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1]) * 1000) : undefined;
}

/** 429 dû à un quota journalier ou à un plafond de dépenses (et non à une limite par minute). */
function isHardQuota(google: GoogleError | undefined): boolean {
  const violations = detailOfType(google?.details, "QuotaFailure").flatMap((d) => d.violations ?? []);
  if (violations.some((v) => /per[_\s-]?day/i.test(`${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`))) return true;
  const reasons = detailOfType(google?.details, "ErrorInfo").map((d) => d.reason ?? "");
  if (reasons.some((r) => /BILLING|SPENDING/i.test(r))) return true;
  return /spending cap/i.test(google?.message ?? "");
}

/** Classe une erreur d'appel Gemini d'après le code HTTP et le corps structuré de l'erreur. */
export function classifyGeminiError(error: unknown): ClassifiedGeminiError {
  if (error instanceof InvalidOutputError) return { kind: "INVALID_OUTPUT", detail: error.message };
  if (error instanceof BlockedContentError) return { kind: "FATAL", detail: error.message };

  if (error instanceof ApiError) {
    const google = parseGoogleError(error);
    const httpStatus = error.status;
    const apiStatus = google?.status;
    const detail = google?.message ?? `HTTP ${httpStatus}`;
    const base = { httpStatus, apiStatus, detail };

    if (httpStatus === 429 || apiStatus === "RESOURCE_EXHAUSTED") {
      if (isHardQuota(google)) return { ...base, kind: "QUOTA_EXHAUSTED" };
      const retryAfterMs = detailOfType(google?.details, "RetryInfo")
        .map((d) => parseDuration(d.retryDelay))
        .find((ms) => ms !== undefined);
      return { ...base, kind: "RATE_LIMITED", retryAfterMs };
    }
    if (httpStatus === 408 || httpStatus === 504 || apiStatus === "DEADLINE_EXCEEDED") return { ...base, kind: "TIMEOUT" };
    if (httpStatus >= 500 || apiStatus === "UNAVAILABLE" || apiStatus === "INTERNAL") return { ...base, kind: "OVERLOADED" };
    return { ...base, kind: "FATAL" };
  }

  const name = (error as { name?: unknown } | null)?.name;
  const message = error instanceof Error ? error.message : String(error);
  // AbortSignal.timeout() rejette fetch avec une TimeoutError (l'annulation par l'appelant
  // est traitée avant, par le client).
  if (name === "TimeoutError" || name === "AbortError") return { kind: "TIMEOUT", detail: message || "délai dépassé" };
  if (isNetworkError(error)) return { kind: "NETWORK", detail: message };
  return { kind: "FATAL", detail: message };
}

