import { describe, expect, it } from "vitest";
import { parseTimestamp, parseVtt } from "./vtt";

describe("parseTimestamp", () => {
  it("gère les formats avec et sans heures", () => {
    expect(parseTimestamp("00:00:01.500")).toBe(1.5);
    expect(parseTimestamp("01:02:03.456")).toBeCloseTo(3723.456);
    expect(parseTimestamp("02:03.250")).toBe(123.25);
    expect(parseTimestamp("00:00:01,500")).toBe(1.5);
  });
});

describe("parseVtt — piste manuelle", () => {
  const vtt = [
    "WEBVTT",
    "Kind: captions",
    "Language: fr",
    "",
    "NOTE ceci est un commentaire",
    "",
    "1",
    "00:00:00.000 --> 00:00:02.500",
    "Bonjour à tous,",
    "bienvenue à l&#39;atelier !",
    "",
    "2",
    "00:00:02.500 --> 00:00:05.000 align:start position:10%",
    "<i>Aujourd'hui</i> on fabrique une <b>table</b> &amp; un banc.",
    "",
    "00:00:05.000 --> 00:00:06.000",
    "[Musique]",
    "",
    "00:01:06.000 --> 00:01:08.000",
    "♪ Fin ♪",
    "",
  ].join("\r\n");

  it("parse les cues, nettoie les balises et décode les entités", () => {
    expect(parseVtt(vtt)).toEqual([
      { start: 0, end: 2.5, text: "Bonjour à tous, bienvenue à l'atelier !" },
      { start: 2.5, end: 5, text: "Aujourd'hui on fabrique une table & un banc." },
      { start: 66, end: 68, text: "Fin" },
    ]);
  });
});

describe("parseVtt — piste auto-générée (ASR) déroulante", () => {
  // Format réel des pistes ASR YouTube : chaque cue répète la ligne précédente,
  // suivie de cues de 10 ms qui ne font que figer le texte.
  // Les lignes " " (espace seul) font partie du format : on les écrit explicitement.
  const vtt = [
    "WEBVTT",
    "Kind: captions",
    "Language: fr",
    "",
    "00:00:00.160 --> 00:00:02.330 align:start position:0%",
    " ",
    "alors<00:00:00.480><c> aujourd'hui</c><00:00:00.800><c> on</c><00:00:01.120><c> va</c>",
    "",
    "00:00:02.330 --> 00:00:02.340 align:start position:0%",
    "alors aujourd'hui on va",
    " ",
    "",
    "00:00:02.340 --> 00:00:04.789 align:start position:0%",
    "alors aujourd'hui on va",
    "poncer<00:00:02.800><c> le</c><00:00:03.040><c> plateau</c>",
    "",
    "00:00:04.789 --> 00:00:04.799 align:start position:0%",
    "poncer le plateau",
    " ",
    "",
    "00:00:04.799 --> 00:00:07.000 align:start position:0%",
    "poncer le plateau",
    "[Musique]",
    "",
    "00:00:07.000 --> 00:00:09.500 align:start position:0%",
    "[Musique]",
    "avec<00:00:07.400><c> du</c><00:00:07.700><c> grain</c><00:00:08.000><c> 120</c>",
    "",
  ].join("\n");

  const expected = [
    { start: 0.16, end: 2.34, text: "alors aujourd'hui on va" },
    { start: 2.34, end: 4.799, text: "poncer le plateau" },
    { start: 7, end: 9.5, text: "avec du grain 120" },
  ];

  it("supprime les doublons et absorbe les cues de 10 ms", () => {
    expect(parseVtt(vtt)).toEqual(expected);
  });

  it("reste correct si les lignes « espace seul » ont été vidées", () => {
    expect(parseVtt(vtt.replace(/^ $/gm, ""))).toEqual(expected);
  });
});

describe("parseVtt — cas limites", () => {
  it("renvoie un tableau vide pour un fichier sans cue", () => {
    expect(parseVtt("WEBVTT\n\n")).toEqual([]);
    expect(parseVtt("")).toEqual([]);
  });

  it("fusionne les segments identiques consécutifs", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOui.\n\n00:00:02.000 --> 00:00:03.000\nOui.\n";
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 3, text: "Oui." }]);
  });

  it("supprime les chevauchements entre cues", () => {
    const vtt =
      "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nPremière phrase.\n\n00:00:03.000 --> 00:00:05.000\nDeuxième phrase.\n";
    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 3, text: "Première phrase." },
      { start: 3, end: 5, text: "Deuxième phrase." },
    ]);
  });

  it("ignore le BOM et un bloc STYLE", () => {
    const vtt = "﻿WEBVTT\n\nSTYLE\n::cue { color: red }\n\n00:00.500 --> 00:01.500\nSalut\n";
    expect(parseVtt(vtt)).toEqual([{ start: 0.5, end: 1.5, text: "Salut" }]);
  });
});
