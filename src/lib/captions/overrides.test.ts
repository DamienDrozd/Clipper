import { describe, expect, it } from "vitest";
import { applyCaptionOverrides, mergeCaptionOverrides, segmentKey } from "./overrides";

const segments = [
  { start: 0, end: 2, text: "on va poncé le plateau" },
  { start: 2, end: 4, text: "avec du grain 120" },
  { start: 4, end: 6, text: "euh voilà" },
];

describe("applyCaptionOverrides", () => {
  it("remplace le texte des segments corrigés, garde les autres", () => {
    expect(
      applyCaptionOverrides(segments, [
        { start: 0, end: 2, text: "On va poncer le plateau" },
        { start: 4, end: 6, text: "" },
      ]),
    ).toEqual([
      { start: 0, end: 2, text: "On va poncer le plateau" },
      { start: 2, end: 4, text: "avec du grain 120" },
      { start: 4, end: 6, text: "" },
    ]);
  });

  it("ignore les corrections qui ne correspondent à aucun segment", () => {
    expect(applyCaptionOverrides(segments, [{ start: 10, end: 12, text: "x" }])).toEqual(segments);
  });

  it("sans correction : transcription inchangée", () => {
    expect(applyCaptionOverrides(segments, null)).toBe(segments);
  });
});

describe("mergeCaptionOverrides", () => {
  it("ajoute les textes modifiés et ignore les textes identiques", () => {
    expect(
      mergeCaptionOverrides(segments, null, {
        [segmentKey(segments[0])]: "On va poncer le plateau",
        [segmentKey(segments[1])]: "avec du grain 120",
      }),
    ).toEqual([{ start: 0, end: 2, text: "On va poncer le plateau" }]);
  });

  it("retire une correction quand on revient au texte d'origine, garde les autres", () => {
    const existing = [
      { start: 0, end: 2, text: "On va poncer le plateau" },
      { start: 4, end: 6, text: "" },
    ];
    expect(mergeCaptionOverrides(segments, existing, { [segmentKey(segments[0])]: "on va poncé le plateau" })).toEqual([
      { start: 4, end: 6, text: "" },
    ]);
  });

  it("renvoie null quand il ne reste aucune correction", () => {
    expect(mergeCaptionOverrides(segments, [{ start: 0, end: 2, text: "x" }], { "0|2": "on va poncé le plateau" })).toBeNull();
  });
});
