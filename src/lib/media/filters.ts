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

/**
 * Filtergraph vidéo 1080x1920 avec sous-titres incrustés, sortie sur [v].
 * - CENTER : la vidéo remplit l'image, recadrée au centre ;
 * - BLUR : la vidéo entière est centrée sur un fond flouté d'elle-même. Le flou est
 *   calculé en basse résolution (270x480) puis agrandi : bien plus rapide, rendu identique.
 */
export function buildVideoFilter(mode: CropMode, subtitles: { assFile: string; fontsDir: string }): string {
  const W = OUTPUT_WIDTH;
  const H = OUTPUT_HEIGHT;
  const ass = `ass=filename=${filterPath(subtitles.assFile)}:fontsdir=${filterPath(subtitles.fontsDir)}`;

  if (mode === "CENTER") {
    return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,${ass}[v]`;
  }

  return [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=10:2,scale=${W}:${H},setsar=1[bgb]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${ass}[v]`,
  ].join(";");
}
