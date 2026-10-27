import { prisma } from "@/lib/prisma";
import { userMessage } from "@/lib/errors";
import type { ProcessVideoJob } from "@/lib/jobs/boss";
import { videoOptionsSchema } from "@/lib/options";
import { getYouTubeClient } from "@/lib/youtube/client";
import { fetchTranscript } from "@/lib/youtube/captions";
import type { VideoStatus } from "@/generated/prisma/client";

const setStatus = (videoId: string, status: VideoStatus) =>
  prisma.video.update({ where: { id: videoId }, data: { status, error: null } });

/** Pipeline d'une vidéo, exécuté par le worker. */
export async function processVideo({ videoId, userId }: ProcessVideoJob): Promise<void> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: { transcript: { select: { id: true } } },
  });
  if (!video) {
    console.warn(`[process-video] vidéo ${videoId} introuvable, job ignoré`);
    return;
  }

  try {
    const options = videoOptionsSchema.parse(video.options);

    // 1. Transcription — mise en cache en base, jamais retéléchargée (quota : ~250 unités).
    if (!video.transcript) {
      await setStatus(videoId, "FETCHING_TRANSCRIPT");
      const yt = await getYouTubeClient(userId);
      const transcript = await fetchTranscript(yt, video.youtubeId, options.language);
      await prisma.transcript.create({ data: { videoId, ...transcript } });
      console.log(
        `[process-video] ${video.youtubeId} : ${transcript.segments.length} segments (${transcript.language}, ${transcript.kind})`,
      );
    }

    // 2. Sélection des moments par Gemini — jalon 3.

    await setStatus(videoId, "DONE");
  } catch (error) {
    console.error(`[process-video] ${video.youtubeId} en échec :`, error);
    await prisma.video.update({
      where: { id: videoId },
      data: { status: "FAILED", error: userMessage(error) },
    });
  }
}
