import { describe, expect, it } from "vitest";
import { baseCropSize, cropFromCenter, cropRectSchema, cropToCenter, roundCrop } from "./crop";

const WIDE = 16 / 9;

describe("baseCropSize", () => {
  it("CENTER sur source 16:9 : bande verticale 9:16 pleine hauteur", () => {
    const { w, h } = baseCropSize("CENTER", WIDE);
    expect(h).toBe(1);
    expect(w).toBeCloseTo(0.31640625);
    // En pixels (1920x1080) : 607,5 x 1080 → 9:16.
    expect((w * 1920) / (h * 1080)).toBeCloseTo(9 / 16);
  });

  it("CENTER sur source plus verticale que 9:16 : pleine largeur", () => {
    const { w, h } = baseCropSize("CENTER", 0.5);
    expect(w).toBe(1);
    expect(h).toBeCloseTo(0.5 / (9 / 16));
  });

  it("BLUR : image entière", () => {
    expect(baseCropSize("BLUR", WIDE)).toEqual({ w: 1, h: 1 });
  });
});

describe("cropFromCenter", () => {
  it("centre par défaut", () => {
    const crop = cropFromCenter("CENTER", WIDE, { cx: 0.5, cy: 0.5 }, 1);
    expect(crop.x).toBeCloseTo(0.5 - 0.31640625 / 2);
    expect(crop.y).toBe(0);
  });

  it("reste dans l'image quand le centre est au bord", () => {
    const left = cropFromCenter("CENTER", WIDE, { cx: 0, cy: 0.5 }, 1);
    expect(left.x).toBe(0);
    const right = cropFromCenter("CENTER", WIDE, { cx: 1, cy: 0.5 }, 1);
    expect(right.x + right.w).toBeCloseTo(1);
  });

  it("le zoom réduit la zone et permet de cadrer verticalement", () => {
    const crop = cropFromCenter("BLUR", WIDE, { cx: 0.25, cy: 0.75 }, 2);
    expect(crop).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("borne le zoom entre 1 et 4", () => {
    expect(cropFromCenter("BLUR", WIDE, { cx: 0.5, cy: 0.5 }, 0.2).w).toBe(1);
    expect(cropFromCenter("BLUR", WIDE, { cx: 0.5, cy: 0.5 }, 10).w).toBe(0.25);
  });
});

describe("cropToCenter", () => {
  it("retrouve centre et zoom d'une zone", () => {
    const crop = cropFromCenter("CENTER", WIDE, { cx: 0.3, cy: 0.6 }, 2);
    const back = cropToCenter("CENTER", WIDE, crop);
    expect(back.cx).toBeCloseTo(0.3);
    expect(back.cy).toBeCloseTo(0.6);
    expect(back.zoom).toBeCloseTo(2);
  });

  it("null = centré sans zoom", () => {
    expect(cropToCenter("BLUR", WIDE, null)).toEqual({ cx: 0.5, cy: 0.5, zoom: 1 });
  });
});

describe("roundCrop", () => {
  it("arrondit vers l'intérieur et reste valide", () => {
    const crop = roundCrop({ x: 0.683593751, y: 0, w: 0.316406249, h: 1 });
    expect(crop.x + crop.w).toBeLessThanOrEqual(1);
    expect(cropRectSchema.safeParse(crop).success).toBe(true);
  });
});
