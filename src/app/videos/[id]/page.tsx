import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDuration, isFinalStatus } from "@/lib/status";
import { videoVersion } from "@/lib/videos";
import { segmentsSchema } from "@/lib/transcript/types";
import { retryVideo } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { StatusPoller } from "@/components/status-poller";
import { ClipCard, ProgressBar } from "@/components/clip-card";
import { DeleteVideoButton } from "@/components/delete-video-button";

export default function VideoPage(props: PageProps<"/videos/[id]">) {
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Mes vidéos
      </Link>
      <Suspense fallback={<p className="text-sm text-muted">Chargement…</p>}>
        <VideoDetail params={props.params} />
      </Suspense>
    </div>
  );
}

async function VideoDetail({ params }: Pick<PageProps<"/videos/[id]">, "params">) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const video = await prisma.video.findFirst({
    where: { id, userId: user.id },
    include: { transcript: true, clips: { orderBy: [{ score: "desc" }, { start: "asc" }] } },
  });
  if (!video) notFound();

  const segments = video.transcript ? segmentsSchema.parse(video.transcript.segments) : [];
  const unrenderedCount = video.clips.filter((clip) => clip.renderStatus !== "DONE").length;

  return (
    <div className="space-y-6">
      {!isFinalStatus(video.status) && <StatusPoller videoId={video.id} version={videoVersion(video, video.clips)} />}

      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold">{video.title}</h1>
          <DeleteVideoButton videoId={video.id} inProgress={!isFinalStatus(video.status)} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <StatusBadge status={video.status} />
          <span>{formatDuration(video.durationSec)}</span>
          <a
            href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            Voir sur YouTube
          </a>
        </div>
        {video.status === "DOWNLOADING" && (
          <div className="max-w-sm space-y-1 text-xs text-muted">
            <p>Téléchargement de la vidéo source… {video.progress} %</p>
            <ProgressBar value={video.progress} />
          </div>
        )}
        {video.status === "RENDERING" && (
          <p className="text-xs text-muted">
            {video.clips.filter((c) => c.renderStatus === "DONE").length}/{video.clips.length} clips rendus
          </p>
        )}
      </header>

      {!isFinalStatus(video.status) && video.error && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{video.error}</p>
      )}

      {video.status === "FAILED" && (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
          <p>{video.error ?? "Le traitement a échoué."}</p>
          <form action={retryVideo.bind(null, video.id)}>
            <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 hover:bg-surface">
              Réessayer
            </button>
          </form>
        </div>
      )}

      {video.status === "DONE" && unrenderedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
          <p>{unrenderedCount} clip(s) non rendu(s).</p>
          <form action={retryVideo.bind(null, video.id)}>
            <button type="submit" className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background hover:opacity-90">
              Rendre les clips manquants
            </button>
          </form>
        </div>
      )}

      {video.clips.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Clips ({video.clips.length})</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {video.clips.map((clip, i) => (
              <ClipCard key={clip.id} clip={clip} rank={i + 1} youtubeId={video.youtubeId} segments={segments} />
            ))}
          </div>
        </section>
      )}

      {video.transcript && (
        <details className="space-y-3" open={video.clips.length === 0}>
          <summary className="cursor-pointer text-lg font-semibold">Transcription</summary>
          <p className="mt-3 text-sm text-muted">
            Piste {video.transcript.kind === "MANUAL" ? "manuelle" : "auto-générée"} ({video.transcript.language}) ·{" "}
            {segments.length} segments
          </p>
          <ol className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-sm">
            {segments.map((segment, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs leading-5 text-muted">
                  {formatDuration(segment.start)}
                </span>
                <span>{segment.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
