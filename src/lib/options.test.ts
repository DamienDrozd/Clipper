import { describe, expect, it } from "vitest";
import { autoMaxClips, videoOptionsSchema } from "./options";

describe("videoOptionsSchema — clipCount", () => {
  it("vide ou absent = automatique (null)", () => {
    expect(videoOptionsSchema.parse({ clipCount: "" }).clipCount).toBeNull();
    expect(videoOptionsSchema.parse({}).clipCount).toBeNull();
    expect(videoOptionsSchema.parse({ clipCount: null }).clipCount).toBeNull();
  });

  it("accepte un nombre (formulaire ou options déjà stockées)", () => {
    expect(videoOptionsSchema.parse({ clipCount: "7" }).clipCount).toBe(7);
    expect(videoOptionsSchema.parse({ clipCount: 5 }).clipCount).toBe(5);
  });

  it("rejette les valeurs hors bornes", () => {
    expect(videoOptionsSchema.safeParse({ clipCount: "0" }).success).toBe(false);
    expect(videoOptionsSchema.safeParse({ clipCount: "21" }).success).toBe(false);
    expect(videoOptionsSchema.safeParse({ clipCount: "abc" }).success).toBe(false);
  });
});

describe("autoMaxClips", () => {
  it("≈ 1 clip par 3 min, entre 3 et 20", () => {
    expect(autoMaxClips(60)).toBe(3);
    expect(autoMaxClips(10 * 60)).toBe(3);
    expect(autoMaxClips(20 * 60)).toBe(7);
    expect(autoMaxClips(55 * 60)).toBe(18);
    expect(autoMaxClips(3 * 3600)).toBe(20);
  });
});
