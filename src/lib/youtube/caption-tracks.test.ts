import { describe, expect, it } from "vitest";
import { rankCaptionTracks } from "./caption-tracks";

const track = (id: string, language: string, trackKind: string, extra: object = {}) => ({
  id,
  snippet: { language, trackKind, isDraft: false, status: "serving", name: "", ...extra },
});

describe("rankCaptionTracks", () => {
  it("ordonne manuelle préférée > manuelle autre > ASR préférée > ASR autre", () => {
    const ranked = rankCaptionTracks(
      [
        track("asr-en", "en", "asr"),
        track("asr-fr", "fr", "asr"),
        track("man-en", "en", "standard"),
        track("man-fr", "fr-FR", "standard"),
      ],
      "fr",
    );
    expect(ranked.map((t) => t.id)).toEqual(["man-fr", "man-en", "asr-fr", "asr-en"]);
    expect(ranked[0]).toMatchObject({ kind: "MANUAL", language: "fr-FR" });
    expect(ranked[2]).toMatchObject({ kind: "ASR" });
  });

  it("exclut brouillons, pistes en échec et pistes forced", () => {
    const ranked = rankCaptionTracks(
      [
        track("draft", "fr", "standard", { isDraft: true }),
        track("failed", "fr", "standard", { status: "failed" }),
        track("forced", "fr", "forced"),
        track("ok", "fr", "ASR"),
      ],
      "fr",
    );
    expect(ranked.map((t) => t.id)).toEqual(["ok"]);
  });

  it("renvoie une liste vide sans piste exploitable", () => {
    expect(rankCaptionTracks([], "fr")).toEqual([]);
    expect(rankCaptionTracks([{ id: "x", snippet: null }], "fr")).toEqual([]);
  });
});
