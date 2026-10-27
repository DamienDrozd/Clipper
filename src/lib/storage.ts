import { rm } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

// Arborescence sous STORAGE_DIR :
//   sources/{youtubeId}/   MP4 source téléchargé par yt-dlp (cache, une fois par vidéo)
//   clips/{videoId}/       rendus des clips (MP4, SRT, miniatures)

export const storageRoot = () => path.resolve(env().STORAGE_DIR);
export const sourceDir = (youtubeId: string) => path.join(storageRoot(), "sources", youtubeId);
export const clipsDir = (videoId: string) => path.join(storageRoot(), "clips", videoId);

/** Supprime tous les fichiers d'une vidéo (source et rendus). */
export async function removeVideoFiles(video: { id: string; youtubeId: string }): Promise<void> {
  await Promise.all([
    rm(sourceDir(video.youtubeId), { recursive: true, force: true }),
    rm(clipsDir(video.id), { recursive: true, force: true }),
  ]);
}
