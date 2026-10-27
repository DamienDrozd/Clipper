"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { userMessage } from "@/lib/errors";
import { videoOptionsSchema } from "@/lib/options";
import { isFinalStatus } from "@/lib/status";
import { cropRectSchema, roundCrop } from "@/lib/clips/crop";
import { cancelVideoJobs, enqueueProcessVideo, enqueueRenderClip } from "@/lib/jobs/boss";
import { removeStorageFiles, removeVideoFiles } from "@/lib/storage";
import { segmentsSchema } from "@/lib/transcript/types";
import { captionOverridesSchema, mergeCaptionOverrides } from "@/lib/captions/overrides";
import { parseYouTubeUrl } from "@/lib/youtube/url";
import { getYouTubeClient } from "@/lib/youtube/client";
import { fetchOwnedVideo } from "@/lib/youtube/metadata";
import { canResume } from "@/lib/videos";

const unrendered = (clips: { renderStatus: string }[]) => clips.filter((c) => c.renderStatus !== "DONE").length;

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
      include: { clips: { select: { renderStatus: true } } },
    });
    if (existing && existing.userId !== user.id) {
      return { error: "Cette vidéo est déjà traitée par un autre compte.", values };
    }

    if (existing && !canResume(existing.status, existing.clips.length, unrendered(existing.clips))) {
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

/**
 * Relance le pipeline d'une vidéo en échec ou dont des clips ne sont pas rendus
 * (les étapes déjà faites sont en cache).
 */
export async function retryVideo(videoId: string): Promise<void> {
  const user = await requireUser();
  const video = await prisma.video.findFirst({
    where: { id: videoId, userId: user.id },
    include: { clips: { select: { renderStatus: true } } },
  });
  if (!video || !canResume(video.status, video.clips.length, unrendered(video.clips))) return;

  // « Relancer maintenant » : la reprise planifiée par pg-boss est remplacée par un job immédiat.
  if (video.status === "WAITING_RETRY") await cancelVideoJobs(video.id);
  await prisma.video.update({ where: { id: video.id }, data: { status: "PENDING", error: null } });
  await enqueueProcessVideo({ videoId: video.id, userId: user.id });
  redirect(`/videos/${video.id}`);
}

const framingSchema = z.object({
  cropMode: z.enum(["CENTER", "BLUR"]),
  crop: cropRectSchema.nullable(),
});

export type FramingInput = z.infer<typeof framingSchema>;

/**
 * Enregistre le cadrage d'un clip (mode + zone de la source) et lance son nouveau rendu.
 * Refusé pendant le traitement de la vidéo, pour ne pas rendre le clip deux fois en parallèle.
 */
export async function updateClipFraming(clipId: string, input: FramingInput): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = framingSchema.safeParse(input);
  if (!parsed.success) return { error: "Cadrage invalide." };

  const clip = await prisma.clip.findFirst({
    where: { id: clipId, video: { userId: user.id } },
    select: { id: true, videoId: true, video: { select: { status: true } } },
  });
  if (!clip) return { error: "Clip introuvable." };
  if (!isFinalStatus(clip.video.status)) {
    return { error: "Attends la fin du traitement de la vidéo avant de recadrer un clip." };
  }

  const { cropMode, crop } = parsed.data;
  try {
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        cropMode,
        crop: crop ? roundCrop(crop) : Prisma.DbNull,
        renderStatus: "QUEUED",
        renderProgress: 0,
        renderError: null,
      },
    });
    await enqueueRenderClip({ clipId: clip.id, videoId: clip.videoId });
  } catch (error) {
    console.error("[updateClipFraming]", error);
    return { error: userMessage(error) };
  }
  refresh();
  return {};
}

/** Clip de l'utilisateur, modifiable seulement une fois le traitement de la vidéo terminé. */
async function findEditableClip(userId: string, clipId: string) {
  const clip = await prisma.clip.findFirst({
    where: { id: clipId, video: { userId } },
    include: { video: { select: { status: true, durationSec: true, transcript: { select: { segments: true } } } } },
  });
  if (!clip) return { error: "Clip introuvable." } as const;
  if (!isFinalStatus(clip.video.status)) {
    return { error: "Attends la fin du traitement de la vidéo avant de modifier un clip." } as const;
  }
  return { clip } as const;
}

