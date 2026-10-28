import { prisma } from "@/lib/prisma";
import { isRetryable, userMessage } from "@/lib/errors";
import { enqueueGenerateTexts, MAX_RENDER_ATTEMPTS, type GenerateTextsJob } from "@/lib/jobs/boss";
import { generateStructured } from "@/lib/llm/gemini-client";
import { TEXTS_PROMPT_VERSION, textsSystemInstruction, textsUserPrompt } from "@/lib/llm/prompt";
import { publishTextsBatchJsonSchema, publishTextsBatchSchema } from "@/lib/llm/schema";
import { normalizePublishTexts } from "@/lib/clips/publish";
import { applyCaptionOverrides, captionOverridesSchema } from "@/lib/captions/overrides";
import { clipCues } from "@/lib/captions/captions";
import { segmentsSchema } from "@/lib/transcript/types";
import { getChannelSettings } from "@/lib/settings";
import { VideoDeletedError, videoExists, watchDeletion } from "./cancellation";

/** Marque les clips « textes en cours » et met en file l'appel Gemini n° 2 (worker, file generate-texts). */
export async function requestClipTexts(job: GenerateTextsJob): Promise<void> {
  if (job.clipIds.length === 0) return;
  await prisma.clip.updateMany({
    where: { id: { in: job.clipIds } },
    data: { textsStatus: "PENDING", textsError: null },
  });
  await enqueueGenerateTexts(job);
}

/**
 * Appel Gemini n° 2 : textes de publication (titre, description, tags) d'un ou plusieurs clips,
 * en une seule requête. Gemini reçoit la transcription exacte de chaque clip (bornes finales,
 * corrections comprises), le titre de la vidéo et le contexte de la chaîne. Même couche
 * résiliente (generateStructured) et même post-traitement que partout ailleurs.
 */
export async function generateClipTexts(job: GenerateTextsJob, retryCount = 0): Promise<void> {
  const { videoId, userId } = job;
  const clipIds = job.clipIds ?? (job.clipId ? [job.clipId] : []);

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      title: true,
      transcript: { select: { segments: true } },
      clips: { where: { id: { in: clipIds } }, orderBy: [{ score: "desc" }, { start: "asc" }] },
    },
  });
  if (!video || video.clips.length === 0) return; // vidéo ou clips supprimés entre-temps

  const deletion = watchDeletion(videoId);
  try {
    const transcript = segmentsSchema.parse(video.transcript?.segments ?? []);
    // Identifiants courts dans le prompt (S1, S2…), plus fiables que des cuid pour le modèle.
    const shorts = video.clips.map((clip, i) => {
      const segments = applyCaptionOverrides(
        transcript,
        clip.captionOverrides ? captionOverridesSchema.parse(clip.captionOverrides) : null,
      );
      return {
        id: `S${i + 1}`,
        clipId: clip.id,
        title: clip.title,
        transcript: clipCues(segments, clip.start, clip.end)
          .map((cue) => cue.text)
          .join("\n"),
      };
    });

    const { data, model } = await generateStructured({
      purpose: "texts",
      promptVersion: TEXTS_PROMPT_VERSION,
      system: textsSystemInstruction(),
      prompt: textsUserPrompt({ videoTitle: video.title, channel: await getChannelSettings(userId), clips: shorts }),
      schema: publishTextsBatchSchema,
      jsonSchema: publishTextsBatchJsonSchema,
      temperature: 0.7,
      signal: deletion.signal,
      videoId,
      bypassCache: job.bypassCache,
    });

    const byId = new Map(data.clips.map((texts) => [texts.id.trim().toUpperCase(), texts]));
    let missing = 0;
    for (const short of shorts) {
      const texts = byId.get(short.id);
      if (!texts) missing++;
      await prisma.clip.updateMany({
        where: { id: short.clipId },
        data: texts
          ? { ...normalizePublishTexts(texts), textsStatus: "IDLE", textsError: null }
          : { textsStatus: "FAILED", textsError: "Gemini n'a pas renvoyé de textes pour ce clip : régénère-les." },
      });
    }
    console.log(`[generate-texts] ${videoId} : textes de ${shorts.length - missing}/${shorts.length} clip(s) (${model})`);
  } catch (error) {
    if (error instanceof VideoDeletedError || deletion.signal.aborted || !(await videoExists(videoId))) return;

    const retry = isRetryable(error) && retryCount + 1 < MAX_RENDER_ATTEMPTS;
    console.error(`[generate-texts] ${videoId} : échec${retry ? ", nouvel essai prévu" : ""} :`, error);
    await prisma.clip.updateMany({
      where: { id: { in: clipIds } },
      data: retry
        ? { textsStatus: "PENDING", textsError: `${userMessage(error)} Nouvelle tentative automatique.` }
        : { textsStatus: "FAILED", textsError: userMessage(error) },
    });
    if (retry) throw error; // pg-boss replanifie le job
  } finally {
    deletion.stop();
  }
}
