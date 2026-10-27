import { prisma } from "@/lib/prisma";

/** La vidéo a été supprimée pendant son traitement : le pipeline s'arrête sans erreur. */
export class VideoDeletedError extends Error {
  constructor() {
    super("Vidéo supprimée pendant le traitement");
    this.name = "VideoDeletedError";
  }
}

export const videoExists = async (videoId: string) =>
  (await prisma.video.count({ where: { id: videoId } })) > 0;

/**
 * Surveille la suppression d'une vidéo pendant son traitement : le signal est annulé dès que
 * la ligne disparaît de la base, pour interrompre les opérations longues (Gemini, yt-dlp, ffmpeg).
 */
export function watchDeletion(videoId: string, intervalMs = 3000): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer = setInterval(async () => {
    try {
      if (!(await videoExists(videoId))) {
        clearInterval(timer);
        controller.abort(new VideoDeletedError());
      }
    } catch {
      // Base momentanément injoignable : on réessaie au prochain tick.
    }
  }, intervalMs);
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}
