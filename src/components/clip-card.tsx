import type { Clip } from "@/generated/prisma/client";
import type { Segment } from "@/lib/transcript/types";
import { formatClock } from "@/lib/transcript/format";
import { downloadName, fileUrl } from "@/lib/videos";

function scoreTone(score: number) {
  if (score >= 80) return "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400";
  if (score >= 60) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "border-border bg-surface text-muted";
}

const CROP_LABELS = { BLUR: "Flou en fond", CENTER: "Crop central" } as const;

export function ClipCard({
  clip,
  rank,
  youtubeId,
  segments,
}: {
  clip: Clip;
  rank: number;
  youtubeId: string;
  segments: Segment[];
}) {
  const excerpt = segments.filter((s) => s.end > clip.start && s.start < clip.end);

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border">
      <ClipMedia clip={clip} youtubeId={youtubeId} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-snug">
            <span className="text-muted">#{rank} </span>
            {clip.title}
          </h3>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${scoreTone(clip.score)}`}
            title="Score de potentiel attribué par l'IA"
          >
            {clip.score}/100
          </span>
        </div>

        <p className="text-xs text-muted">
          {formatClock(clip.start)} → {formatClock(clip.end)} · {Math.round(clip.end - clip.start)} s ·{" "}
          {CROP_LABELS[clip.cropMode]}
        </p>

        <blockquote className="border-l-2 border-border pl-3 text-sm italic">« {clip.hook} »</blockquote>
        <p className="text-sm text-muted">{clip.reason}</p>

        {clip.renderStatus === "DONE" && clip.mp4Path && (
          <div className="flex flex-wrap gap-2">
            <a
              href={fileUrl(clip.mp4Path, downloadName(clip.title, "mp4"))}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
            >
              Télécharger MP4
            </a>
            {clip.srtPath && (
              <a
                href={fileUrl(clip.srtPath, downloadName(clip.title, "srt"))}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
              >
                SRT
              </a>
            )}
          </div>
        )}

        <details className="mt-auto text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">Transcription du passage</summary>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md bg-surface p-2">
            {excerpt.map((segment, i) => (
              <p key={i}>
                <span className="mr-2 font-mono text-xs text-muted">{formatClock(segment.start)}</span>
                {segment.text}
              </p>
            ))}
          </div>
        </details>
      </div>
    </article>
  );
}

/** Lecteur du clip rendu ; sinon état du rendu par-dessus un aperçu YouTube du passage. */
function ClipMedia({ clip, youtubeId }: { clip: Clip; youtubeId: string }) {
  if (clip.renderStatus === "DONE" && clip.mp4Path) {
    return (
      <div className="flex justify-center bg-black">
        <video
          src={fileUrl(clip.mp4Path)}
          poster={clip.thumbPath ? fileUrl(clip.thumbPath) : undefined}
          controls
          playsInline
          preload="metadata"
          className="aspect-[9/16] max-h-[28rem] w-full object-contain"
        />
      </div>
    );
  }

  const embedUrl = `https://www.youtube-nocookie.com/embed/${youtubeId}?start=${Math.floor(clip.start)}&end=${Math.ceil(clip.end)}&rel=0`;
  return (
    <div>
      <iframe
        src={embedUrl}
        title={clip.title}
        loading="lazy"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full bg-black"
      />
      <RenderState clip={clip} />
    </div>
  );
}

function RenderState({ clip }: { clip: Clip }) {
  if (clip.renderStatus === "FAILED") {
    return (
      <p className="border-t border-accent/40 bg-accent/10 px-4 py-2 text-xs">
        Rendu en échec : {clip.renderError ?? "erreur inconnue"}
      </p>
    );
  }
  if (clip.renderStatus === "RENDERING") {
    return (
      <div className="space-y-1 border-t border-border px-4 py-2 text-xs text-muted">
        <p>Rendu en cours… {clip.renderProgress} %</p>
        <ProgressBar value={clip.renderProgress} />
      </div>
    );
  }
  return (
    <p className="border-t border-border px-4 py-2 text-xs text-muted">
      {clip.renderStatus === "QUEUED" ? "En attente de rendu" : "Aperçu YouTube (pas encore rendu)"}
    </p>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-border">
      <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );
}
