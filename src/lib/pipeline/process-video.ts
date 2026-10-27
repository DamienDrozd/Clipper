import { prisma } from "@/lib/prisma";
import { AppError, userMessage } from "@/lib/errors";
import { ensureSource } from "@/lib/media/ytdlp";
import { toStoragePath } from "@/lib/storage";
import { renderClip } from "./render-clip";
import { MAX_PROCESS_ATTEMPTS, type ProcessVideoJob } from "@/lib/jobs/boss";
import { videoOptionsSchema } from "@/lib/options";
import { getYouTubeClient } from "@/lib/youtube/client";
import { fetchTranscript } from "@/lib/youtube/captions";
import { segmentsSchema } from "@/lib/transcript/types";
import { selectClips } from "@/lib/llm/select";
import { replaceClips } from "@/lib/clips/store";
import type { VideoStatus } from "@/generated/prisma/client";
import { VideoDeletedError, videoExists, watchDeletion } from "./cancellation";
import { decideFailure } from "./failure";

/** Change le statut ; lève VideoDeletedError si la vidéo a été supprimée entre-temps. */
async function setStatus(videoId: string, status: VideoStatus) {
  const { count } = await prisma.video.updateMany({
    where: { id: videoId },
    data: { status, error: null, progress: 0 },
  });
  if (count === 0) throw new VideoDeletedError();
}

/** Progression de la vidéo, au plus une écriture par seconde. */
function videoProgressWriter(videoId: string) {
  let last = 0;
  return (percent: number, force = false) => {
    if (!force && Date.now() - last < 1000) return;
    last = Date.now();
    prisma.video.updateMany({ where: { id: videoId }, data: { progress: percent } }).catch(() => {});
  };
}

/** MP4 source en cache, ou téléchargé (statut DOWNLOADING) s'il manque. */
async function ensureVideoSource(video: { id: string; youtubeId: string }, signal: AbortSignal): Promise<string> {
  const progress = videoProgressWriter(video.id);
  const source = await ensureSource(video.youtubeId, {
    signal,
    onStart: async () => {
      await setStatus(video.id, "DOWNLOADING");
      console.log(`[process-video] ${video.youtubeId} : téléchargement de la vidéo source`);
    },
    onProgress: (percent) => progress(percent),
  });
  await prisma.video.updateMany({ where: { id: video.id }, data: { sourcePath: toStoragePath(source) } });
  return source;
}

/**
 * Rend les clips un par un (ffmpeg utilise déjà tous les cœurs). Un clip en échec est marqué
 * FAILED sans bloquer les autres ; si aucun clip n'a pu être rendu, l'étape échoue.
 */
async function renderClips(videoId: string, clipIds: string[], source: string, signal: AbortSignal) {
  await setStatus(videoId, "RENDERING");
  await prisma.clip.updateMany({ where: { id: { in: clipIds } }, data: { renderStatus: "QUEUED", renderProgress: 0 } });
  const progress = videoProgressWriter(videoId);
  const failures: string[] = [];

  for (const [i, clipId] of clipIds.entries()) {
    signal.throwIfAborted();
    progress(Math.round((i / clipIds.length) * 100), true);
    try {
      await renderClip(clipId, source, signal);
    } catch (error) {
      if (signal.aborted || error instanceof VideoDeletedError) throw error;
      const message = userMessage(error);
      console.error(`[process-video] rendu du clip ${clipId} en échec :`, error);
      failures.push(message);
      await prisma.clip.updateMany({
        where: { id: clipId },
        data: { renderStatus: "FAILED", renderError: message },
      });
    }
  }

  if (failures.length === clipIds.length) {
    throw new AppError("RENDER_FAILED", `Aucun clip n'a pu être rendu. ${failures[0]}`);
  }
}

/**
 * Pipeline d'une vidéo, exécuté par le worker. Chaque étape déjà faite est sautée.
 * Sur une erreur temporaire, passe la vidéo en WAITING_RETRY et relance l'erreur pour que pg-boss
 * replanifie le job (`retryCount` = reprises déjà faites) ; sinon, passe la vidéo en FAILED.
 */
export async function processVideo(job: ProcessVideoJob, retryCount = 0): Promise<void> {
  const { videoId, userId } = job;
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: { transcript: true, _count: { select: { clips: true } } },
  });
  if (!video) {
    console.warn(`[process-video] vidéo ${videoId} introuvable, job ignoré`);
    return;
  }

  const deletion = watchDeletion(videoId);
  try {
    const options = videoOptionsSchema.parse(video.options);

    // 1. Transcription — mise en cache en base, jamais retéléchargée (quota : ~250 unités).
    let transcript = video.transcript;
    if (!transcript) {
      await setStatus(videoId, "FETCHING_TRANSCRIPT");
      const yt = await getYouTubeClient(userId);
      const fetched = await fetchTranscript(yt, video.youtubeId, options.language);
      transcript = await prisma.transcript.create({ data: { videoId, ...fetched } });
      console.log(
        `[process-video] ${video.youtubeId} : ${fetched.segments.length} segments (${fetched.language}, ${fetched.kind})`,
      );
    }

    // 2. Sélection des moments par Gemini.
    if (video._count.clips === 0) {
      await setStatus(videoId, "ANALYZING");
      const segments = segmentsSchema.parse(transcript.segments);
      const { clips, model } = await selectClips({
        title: video.title,
        durationSec: Math.max(video.durationSec, segments.at(-1)?.end ?? 0),
        segments,
        options,
        signal: deletion.signal,
        videoId,
        bypassCache: job.bypassCache,
      });
      await replaceClips(videoId, clips, options.cropMode);
      await prisma.video.updateMany({ where: { id: videoId }, data: { analysisModel: model } });
      console.log(`[process-video] ${video.youtubeId} : ${clips.length} clips sélectionnés (${model})`);
    }

    // 3. Vidéo source (yt-dlp, une seule fois) et 4. rendu des clips pas encore rendus.
    const toRender = await prisma.clip.findMany({
      where: { videoId, renderStatus: { not: "DONE" } },
      orderBy: [{ score: "desc" }, { start: "asc" }],
      select: { id: true },
    });
    if (toRender.length > 0) {
      const source = await ensureVideoSource(video, deletion.signal);
      await renderClips(videoId, toRender.map((c) => c.id), source, deletion.signal);
    }

    await setStatus(videoId, "DONE");
  } catch (error) {
    // Suppression pendant le traitement : les écritures échouent (ligne absente, clé
    // étrangère) ou le signal interrompt l'appel en cours. Rien à signaler.
    if (error instanceof VideoDeletedError || deletion.signal.aborted || !(await videoExists(videoId))) {
      console.log(`[process-video] ${video.youtubeId} : vidéo supprimée, traitement interrompu`);
      return;
    }
    const outcome = decideFailure(error, retryCount, MAX_PROCESS_ATTEMPTS);
    await prisma.video.updateMany({
      where: { id: videoId },
      data: { status: outcome.status, error: outcome.message },
    });

    if (outcome.status === "WAITING_RETRY") {
      console.warn(`[process-video] ${video.youtubeId} : en attente de reprise : ${outcome.message}`);
      throw error; // pg-boss replanifie le job (PROCESS_RETRY_POLICY)
    }
    console.error(`[process-video] ${video.youtubeId} en échec définitif :`, error);
  } finally {
    deletion.stop();
  }
}
