import type { youtube_v3 } from "./api";
import { AppError } from "@/lib/errors";
import { parseVtt } from "@/lib/transcript/vtt";
import type { Segment } from "@/lib/transcript/types";
import { rankCaptionTracks, type CaptionTrack } from "./caption-tracks";
import { toYouTubeError } from "./errors";

export type FetchedTranscript = {
  language: string;
  kind: CaptionTrack["kind"];
  captionTrackId: string;
  segments: Segment[];
};

/**
 * Liste les pistes (captions.list, 50 unités) puis télécharge la meilleure en VTT
 * (captions.download, 200 unités). Si une piste n'est pas téléchargeable, essaie la suivante.
 * Le résultat doit être mis en cache en base par l'appelant : ne jamais rappeler inutilement.
 */
export async function fetchTranscript(
  yt: youtube_v3.Youtube,
  youtubeId: string,
  preferredLanguage: string,
): Promise<FetchedTranscript> {
  let items: youtube_v3.Schema$Caption[];
  try {
    const res = await yt.captions.list({ part: ["snippet"], videoId: youtubeId });
    items = res.data.items ?? [];
  } catch (error) {
    throw toYouTubeError(error, "liste des sous-titres");
  }

  const tracks = rankCaptionTracks(items, preferredLanguage);
  if (tracks.length === 0) {
    throw new AppError(
      "NO_CAPTIONS",
      "Aucune piste de sous-titres disponible pour cette vidéo. Si elle vient d'être mise en ligne, attends que YouTube génère les sous-titres automatiques (parfois plusieurs heures), ou ajoute-en dans YouTube Studio.",
    );
  }

  const failures: string[] = [];
  for (const track of tracks) {
    try {
      const res = await yt.captions.download(
        { id: track.id, tfmt: "vtt" },
        { responseType: "text" },
      );
      const segments = parseVtt(String(res.data));
      if (segments.length > 0) {
        return { language: track.language, kind: track.kind, captionTrackId: track.id, segments };
      }
      failures.push(`${track.language}/${track.kind} : piste vide`);
    } catch (error) {
      const appError = toYouTubeError(error, "téléchargement des sous-titres");
      // Inutile d'essayer d'autres pistes si le quota ou l'authentification bloquent ;
      // une erreur passagère sera réessayée plus tard par le worker.
      if (appError.code === "QUOTA_EXCEEDED" || appError.code === "AUTH_EXPIRED" || appError.retryable) {
        throw appError;
      }
      console.warn(`[captions] piste ${track.id} (${track.language}/${track.kind}) ignorée :`, appError.message);
      failures.push(`${track.language}/${track.kind} : ${appError.message}`);
    }
  }

  throw new AppError(
    "NO_CAPTIONS",
    `Aucune piste de sous-titres n'a pu être téléchargée (${failures.join(" ; ")}).`,
  );
}
