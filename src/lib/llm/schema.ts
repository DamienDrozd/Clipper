import { z } from "zod";
import { parseClock } from "@/lib/transcript/format";

const clock = z
  .string()
  .trim()
  .refine((value) => parseClock(value) !== null, "horodatage attendu au format mm:ss ou h:mm:ss")
  .transform((value) => parseClock(value)!);

/** Validation stricte de la réponse du LLM (le JSON Schema côté Gemini n'est qu'indicatif). */
export const llmResponseSchema = z.object({
  clips: z.array(
    z.object({
      start: clock,
      end: clock,
      title: z.string().trim().min(1).max(150),
      hook: z.string().trim().min(1).max(500),
      score: z.number().min(0).max(100),
      reason: z.string().trim().min(1).max(1000),
    }),
  ),
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

/**
 * JSON Schema envoyé à Gemini (responseJsonSchema). Écrit à la main : Gemini n'accepte qu'un
 * sous-ensemble de JSON Schema (pas de pattern ni de minLength, par exemple).
 */
export const llmResponseJsonSchema = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "Horodatage de la première ligne du clip, tel qu'écrit dans la transcription (mm:ss ou h:mm:ss)." },
          end: { type: "string", description: "Horodatage de la dernière ligne incluse dans le clip, tel qu'écrit dans la transcription." },
          title: { type: "string", description: "Titre court et accrocheur pour le short (70 caractères max), dans la langue de la vidéo." },
          hook: { type: "string", description: "La phrase d'accroche, telle que prononcée au début du clip." },
          score: { type: "integer", minimum: 0, maximum: 100, description: "Potentiel du clip en short, de 0 à 100." },
          reason: { type: "string", description: "Pourquoi ce passage fonctionne en short (1 à 2 phrases, en français)." },
        },
        required: ["start", "end", "title", "hook", "score", "reason"],
        propertyOrdering: ["start", "end", "title", "hook", "score", "reason"],
      },
    },
  },
  required: ["clips"],
} as const;
