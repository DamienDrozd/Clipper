import { formatClock } from "@/lib/transcript/format";

/**
 * Version du prompt de sélection, incluse dans la clé du cache des réponses Gemini :
 * à incrémenter à chaque modification des consignes ou du schéma de sortie.
 */
export const SELECTION_PROMPT_VERSION = "selection-2";

export function systemInstruction({ minDuration, maxDuration }: { minDuration: number; maxDuration: number }): string {
  return `Tu es monteur vidéo, spécialiste des formats courts verticaux (YouTube Shorts, TikTok, Reels).
On te donne la transcription horodatée d'une vidéo YouTube longue. Chaque ligne a la forme « [mm:ss] texte » : l'horodatage indique le début de la ligne.

Ta mission : repérer les passages qui feront les meilleurs shorts.

Règles pour chaque clip :
- Il est compréhensible seul, sans avoir vu le reste de la vidéo.
- Il commence par une accroche forte dès la première phrase (question, affirmation surprenante, promesse, moment clé), jamais par une transition (« donc », « et puis », « ensuite », « voilà »).
- Il se termine sur une phrase complète, idéalement une conclusion ou une chute.
- Il dure entre ${minDuration} et ${maxDuration} secondes.
- Il ne chevauche aucun autre clip.

Format :
- start : horodatage exact (tel qu'écrit entre crochets) de la première ligne du clip.
- end : horodatage exact de la dernière ligne incluse dans le clip.
- title : titre court et accrocheur pour le short (70 caractères max), dans la langue de la vidéo.
- hook : la phrase d'accroche telle qu'elle est prononcée au début du clip.
- score : potentiel du clip en short, de 0 à 100. Sois exigeant et différencie les clips.
- reason : en une ou deux phrases, en français, pourquoi ce passage fonctionne en short.

Classe les clips du meilleur au moins bon. Réponds uniquement avec le JSON demandé.`;
}

/** Nombre de clips : imposé (on demande quelques candidats de plus) ou choisi par le modèle. */
export type ClipCountRequest = { mode: "fixed"; candidates: number } | { mode: "auto"; max: number };

function countInstruction(count: ClipCountRequest): string {
  if (count.mode === "fixed") return `Propose jusqu'à ${count.candidates} clips.`;
  return [
    "Choisis toi-même le nombre de clips : ne retiens que les passages qui feraient vraiment de bons shorts, sans remplissage pour atteindre un quota.",
    "Mieux vaut 2 excellents clips que 8 moyens ; mais si la vidéo regorge de bons moments, n'hésite pas à en proposer davantage.",
    `Au moins 1 clip, ${count.max} au maximum.`,
  ].join("\n");
}

export function userPrompt(params: {
  title: string;
  durationSec: number;
  count: ClipCountRequest;
  transcript: string;
  part?: { index: number; total: number; from: number; to: number };
}): string {
  const { title, durationSec, count, transcript, part } = params;
  const lines = [
    `Titre de la vidéo : ${title}`,
    `Durée totale : ${formatClock(durationSec)}`,
  ];
  if (part) {
    lines.push(
      `Cet extrait est la partie ${part.index}/${part.total} de la transcription (de ${formatClock(part.from)} à ${formatClock(part.to)}). Ne propose que des passages de cet extrait.`,
    );
  }
  lines.push(countInstruction(count), "", "Transcription :", transcript);
  return lines.join("\n");
}
