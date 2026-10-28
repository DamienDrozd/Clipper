import type { Segment } from "@/lib/transcript/types";
import { normalizeDescription, normalizeTags, truncateTitle } from "./publish";

/** Clip candidat proposé par le LLM, temps déjà convertis en secondes. */
export type CandidateClip = {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  /** Textes de publication (null ou absents si le LLM ne les a pas fournis correctement). */
  publishTitle?: string | null;
  publishDescription?: string | null;
  tags?: string[] | null;
};

export type SelectedClip = Omit<CandidateClip, "publishTitle" | "publishDescription" | "tags"> & {
  publishTitle: string | null;
  publishDescription: string | null;
  tags: string[];
};

/** Limites YouTube appliquées aux textes de publication (sans faire confiance au LLM). */
export function normalizePublishTexts(texts: Pick<CandidateClip, "publishTitle" | "publishDescription" | "tags">) {
  return {
    publishTitle: texts.publishTitle ? truncateTitle(texts.publishTitle) || null : null,
    publishDescription: texts.publishDescription ? normalizeDescription(texts.publishDescription) || null : null,
    tags: normalizeTags(texts.tags ?? []),
  };
}

export type ClipConstraints = {
  clipCount: number;
  minDuration: number;
  maxDuration: number;
};

const SENTENCE_END = /[.!?…]["'»”)\]]*$/;

/** Index du segment dont l'horodatage affiché ([mm:ss], donc arrondi à la seconde) est le plus proche de t. */
function nearestSegment(segments: Segment[], t: number, from = 0): number {
  let best = from;
  let bestDistance = Infinity;
  for (let i = from; i < segments.length; i++) {
    const distance = Math.abs(Math.floor(segments[i].start) - t);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Cale un clip sur les limites de segments et force la durée dans [min, max],
 * en préférant terminer sur une fin de phrase quand la ponctuation le permet.
 * Renvoie null si aucune durée acceptable n'est atteignable (vidéo trop courte).
 */
export function fitClipToSegments(
  clip: { start: number; end: number },
  segments: Segment[],
  { minDuration, maxDuration }: Pick<ClipConstraints, "minDuration" | "maxDuration">,
): { start: number; end: number } | null {
  if (segments.length === 0) return null;

  let s = nearestSegment(segments, Math.min(clip.start, clip.end));
  let e = nearestSegment(segments, Math.max(clip.start, clip.end), s);
  const duration = (i: number, j: number) => segments[j].end - segments[i].start;
  const endsSentence = (j: number) => SENTENCE_END.test(segments[j].text);

  if (duration(s, e) > maxDuration) {
    // Trop long : on raccourcit par la fin.
    let fallback = s;
    let sentence = -1;
    for (let j = s; j <= e && duration(s, j) <= maxDuration; j++) {
      fallback = j;
      if (endsSentence(j) && duration(s, j) >= minDuration) sentence = j;
    }
    e = sentence >= 0 ? sentence : fallback;
  } else if (duration(s, e) < minDuration) {
    // Trop court : on prolonge par la fin…
    let fallback = -1;
    let sentence = -1;
    for (let j = e; j < segments.length && duration(s, j) <= maxDuration; j++) {
      if (duration(s, j) < minDuration) continue;
      if (fallback < 0) fallback = j;
      if (endsSentence(j)) {
        sentence = j;
        break;
      }
    }
    if (sentence >= 0 || fallback >= 0) {
      e = sentence >= 0 ? sentence : fallback;
    } else {
      // … ou par le début si on bute sur la fin de la vidéo.
      e = segments.length - 1;
      while (s > 0 && duration(s, e) < minDuration && duration(s - 1, e) <= maxDuration) s--;
    }
  }

  const start = segments[s].start;
  const end = Math.min(segments[e].end, start + maxDuration);
  if (end - start < Math.min(minDuration, maxDuration) * 0.5) return null;
  return { start: round(start), end: round(end) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Post-traitement des propositions du LLM : calage sur les segments, durées min/max,
 * suppression des chevauchements (le meilleur score gagne), tri par score décroissant.
 */
export function postProcessClips(
  candidates: CandidateClip[],
  segments: Segment[],
  constraints: ClipConstraints,
): SelectedClip[] {
  const fitted: SelectedClip[] = [];
  for (const candidate of candidates) {
    const bounds = fitClipToSegments(candidate, segments, constraints);
    if (!bounds) continue;
    fitted.push({
      ...candidate,
      ...bounds,
      title: candidate.title.trim(),
      hook: candidate.hook.trim(),
      reason: candidate.reason.trim(),
      score: Math.round(Math.min(100, Math.max(0, candidate.score))),
      ...normalizePublishTexts(candidate),
    });
  }

  fitted.sort((a, b) => b.score - a.score || a.start - b.start);

  const selected: SelectedClip[] = [];
  for (const clip of fitted) {
    if (selected.length >= constraints.clipCount) break;
    if (selected.some((other) => clip.start < other.end && other.start < clip.end)) continue;
    selected.push(clip);
  }
  return selected;
}
