import { z } from "zod";

/**
 * Zone de l'image source affichée dans le short, en fractions de la largeur/hauteur source (0–1).
 * - mode CENTER (remplir l'écran) : la zone a le format 9:16 et remplit tout le short ;
 * - mode BLUR (fond flouté) : la zone garde le format de la source et s'affiche au centre,
 *   sur le fond flouté de l'image entière.
 * null = cadrage par défaut (zone centrée, sans zoom).
 */
export const cropRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.02).max(1),
    h: z.number().min(0.02).max(1),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "zone hors de l'image");

export type CropRect = z.infer<typeof cropRectSchema>;
export type FramingMode = "CENTER" | "BLUR";

export const MAX_ZOOM = 4;
export const OUTPUT_ASPECT = 9 / 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Format de la zone (largeur/hauteur en pixels). En remplissage : 9:16. En fond flouté : au choix,
 * entre celui de la source (vidéo entière, bandes floues maximales) et 9:16 (plus de bandes).
 * Le premier plan étant affiché sur toute la largeur, une zone plus haute donne une image plus
 * grande et des bandes floues plus fines.
 */
export function frameAspect(mode: FramingMode, sourceAspect: number, blurAspect?: number | null): number {
  if (mode === "CENTER") return OUTPUT_ASPECT;
  const min = Math.min(OUTPUT_ASPECT, sourceAspect);
  const max = Math.max(OUTPUT_ASPECT, sourceAspect);
  return clamp(blurAspect ?? sourceAspect, min, max);
}

/** Taille (fractions) de la zone sans zoom : la plus grande zone du format voulu dans la source. */
export function baseCropSize(
  mode: FramingMode,
  sourceAspect: number,
  blurAspect?: number | null,
): { w: number; h: number } {
  const aspect = frameAspect(mode, sourceAspect, blurAspect);
  return sourceAspect >= aspect ? { w: aspect / sourceAspect, h: 1 } : { w: 1, h: sourceAspect / aspect };
}

/**
 * Part de la hauteur du short occupée par le premier plan en mode fond flouté (0–1),
 * pour un format de zone donné : 1080 / aspect pixels sur 1920.
 */
export const foregroundHeightRatio = (aspect: number) => Math.min(1, OUTPUT_ASPECT / aspect);

/** Inverse de foregroundHeightRatio : format de zone donnant cette part de hauteur. */
export const aspectForForegroundHeight = (ratio: number) => OUTPUT_ASPECT / ratio;

/** Zone centrée sur (cx, cy) au niveau de zoom donné, maintenue dans l'image. */
export function cropFromCenter(
  mode: FramingMode,
  sourceAspect: number,
  center: { cx: number; cy: number },
  zoom: number,
  blurAspect?: number | null,
): CropRect {
  const base = baseCropSize(mode, sourceAspect, blurAspect);
  const z = clamp(zoom, 1, MAX_ZOOM);
  const w = base.w / z;
  const h = base.h / z;
  return {
    x: clamp(center.cx - w / 2, 0, 1 - w),
    y: clamp(center.cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/**
 * Inverse de cropFromCenter : centre, zoom et (en fond flouté) format d'une zone enregistrée.
 * Sans zone : centré, sans zoom, format de la source (blurAspect null).
 */
export function cropToCenter(
  mode: FramingMode,
  sourceAspect: number,
  crop: CropRect | null,
): { cx: number; cy: number; zoom: number; blurAspect: number | null } {
  if (!crop) return { cx: 0.5, cy: 0.5, zoom: 1, blurAspect: null };
  const blurAspect = mode === "BLUR" ? frameAspect(mode, sourceAspect, (crop.w / crop.h) * sourceAspect) : null;
  const base = baseCropSize(mode, sourceAspect, blurAspect);
  return {
    cx: crop.x + crop.w / 2,
    cy: crop.y + crop.h / 2,
    zoom: clamp(base.w / crop.w, 1, MAX_ZOOM),
    blurAspect,
  };
}

/** Arrondi vers l'intérieur (4 décimales) : la zone reste dans l'image une fois en pixels. */
export function roundCrop(crop: CropRect): CropRect {
  const down = (n: number) => Math.floor(n * 10_000) / 10_000;
  const w = down(crop.w);
  const h = down(crop.h);
  return { x: Math.min(down(crop.x), 1 - w), y: Math.min(down(crop.y), 1 - h), w, h };
}
