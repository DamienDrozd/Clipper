import { execFile } from "node:child_process";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import { storageRoot } from "@/lib/storage";

const execFileAsync = promisify(execFile);

/** yt-dlp géré par Clipper (voir ensureYtDlp), une fois résolu au démarrage du worker. */
let managedYtDlp: string | undefined;

/** Chemins des binaires (variables FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH, sinon le PATH). */
export const bin = {
  ffmpeg: () => env().FFMPEG_PATH,
  ffprobe: () => env().FFPROBE_PATH,
  ytdlp: () => managedYtDlp ?? env().YTDLP_PATH,
};

async function version(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 15_000, windowsHide: true });
    return stdout.split(/\r?\n/)[0].trim();
  } catch {
    return null;
  }
}

/** Binaire autonome officiel de yt-dlp pour la plateforme courante (Linux uniquement), ou null. */
export function ytDlpReleaseUrl(platform = process.platform, arch = process.arch): string | null {
  if (platform !== "linux") return null;
  const asset = arch === "arm64" ? "yt-dlp_linux_aarch64" : arch === "x64" ? "yt-dlp_linux" : null;
  return asset ? `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}` : null;
}

export const managedYtDlpPath = () => path.join(storageRoot(), "bin", "yt-dlp");

/**
 * yt-dlp disponible pour le worker. On utilise celui du PATH (ou YTDLP_PATH) s'il répond ; sinon,
 * sous Linux et si YTDLP_PATH n'est pas imposé, Clipper gère sa propre copie dans
 * STORAGE_DIR/bin : téléchargée depuis la release officielle au premier démarrage (le volume
 * persistant la conserve entre les déploiements), puis mise à jour à chaque démarrage
 * (`yt-dlp -U`), YouTube cassant régulièrement les anciennes versions.
 */
export async function ensureYtDlp(
  log: (message: string) => void = console.log,
  platform: { os: NodeJS.Platform; arch: string } = { os: process.platform, arch: process.arch },
): Promise<void> {
  const configured = env().YTDLP_PATH;
  if ((await version(configured, ["--version"])) !== null) return;

  const url = ytDlpReleaseUrl(platform.os, platform.arch);
  if (configured !== "yt-dlp" || !url) return; // checkBinaries signalera l'absence

  const target = managedYtDlpPath();
  if ((await version(target, ["--version"])) === null) {
    log(`yt-dlp introuvable dans le PATH : téléchargement de ${url} vers ${target}…`);
    await mkdir(path.dirname(target), { recursive: true });
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Téléchargement de yt-dlp impossible (HTTP ${response.status}).`);
    const temporary = `${target}.download`;
    try {
      await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
      await chmod(temporary, 0o755);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  } else {
    // Mise à jour, sans bloquer le démarrage si GitHub est injoignable.
    try {
      const { stdout } = await execFileAsync(target, ["-U"], { timeout: 120_000, windowsHide: true });
      const line = stdout.trim().split(/\r?\n/).at(-1);
      if (line) log(`yt-dlp : ${line}`);
    } catch (error) {
      log(`yt-dlp : mise à jour impossible (${error instanceof Error ? error.message.split("\n")[0] : error}), version actuelle conservée.`);
    }
  }
  managedYtDlp = target;
}

type Binary = {
  name: string;
  path: () => string;
  args: string[];
  env?: string;
  install: string;
  /** Absent = simple avertissement, le worker démarre quand même. */
  optional?: boolean;
};

const BINARIES: Binary[] = [
  { name: "ffmpeg", path: bin.ffmpeg, args: ["-version"], env: "FFMPEG_PATH", install: "https://ffmpeg.org/download.html (Windows : winget install Gyan.FFmpeg)" },
  { name: "ffprobe", path: bin.ffprobe, args: ["-version"], env: "FFPROBE_PATH", install: "fourni avec ffmpeg" },
  { name: "yt-dlp", path: bin.ytdlp, args: ["--version"], env: "YTDLP_PATH", install: "https://github.com/yt-dlp/yt-dlp#installation (Windows : winget install yt-dlp)" },
  {
    name: "deno",
    path: () => "deno",
    args: ["--version"],
    install: "runtime JavaScript utilisé par yt-dlp pour YouTube : https://deno.com (Windows : winget install DenoLand.Deno)",
    optional: true,
  },
];

/**
 * Vérifie que ffmpeg, ffprobe et yt-dlp sont exécutables ; lève une erreur explicite sinon.
 * Deno manquant ne bloque pas le démarrage mais est signalé (les téléchargements YouTube échoueront).
 */
export async function checkBinaries(warn: (message: string) => void = console.warn): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  const missing: string[] = [];

  for (const binary of BINARIES) {
    const command = binary.path();
    const found = await version(command, binary.args);
    if (found !== null) {
      versions[binary.name] = `${found} (${command})`;
      continue;
    }
    const message = `  - ${binary.name} (« ${command} ») : ${binary.install}${binary.env ? ` — ou indique son chemin dans ${binary.env}` : ""}`;
    if (binary.optional) warn(`⚠ Outil recommandé introuvable :\n${message}`);
    else missing.push(message);
  }

  if (missing.length > 0) {
    throw new Error(`Outils introuvables :\n${missing.join("\n")}\nInstalle-les puis relance le worker.`);
  }
  return versions;
}
