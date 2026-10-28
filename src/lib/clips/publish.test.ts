import { describe, expect, it } from "vitest";
import {
  composeDescription,
  composePublishText,
  normalizeDescription,
  normalizePublishTexts,
  normalizeTags,
  parseHashtags,
  truncateTitle,
} from "./publish";

describe("truncateTitle", () => {
  it("laisse un titre court intact (espaces normalisés)", () => {
    expect(truncateTitle("  Le  secret d'un collage  ")).toBe("Le secret d'un collage");
  });

  it("coupe à 100 caractères sans couper un mot", () => {
    const title = "Pourquoi " + "toujours ".repeat(15) + "poncer";
    const result = truncateTitle(title);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(title.startsWith(result)).toBe(true);
    expect(result.endsWith("toujours")).toBe(true);
  });

  it("retire la ponctuation qui pend après la coupe", () => {
    expect(truncateTitle("abc defgh, ijkl", 10)).toBe("abc defgh");
    expect(truncateTitle("abc – defgh", 6)).toBe("abc");
  });

  it("coupe net un mot unique trop long", () => {
    expect(truncateTitle("x".repeat(150))).toHaveLength(100);
  });
});

describe("normalizeTags", () => {
  it("retire les #, met en minuscules et supprime les doublons (casse et accents ignorés)", () => {
    expect(normalizeTags(["#Établi", "etabli", "  Chêne  massif ", "chene massif", "#DIY", "diy", ""])).toEqual([
      "établi",
      "chêne massif",
      "diy",
    ]);
  });

  it("reste sous 500 caractères au total, virgules et guillemets compris", () => {
    const tags = Array.from({ length: 60 }, (_, i) => `tag numero ${i}`); // 13+ car. + 2 guillemets
    const result = normalizeTags(tags);
    const counted = result.reduce((sum, t) => sum + t.length + (t.includes(" ") ? 2 : 0), 0) + result.length - 1;
    expect(counted).toBeLessThanOrEqual(500);
    expect(result.length).toBeGreaterThan(20);
    expect(result).toEqual(tags.slice(0, result.length)); // ordre conservé, coupe en fin de liste
  });

  it("ignore les tags vides ou trop longs", () => {
    expect(normalizeTags(["#", "   ", "a".repeat(101), "ok"])).toEqual(["ok"]);
  });
});

describe("normalizeDescription", () => {
  it("nettoie les espaces et lignes vides multiples", () => {
    expect(normalizeDescription("  Ligne 1  \n\n\n\nLigne   2\r\n#a #b ")).toBe("Ligne 1\n\nLigne 2\n#a #b");
  });

  it("déplace les hashtags collés à la dernière phrase sur leur propre ligne", () => {
    expect(normalizeDescription("Une astuce indispensable. #bois #bricolage #astucebois")).toBe(
      "Une astuce indispensable.\n#bois #bricolage #astucebois",
    );
    // Hashtag au milieu d'une phrase, ou ligne déjà composée de hashtags : inchangé.
    expect(normalizeDescription("Le #diy pour tous, vraiment")).toBe("Le #diy pour tous, vraiment");
    expect(normalizeDescription("Texte.\n#a #b")).toBe("Texte.\n#a #b");
  });

  it("puis les hashtags fixes complètent cette ligne", () => {
    const normalized = normalizeDescription("Une astuce. #bois #astuce");
    expect(composeDescription(normalized, { fixedHashtags: "#menuiserie", appendSourceLink: false }, "")).toBe(
      "Une astuce.\n#bois #astuce #menuiserie",
    );
  });

  it("coupe à 1000 caractères sans couper un mot", () => {
    const result = normalizeDescription("mot ".repeat(400));
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result.endsWith("mot")).toBe(true);
  });
});

describe("parseHashtags", () => {
  it("accepte espaces, virgules, avec ou sans #", () => {
    expect(parseHashtags("#menuiserie, diy  ##atelier")).toEqual(["#menuiserie", "#diy", "#atelier"]);
    expect(parseHashtags("")).toEqual([]);
  });
});

describe("composeDescription", () => {
  const url = "https://www.youtube.com/watch?v=abc";
  const base = "Le secret d'un bon collage.\nRegardez jusqu'au bout !\n#collage #bois";

  it("ajoute les hashtags fixes manquants sur la ligne de hashtags, puis le lien", () => {
    expect(composeDescription(base, { fixedHashtags: "#bois #Atelier", appendSourceLink: true }, url)).toBe(
      "Le secret d'un bon collage.\nRegardez jusqu'au bout !\n#collage #bois #Atelier\n\nVidéo complète : https://www.youtube.com/watch?v=abc",
    );
  });

  it("sans ligne de hashtags : les ajoute sur une nouvelle ligne", () => {
    expect(composeDescription("Texte.", { fixedHashtags: "atelier", appendSourceLink: false }, url)).toBe(
      "Texte.\n\n#atelier",
    );
  });

  it("sans réglages : description inchangée", () => {
    expect(composeDescription(base, { fixedHashtags: "", appendSourceLink: false }, url)).toBe(base);
  });

  it("description vide : seulement les ajouts", () => {
    expect(composeDescription("", { fixedHashtags: "#a", appendSourceLink: true }, url)).toBe(
      "#a\n\nVidéo complète : https://www.youtube.com/watch?v=abc",
    );
  });
});

describe("composePublishText", () => {
  it("assemble titre, description et tags", () => {
    expect(composePublishText({ title: "T", description: "D", tags: ["a", "b"] })).toBe(
      "Titre :\nT\n\nDescription :\nD\n\nTags :\na, b",
    );
  });
});

describe("normalizePublishTexts", () => {
  it("applique les limites YouTube ; champs vides ou absents → null / []", () => {
    const texts = normalizePublishTexts({
      publishTitle: "Titre " + "très long ".repeat(15),
      publishDescription: "  Description.\n\n\n#bois  ",
      tags: ["#Bois", "bois", "Atelier"],
    });
    expect(texts.publishTitle!.length).toBeLessThanOrEqual(100);
    expect(texts.publishDescription).toBe("Description.\n\n#bois");
    expect(texts.tags).toEqual(["bois", "atelier"]);
    expect(normalizePublishTexts({ publishTitle: "  ", publishDescription: null })).toEqual({
      publishTitle: null,
      publishDescription: null,
      tags: [],
    });
  });
});
