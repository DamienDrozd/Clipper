import type { Segment } from "@/lib/transcript/types";

/** Sous-titre positionné en temps relatif au début du clip (secondes). */
export type Cue = { start: number; end: number; text: string };

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Sous-titres d'un clip : segments (ou corrections manuelles, en temps absolus) qui
 * chevauchent [clipStart, clipEnd], bornés à cet intervalle et ramenés en temps relatif.
 */
export function clipCues(source: Segment[], clipStart: number, clipEnd: number): Cue[] {
  const cues: Cue[] = [];
  for (const segment of source) {
    if (segment.end <= clipStart || segment.start >= clipEnd) continue;
    const text = segment.text.trim();
    if (!text) continue;
    cues.push({
      start: round(Math.max(segment.start, clipStart) - clipStart),
      end: round(Math.min(segment.end, clipEnd) - clipStart),
      text,
    });
  }
  return cues;
}

/**
 * Découpe chaque sous-titre en blocs de 2 à 4 mots (3 visés, répartis équitablement),
 * le temps du sous-titre étant partagé entre les blocs au prorata de leur nombre de caractères.
 */
export function wordChunks(cues: Cue[]): Cue[] {
  const chunks: Cue[] = [];
  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const count = Math.ceil(words.length / 3);
    const groups: string[] = [];
    let index = 0;
    for (let i = 0; i < count; i++) {
      const size = Math.floor(words.length / count) + (i < words.length % count ? 1 : 0);
      groups.push(words.slice(index, index + size).join(" "));
      index += size;
    }

    const totalChars = groups.reduce((sum, g) => sum + g.length, 0);
    const duration = cue.end - cue.start;
    let elapsedChars = 0;
    for (const group of groups) {
      const start = cue.start + (duration * elapsedChars) / totalChars;
      elapsedChars += group.length;
      const end = cue.start + (duration * elapsedChars) / totalChars;
      chunks.push({ start: round(start), end: round(end), text: group });
    }
  }
  return chunks;
}

// --- ASS ---------------------------------------------------------------------

/** Police embarquée (assets/fonts) : nom de famille tel qu'enregistré dans le fichier TTF. */
export const SUBTITLE_FONT = "Poppins";

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Neutralise les caractères de contrôle ASS ({…} = balises, \N = retour à la ligne…). */
function assText(text: string): string {
  return text.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Fichier ASS 1080x1920 : texte gras blanc à contour noir, centré horizontalement,
 * bas du texte à 480 px du bas de l'image (tiers inférieur, sous la vidéo en mode flou).
 */
export function buildAss(chunks: Cue[]): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${SUBTITLE_FONT},96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,480,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = chunks
    .filter((chunk) => chunk.end > chunk.start)
    .map((chunk) => `Dialogue: 0,${assTime(chunk.start)},${assTime(chunk.end)},Default,,0,0,0,,${assText(chunk.text)}`);
  return [...header, ...events, ""].join("\n");
}

// --- SRT ---------------------------------------------------------------------

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** SRT du clip, une entrée par sous-titre (phrases complètes, plus lisible à l'import). */
export function buildSrt(cues: Cue[]): string {
  return cues
    .filter((cue) => cue.end > cue.start)
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`)
    .join("\n");
}
