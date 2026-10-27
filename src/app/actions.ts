"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { userMessage } from "@/lib/errors";
import { videoOptionsSchema } from "@/lib/options";
import { cancelVideoJobs, enqueueProcessVideo } from "@/lib/jobs/boss";
import { removeVideoFiles } from "@/lib/storage";
import { parseYouTubeUrl } from "@/lib/youtube/url";
import { getYouTubeClient } from "@/lib/youtube/client";
import { fetchOwnedVideo } from "@/lib/youtube/metadata";

export type SubmitVideoState = {
  error?: string;
  values?: Record<string, string>;
};

/**
 * Soumission d'une URL : parsing, métadonnées et contrôle de propriété (rapides, 2 unités
 * de quota), puis mise en file du traitement long pour le worker.
 */
export async function submitVideo(_prev: SubmitVideoState, formData: FormData): Promise<SubmitVideoState> {
  const user = await requireUser();
  const values = Object.fromEntries(
    [...formData.entries()].filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  const youtubeId = parseYouTubeUrl(values.url ?? "");
  if (!youtubeId) {
    return { error: "URL YouTube non reconnue (formats acceptés : watch?v=, youtu.be/, /shorts/, /live/).", values };
  }

  const parsed = videoOptionsSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Options invalides.", values };
  }

  let videoId: string;
  try {
    const existing = await prisma.video.findUnique({
      where: { youtubeId },
      include: { _count: { select: { clips: true } } },
    });
    if (existing && existing.userId !== user.id) {
      return { error: "Cette vidéo est déjà traitée par un autre compte.", values };
    }

    const needsProcessing =
      existing?.status === "FAILED" || (existing?.status === "DONE" && existing._count.clips === 0);
    if (existing && !needsProcessing) {
      // Déjà traitée ou en cours : on affiche simplement sa page.
      videoId = existing.id;
    } else {
      const yt = await getYouTubeClient(user.id);
      const metadata = await fetchOwnedVideo(yt, youtubeId);
      const video = await prisma.video.upsert({
        where: { youtubeId },
        create: { ...metadata, userId: user.id, options: parsed.data },
        update: { ...metadata, options: parsed.data, status: "PENDING", error: null },
      });
      await enqueueProcessVideo({ videoId: video.id, userId: user.id });
      videoId = video.id;
    }
  } catch (error) {
    console.error("[submitVideo]", error);
    return { error: userMessage(error), values };
  }

  redirect(`/videos/${videoId}`);
}

/**
 * Supprime une vidéo, même en cours de traitement : annule ses jobs en file, efface la ligne
 * (transcription et clips en cascade) puis ses fichiers. Un job déjà démarré s'arrête de
 * lui-même en constatant la suppression.
 */
export async function deleteVideo(videoId: string): Promise<void> {
  const user = await requireUser();
  const video = await prisma.video.findFirst({ where: { id: videoId, userId: user.id } });
  if (video) {
    await cancelVideoJobs(video.id);
    await prisma.video.delete({ where: { id: video.id } });
    await removeVideoFiles(video).catch((error) =>
      console.error(`[deleteVideo] fichiers de ${video.youtubeId} non supprimés :`, error),
    );
  }
  redirect("/");
}

/** Relance le pipeline d'une vidéo en échec (les étapes déjà faites sont en cache). */
export async function retryVideo(videoId: string): Promise<void> {
  const user = await requireUser();
  const video = await prisma.video.findFirst({ where: { id: videoId, userId: user.id } });
  if (!video || video.status !== "FAILED") return;

  await prisma.video.update({ where: { id: video.id }, data: { status: "PENDING", error: null } });
  await enqueueProcessVideo({ videoId: video.id, userId: user.id });
  redirect(`/videos/${video.id}`);
}
