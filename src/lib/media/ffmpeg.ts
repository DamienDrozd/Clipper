import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "@/lib/errors";
import { bin } from "./binaries";
import { buildVideoFilter, type CropArea, type CropMode } from "./filters";
import { MissingBinaryError, ProcessError, runProcess } from "./process";

const execFileAsync = promisify(execFile);

export type VideoProbe = { width: number; height: number; duration: number };

/** Dimensions et durée d'un fichier vidéo (ffprobe). */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(
    bin.ffprobe(),
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
    { windowsHide: true, timeout: 30_000 },
  );
  const json = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  return {
    width: json.streams?.[0]?.width ?? 0,
    height: json.streams?.[0]?.height ?? 0,
    duration: Number(json.format?.duration ?? 0),
  };
}

function toRenderError(error: unknown): unknown {
  if (error instanceof ProcessError) {
    const detail = error.stderr.trim().split(/\r?\n/).slice(-3).join(" ");
    return new AppError("RENDER_FAILED", `Le rendu ffmpeg a échoué : ${detail.slice(0, 400)}`, { cause: error });
  }
  if (error instanceof MissingBinaryError) {
    return new AppError("RENDER_FAILED", `ffmpeg introuvable (« ${error.command} ») : installe-le ou renseigne FFMPEG_PATH.`);
  }
  return error;
}

/** "00:01:02.345678" → secondes. */
function parseOutTime(value: string): number | null {
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/**
 * Découpe précise (réencodage, seek en entrée : les horodatages du clip partent de 0,
 * comme ceux du fichier ASS) et rendu vertical 1080x1920 H.264 + AAC.
 */
export async function renderVertical(params: {
  source: string;
  start: number;
  end: number;
  cropMode: CropMode;
  crop?: CropArea | null;
  assFile: string;
  fontsDir: string;
  output: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const duration = params.end - params.start;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss", params.start.toFixed(3),
    "-i", params.source,
    "-t", duration.toFixed(3),
    "-filter_complex",
    buildVideoFilter(params.cropMode, { assFile: params.assFile, fontsDir: params.fontsDir }, params.crop),
    "-map", "[v]",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "48000",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    "-f", "mp4",
    params.output,
  ];

  try {
    await runProcess(bin.ffmpeg(), args, {
      signal: params.signal,
      onStdoutLine: (line) => {
        if (!line.startsWith("out_time=")) return;
        const seconds = parseOutTime(line.slice("out_time=".length));
        if (seconds !== null && duration > 0) {
          params.onProgress?.(Math.min(99, Math.round((seconds / duration) * 100)));
        }
      },
    });
  } catch (error) {
    throw toRenderError(error);
  }
}

/** Miniature JPG extraite du clip rendu (à `at` secondes). */
export async function extractThumbnail(video: string, output: string, at: number, signal?: AbortSignal): Promise<void> {
  try {
    await runProcess(
      bin.ffmpeg(),
      ["-hide_banner", "-nostdin", "-y", "-ss", at.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "3", "-f", "image2", output],
      { signal },
    );
  } catch (error) {
    throw toRenderError(error);
  }
}
