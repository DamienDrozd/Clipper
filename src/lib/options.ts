import { z } from "zod";

export const CROP_MODES = ["blur", "center"] as const;
export type CropModeOption = (typeof CROP_MODES)[number];

/** Options choisies à la soumission d'une vidéo (stockées dans Video.options). */
export const videoOptionsSchema = z
  .object({
    clipCount: z.coerce
      .number({ error: "Nombre de clips invalide" })
      .int()
      .min(1, "Au moins 1 clip")
      .max(20, "20 clips maximum")
      .default(5),
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
