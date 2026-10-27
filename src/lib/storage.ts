import { rm } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

// Arborescence sous STORAGE_DIR :
//   sources/{youtubeId}/source.mp4   MP4 source téléchargé par yt-dlp (cache, une fois par vidéo)
//   clips/{videoId}/{clipId}-{v}.*   rendus des clips (MP4, SRT, miniature JPG)
// En base, les chemins sont stockés relativement à STORAGE_DIR, avec des « / ».

export const storageRoot = () => path.resolve(env().STORAGE_DIR);
export const sourceDir = (youtubeId: string) => path.join(storageRoot(), "sources", youtubeId);
export const clipsDir = (videoId: string) => path.join(storageRoot(), "clips", videoId);

/** Chemin absolu → chemin relatif à STORAGE_DIR (format stocké en base). */
export function toStoragePath(absolute: string): string {
  return path.relative(storageRoot(), absolute).split(path.sep).join("/");
}

/** Chemin relatif (base, URL) → chemin absolu, ou null s'il sort de STORAGE_DIR. */
export function resolveStoragePath(relative: string): string | null {
  const root = storageRoot();
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(root + path.sep) ? absolute : null;
}

/** Supprime tous les fichiers d'une vidéo (source et rendus). */
export async function removeVideoFiles(video: { id: string; youtubeId: string }): Promise<void> {
  await Promise.all([
    rm(sourceDir(video.youtubeId), { recursive: true, force: true }),
    rm(clipsDir(video.id), { recursive: true, force: true }),
  ]);
}

/** Supprime des fichiers par leurs chemins relatifs (anciens rendus), sans échouer. */
export async function removeStorageFiles(relativePaths: (string | null | undefined)[]): Promise<void> {
  await Promise.all(
    relativePaths.map(async (relative) => {
      const absolute = relative ? resolveStoragePath(relative) : null;
      if (absolute) await rm(absolute, { force: true }).catch(() => {});
    }),
  );
}
