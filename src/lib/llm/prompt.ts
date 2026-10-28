import { formatClock } from "@/lib/transcript/format";

/**
 * Versions des prompts, incluses dans la clé du cache des réponses Gemini :
 * à incrémenter à chaque modification des consignes ou du schéma de sortie.
 */
export const SELECTION_PROMPT_VERSION = "selection-4";
export const TEXTS_PROMPT_VERSION = "texts-2";

// ---------------------------------------------------------------------------
// Appel 1 : sélection des clips
// ---------------------------------------------------------------------------

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
- title : titre de travail interne, court (70 caractères max), dans la langue de la vidéo.
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

// ---------------------------------------------------------------------------
// Appel 2 : textes de publication
// ---------------------------------------------------------------------------

/** Contexte de la chaîne (page Réglages), injecté dans le prompt des textes. */
export type ChannelContext = {
  channelName: string;
  channelDescription: string;
  tone: string;
  fixedHashtags: string;
};

/** Bloc « Contexte de la chaîne » du prompt, ou null si rien n'est renseigné. */
export function channelContextBlock(context: ChannelContext | null): string | null {
  if (!context) return null;
  const lines = [
    context.channelName && `- Nom de la chaîne : ${context.channelName}`,
    context.channelDescription && `- La chaîne et son public : ${context.channelDescription}`,
    context.tone && `- Ton souhaité : ${context.tone}`,
    context.fixedHashtags &&
      `- Hashtags ajoutés automatiquement à chaque description (inutile de les répéter) : ${context.fixedHashtags}`,
  ].filter(Boolean);
  return lines.length > 0 ? ["Contexte de la chaîne :", ...lines].join("\n") : null;
}

export function textsSystemInstruction(): string {
  return `Tu rédiges les textes de publication de shorts verticaux (YouTube Shorts) tirés d'une vidéo YouTube plus longue. Je publie moi-même les shorts.
On te donne, pour chaque short, son identifiant et la transcription exacte de son passage. Pour chacun, renvoie son id, publishTitle, publishDescription et tags.

Règles :
- Rédige dans la langue de la vidéo (celle de la transcription).
- publishTitle : 100 caractères maximum ; l'accroche principale doit tenir dans les 40 premiers caractères (le titre est tronqué sur mobile).
- publishDescription : 2 à 4 phrases courtes qui donnent envie de regarder, puis 3 à 5 hashtags pertinents seuls sur la dernière ligne.
- tags : 8 à 15 tags sans « # », en minuscules, du plus spécifique au plus général (sujet précis du short → thème de la vidéo → thème de la chaîne).
- Reste fidèle au contenu du short : aucune promesse que le passage ne tient pas, pas de majuscules à outrance, 1 emoji maximum.
- Appuie-toi sur les termes concrets employés dans la transcription (noms de pièces, de modèles, d'outils) : ce sont eux que les gens recherchent.
- Chaque short a ses propres textes : évite de répéter le même titre ou les mêmes formulations d'un short à l'autre.
- Tiens compte du contexte de la chaîne s'il est fourni.

Réponds uniquement avec le JSON demandé, avec une entrée par short.`;
}

export function textsUserPrompt(params: {
  videoTitle: string;
  channel: ChannelContext | null;
  clips: { id: string; title: string; transcript: string }[];
}): string {
  const context = channelContextBlock(params.channel);
  return [
    `Titre de la vidéo complète : ${params.videoTitle}`,
    ...(context ? ["", context] : []),
    ...params.clips.flatMap((clip) => ["", `=== Short ${clip.id} (titre de travail : ${clip.title}) ===`, clip.transcript]),
  ].join("\n");
}
