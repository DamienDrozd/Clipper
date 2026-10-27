import type { RenderStatus, VideoStatus } from "@/generated/prisma/enums";

/**
 * Empreinte de l'état d'une vidéo et de ses clips : change à chaque mise à jour (statut,
 * progression, heure de reprise planifiée…), ce qui déclenche le rafraîchissement de la page.
 * La page et /api/videos/[id] doivent la calculer avec les mêmes données.
 */
export function videoVersion(
  video: { status: VideoStatus; updatedAt: Date },
  clips: { renderStatus: RenderStatus; renderProgress: number }[],
  nextRetryAt: Date | null = null,
): string {
  return [
    video.status,
    video.updatedAt.getTime(),
    nextRetryAt?.getTime() ?? "",
    ...clips.map((c) => `${c.renderStatus}${c.renderProgress}`),
  ].join(":");
}

/**
 * Le pipeline a-t-il du travail à reprendre ? Vidéo en échec ou en attente de reprise, ou terminée
 * sans clips ou avec des clips non rendus (rendu en échec, ou vidéo analysée avant l'ajout du rendu).
 */
export function canResume(status: VideoStatus, totalClips: number, unrenderedClips: number): boolean {
  return (
    status === "FAILED" ||
    status === "WAITING_RETRY" ||
    (status === "DONE" && (totalClips === 0 || unrenderedClips > 0))
  );
}

/** URL d'un fichier de STORAGE_DIR (chemin relatif stocké en base), servi par /api/files. */
export function fileUrl(relativePath: string, download?: string): string {
  const url = `/api/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  return download ? `${url}?download=${encodeURIComponent(download)}` : url;
}

/** Nom de fichier lisible à partir d'un titre de clip. */
export function downloadName(title: string, extension: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "clip"}.${extension}`;
}
