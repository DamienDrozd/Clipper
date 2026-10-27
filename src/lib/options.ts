import { z } from "zod";

export const CROP_MODES = ["blur", "center"] as const;
export type CropModeOption = (typeof CROP_MODES)[number];

export const MAX_CLIPS = 20;

/** Plafond du mode automatique : environ 1 clip par tranche de 3 min, entre 3 et 20. */
export function autoMaxClips(durationSec: number): number {
  return Math.min(MAX_CLIPS, Math.max(3, Math.round(durationSec / 180)));
}

/** Options choisies à la soumission d'une vidéo (stockées dans Video.options). */
export const videoOptionsSchema = z
  .object({
    /** null = automatique : Gemini choisit le nombre de clips (voir autoMaxClips). */
    clipCount: z
      .preprocess(
        (value) => (value === "" || value === undefined ? null : value),
        z.union([
          z.null(),
          z.coerce
            .number({ error: "Nombre de clips invalide" })
            .int("Nombre de clips invalide")
            .min(1, "Au moins 1 clip")
            .max(MAX_CLIPS, `${MAX_CLIPS} clips maximum`),
        ]),
      )
      .default(null),
    minDuration: z.coerce
      .number({ error: "Durée min invalide" })
      .int()
      .min(5, "Durée min : 5 s au minimum")
      .max(170)
      .default(20),
    maxDuration: z.coerce
      .number({ error: "Durée max invalide" })
      .int()
      .min(10)
      .max(180, "Durée max : 180 s au maximum")
      .default(60),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, "Code de langue invalide (ex. fr, en, pt-br)")
      .default("fr"),
    cropMode: z.enum(CROP_MODES, { error: "Mode de recadrage invalide" }).default("blur"),
  })
  .refine((o) => o.maxDuration - o.minDuration >= 5, {
    message: "La durée max doit dépasser la durée min d'au moins 5 s",
    path: ["maxDuration"],
  });

export type VideoOptions = z.infer<typeof videoOptionsSchema>;
