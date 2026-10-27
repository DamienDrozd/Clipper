import { describe, expect, it } from "vitest";
import { parseIsoDuration, parseYouTubeUrl } from "./url";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeUrl", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `http://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&feature=share`,
    `https://www.youtube.com/watch?feature=youtu.be&v=${ID}&t=42s&list=PL123`,
    `www.youtube.com/watch?v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=AbCdEf123&t=10`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/live/${ID}?si=xyz`,
    `https://www.youtube.com/embed/${ID}?start=30`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  https://www.youtube.com/watch?v=${ID}  `,
    ID,
  ])("extrait l'id de %s", (input) => {
    expect(parseYouTubeUrl(input)).toBe(ID);
  });

  it.each([
    "",
    "pas une url",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=trop-court",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQXX",
    "https://www.youtube.com/channel/UC1234567890",
    "https://www.youtube.com/@machaine",
    "https://youtu.be/",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
  ])("rejette %s", (input) => {
    expect(parseYouTubeUrl(input)).toBeNull();
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT45S", 45],
    ["PT3M", 180],
    ["PT1H2M3S", 3723],
    ["PT10H", 36000],
    ["P1DT2H", 93600],
    ["P0D", 0],
  ])("%s → %i s", (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });

  it("renvoie 0 pour une valeur invalide", () => {
    expect(parseIsoDuration("1:23")).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
  });
});
