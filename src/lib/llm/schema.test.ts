import { describe, expect, it } from "vitest";
import { llmResponseSchema, publishTextsSchema } from "./schema";

const clip = {
  start: "01:18",
  end: "02:00",
  title: "Le secret du collage",
  hook: "Le secret d'un bon collage, c'est la pression répartie.",
  score: 92,
  reason: "Conseil concret et démonstration visuelle.",
};

describe("llmResponseSchema", () => {
  it("accepte un clip complet avec ses textes de publication", () => {
    const parsed = llmResponseSchema.parse({
      clips: [{ ...clip, publishTitle: "Serre-joints : l'erreur des débutants", publishDescription: "Texte.\n#bois", tags: ["serre-joint", "collage"] }],
    });
    expect(parsed.clips[0]).toMatchObject({
      start: 78,
      end: 120,
      publishTitle: "Serre-joints : l'erreur des débutants",
      tags: ["serre-joint", "collage"],
    });
  });

  it("textes de publication manquants ou invalides : le clip reste valide (champs à null)", () => {
    const parsed = llmResponseSchema.parse({
      clips: [
        { ...clip },
        { ...clip, publishTitle: 42, publishDescription: "", tags: "pas une liste" },
      ],
    });
    expect(parsed.clips).toHaveLength(2);
    for (const c of parsed.clips) {
      expect(c.publishTitle ?? null).toBeNull();
      expect(c.publishDescription ?? null).toBeNull();
      expect(c.tags ?? null).toBeNull();
    }
  });

  it("les champs de sélection restent obligatoires", () => {
    expect(llmResponseSchema.safeParse({ clips: [{ ...clip, start: "1m18" }] }).success).toBe(false);
    expect(llmResponseSchema.safeParse({ clips: [{ ...clip, score: 140 }] }).success).toBe(false);
  });
});

describe("publishTextsSchema", () => {
  it("exige les trois champs pour une régénération", () => {
    expect(publishTextsSchema.safeParse({ publishTitle: "T", publishDescription: "D", tags: ["a"] }).success).toBe(true);
    expect(publishTextsSchema.safeParse({ publishTitle: "T", publishDescription: "D" }).success).toBe(false);
  });
});
