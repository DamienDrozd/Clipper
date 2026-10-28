import { describe, expect, it } from "vitest";
import { fitClipToSegments, postProcessClips, type CandidateClip } from "./postprocess";
import type { Segment } from "@/lib/transcript/types";

/** Segments de 5 s ; un segment sur trois termine une phrase. */
const segments: Segment[] = Array.from({ length: 60 }, (_, i) => ({
  start: i * 5,
  end: i * 5 + 5,
  text: i % 3 === 2 ? `phrase ${i}.` : `mot ${i}`,
}));

const limits = { minDuration: 20, maxDuration: 60 };

const candidate = (start: number, end: number, score: number, title = `clip ${start}`): CandidateClip => ({
  start,
  end,
  score,
  title,
  hook: " accroche ",
  reason: "raison",
});

describe("fitClipToSegments", () => {
  it("cale début et fin sur les segments (fin = fin de la dernière ligne)", () => {
    // [00:31] → segment qui commence à 30 ; [01:00] → segment 60–65.
    expect(fitClipToSegments({ start: 31, end: 60 }, segments, limits)).toEqual({ start: 30, end: 65 });
  });

  it("raccourcit un clip trop long en finissant sur une phrase", () => {
    const fitted = fitClipToSegments({ start: 0, end: 200 }, segments, limits)!;
    expect(fitted.start).toBe(0);
    expect(fitted.end - fitted.start).toBeLessThanOrEqual(60);
    expect(fitted.end).toBe(60); // segment 11 (55–60) = "phrase 11."
  });

  it("prolonge un clip trop court jusqu'à une fin de phrase", () => {
    // 0–10 s (2 segments) → au moins 20 s, première fin de phrase ensuite : segment 5 (25–30).
    expect(fitClipToSegments({ start: 0, end: 5 }, segments, limits)).toEqual({ start: 0, end: 30 });
  });

  it("prolonge par le début en fin de vidéo", () => {
    const fitted = fitClipToSegments({ start: 295, end: 295 }, segments, limits)!;
    expect(fitted.end).toBe(300);
    expect(fitted.end - fitted.start).toBeGreaterThanOrEqual(20);
  });

  it("accepte start/end inversés", () => {
    expect(fitClipToSegments({ start: 60, end: 31 }, segments, limits)).toEqual({ start: 30, end: 65 });
  });

  it("tronque si un seul segment dépasse la durée max", () => {
    const long: Segment[] = [{ start: 0, end: 120, text: "monologue sans fin." }];
    expect(fitClipToSegments({ start: 0, end: 0 }, long, limits)).toEqual({ start: 0, end: 60 });
  });

  it("renvoie null si la vidéo est trop courte", () => {
    const short: Segment[] = [{ start: 0, end: 4, text: "Salut." }];
    expect(fitClipToSegments({ start: 0, end: 0 }, short, limits)).toBeNull();
  });
});

describe("postProcessClips", () => {
  it("supprime les chevauchements en gardant le meilleur score, trie par score", () => {
    const result = postProcessClips(
      [candidate(0, 25, 70), candidate(10, 40, 90), candidate(100, 130, 80), candidate(200, 230, 60)],
      segments,
      { ...limits, clipCount: 10 },
    );
    expect(result.map((c) => c.score)).toEqual([90, 80, 60]);
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const [a, b] = [result[i], result[j]];
        expect(a.start < b.end && b.start < a.end).toBe(false);
      }
    }
  });

  it("limite au nombre de clips demandé", () => {
    const result = postProcessClips(
      [candidate(0, 25, 50), candidate(100, 130, 80), candidate(200, 230, 60)],
      segments,
      { ...limits, clipCount: 2 },
    );
    expect(result.map((c) => c.score)).toEqual([80, 60]);
  });

  it("borne et arrondit le score, nettoie les textes", () => {
    const [clip] = postProcessClips([candidate(0, 25, 140.6)], segments, { ...limits, clipCount: 1 });
    expect(clip.score).toBe(100);
    expect(clip.hook).toBe("accroche");
  });
});

describe("postProcessClips — textes de publication", () => {
  it("applique les limites YouTube et garde le clip si les textes manquent", () => {
    const [withTexts, without] = postProcessClips(
      [
        {
          ...candidate(0, 25, 90),
          publishTitle: "Titre " + "très long ".repeat(15),
          publishDescription: "  Description.\n\n\n#bois  ",
          tags: ["#Bois", "bois", "Atelier"],
        },
        { ...candidate(100, 130, 80), publishTitle: null },
      ],
      segments,
      { ...limits, clipCount: 5 },
    );
    expect(withTexts.publishTitle!.length).toBeLessThanOrEqual(100);
    expect(withTexts.publishDescription).toBe("Description.\n\n#bois");
    expect(withTexts.tags).toEqual(["bois", "atelier"]);
    expect(without).toMatchObject({ publishTitle: null, publishDescription: null, tags: [] });
  });
});
