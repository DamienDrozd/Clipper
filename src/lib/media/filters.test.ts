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

  it("mode CENTER avec zone : crop de la zone avant mise à l'échelle", () => {
    expect(buildVideoFilter("CENTER", subtitles, { x: 0.1, y: 0, w: 0.31640625, h: 1 })).toBe(
      "[0:v]crop=w=iw*0.3164:h=ih*1.0000:x=iw*0.1000:y=ih*0.0000," +
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1," +
        "ass=filename='/data/a.ass':fontsdir='/app/fonts'[v]",
    );
  });

  it("mode BLUR avec zone : seule la vidéo du premier plan est recadrée", () => {
    const graph = buildVideoFilter("BLUR", subtitles, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(graph).toContain("[fg]crop=w=iw*0.5000:h=ih*0.5000:x=iw*0.2500:y=ih*0.2500,scale=");
    expect(graph).toMatch(/\[bg\]scale=/);
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