const clipEditSchema = z
  .object({
    title: z.string().trim().min(1, "Le titre est requis.").max(150, "Titre trop long (150 caractères max)."),
    start: z.number().min(0, "Le début ne peut pas être négatif."),
    end: z.number(),
    /** Textes de sous-titres saisis, par clé de segment (voir segmentKey). */
    captions: z.record(z.string(), z.string().max(500)),
  })
  .refine((v) => v.end - v.start >= 1, "Le clip doit durer au moins 1 s.")
  .refine((v) => v.end - v.start <= 180, "Le clip ne peut pas dépasser 180 s.");

export type ClipEditInput = z.infer<typeof clipEditSchema>;

/**
 * Modifie un clip (titre, début/fin, corrections de sous-titres). Un nouveau rendu est lancé
 * si le passage ou les sous-titres changent ; un simple changement de titre n'en a pas besoin.
 */
export async function updateClip(clipId: string, input: ClipEditInput): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = clipEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Modification invalide." };

  const found = await findEditableClip(user.id, clipId);
  if ("error" in found) return { error: found.error };
  const { clip } = found;

  const segments = segmentsSchema.parse(clip.video.transcript?.segments ?? []);
  const maxEnd = Math.max(clip.video.durationSec, segments.at(-1)?.end ?? 0);
  const { title, captions } = parsed.data;
  const start = Math.round(parsed.data.start * 1000) / 1000;
  const end = Math.round(parsed.data.end * 1000) / 1000;
  if (end > maxEnd + 0.5) return { error: "La fin dépasse la durée de la vidéo." };

  const existing = clip.captionOverrides ? captionOverridesSchema.parse(clip.captionOverrides) : null;
  const overrides = mergeCaptionOverrides(segments, existing, captions);
  const needsRender =
    start !== clip.start || end !== clip.end || JSON.stringify(overrides) !== JSON.stringify(existing);

  try {
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        title,
        start,
        end,
        captionOverrides: overrides ?? Prisma.DbNull,
        ...(needsRender ? { renderStatus: "QUEUED", renderProgress: 0, renderError: null } : {}),
      },
    });
    if (needsRender) await enqueueRenderClip({ clipId: clip.id, videoId: clip.videoId });
  } catch (error) {
    console.error("[updateClip]", error);
    return { error: userMessage(error) };
  }
  refresh();
  return {};
}

/** Relance le rendu d'un clip tel quel (par exemple après un échec). */
export async function rerenderClip(clipId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const found = await findEditableClip(user.id, clipId);
  if ("error" in found) return { error: found.error };

  await prisma.clip.update({
    where: { id: clipId },
    data: { renderStatus: "QUEUED", renderProgress: 0, renderError: null },
  });
  await enqueueRenderClip({ clipId, videoId: found.clip.videoId });
  refresh();
  return {};
}

/**
 * « Régénérer la sélection » : supprime les clips (et leurs rendus) puis relance le pipeline,
 * qui refait seulement l'analyse Gemini et les rendus — transcription et vidéo source sont en cache.
 */
export async function regenerateSelection(videoId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const video = await prisma.video.findFirst({
    where: { id: videoId, userId: user.id },
    include: { clips: { select: { renderStatus: true, mp4Path: true, srtPath: true, thumbPath: true } } },
  });
  if (!video) return { error: "Vidéo introuvable." };
  if (!isFinalStatus(video.status)) return { error: "Attends la fin du traitement en cours." };
  if (video.clips.some((c) => c.renderStatus === "QUEUED" || c.renderStatus === "RENDERING")) {
    return { error: "Attends la fin des rendus en cours." };
  }

  try {
    await cancelVideoJobs(video.id);
    await prisma.$transaction([
      prisma.clip.deleteMany({ where: { videoId: video.id } }),
      prisma.video.update({ where: { id: video.id }, data: { status: "PENDING", error: null, progress: 0 } }),
    ]);
    await removeStorageFiles(video.clips.flatMap((c) => [c.mp4Path, c.srtPath, c.thumbPath]));
    // Nouvel appel à Gemini, sans réutiliser la réponse en cache.
    await enqueueProcessVideo({ videoId: video.id, userId: user.id, bypassCache: true });
  } catch (error) {
    console.error("[regenerateSelection]", error);
    return { error: userMessage(error) };
  }
  refresh();
  return {};
}
