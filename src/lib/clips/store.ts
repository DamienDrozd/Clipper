import { prisma } from "@/lib/prisma";
import type { CropModeOption } from "@/lib/options";
import type { SelectedClip } from "./postprocess";

export const toCropMode = (mode: CropModeOption) => (mode === "center" ? "CENTER" : "BLUR");

/** Remplace la sélection de clips d'une vidéo. */
export async function replaceClips(videoId: string, clips: SelectedClip[], cropMode: CropModeOption) {
  await prisma.$transaction([
    prisma.clip.deleteMany({ where: { videoId } }),
    prisma.clip.createMany({
      data: clips.map((clip) => ({ ...clip, videoId, cropMode: toCropMode(cropMode) })),
    }),
  ]);
}
