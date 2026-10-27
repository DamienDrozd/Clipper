import { prisma } from "@/lib/prisma";
import { userMessage } from "@/lib/errors";
import type { ProcessVideoJob } from "@/lib/jobs/boss";
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

/** Pipeline d'une vidéo, exécuté par le worker. Chaque étape déjà faite est sautée. */
export async function processVideo({ videoId, userId }: ProcessVideoJob): Promise<void> {
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
    console.error(`[process-video] ${video.youtubeId} en échec :`, error);
    await prisma.video.updateMany({
      where: { id: videoId },
      data: { status: "FAILED", error: userMessage(error) },
    });
  } finally {
    deletion.stop();
  }
}
