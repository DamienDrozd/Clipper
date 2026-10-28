import { z } from "zod";
import { parseClock } from "@/lib/transcript/format";

const clock = z
  .string()
  .trim()
  .refine((value) => parseClock(value) !== null, "horodatage attendu au format mm:ss ou h:mm:ss")
  .transform((value) => parseClock(value)!);

/**
 * Textes de publication : tolérants. Un champ manquant ou invalide devient null sans invalider
 * le clip (il sera affiché « à générer ») ; les limites YouTube sont appliquées ensuite par le code.
 */
const publishFields = {
  publishTitle: z.string().trim().min(1).nullish().catch(null),
  publishDescription: z.string().trim().min(1).nullish().catch(null),
  tags: z.array(z.string()).nullish().catch(null),
};

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
      ...publishFields,
    }),
  ),
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

const publishJsonProperties = {
  publishTitle: {
    type: "string",
    description: "Titre de publication YouTube (100 caractères max), accroche dans les 40 premiers caractères.",
  },
  publishDescription: {
    type: "string",
    description: "Description : 2 à 4 phrases courtes, puis 3 à 5 hashtags sur la dernière ligne (1000 caractères max).",
  },
  tags: {
    type: "array",
    items: { type: "string" },
    minItems: 8,
    maxItems: 15,
    description: "8 à 15 tags sans #, en minuscules, du plus spécifique au plus général.",
  },
} as const;

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
          title: { type: "string", description: "Titre de travail interne du clip (70 caractères max), dans la langue de la vidéo." },
          hook: { type: "string", description: "La phrase d'accroche, telle que prononcée au début du clip." },
          score: { type: "integer", minimum: 0, maximum: 100, description: "Potentiel du clip en short, de 0 à 100." },
          reason: { type: "string", description: "Pourquoi ce passage fonctionne en short (1 à 2 phrases, en français)." },
          ...publishJsonProperties,
        },
        required: ["start", "end", "title", "hook", "score", "reason", "publishTitle", "publishDescription", "tags"],
        propertyOrdering: ["start", "end", "title", "hook", "score", "reason", "publishTitle", "publishDescription", "tags"],
      },
    },
  },
  required: ["clips"],
} as const;

/** Réponse de « Régénérer les textes » : seulement les trois champs, ici obligatoires. */
export const publishTextsSchema = z.object({
  publishTitle: z.string().trim().min(1),
  publishDescription: z.string().trim().min(1),
  tags: z.array(z.string()).min(1),
});

export type PublishTextsResponse = z.infer<typeof publishTextsSchema>;

export const publishTextsJsonSchema = {
  type: "object",
  properties: publishJsonProperties,
  required: ["publishTitle", "publishDescription", "tags"],
  propertyOrdering: ["publishTitle", "publishDescription", "tags"],
} as const;
