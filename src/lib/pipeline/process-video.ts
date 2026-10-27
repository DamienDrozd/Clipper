import { prisma } from "@/lib/prisma";
import { isRetryable, userMessage } from "@/lib/errors";
import { MAX_ATTEMPTS, retryDelayUpperBound, type ProcessVideoJob } from "@/lib/jobs/boss";
import { videoOptionsSchema } from "@/lib/options";
import { getYouTubeClient } from "@/lib/youtube/client";
import { fetchTranscript } from "@/lib/youtube/captions";
import { segmentsSchema } from "@/lib/transcript/types";
import { selectClips } from "@/lib/llm/select";
import { replaceClips } from "@/lib/clips/store";
import type { VideoStatus } from "@/generated/prisma/client";
import { VideoDeletedError, videoExists, watchDeletion } from "./cancellation";

/** Change le statut ; lève VideoDeletedError si la vidéo a été supprimée entre-temps. */
async function setStatus(videoId: string, status: VideoStatus) {
  const { count } = await prisma.video.updateMany({ where: { id: videoId }, data: { status, error: null } });
  if (count === 0) throw new VideoDeletedError();
}

/**
 * Pipeline d'une vidéo, exécuté par le worker. Chaque étape déjà faite est sautée.
 * Sur une erreur passagère, relance l'erreur pour que pg-boss replanifie le job
 * (`retryCount` = nombre de tentatives déjà faites) ; sinon, passe la vidéo en FAILED.
 */
export async function processVideo({ videoId, userId }: ProcessVideoJob, retryCount = 0): Promise<void> {
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
      const clips = await selectClips({
        title: video.title,
        durationSec: Math.max(video.durationSec, segments.at(-1)?.end ?? 0),
        segments,
        options,
        signal: deletion.signal,
      });
      await replaceClips(videoId, clips, options.cropMode);
      console.log(`[process-video] ${video.youtubeId} : ${clips.length} clips sélectionnés`);
    }

    // 3. Téléchargement et rendu — jalon 4.

    await setStatus(videoId, "DONE");
  } catch (error) {
    // Suppression pendant le traitement : les écritures échouent (ligne absente, clé
    // étrangère) ou le signal interrompt l'appel en cours. Rien à signaler.
    if (error instanceof VideoDeletedError || deletion.signal.aborted || !(await videoExists(videoId))) {
      console.log(`[process-video] ${video.youtubeId} : vidéo supprimée, traitement interrompu`);
      return;
    }
    const attempt = retryCount + 1;
    const message = userMessage(error);

    if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
      const minutes = Math.ceil(retryDelayUpperBound(retryCount) / 60);
      console.warn(
        `[process-video] ${video.youtubeId} : tentative ${attempt}/${MAX_ATTEMPTS} échouée, nouvel essai d'ici ${minutes} min : ${message}`,
      );
      await prisma.video.updateMany({
        where: { id: videoId },
        data: {
          status: "PENDING",
          error: `${message} Nouvelle tentative automatique (${attempt + 1}/${MAX_ATTEMPTS}) d'ici ${minutes} min.`,
        },
      });
      throw error; // pg-boss replanifie le job
    }

    console.error(`[process-video] ${video.youtubeId} en échec (tentative ${attempt}) :`, error);
    await prisma.video.updateMany({
      where: { id: videoId },
      data: {
        status: "FAILED",
        error: attempt > 1 ? `${message} (échec après ${attempt} tentatives)` : message,
      },
    });
  } finally {
    deletion.stop();
  }
}
