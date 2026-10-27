import { AppError } from "@/lib/errors";
import { postProcessClips, type CandidateClip, type SelectedClip } from "@/lib/clips/postprocess";
import { chunkSegments, formatTranscript } from "@/lib/transcript/format";
import type { Segment } from "@/lib/transcript/types";
import type { VideoOptions } from "@/lib/options";
import { generateClipSelection } from "./gemini";
import { systemInstruction, userPrompt } from "./prompt";

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
}): Promise<SelectedClip[]> {
  const { title, durationSec, segments, options, signal } = params;
  const withHours = durationSec >= 3600;
  const overlapSeconds = Math.max(120, options.maxDuration + 30);
  const chunks = chunkSegments(segments, MAX_CHARS_PER_CALL, overlapSeconds);
  const system = systemInstruction(options);
  const candidates: CandidateClip[] = [];

  // Séquentiel : évite de saturer le quota Gemini sur les longues vidéos.
  for (const [i, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    const response = await generateClipSelection(
      system,
      userPrompt({
        title,
        durationSec,
        candidates: options.clipCount + EXTRA_CANDIDATES,
        transcript: formatTranscript(chunk, withHours),
        part:
          chunks.length > 1
            ? { index: i + 1, total: chunks.length, from: chunk[0].start, to: chunk.at(-1)!.end }
            : undefined,
      }),
      signal,
    );
    candidates.push(...response.clips);
  }

  const clips = postProcessClips(candidates, segments, options);
  if (clips.length === 0) {
    throw new AppError(
      "NO_CLIPS",
      "L'IA n'a proposé aucun passage exploitable avec ces contraintes (essaie d'élargir les durées min/max).",
    );
  }
  return clips;
}
