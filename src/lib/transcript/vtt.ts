import type { Segment } from "./types";

const TIMING =
  /^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})/;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

type Cue = { start: number; end: number; lines: string[] };

/** "01:02:03.456" ou "02:03.456" → secondes. */
export function parseTimestamp(value: string): number {
  return value
    .replace(",", ".")
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanLine(line: string): string {
  return decodeEntities(line.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function readCues(vtt: string): Cue[] {
  const cues: Cue[] = [];
  let current: Cue | null = null;

  const lines = vtt.replace(/^﻿/, "").split(/\r\n|\r|\n/);

  lines.forEach((line, i) => {
    const timing = line.match(TIMING);
    if (timing) {
      current = { start: parseTimestamp(timing[1]), end: parseTimestamp(timing[2]), lines: [] };
      cues.push(current);
      return;
    }
    if (!current) return; // en-tête WEBVTT, Kind/Language, NOTE, STYLE → ignorés
    if (TIMING.test(lines[i + 1] ?? "")) {
      // Identifiant du cue suivant (ex. "42").
      current = null;
      return;
    }
    const text = cleanLine(line);
    if (text) {
      current.lines.push(text);
    } else if (current.lines.length > 0) {
      // Une ligne vide termine le cue, sauf avant son texte : les pistes ASR placent
      // une ligne " " (souvent réduite à "" par les éditeurs) juste après l'horodatage.
      current = null;
    }
  });
  return cues;
}

/** Nombre de lignes en tête de `current` qui répètent la fin de `previous`. */
function rollingOverlap(previous: string[], current: string[]): number {
  for (let n = Math.min(previous.length, current.length); n > 0; n--) {
    if (previous.slice(-n).every((line, i) => line === current[i])) return n;
  }
  return 0;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Parse un fichier WebVTT en segments `{ start, end, text }` (secondes).
 * - supprime les balises (`<c>`, horodatages par mot `<00:00:01.234>`, `<i>`…) et décode les entités ;
 * - dédoublonne les pistes auto (ASR) « déroulantes » où chaque cue répète la ligne précédente ;
 * - retire les annotations sonores ([Musique], [Applaudissements]…) et les ♪ ;
 * - fusionne les segments identiques consécutifs et supprime les chevauchements.
 */
export function parseVtt(vtt: string): Segment[] {
  const segments: Segment[] = [];
  let previousLines: string[] = [];

  for (const cue of readCues(vtt)) {
    const fresh = cue.lines.slice(rollingOverlap(previousLines, cue.lines));
    previousLines = cue.lines;
    const last = segments.at(-1);

    // Cue qui ne fait que répéter le segment précédent (cues ASR de 10 ms, doublons
    // des pistes manuelles) : on prolonge ce segment s'il est contigu.
    if (fresh.length === 0) {
      if (last && cue.lines.join(" ") === last.text && cue.start - last.end < 0.05) {
        last.end = round(Math.max(last.end, cue.end));
      }
      continue;
    }

    const text = fresh
      .join(" ")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/♪/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || cue.end <= cue.start) continue;

    if (last && last.text === text && cue.start - last.end < 0.05) {
      last.end = round(Math.max(last.end, cue.end));
      continue;
    }
    if (last && last.end > cue.start && cue.start > last.start) {
      last.end = round(cue.start);
    }
    segments.push({ start: round(cue.start), end: round(cue.end), text });
  }
  return segments;
}
