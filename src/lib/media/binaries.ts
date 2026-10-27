import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BINARIES = [
  { name: "ffmpeg", args: ["-version"], install: "https://ffmpeg.org/download.html (Windows : winget install Gyan.FFmpeg)" },
  { name: "ffprobe", args: ["-version"], install: "fourni avec ffmpeg" },
  { name: "yt-dlp", args: ["--version"], install: "https://github.com/yt-dlp/yt-dlp#installation (Windows : winget install yt-dlp)" },
];

/** Vérifie que ffmpeg, ffprobe et yt-dlp sont dans le PATH ; lève une erreur explicite sinon. */
export async function checkBinaries(): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  const missing: string[] = [];

  for (const binary of BINARIES) {
    try {
      const { stdout } = await execFileAsync(binary.name, binary.args, { timeout: 15_000, windowsHide: true });
      versions[binary.name] = stdout.split(/\r?\n/)[0].trim();
    } catch {
      missing.push(`  - ${binary.name} : ${binary.install}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Outils introuvables dans le PATH :\n${missing.join("\n")}\nInstalle-les puis relance le worker.`,
    );
  }
  return versions;
}
