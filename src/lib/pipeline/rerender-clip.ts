import { prisma } from "@/lib/prisma";
import { isRetryable, userMessage } from "@/lib/errors";
import { MAX_ATTEMPTS, retryDelayUpperBound, type RenderClipJob } from "@/lib/jobs/boss";
import { ensureSource } from "@/lib/media/ytdlp";
import { toStoragePath } from "@/lib/storage";
import { VideoDeletedError, videoExists, watchDeletion } from "./cancellation";
import { renderClip } from "./render-clip";

/**
 * Nouveau rendu d'un clip (job render-clip). La vidéo source est en cache, sinon retéléchargée.
 * Même logique d'erreurs que le pipeline : retry pg-boss si passagère, sinon clip en FAILED.
 */
export async function rerenderClip({ clipId, videoId }: RenderClipJob, retryCount = 0): Promise<void> {
  const clip = await prisma.clip.findUnique({
    where: { id: clipId },
    select: { video: { select: { youtubeId: true } } },
  });
  if (!clip) return; // clip ou vidéo supprimés entre-temps

  const deletion = watchDeletion(videoId);
  try {
    const source = await ensureSource(clip.video.youtubeId, { signal: deletion.signal });
    await prisma.video.updateMany({ where: { id: videoId }, data: { sourcePath: toStoragePath(source) } });
    await renderClip(clipId, source, deletion.signal);
  } catch (error) {
    if (error instanceof VideoDeletedError || deletion.signal.aborted || !(await videoExists(videoId))) return;

    const attempt = retryCount + 1;
    const message = userMessage(error);
    const retry = isRetryable(error) && attempt < MAX_ATTEMPTS;
    console.error(`[render-clip] ${clipId} : tentative ${attempt} en échec${retry ? ", nouvel essai prévu" : ""} :`, error);
    await prisma.clip.updateMany({
      where: { id: clipId },
      data: retry
        ? {
            renderStatus: "QUEUED",
            renderError: `${message} Nouvelle tentative automatique d'ici ${Math.ceil(retryDelayUpperBound(retryCount) / 60)} min.`,
          }
        : { renderStatus: "FAILED", renderError: message },
    });
    if (retry) throw error; // pg-boss replanifie le job
  } finally {
    deletion.stop();
  }
}
