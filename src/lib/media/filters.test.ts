import { describe, expect, it } from "vitest";
import { buildVideoFilter, filterPath } from "./filters";

describe("filterPath", () => {
  it("échappe les chemins Windows", () => {
    expect(filterPath("C:\\Users\\Moi\\Projets persos\\sub.ass")).toBe("'C\\:/Users/Moi/Projets persos/sub.ass'");
  });

  it("laisse les chemins POSIX intacts (hors guillemets)", () => {
    expect(filterPath("/srv/clipper/sub.ass")).toBe("'/srv/clipper/sub.ass'");
  });

  it("refuse les apostrophes", () => {
    expect(() => filterPath("/tmp/l'atelier/sub.ass")).toThrow();
  });
});

describe("buildVideoFilter", () => {
  const subtitles = { assFile: "/data/a.ass", fontsDir: "/app/fonts" };

  it("mode CENTER : remplissage + recadrage central", () => {
    expect(buildVideoFilter("CENTER", subtitles)).toBe(
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1," +
        "ass=filename='/data/a.ass':fontsdir='/app/fonts'[v]",
    );
  });

  it("mode BLUR : fond flouté + vidéo centrée", () => {
    const graph = buildVideoFilter("BLUR", subtitles);
    expect(graph).toContain("split=2[bg][fg]");
    expect(graph).toContain("boxblur");
    expect(graph).toContain("force_original_aspect_ratio=decrease");
    expect(graph).toContain("overlay=(W-w)/2:(H-h)/2,ass=filename='/data/a.ass'");
    expect(graph.endsWith("[v]")).toBe(true);
  });
});
