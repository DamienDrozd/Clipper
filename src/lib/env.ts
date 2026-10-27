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

export function isEmailAllowed(email: string | null | undefined): boolean {
  return !!email && env().ALLOWED_EMAILS.includes(email.toLowerCase());
}
