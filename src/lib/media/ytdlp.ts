import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sourceDir } from "@/lib/storage";
import { bin } from "./binaries";
import { probeVideo } from "./ffmpeg";
import { MissingBinaryError, ProcessError, runProcess } from "./process";

const SOURCE_FILE = "source.mp4";

/**
 * Meilleur MP4 ≤ 1080p, H.264 de préférence (décodage rapide et universel, là où YouTube
 * propose souvent de l'AV1 ou du VP9), audio AAC.
 */
const FORMAT_ARGS = ["-f", "bv*+ba/b", "-S", "res:1080,vcodec:h264,ext:mp4:m4a", "--merge-output-format", "mp4", "--remux-video", "mp4"];

const PROGRESS_PREFIX = "CLIPPER_PROGRESS";

/** Téléchargements en cours, par youtubeId : deux demandes simultanées partagent le même. */
const inFlight = new Map<string, Promise<string>>();

/** Traduit l'échec de yt-dlp en message utile (et indique s'il vaut la peine de réessayer). */
export function toDownloadError(stderr: string): AppError {
  const errorLine =
    stderr
      .split(/\r?\n/)
      .filter((line) => line.startsWith("ERROR:"))
      .at(-1)
      ?.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, "") ?? stderr.trim().split(/\r?\n/).at(-1) ?? "erreur inconnue";

  if (/sign in to confirm|not a bot/i.test(stderr)) {
    return new AppError(
      "DOWNLOAD_FAILED",
      "YouTube bloque le téléchargement depuis cette machine (« confirme que tu n'es pas un robot »). Fournis tes cookies YouTube via YTDLP_COOKIES (voir README).",
    );
  }
  if (/private video|video is private|members-only|granted access/i.test(stderr)) {
    return new AppError(
      "DOWNLOAD_FAILED",
      "Vidéo privée : yt-dlp ne peut la télécharger qu'avec tes cookies YouTube (YTDLP_COOKIES, voir README). Sinon, passe-la en « non répertoriée ».",
    );
  }
  if (/javascript runtime|js runtime|deno/i.test(stderr) && !/HTTP Error/i.test(stderr)) {
    return new AppError(
      "DOWNLOAD_FAILED",
      `yt-dlp a besoin d'un runtime JavaScript pour YouTube : installe Deno (voir README). Détail : ${errorLine}`,
    );
  }
  const transient = /HTTP Error (403|429|5\d\d)|timed out|connection (reset|refused|aborted)|temporary failure|getaddrinfo|incomplete ?read|unable to download/i;
  return new AppError(
    "DOWNLOAD_FAILED",
    `Le téléchargement de la vidéo a échoué : ${errorLine}${/HTTP Error 403/.test(stderr) ? " (si ça persiste, mets yt-dlp à jour : yt-dlp -U)" : ""}`,
    { retryable: transient.test(stderr) },
  );
}

async function isUsable(file: string): Promise<boolean> {
  try {
    if ((await stat(file)).size === 0) return false;
    return (await probeVideo(file)).duration > 0;
  } catch {
    return false;
  }
}

async function download(
  youtubeId: string,
  options: { signal?: AbortSignal; onStart?: () => Promise<void> | void; onProgress?: (percent: number) => void },
): Promise<string> {
  const dir = sourceDir(youtubeId);
  const target = path.join(dir, SOURCE_FILE);
  if (await isUsable(target)) return target;

  await mkdir(dir, { recursive: true });
  // Fichier final illisible (fusion interrompue) : on le refait. Les fichiers partiels et les
  // flux déjà téléchargés (source.f137.mp4…) sont gardés : yt-dlp reprend là où il s'était arrêté.
  await rm(target, { force: true });
  await options.onStart?.();

  // yt-dlp télécharge la vidéo puis l'audio : la vidéo compte pour 90 % de la progression.
  let stream = 0;
  let lastBytes = 0;
  const onLine = (line: string) => {
    if (!line.startsWith(PROGRESS_PREFIX)) return;
    const [, done, total] = line.split(" ").map(Number);
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return;
    if (done < lastBytes) stream++;
    lastBytes = done;
    const ratio = Math.min(1, done / total);
    options.onProgress?.(Math.round(stream === 0 ? ratio * 90 : 90 + ratio * 10));
  };

  const cookies = env().YTDLP_COOKIES;
  const args = [
    "--no-playlist",
    "--newline",
    "--no-colors",
    ...FORMAT_ARGS,
    "--progress-template",
    `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s`,
    "-o",
    path.join(dir, "source.%(ext)s"),
    ...(cookies ? ["--cookies", cookies] : []),
    `https://www.youtube.com/watch?v=${youtubeId}`,
  ];

  try {
    await runProcess(bin.ytdlp(), args, { signal: options.signal, onStdoutLine: onLine });
  } catch (error) {
    if (error instanceof ProcessError) throw toDownloadError(error.stderr);
    if (error instanceof MissingBinaryError) {
      throw new AppError("DOWNLOAD_FAILED", `yt-dlp introuvable (« ${error.command} ») : installe-le ou renseigne YTDLP_PATH.`);
    }
    throw error;
  }

  if (!(await isUsable(target))) {
    throw new AppError("DOWNLOAD_FAILED", "yt-dlp n'a pas produit de fichier MP4 lisible.");
  }
  return target;
}

/**
 * Chemin du MP4 source de la vidéo (STORAGE_DIR/sources/{youtubeId}/source.mp4), téléchargé
 * avec yt-dlp une seule fois : le fichier sert de cache pour tous les rendus suivants.
 * `onStart` n'est appelé que si un téléchargement est réellement nécessaire.
 */
export function ensureSource(
  youtubeId: string,
  options: { signal?: AbortSignal; onStart?: () => Promise<void> | void; onProgress?: (percent: number) => void } = {},
): Promise<string> {
  let pending = inFlight.get(youtubeId);
  if (!pending) {
    pending = download(youtubeId, options).finally(() => inFlight.delete(youtubeId));
    inFlight.set(youtubeId, pending);
  }
  return pending;
}
