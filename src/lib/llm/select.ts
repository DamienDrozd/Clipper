import { AppError } from "@/lib/errors";
import { postProcessClips, type CandidateClip, type SelectedClip } from "@/lib/clips/postprocess";
import { chunkSegments, formatTranscript } from "@/lib/transcript/format";
import type { Segment } from "@/lib/transcript/types";
import { autoMaxClips, type VideoOptions } from "@/lib/options";
import { generateStructured } from "./gemini-client";
import {
  SELECTION_PROMPT_VERSION,
  systemInstruction,
  userPrompt,
  type ChannelContext,
  type ClipCountRequest,
} from "./prompt";
import { llmResponseJsonSchema, llmResponseSchema } from "./schema";

/** Au-delà (≈ 1 h de parole), la transcription est envoyée en plusieurs blocs. */
const MAX_CHARS_PER_CALL = 60_000;
/** Candidats demandés en plus du nombre visé : le post-traitement en élimine une partie. */
const EXTRA_CANDIDATES = 3;

/** Sélection des meilleurs moments par Gemini, puis post-traitement côté code. */
export async function selectClips(params: {
  title: string;
  durationSec: number;
  segments: Segment[];
  options: VideoOptions;
  signal?: AbortSignal;
  videoId?: string;
  /** Ignorer le cache des réponses Gemini (« Régénérer la sélection »). */
  bypassCache?: boolean;
  /** Contexte de la chaîne (page Réglages), pour les textes de publication. */
  channel?: ChannelContext | null;
}): Promise<{ clips: SelectedClip[]; model: string }> {
  const { title, durationSec, segments, options, signal } = params;
  const withHours = durationSec >= 3600;
  const overlapSeconds = Math.max(120, options.maxDuration + 30);
  const chunks = chunkSegments(segments, MAX_CHARS_PER_CALL, overlapSeconds);
  const system = systemInstruction(options);
  const candidates: CandidateClip[] = [];
  const models = new Set<string>();

  // Nombre imposé, ou choisi par Gemini sous un plafond proportionnel à la durée.
  const maxClips = options.clipCount ?? autoMaxClips(durationSec);
  const count: ClipCountRequest =
    options.clipCount === null
      ? { mode: "auto", max: maxClips }
      : { mode: "fixed", candidates: options.clipCount + EXTRA_CANDIDATES };

  // Séquentiel : évite de saturer le quota Gemini sur les longues vidéos.
  for (const [i, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    const { data, model } = await generateStructured({
      purpose: "selection",
      promptVersion: SELECTION_PROMPT_VERSION,
      system,
      prompt: userPrompt({
        title,
        durationSec,
        count,
        channel: params.channel,
        transcript: formatTranscript(chunk, withHours),
        part:
          chunks.length > 1
            ? { index: i + 1, total: chunks.length, from: chunk[0].start, to: chunk.at(-1)!.end }
            : undefined,
      }),
      schema: llmResponseSchema,
      jsonSchema: llmResponseJsonSchema,
      signal,
      videoId: params.videoId,
      bypassCache: params.bypassCache,
    });
    candidates.push(...data.clips);
    models.add(model);
  }

  const clips = postProcessClips(candidates, segments, { ...options, clipCount: maxClips });
  if (clips.length === 0) {
    throw new AppError(
      "NO_CLIPS",
      "L'IA n'a proposé aucun passage exploitable avec ces contraintes (essaie d'élargir les durées min/max).",
    );
  }
  return { clips, model: [...models].join(", ") };
}
