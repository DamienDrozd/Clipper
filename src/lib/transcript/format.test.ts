import { describe, expect, it } from "vitest";
import { chunkSegments, formatClock, formatTranscript, parseClock } from "./format";
import type { Segment } from "./types";

describe("formatClock / parseClock", () => {
  it("formate en mm:ss ou h:mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(754.9)).toBe("12:34");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(65, true)).toBe("0:01:05");
  });

  it("parse les deux formats", () => {
    expect(parseClock("12:34")).toBe(754);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("0:01:05")).toBe(65);
    expect(parseClock("75:00")).toBe(4500);
    expect(parseClock(" 00:07 ")).toBe(7);
  });

  it("rejette les valeurs invalides", () => {
    expect(parseClock("12")).toBeNull();
    expect(parseClock("12:61")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
});

describe("formatTranscript", () => {
  it("produit une ligne [mm:ss] texte par segment", () => {
    const segments = [
      { start: 0.2, end: 2, text: "Salut" },
      { start: 62.5, end: 64, text: "On commence." },
    ];
    expect(formatTranscript(segments, false)).toBe("[00:00] Salut\n[01:02] On commence.");
    expect(formatTranscript(segments, true)).toBe("[0:00:00] Salut\n[0:01:02] On commence.");
  });
});

describe("chunkSegments", () => {
  // 100 segments de 10 s, 40 caractères de texte chacun (50 avec le préfixe compté).
  const segments: Segment[] = Array.from({ length: 100 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 10,
    text: "x".repeat(40),
  }));

  it("renvoie un seul bloc si tout tient", () => {
    expect(chunkSegments(segments, 1_000_000, 60)).toEqual([segments]);
  });

  it("découpe avec recouvrement et couvre toute la transcription", () => {
    const chunks = chunkSegments(segments, 1000, 60); // 20 segments par bloc
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(20);
    // Recouvrement : chaque bloc commence 60 s avant la fin du précédent.
    for (let i = 1; i < chunks.length; i++) {
      const previousEnd = chunks[i - 1].at(-1)!.end;
      expect(chunks[i][0].start).toBe(previousEnd - 60);
    }
    expect(chunks[0][0]).toBe(segments[0]);
    expect(chunks.at(-1)!.at(-1)).toBe(segments.at(-1));
  });

  it("progresse même si le recouvrement dépasse la taille d'un bloc", () => {
    const chunks = chunkSegments(segments, 120, 600);
    expect(chunks.at(-1)!.at(-1)).toBe(segments.at(-1));
    expect(chunks.length).toBeLessThanOrEqual(segments.length);
  });
});
