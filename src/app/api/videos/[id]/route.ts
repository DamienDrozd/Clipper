import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { videoVersion } from "@/lib/videos";

/** Statut d'une vidéo pour le polling du front. */
export async function GET(_request: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const video = await prisma.video.findFirst({
    where: { id, userId: user.id },
    select: {
      status: true,
      progress: true,
      error: true,
      updatedAt: true,
      clips: { select: { renderStatus: true, renderProgress: true }, orderBy: [{ score: "desc" }, { start: "asc" }] },
    },
  });
  if (!video) return Response.json({ error: "Vidéo introuvable" }, { status: 404 });

  return Response.json({
    status: video.status,
    progress: video.progress,
    error: video.error,
    version: videoVersion(video, video.clips),
  });
}
