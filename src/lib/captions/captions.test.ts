import { describe, expect, it } from "vitest";
import { buildAss, buildSrt, clipCues, wordChunks } from "./captions";

describe("clipCues", () => {
  const segments = [
    { start: 8, end: 11, text: "avant le clip" },
    { start: 11, end: 14, text: "début du clip" },
    { start: 14, end: 18, text: "milieu" },
    { start: 18, end: 22, text: "fin coupée" },
    { start: 22, end: 25, text: "après" },
  ];

  it("garde les segments qui chevauchent le clip, en temps relatifs bornés", () => {
    expect(clipCues(segments, 10, 20)).toEqual([
      { start: 0, end: 1, text: "avant le clip" },
      { start: 1, end: 4, text: "début du clip" },
      { start: 4, end: 8, text: "milieu" },
      { start: 8, end: 10, text: "fin coupée" },
    ]);
  });

  it("ignore les textes vides", () => {
    expect(clipCues([{ start: 0, end: 2, text: "  " }], 0, 5)).toEqual([]);
  });
});

describe("wordChunks", () => {
  it("découpe en blocs de 2 à 4 mots, répartis équitablement", () => {
    const sizes = (n: number) =>
      wordChunks([{ start: 0, end: n, text: Array.from({ length: n }, (_, i) => `m${i}`).join(" ") }]).map(
        (c) => c.text.split(" ").length,
      );
    expect(sizes(1)).toEqual([1]);
    expect(sizes(2)).toEqual([2]);
    expect(sizes(4)).toEqual([2, 2]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(7)).toEqual([3, 2, 2]);
    expect(sizes(9)).toEqual([3, 3, 3]);
    for (let n = 2; n <= 40; n++) {
      for (const size of sizes(n)) {
        expect(size).toBeGreaterThanOrEqual(2);
        expect(size).toBeLessThanOrEqual(4);
      }
    }
  });

  it("répartit le temps au prorata des caractères, sans trou ni chevauchement", () => {
    // "aaaa bbbb" (9 car.) puis "cc dd" (5 car.) → 9/14 et 5/14 de 14 s.
    const chunks = wordChunks([{ start: 2, end: 16, text: "aaaa bbbb cc dd" }]);
    expect(chunks).toEqual([
      { start: 2, end: 11, text: "aaaa bbbb" },
      { start: 11, end: 16, text: "cc dd" },
    ]);
  });
});

describe("buildAss", () => {
  it("produit un script 1080x1920 avec un Dialogue par bloc", () => {
    const ass = buildAss([
      { start: 0, end: 1.234, text: "Salut {à} tous" },
      { start: 61.5, end: 3725.05, text: "c'est\\Nparti" },
      { start: 5, end: 5, text: "durée nulle" },
    ]);
    expect(ass).toContain("PlayResX: 1080\nPlayResY: 1920");
    expect(ass).toContain("Style: Default,Poppins,96,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.23,Default,,0,0,0,,Salut à tous");
    expect(ass).toContain("Dialogue: 0,0:01:01.50,1:02:05.05,Default,,0,0,0,,c'est/Nparti");
    expect(ass).not.toContain("durée nulle");
  });
});

describe("buildSrt", () => {
  it("numérote les entrées au format SRT", () => {
    expect(
      buildSrt([
        { start: 0, end: 2.5, text: "Bonjour." },
        { start: 2.5, end: 3661.001, text: "Au revoir." },
      ]),
    ).toBe("1\n00:00:00,000 --> 00:00:02,500\nBonjour.\n\n2\n00:00:02,500 --> 01:01:01,001\nAu revoir.\n");
  });
});
