import type { Segment } from "./types";

/** 754.3 → "12:34" ; avec heures (ou si ≥ 1 h) → "1:02:03". */
export function formatClock(seconds: number, withHours = seconds >= 3600): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return withHours ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m + h * 60).padStart(2, "0")}:${sec}`;
}

/** "12:34" ou "1:02:03" → secondes ; null si le format est invalide. */
export function parseClock(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,3}):(\d{2})(?:\.\d+)?$/);
  if (!match) return null;
  const [, h, m, s] = match;
  if (Number(s) >= 60) return null;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
}

/** Transcription compacte pour le LLM : une ligne `[mm:ss] texte` par segment. */
export function formatTranscript(segments: Segment[], withHours: boolean): string {
  return segments.map((segment) => `[${formatClock(segment.start, withHours)}] ${segment.text}`).join("\n");
}

/**
 * Découpe la transcription en blocs d'au plus `maxChars` caractères (une fois formatée),
 * chaque bloc reprenant les `overlapSeconds` dernières secondes du précédent pour qu'un
 * passage à cheval sur deux blocs soit vu en entier au moins une fois.
 */
export function chunkSegments(segments: Segment[], maxChars: number, overlapSeconds: number): Segment[][] {
  const chunks: Segment[][] = [];
  let from = 0;

  while (from < segments.length) {
    let to = from;
    let chars = 0;
    while (to < segments.length && (to === from || chars + segments[to].text.length + 10 <= maxChars)) {
      chars += segments[to].text.length + 10;
      to++;
    }
    chunks.push(segments.slice(from, to));
    if (to >= segments.length) break;

    const overlapStart = segments[to - 1].end - overlapSeconds;
    let next = from + 1;
    while (next < to && segments[next].start < overlapStart) next++;
    from = next;
  }
  return chunks;
}
