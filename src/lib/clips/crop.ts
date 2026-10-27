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
const OUTPUT_ASPECT = 9 / 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Taille (fractions) de la zone sans zoom, pour une source de rapport largeur/hauteur `sourceAspect`. */
export function baseCropSize(mode: FramingMode, sourceAspect: number): { w: number; h: number } {
  if (mode === "BLUR") return { w: 1, h: 1 };
  // Zone 9:16 la plus grande possible dans la source.
  return sourceAspect >= OUTPUT_ASPECT
    ? { w: OUTPUT_ASPECT / sourceAspect, h: 1 }
    : { w: 1, h: sourceAspect / OUTPUT_ASPECT };
}

/** Zone centrée sur (cx, cy) au niveau de zoom donné, maintenue dans l'image. */
export function cropFromCenter(
  mode: FramingMode,
  sourceAspect: number,
  center: { cx: number; cy: number },
  zoom: number,
): CropRect {
  const base = baseCropSize(mode, sourceAspect);
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

/** Inverse de cropFromCenter : centre et zoom d'une zone enregistrée (ou par défaut si null). */
export function cropToCenter(
  mode: FramingMode,
  sourceAspect: number,
  crop: CropRect | null,
): { cx: number; cy: number; zoom: number } {
  if (!crop) return { cx: 0.5, cy: 0.5, zoom: 1 };
  const base = baseCropSize(mode, sourceAspect);
  return {
    cx: crop.x + crop.w / 2,
    cy: crop.y + crop.h / 2,
    zoom: clamp(base.w / crop.w, 1, MAX_ZOOM),
  };
}

/** Arrondi vers l'intérieur (4 décimales) : la zone reste dans l'image une fois en pixels. */
export function roundCrop(crop: CropRect): CropRect {
  const down = (n: number) => Math.floor(n * 10_000) / 10_000;
  const w = down(crop.w);
  const h = down(crop.h);
  return { x: Math.min(down(crop.x), 1 - w), y: Math.min(down(crop.y), 1 - h), w, h };
}
