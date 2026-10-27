import type { VideoStatus } from "@/generated/prisma/enums";

/** Empreinte de l'état d'une vidéo : change à chaque mise à jour (statut, progression…). */
export function videoVersion(video: { status: VideoStatus; updatedAt: Date }): string {
  return `${video.status}:${video.updatedAt.getTime()}`;
}
