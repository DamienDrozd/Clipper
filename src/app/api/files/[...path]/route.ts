import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { resolveStoragePath } from "@/lib/storage";
import { parseRange } from "@/lib/http/range";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".srt": "application/x-subrip; charset=utf-8",
  ".jpg": "image/jpeg",
};

/** `attachment` avec nom de fichier ASCII de repli + nom UTF-8 (RFC 6266 / 5987). */
function contentDisposition(filename: string): string {
  const ascii = filename.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "clip";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Sert les fichiers de STORAGE_DIR/clips/{videoId}/… à leur propriétaire, avec support des
 * requêtes Range (lecture et déplacement dans le lecteur vidéo du navigateur).
 * `?download=<nom>` force le téléchargement sous ce nom.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });

  const { path: segments } = await ctx.params;
  const [area, videoId] = segments;
  const extension = path.extname(segments.at(-1) ?? "").toLowerCase();
  const absolute = resolveStoragePath(segments.join("/"));
  if (area !== "clips" || !videoId || !absolute || !(extension in CONTENT_TYPES)) {
    return new Response("Introuvable", { status: 404 });
  }
  if ((await prisma.video.count({ where: { id: videoId, userId: user.id } })) === 0) {
    return new Response("Introuvable", { status: 404 });
  }

  let size: number;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("pas un fichier");
    size = info.size;
  } catch {
    return new Response("Introuvable", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": CONTENT_TYPES[extension],
    "Accept-Ranges": "bytes",
    // Les noms de fichiers changent à chaque rendu : contenu immuable pour une URL donnée.
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  const download = new URL(request.url).searchParams.get("download");
  if (download) headers.set("Content-Disposition", contentDisposition(download));

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  const stream = Readable.toWeb(createReadStream(absolute, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: range ? 206 : 200, headers });
}
