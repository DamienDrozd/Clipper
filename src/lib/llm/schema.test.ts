import { describe, expect, it } from "vitest";
import { llmResponseSchema, publishTextsBatchSchema } from "./schema";

const clip = {
  start: "01:18",
  end: "02:00",
  title: "Le secret du collage",
  hook: "Le secret d'un bon collage, c'est la pression répartie.",
  score: 92,
  reason: "Conseil concret et démonstration visuelle.",
};

describe("llmResponseSchema (appel 1 : sélection)", () => {
  it("accepte un clip et convertit les horodatages", () => {
    expect(llmResponseSchema.parse({ clips: [clip] }).clips[0]).toMatchObject({ start: 78, end: 120, score: 92 });
  });

  it("ne contient plus les textes de publication (ignorés s'ils sont renvoyés)", () => {
    const parsed = llmResponseSchema.parse({ clips: [{ ...clip, publishTitle: "x", tags: ["a"] }] });
    expect(parsed.clips[0]).not.toHaveProperty("publishTitle");
  });

  it("rejette un horodatage ou un score invalide", () => {
    expect(llmResponseSchema.safeParse({ clips: [{ ...clip, start: "1m18" }] }).success).toBe(false);
    expect(llmResponseSchema.safeParse({ clips: [{ ...clip, score: 140 }] }).success).toBe(false);
  });
});

describe("publishTextsBatchSchema (appel 2 : textes)", () => {
  const texts = { id: "S1", publishTitle: "Titre", publishDescription: "Texte.\n#bois", tags: ["bois", "collage"] };

  it("accepte les textes de plusieurs shorts, identifiés par leur id", () => {
    const parsed = publishTextsBatchSchema.parse({ clips: [texts, { ...texts, id: "S2" }] });
    expect(parsed.clips.map((c) => c.id)).toEqual(["S1", "S2"]);
  });

  it("exige l'id et les trois champs", () => {
    expect(publishTextsBatchSchema.safeParse({ clips: [{ ...texts, id: "" }] }).success).toBe(false);
    expect(publishTextsBatchSchema.safeParse({ clips: [{ ...texts, tags: [] }] }).success).toBe(false);
    expect(publishTextsBatchSchema.safeParse({ clips: [{ ...texts, publishDescription: undefined }] }).success).toBe(false);
  });
});
