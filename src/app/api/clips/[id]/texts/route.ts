import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getChannelSettings } from "@/lib/settings";
import { composeDescription, composePublishText, youtubeWatchUrl } from "@/lib/clips/publish";
import { downloadName } from "@/lib/videos";

/** Textes de publication d'un clip en .txt (titre, description composée, tags). */
export async function GET(_request: Request, ctx: RouteContext<"/api/clips/[id]/texts">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });

  const { id } = await ctx.params;
  const clip = await prisma.clip.findFirst({
    where: { id, video: { userId: user.id } },
    select: { title: true, publishTitle: true, publishDescription: true, tags: true, video: { select: { youtubeId: true } } },
  });
  if (!clip) return new Response("Introuvable", { status: 404 });

  const settings = await getChannelSettings(user.id);
  const text = composePublishText({
    title: clip.publishTitle ?? "(à générer)",
    description: composeDescription(clip.publishDescription ?? "", settings, youtubeWatchUrl(clip.video.youtubeId)),
    tags: clip.tags,
  });

  const filename = downloadName(clip.title, "txt");
  const ascii = filename.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "clip.txt";
  return new Response(`${text}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
