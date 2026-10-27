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

/** Le fichier appartient-il à une vidéo de l'utilisateur ? clips/{videoId}/… ou sources/{youtubeId}/… */
async function isOwned(area: string | undefined, id: string | undefined, userId: string): Promise<boolean> {
  if (!id) return false;
  if (area === "clips") return (await prisma.video.count({ where: { id, userId } })) > 0;
  if (area === "sources") return (await prisma.video.count({ where: { youtubeId: id, userId } })) > 0;
  return false;
}

/**
 * Sert les fichiers de STORAGE_DIR (rendus des clips, vidéo source pour l'éditeur de cadrage)
 * à leur propriétaire, avec support des requêtes Range (lecture et déplacement dans le lecteur).
 * `?download=<nom>` force le téléchargement sous ce nom.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });

  const { path: segments } = await ctx.params;
  const [area, id] = segments;
  const extension = path.extname(segments.at(-1) ?? "").toLowerCase();
  const absolute = resolveStoragePath(segments.join("/"));
  if (!absolute || !(extension in CONTENT_TYPES) || !(await isOwned(area, id, user.id))) {
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
    // Les rendus changent de nom à chaque rendu : contenu immuable pour une URL donnée.
    // La source garde son nom (elle peut être retéléchargée après suppression) : cache court.
    "Cache-Control": area === "clips" ? "private, max-age=31536000, immutable" : "private, max-age=3600",
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
