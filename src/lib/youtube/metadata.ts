import type { youtube_v3 } from "./api";
import { AppError } from "@/lib/errors";
import { toYouTubeError } from "./errors";
import { parseIsoDuration } from "./url";

export type VideoMetadata = {
  youtubeId: string;
  title: string;
  durationSec: number;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
};

/**
 * Métadonnées de la vidéo (videos.list, 1 unité de quota) + contrôle qu'elle appartient
 * bien à la chaîne de l'utilisateur connecté (channels.list mine=true, 1 unité).
 */
export async function fetchOwnedVideo(
  yt: youtube_v3.Youtube,
  youtubeId: string,
): Promise<VideoMetadata> {
  let videoRes, channelRes;
  try {
    [videoRes, channelRes] = await Promise.all([
      yt.videos.list({ part: ["snippet", "contentDetails"], id: [youtubeId] }),
      yt.channels.list({ part: ["id"], mine: true }),
    ]);
  } catch (error) {
    throw toYouTubeError(error, "métadonnées de la vidéo");
  }

  const video = videoRes.data.items?.[0];
  const snippet = video?.snippet;
  if (!video || !snippet?.channelId) {
    throw new AppError(
      "VIDEO_NOT_FOUND",
      "Vidéo introuvable : vérifie l'URL (la vidéo a peut-être été supprimée).",
    );
  }

  const myChannelIds = (channelRes.data.items ?? []).map((channel) => channel.id);
  if (myChannelIds.length === 0) {
    throw new AppError("NO_CHANNEL", "Ce compte Google n'a pas de chaîne YouTube.");
  }
  if (!myChannelIds.includes(snippet.channelId)) {
    throw new AppError(
      "NOT_OWNER",
      `Cette vidéo appartient à la chaîne « ${snippet.channelTitle ?? snippet.channelId} », pas à la tienne. Clipper ne traite que tes propres vidéos.`,
    );
  }

  if (snippet.liveBroadcastContent === "live" || snippet.liveBroadcastContent === "upcoming") {
    throw new AppError(
      "LIVE_VIDEO",
      "Ce direct n'est pas encore terminé : réessaie une fois la rediffusion disponible.",
    );
  }

  const thumbnails = snippet.thumbnails;
  return {
    youtubeId,
    title: snippet.title ?? "(sans titre)",
    durationSec: parseIsoDuration(video.contentDetails?.duration),
    channelId: snippet.channelId,
    channelTitle: snippet.channelTitle ?? "",
    thumbnailUrl:
      (thumbnails?.maxres ?? thumbnails?.standard ?? thumbnails?.high ?? thumbnails?.medium ?? thumbnails?.default)
        ?.url ?? null,
  };
}
