export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;

export type CropMode = "CENTER" | "BLUR";

/**
 * Chemin utilisable comme valeur d'option dans un filtergraph ffmpeg, y compris sous
 * Windows (« C:\… ») : barres obliques, « : » échappé pour le parseur d'options, le tout
 * entre apostrophes pour le parseur de filtergraph.
 */
export function filterPath(filePath: string): string {
  if (filePath.includes("'")) {
    throw new Error(`Chemin non supporté par ffmpeg (apostrophe) : ${filePath}`);
  }
  return `'${filePath.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
}

/** Zone de la source à garder, en fractions (voir CropRect dans lib/clips/crop). */
export type CropArea = { x: number; y: number; w: number; h: number };

/** Filtre crop ffmpeg d'une zone en fractions de l'image (iw/ih = taille source). */
function cropFilter({ x, y, w, h }: CropArea): string {
  const n = (value: number) => value.toFixed(4);
  return `crop=w=iw*${n(w)}:h=ih*${n(h)}:x=iw*${n(x)}:y=ih*${n(y)}`;
}

/**
 * Filtergraph vidéo 1080x1920 avec sous-titres incrustés, sortie sur [v].
 * - CENTER : la zone choisie (9:16) remplit l'image ; sans zone, recadrage central ;
 * - BLUR : la zone choisie (toute l'image par défaut) est centrée sur un fond flouté de
 *   l'image entière. Le flou est calculé en basse résolution (270x480) puis agrandi :
 *   bien plus rapide, rendu identique.
 */
export function buildVideoFilter(
  mode: CropMode,
  subtitles: { assFile: string; fontsDir: string },
  crop: CropArea | null = null,
): string {
  const W = OUTPUT_WIDTH;
  const H = OUTPUT_HEIGHT;
  const ass = `ass=filename=${filterPath(subtitles.assFile)}:fontsdir=${filterPath(subtitles.fontsDir)}`;
  const area = crop ? `${cropFilter(crop)},` : "";

  if (mode === "CENTER") {
    // Le scale+crop final absorbe les écarts d'arrondi si la zone n'est pas exactement 9:16.
    return `[0:v]${area}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,${ass}[v]`;
  }

  return [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=10:2,scale=${W}:${H},setsar=1[bgb]`,
    `[fg]${area}scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${ass}[v]`,
  ].join(";");
}
