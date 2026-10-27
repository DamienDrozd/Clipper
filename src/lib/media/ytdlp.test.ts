import { describe, expect, it } from "vitest";
import { toDownloadError } from "./ytdlp";

describe("toDownloadError", () => {
  it("blocage anti-robot : cookies nécessaires, pas de retry", () => {
    const error = toDownloadError("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies…");
    expect(error.message).toMatch(/YTDLP_COOKIES/);
    expect(error.retryable).toBe(false);
  });

  it("vidéo privée : cookies nécessaires, pas de retry", () => {
    const error = toDownloadError("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video");
    expect(error.message).toMatch(/privée/);
    expect(error.retryable).toBe(false);
  });

  it("erreurs HTTP et réseau passagères : retry", () => {
    expect(toDownloadError("ERROR: unable to download video data: HTTP Error 403: Forbidden").retryable).toBe(true);
    expect(toDownloadError("ERROR: unable to download video data: HTTP Error 503: Service Unavailable").retryable).toBe(true);
    expect(toDownloadError("ERROR: [download] Got error: The read operation timed out").retryable).toBe(true);
  });

  it("suggère la mise à jour de yt-dlp sur un 403", () => {
    expect(toDownloadError("ERROR: unable to download video data: HTTP Error 403: Forbidden").message).toMatch(/yt-dlp -U/);
  });

  it("reprend la dernière ligne ERROR sans le préfixe technique", () => {
    const error = toDownloadError("WARNING: x\nERROR: [youtube] abc123: Video unavailable");
    expect(error.message).toBe("Le téléchargement de la vidéo a échoué : Video unavailable");
    expect(error.retryable).toBe(false);
  });
});
