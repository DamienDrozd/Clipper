import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/lib/env";

const execFileAsync = promisify(execFile);

/** Chemins des binaires (variables FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH, sinon le PATH). */
export const bin = {
  ffmpeg: () => env().FFMPEG_PATH,
  ffprobe: () => env().FFPROBE_PATH,
  ytdlp: () => env().YTDLP_PATH,
};

const BINARIES = [
  { name: "ffmpeg", path: bin.ffmpeg, args: ["-version"], env: "FFMPEG_PATH", install: "https://ffmpeg.org/download.html (Windows : winget install Gyan.FFmpeg)" },
  { name: "ffprobe", path: bin.ffprobe, args: ["-version"], env: "FFPROBE_PATH", install: "fourni avec ffmpeg" },
  { name: "yt-dlp", path: bin.ytdlp, args: ["--version"], env: "YTDLP_PATH", install: "https://github.com/yt-dlp/yt-dlp#installation (Windows : winget install yt-dlp)" },
];

/** Vérifie que ffmpeg, ffprobe et yt-dlp sont exécutables ; lève une erreur explicite sinon. */
export async function checkBinaries(): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  const missing: string[] = [];

  for (const binary of BINARIES) {
    const command = binary.path();
    try {
      const { stdout } = await execFileAsync(command, binary.args, { timeout: 15_000, windowsHide: true });
      versions[binary.name] = `${stdout.split(/\r?\n/)[0].trim()} (${command})`;
    } catch {
      missing.push(`  - ${binary.name} (« ${command} ») : ${binary.install} — ou indique son chemin dans ${binary.env}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Outils introuvables :\n${missing.join("\n")}\nInstalle-les puis relance le worker.`);
  }
  return versions;
}
