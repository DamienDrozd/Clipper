import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDuration } from "@/lib/status";
import { VideoForm } from "@/components/video-form";
import { StatusBadge } from "@/components/status-badge";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Nouvelle vidéo</h1>
        <VideoForm />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Mes vidéos</h2>
        <Suspense fallback={<p className="text-sm text-muted">Chargement…</p>}>
          <VideoList />
        </Suspense>
      </section>
    </div>
  );
}

async function VideoList() {
  const user = await requireUser();
  const videos = await prisma.video.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clips: true } } },
  });

  if (videos.length === 0) {
    return <p className="text-sm text-muted">Aucune vidéo traitée pour l&apos;instant.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {videos.map((video) => (
        <li key={video.id}>
          <Link href={`/videos/${video.id}`} className="flex items-center gap-3 p-3 hover:bg-surface">
            <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded bg-surface sm:w-36">
              {video.thumbnailUrl && (
                <Image src={video.thumbnailUrl} alt="" fill sizes="144px" className="object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium">{video.title}</p>
              <p className="text-xs text-muted">
                {formatDuration(video.durationSec)} · {video._count.clips} clip(s) ·{" "}
                {video.createdAt.toLocaleDateString("fr-FR")}
              </p>
              <StatusBadge status={video.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
