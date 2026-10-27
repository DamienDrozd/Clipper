import { z } from "zod";

const emailList = z
  .string()
  .transform((value) =>
    value
      .split(/[,;\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()).min(1, "au moins un email requis"));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  ALLOWED_EMAILS: emailList,
  // Gemini : obligatoires pour le worker, vérifiées au moment de leur usage (geminiConfig).
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** Chaîne de modèles, séparés par des virgules : le premier est le principal, les suivants de secours. */
  GEMINI_MODELS: z.string().min(1).optional(),
  /** Ancien nom (un seul modèle), accepté si GEMINI_MODELS est absent. */
  GEMINI_MODEL: z.string().min(1).optional(),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  GEMINI_BACKOFF_BASE_MS: z.coerce.number().int().min(0).default(2000),
  GEMINI_BACKOFF_MAX_MS: z.coerce.number().int().min(0).default(30_000),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
  GEMINI_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(3),
  GEMINI_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(0).default(5 * 60_000),
  STORAGE_DIR: z.string().min(1).default("./storage"),
  // Optionnelles : chemins des binaires (par défaut, recherchés dans le PATH).
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  FFPROBE_PATH: z.string().min(1).default("ffprobe"),
  YTDLP_PATH: z.string().min(1).default("yt-dlp"),
  // Optionnelle : fichier cookies.txt (format Netscape) pour yt-dlp (vidéos privées, blocage anti-robot).
  YTDLP_COOKIES: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Variables d'environnement validées. Lecture paresseuse pour ne pas casser `next build`. */
export function env(): Env {
  if (!cached) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      throw new Error(
        `Variables d'environnement invalides :\n${z.prettifyError(result.error)}`,
      );
    }
    cached = result.data;
  }
  return cached;
}

export type GeminiConfig = {
  apiKey: string;
  /** Modèles dans l'ordre d'essai ; le premier est le principal. */
  models: string[];
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  timeoutMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
};

/** Configuration Gemini, obligatoire pour le worker. */
export function geminiConfig(): GeminiConfig {
  const e = env();
  const models = (e.GEMINI_MODELS ?? e.GEMINI_MODEL ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (!e.GEMINI_API_KEY || models.length === 0) {
    throw new Error("GEMINI_API_KEY et GEMINI_MODELS doivent être définis (voir .env.example).");
  }
  return {
    apiKey: e.GEMINI_API_KEY,
    models: [...new Set(models)],
    maxRetries: e.GEMINI_MAX_RETRIES,
    backoffBaseMs: e.GEMINI_BACKOFF_BASE_MS,
    backoffMaxMs: e.GEMINI_BACKOFF_MAX_MS,
    timeoutMs: e.GEMINI_TIMEOUT_MS,
    breakerThreshold: e.GEMINI_BREAKER_THRESHOLD,
    breakerCooldownMs: e.GEMINI_BREAKER_COOLDOWN_MS,
  };
}

/** Modèle Gemini principal (premier de la chaîne), ou null si non configuré. Ne lève pas d'erreur. */
export function primaryGeminiModel(): string | null {
  const e = env();
  return (e.GEMINI_MODELS ?? e.GEMINI_MODEL ?? "").split(",")[0]?.trim() || null;
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  return !!email && env().ALLOWED_EMAILS.includes(email.toLowerCase());
}
