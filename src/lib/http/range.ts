export type ByteRange = { start: number; end: number };

/**
 * En-tête HTTP `Range` (une seule plage, unité bytes) → bornes incluses.
 * Renvoie null sans en-tête (fichier entier) et "unsatisfiable" pour une plage invalide (416).
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return "unsatisfiable";

  let start: number;
  let end: number;
  if (match[1] === "") {
    // "bytes=-500" : les 500 derniers octets.
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
