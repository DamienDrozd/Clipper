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
  // Utilisées à partir des jalons 3 et 4 ; vérifiées au moment de leur usage.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
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

/** Configuration Gemini, obligatoire pour le worker. */
export function geminiConfig(): { apiKey: string; model: string } {
  const { GEMINI_API_KEY, GEMINI_MODEL } = env();
  if (!GEMINI_API_KEY || !GEMINI_MODEL) {
    throw new Error("GEMINI_API_KEY et GEMINI_MODEL doivent être définis (voir .env.example).");
  }
  return { apiKey: GEMINI_API_KEY, model: GEMINI_MODEL };
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  return !!email && env().ALLOWED_EMAILS.includes(email.toLowerCase());
}
