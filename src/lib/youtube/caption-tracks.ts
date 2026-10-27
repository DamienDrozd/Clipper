export type CaptionTrack = {
  id: string;
  language: string;
  kind: "MANUAL" | "ASR";
  name: string;
};

type RawTrack = {
  id?: string | null;
  snippet?: {
    language?: string | null;
    trackKind?: string | null;
    isDraft?: boolean | null;
    status?: string | null;
    name?: string | null;
  } | null;
};

function sameLanguage(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x === y || x.split("-")[0] === y.split("-")[0];
}

/**
 * Pistes utilisables, de la plus à la moins souhaitable :
 * manuelle dans la langue préférée > manuelle autre langue > ASR langue préférée > ASR autre langue.
 * Les brouillons, pistes en échec et pistes « forced » (sous-titres partiels) sont exclues.
 */
export function rankCaptionTracks(items: RawTrack[], preferredLanguage: string): CaptionTrack[] {
  const tracks: CaptionTrack[] = [];
  for (const item of items) {
    const snippet = item.snippet;
    const trackKind = snippet?.trackKind?.toLowerCase();
    if (!item.id || !snippet?.language || snippet.isDraft) continue;
    if (snippet.status?.toLowerCase() === "failed") continue;
    if (trackKind !== "standard" && trackKind !== "asr") continue;
    tracks.push({
      id: item.id,
      language: snippet.language,
      kind: trackKind === "asr" ? "ASR" : "MANUAL",
      name: snippet.name ?? "",
    });
  }

  const rank = (track: CaptionTrack) =>
    (track.kind === "ASR" ? 2 : 0) + (sameLanguage(track.language, preferredLanguage) ? 0 : 1);

  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => rank(a.track) - rank(b.track) || a.index - b.index)
    .map(({ track }) => track);
}
