import type { Clip } from "@/generated/prisma/client";
import type { Segment } from "@/lib/transcript/types";
import { formatClock } from "@/lib/transcript/format";

function scoreTone(score: number) {
  if (score >= 80) return "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400";
  if (score >= 60) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "border-border bg-surface text-muted";
}

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
  const embedUrl = `https://www.youtube-nocookie.com/embed/${youtubeId}?start=${Math.floor(clip.start)}&end=${Math.ceil(clip.end)}&rel=0`;

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border">
      <iframe
        src={embedUrl}
        title={clip.title}
        loading="lazy"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full bg-black"
      />
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
          {formatClock(clip.start)} → {formatClock(clip.end)} · {Math.round(clip.end - clip.start)} s
        </p>

        <blockquote className="border-l-2 border-border pl-3 text-sm italic">« {clip.hook} »</blockquote>
        <p className="text-sm text-muted">{clip.reason}</p>

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
