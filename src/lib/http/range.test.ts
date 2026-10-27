import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  const size = 1000;

  it("sans en-tête : fichier entier", () => {
    expect(parseRange(null, size)).toBeNull();
  });

  it.each([
    ["bytes=0-499", { start: 0, end: 499 }],
    ["bytes=500-", { start: 500, end: 999 }],
    ["bytes=-200", { start: 800, end: 999 }],
    ["bytes=900-5000", { start: 900, end: 999 }],
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=-5000", { start: 0, end: 999 }],
  ])("%s", (header, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it.each(["bytes=1000-", "bytes=500-100", "bytes=-0", "bytes=-", "items=0-10", "bytes=0-10,20-30", "n'importe quoi"])(
    "%s → 416",
    (header) => {
      expect(parseRange(header, size)).toBe("unsatisfiable");
    },
  );
});
