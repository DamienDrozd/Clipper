import type { VideoStatus } from "@/generated/prisma/enums";

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  PENDING: "En attente",
  FETCHING_TRANSCRIPT: "Récupération de la transcription",
  ANALYZING: "Analyse par l'IA",
  DOWNLOADING: "Téléchargement de la vidéo",
  RENDERING: "Rendu des clips",
  DONE: "Terminé",
  FAILED: "Échec",
};

export const isFinalStatus = (status: VideoStatus) => status === "DONE" || status === "FAILED";

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
