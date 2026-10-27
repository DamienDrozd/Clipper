import { z } from "zod";
import type { Segment } from "@/lib/transcript/types";

/**
 * Corrections manuelles des sous-titres d'un clip (Clip.captionOverrides) : texte de remplacement
 * pour des segments de la transcription, identifiés par leurs temps (absolus). Un texte vide
 * masque le segment. Stockées comme retouches et non comme copie, elles restent valides si
 * le début ou la fin du clip change ensuite.
 */
export const captionOverridesSchema = z.array(
  z.object({ start: z.number(), end: z.number(), text: z.string().max(500) }),
);

export type CaptionOverride = z.infer<typeof captionOverridesSchema>[number];

const key = (s: { start: number; end: number }) => `${s.start}|${s.end}`;

/** Transcription avec les corrections appliquées. */
export function applyCaptionOverrides(segments: Segment[], overrides: CaptionOverride[] | null): Segment[] {
  if (!overrides?.length) return segments;
  const byKey = new Map(overrides.map((o) => [key(o), o.text]));
  return segments.map((segment) => {
    const text = byKey.get(key(segment));
    return text === undefined ? segment : { ...segment, text: text.replace(/\s+/g, " ").trim() };
  });
}

/**
 * Fusionne les corrections existantes avec les textes saisis (clé segment → texte) :
 * une saisie identique au texte d'origine retire la correction. Renvoie null s'il n'en reste aucune.
 */
export function mergeCaptionOverrides(
  segments: Segment[],
  existing: CaptionOverride[] | null,
  edited: Record<string, string>,
): CaptionOverride[] | null {
  const byKey = new Map((existing ?? []).map((o) => [key(o), o]));
  for (const segment of segments) {
    const k = key(segment);
    if (!(k in edited)) continue;
    const text = edited[k].replace(/\s+/g, " ").trim();
    if (text === segment.text) byKey.delete(k);
    else byKey.set(k, { start: segment.start, end: segment.end, text });
  }
  const result = [...byKey.values()].sort((a, b) => a.start - b.start);
  return result.length > 0 ? result : null;
}

/** Clé d'un segment, pour indexer les textes saisis côté client. */
export const segmentKey = key;
