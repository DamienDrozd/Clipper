import { prisma } from "@/lib/prisma";
import { isRetryable, userMessage } from "@/lib/errors";
import { MAX_RENDER_ATTEMPTS, type GenerateTextsJob } from "@/lib/jobs/boss";
import { generateStructured } from "@/lib/llm/gemini-client";
import { TEXTS_PROMPT_VERSION, textsSystemInstruction, textsUserPrompt } from "@/lib/llm/prompt";
import { publishTextsJsonSchema, publishTextsSchema } from "@/lib/llm/schema";
import { normalizePublishTexts } from "@/lib/clips/postprocess";
import { applyCaptionOverrides, captionOverridesSchema } from "@/lib/captions/overrides";
import { clipCues } from "@/lib/captions/captions";
import { segmentsSchema } from "@/lib/transcript/types";
import { getChannelSettings } from "@/lib/settings";
import { VideoDeletedError, videoExists, watchDeletion } from "./cancellation";

/**
 * « Régénérer les textes » (job generate-texts) : appel Gemini léger qui ne reçoit que la
 * transcription du clip (corrections comprises), le titre de la vidéo et le contexte de la chaîne,
 * via la même couche résiliente et le même post-traitement que la sélection.
 */
export async function generateClipTexts({ clipId, videoId, userId }: GenerateTextsJob, retryCount = 0): Promise<void> {
  const clip = await prisma.clip.findUnique({
    where: { id: clipId },
    include: { video: { select: { title: true, transcript: { select: { segments: true } } } } },
  });
  if (!clip) return; // clip ou vidéo supprimés entre-temps

  const deletion = watchDeletion(videoId);
  try {
    const segments = applyCaptionOverrides(
      segmentsSchema.parse(clip.video.transcript?.segments ?? []),
      clip.captionOverrides ? captionOverridesSchema.parse(clip.captionOverrides) : null,
    );
    const transcript = clipCues(segments, clip.start, clip.end)
      .map((cue) => cue.text)
      .join("\n");

    const { data, model } = await generateStructured({
      purpose: "texts",
      promptVersion: TEXTS_PROMPT_VERSION,
      system: textsSystemInstruction(),
      prompt: textsUserPrompt({
        videoTitle: clip.video.title,
        clipTitle: clip.title,
        transcript,
        channel: await getChannelSettings(userId),
      }),
      schema: publishTextsSchema,
      jsonSchema: publishTextsJsonSchema,
      temperature: 0.7,
      signal: deletion.signal,
      videoId,
      // Une régénération doit proposer d'autres textes, pas resservir les précédents.
      bypassCache: true,
    });

    await prisma.clip.updateMany({
      where: { id: clipId },
      data: { ...normalizePublishTexts(data), textsStatus: "IDLE", textsError: null },
    });
    console.log(`[generate-texts] ${clipId} : textes régénérés (${model})`);
  } catch (error) {
    if (error instanceof VideoDeletedError || deletion.signal.aborted || !(await videoExists(videoId))) return;

    const retry = isRetryable(error) && retryCount + 1 < MAX_RENDER_ATTEMPTS;
    console.error(`[generate-texts] ${clipId} : échec${retry ? ", nouvel essai prévu" : ""} :`, error);
    await prisma.clip.updateMany({
      where: { id: clipId },
      data: retry
        ? { textsStatus: "PENDING", textsError: `${userMessage(error)} Nouvelle tentative automatique.` }
        : { textsStatus: "FAILED", textsError: userMessage(error) },
    });
    if (retry) throw error; // pg-boss replanifie le job
  } finally {
    deletion.stop();
  }
}
