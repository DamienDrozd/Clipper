/**
 * Textes de publication d'un short (titre, description, tags) : nettoyage des propositions du LLM
 * selon les limites YouTube, et composition finale (hashtags fixes, lien vers la vidéo complète).
 * Fonctions pures, utilisables côté serveur comme côté client.
 */

export const TITLE_MAX = 100;
/** Partie du titre visible sur mobile : l'accroche doit y tenir. */
export const TITLE_VISIBLE = 40;
export const DESCRIPTION_MAX = 1000;
/** Limite YouTube du champ « tags » (tags joints par des virgules). */
export const TAGS_MAX_CHARS = 500;

/** Coupe au dernier espace avant `max` (jamais au milieu d'un mot, sauf mot unique trop long). */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const space = slice.lastIndexOf(" ");
  const cut = space > 0 ? slice.slice(0, space) : text.slice(0, max);
  return cut.replace(/[\s,;:–—-]+$/u, "");
}

/** Titre : espaces normalisés, 100 caractères max sans couper un mot. */
export function truncateTitle(title: string, max = TITLE_MAX): string {
  return cutAtWord(title.replace(/\s+/g, " ").trim(), max);
}

const HASHTAG = /#[\p{L}\p{N}_]+/u;
/** Dernière ligne « texte… #a #b » : texte et hashtags finaux. */
const TRAILING_HASHTAGS = /^(.*?[^\s#][^#]*?)\s+((?:#[\p{L}\p{N}_]+\s*)+)$/u;

/**
 * Description : 1000 caractères max, coupée proprement ; lignes vides multiples réduites ;
 * hashtags collés à la fin de la dernière phrase déplacés sur leur propre ligne.
 */
export function normalizeDescription(description: string, max = DESCRIPTION_MAX): string {
  const lines = description
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  const last = lines.at(-1) ?? "";
  const trailing = last.match(TRAILING_HASHTAGS);
  if (trailing && HASHTAG.test(trailing[2]) && !trailing[1].trim().startsWith("#")) {
    lines.splice(-1, 1, trailing[1].trim(), trailing[2].trim());
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return (breakAt > 0 ? slice.slice(0, breakAt) : text.slice(0, max)).trim();
}

/** Clé de dédoublonnage : insensible à la casse et aux accents. */
const tagKey = (tag: string) => tag.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Longueur comptée par YouTube : un tag contenant un espace est entouré de guillemets (+2). */
const youtubeTagLength = (tag: string) => tag.length + (tag.includes(" ") ? 2 : 0);

/**
 * Tags : sans « # », en minuscules, sans doublons (casse et accents ignorés), dans l'ordre reçu,
 * et coupés pour que l'ensemble joint par des virgules reste sous 500 caractères.
 */
export function normalizeTags(tags: string[], maxChars = TAGS_MAX_CHARS): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of tags) {
    const tag = raw.replace(/#/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!tag || tag.length > 100) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    const added = youtubeTagLength(tag) + (result.length > 0 ? 1 : 0); // + la virgule
    if (total + added > maxChars) break;
    seen.add(key);
    result.push(tag);
    total += added;
  }
  return result;
}

/** « #menuiserie #diy » ou « menuiserie, diy » → ["#menuiserie", "#diy"]. */
export function parseHashtags(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter(Boolean)
    .map((tag) => `#${tag}`);
}

export type PublishSettings = {
  /** Hashtags à toujours inclure (ex. « #menuiserie #atelier »). */
  fixedHashtags: string;
  /** Ajouter la ligne « Vidéo complète : <url> ». */
  appendSourceLink: boolean;
};

/**
 * Description telle qu'elle sera publiée : texte enregistré, hashtags fixes manquants ajoutés à
 * la ligne de hashtags (ou sur une nouvelle ligne), puis le lien vers la vidéo complète.
 */
export function composeDescription(description: string, settings: PublishSettings, videoUrl: string): string {
  const lines = description.trim() ? description.trim().split("\n") : [];
  const present = new Set(
    (description.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tagKey(tag)),
  );
  const missing = parseHashtags(settings.fixedHashtags).filter((tag) => !present.has(tagKey(tag)));

  if (missing.length > 0) {
    const last = lines.at(-1) ?? "";
    const lastIsHashtags = last.length > 0 && last.split(/\s+/).every((word) => word.startsWith("#"));
    if (lastIsHashtags) lines[lines.length - 1] = `${last} ${missing.join(" ")}`;
    else lines.push("", missing.join(" "));
  }
  if (settings.appendSourceLink) lines.push("", `Vidéo complète : ${videoUrl}`);
  return lines.join("\n").replace(/^\n+/, "").trim();
}

/** Bloc complet (titre, description, tags) pour « Tout copier » et le fichier .txt. */
export function composePublishText(texts: { title: string; description: string; tags: string[] }): string {
  return [`Titre :\n${texts.title}`, `Description :\n${texts.description}`, `Tags :\n${texts.tags.join(", ")}`].join("\n\n");
}

export const youtubeWatchUrl = (youtubeId: string) => `https://www.youtube.com/watch?v=${youtubeId}`;
