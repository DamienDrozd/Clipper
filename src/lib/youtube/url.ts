const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_FORMATS = /^\/(?:shorts|live|embed|v)\/([^/]+)/;

/**
 * Extrait le videoId d'une URL YouTube (watch?v=, youtu.be/, /shorts/, /live/, /embed/),
 * avec ou sans protocole ni paramètres supplémentaires. Accepte aussi un id nu.
 * Renvoie null si l'entrée n'est pas reconnue.
 */
export function parseYouTubeUrl(input: string): string | null {
  const raw = input.trim();
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|music\.)/, "");
  let id: string | null | undefined;

  if (host === "youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(PATH_FORMATS)?.[1];
  }

  return id && VIDEO_ID.test(id) ? id : null;
}

/** Durée ISO 8601 de l'API YouTube (ex. "PT1H2M3S", "P1DT2H") en secondes. */
export function parseIsoDuration(value: string | null | undefined): number {
  const match = value?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 0;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return ((d * 24 + h) * 60 + m) * 60 + s;
}
