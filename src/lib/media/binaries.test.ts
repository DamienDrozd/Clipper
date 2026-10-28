import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Simulations : processus externes, variables d'environnement, dossier de stockage ---------
const state = { ytdlpPath: "yt-dlp", root: "", inPath: false, calls: [] as string[][] };

vi.mock("node:child_process", () => ({
  execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => {
    state.calls.push([command, ...args]);
    const managed = command.endsWith(path.join("bin", "yt-dlp"));
    if (command === "yt-dlp" && state.inPath) return callback(null, { stdout: "2026.10.26\n" });
    if (managed && existsSync(command)) {
      return callback(null, { stdout: args[0] === "-U" ? "Latest version: stable@2026.10.26\n" : "2026.10.26\n" });
    }
    callback(Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" }));
  },
}));
vi.mock("@/lib/env", () => ({ env: () => ({ YTDLP_PATH: state.ytdlpPath, FFMPEG_PATH: "ffmpeg", FFPROBE_PATH: "ffprobe" }) }));
vi.mock("@/lib/storage", () => ({ storageRoot: () => state.root }));

/** Module rechargé à chaque test : la copie gérée de yt-dlp est mémorisée au niveau du module. */
const load = async () => {
  vi.resetModules();
  return import("./binaries");
};
const linux = { os: "linux" as const, arch: "x64" };

beforeEach(() => {
  state.ytdlpPath = "yt-dlp";
  state.inPath = false;
  state.calls = [];
  state.root = mkdtempSync(path.join(os.tmpdir(), "clipper-bin-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(state.root, { recursive: true, force: true });
});

describe("ytDlpReleaseUrl", () => {
  it("binaire autonome officiel pour Linux x64 et arm64", async () => {
    const { ytDlpReleaseUrl } = await load();
    expect(ytDlpReleaseUrl("linux", "x64")).toBe("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux");
    expect(ytDlpReleaseUrl("linux", "arm64")).toBe(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64",
    );
  });

  it("pas de téléchargement automatique ailleurs (installation manuelle)", async () => {
    const { ytDlpReleaseUrl } = await load();
    expect(ytDlpReleaseUrl("win32", "x64")).toBeNull();
    expect(ytDlpReleaseUrl("darwin", "arm64")).toBeNull();
    expect(ytDlpReleaseUrl("linux", "ia32")).toBeNull();
  });
});

describe("ensureYtDlp", () => {
  it("yt-dlp déjà dans le PATH : rien à faire", async () => {
    state.inPath = true;
    const { ensureYtDlp, bin } = await load();
    await ensureYtDlp(() => {}, linux);
    expect(fetch).not.toHaveBeenCalled();
    expect(bin.ytdlp()).toBe("yt-dlp");
  });

  it("premier démarrage sous Linux : télécharge la release dans STORAGE_DIR/bin et l'utilise", async () => {
    const { ensureYtDlp, bin, managedYtDlpPath } = await load();
    await ensureYtDlp(() => {}, linux);
    expect(fetch).toHaveBeenCalledWith(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
      expect.objectContaining({ redirect: "follow" }),
    );
    expect(readFileSync(managedYtDlpPath()).subarray(0, 4).toString("latin1")).toBe("\x7fELF");
    expect(existsSync(`${managedYtDlpPath()}.download`)).toBe(false);
    expect(bin.ytdlp()).toBe(managedYtDlpPath());
  });

  it("démarrages suivants : met à jour la copie gérée (yt-dlp -U) sans la retélécharger", async () => {
    const first = await load();
    await first.ensureYtDlp(() => {}, linux);
    vi.mocked(fetch).mockClear();
    state.calls = [];

    const { ensureYtDlp, bin, managedYtDlpPath } = await load();
    const logs: string[] = [];
    await ensureYtDlp((m) => logs.push(m), linux);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.calls).toContainEqual([managedYtDlpPath(), "-U"]);
    expect(logs.join("\n")).toMatch(/Latest version/);
    expect(bin.ytdlp()).toBe(managedYtDlpPath());
  });

  it("téléchargement en échec : erreur explicite", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { ensureYtDlp } = await load();
    await expect(ensureYtDlp(() => {}, linux)).rejects.toThrow(/HTTP 503/);
  });

  it("YTDLP_PATH imposé ou hors Linux : aucun téléchargement (checkBinaries signalera l'absence)", async () => {
    state.ytdlpPath = "/opt/yt-dlp";
    let module = await load();
    await module.ensureYtDlp(() => {}, linux);
    expect(fetch).not.toHaveBeenCalled();
    expect(module.bin.ytdlp()).toBe("/opt/yt-dlp");

    state.ytdlpPath = "yt-dlp";
    module = await load();
    await module.ensureYtDlp(() => {}, { os: "win32", arch: "x64" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
