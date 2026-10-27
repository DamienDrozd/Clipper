import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildAss, buildSrt, clipCues, wordChunks } from "@/lib/captions/captions";
import { extractThumbnail, renderVertical } from "@/lib/media/ffmpeg";
import { segmentsSchema } from "@/lib/transcript/types";
import { applyCaptionOverrides, captionOverridesSchema } from "@/lib/captions/overrides";
import { clipsDir, removeStorageFiles, toStoragePath } from "@/lib/storage";
import { cropRectSchema } from "@/lib/clips/crop";

const FONTS_DIR = path.resolve("assets/fonts");

/** Throttle des écritures de progression en base (au plus une par seconde). */
function progressWriter(write: (percent: number) => Promise<unknown>) {
  let last = 0;
  let lastPercent = -1;
  return (percent: number) => {
    const now = Date.now();
    if (percent === lastPercent || now - last < 1000) return;
    last = now;
    lastPercent = percent;
    write(percent).catch(() => {});
  };
}

/**
 * Rend un clip : sous-titres ASS (blocs de mots) incrustés, MP4 1080x1920, SRT et miniature.
 * Les fichiers sont versionnés (`{clipId}-{v}.*`) : un nouveau rendu ne touche pas aux fichiers
 * en cours de lecture, puis les anciens sont supprimés.
 */
export async function renderClip(clipId: string, sourceFile: string, signal?: AbortSignal): Promise<void> {
  const clip = await prisma.clip.findUniqueOrThrow({
    where: { id: clipId },
    include: { video: { select: { id: true, transcript: { select: { segments: true } } } } },
  });

  await prisma.clip.update({
    where: { id: clipId },
    data: { renderStatus: "RENDERING", renderProgress: 0, renderError: null },
  });

  const captionSource = applyCaptionOverrides(
    segmentsSchema.parse(clip.video.transcript?.segments ?? []),
    clip.captionOverrides ? captionOverridesSchema.parse(clip.captionOverrides) : null,
  );
  const cues = clipCues(captionSource, clip.start, clip.end);

  const dir = clipsDir(clip.video.id);
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, `${clip.id}-${Date.now().toString(36)}`);
  const files = { ass: `${base}.ass`, tmp: `${base}.tmp.mp4`, mp4: `${base}.mp4`, srt: `${base}.srt`, jpg: `${base}.jpg` };

  try {
    await writeFile(files.ass, buildAss(wordChunks(cues)), "utf8");
    await writeFile(files.srt, buildSrt(cues), "utf8");

    await renderVertical({
      source: sourceFile,
      start: clip.start,
      end: clip.end,
      cropMode: clip.cropMode,
      crop: clip.crop ? cropRectSchema.parse(clip.crop) : null,
      assFile: files.ass,
      fontsDir: FONTS_DIR,
      output: files.tmp,
      signal,
      onProgress: progressWriter((percent) =>
        prisma.clip.update({ where: { id: clipId }, data: { renderProgress: percent } }),
      ),
    });
    await rename(files.tmp, files.mp4);
    await extractThumbnail(files.mp4, files.jpg, Math.min(1, (clip.end - clip.start) / 2), signal);
  } catch (error) {
    await Promise.all([files.tmp, files.mp4, files.srt, files.jpg].map((file) => rm(file, { force: true })));
    throw error;
  } finally {
    await rm(files.ass, { force: true });
  }

  await prisma.clip.update({
    where: { id: clipId },
    data: {
      renderStatus: "DONE",
      renderProgress: 100,
      renderError: null,
      mp4Path: toStoragePath(files.mp4),
      srtPath: toStoragePath(files.srt),
      thumbPath: toStoragePath(files.jpg),
      renderedAt: new Date(),
    },
  });
  await removeStorageFiles([clip.mp4Path, clip.srtPath, clip.thumbPath]);
}
