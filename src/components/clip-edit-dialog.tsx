"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateClip } from "@/app/actions";
import { segmentKey, type CaptionOverride } from "@/lib/captions/overrides";
import { formatClock } from "@/lib/transcript/format";
import type { Segment } from "@/lib/transcript/types";

type Props = {
  clipId: string;
  title: string;
  start: number;
  end: number;
  /** Segments de la transcription autour du clip (texte d'origine). */
  context: Segment[];
  overrides: CaptionOverride[] | null;
  sourceUrl: string | null;
  /** Durées choisies à la soumission, pour avertir (sans bloquer) si on en sort. */
  minDuration: number;
  maxDuration: number;
  disabledReason?: string;
};

export function ClipEditButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!!props.disabledReason}
        title={props.disabledReason}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        Modifier
      </button>
      {open && <ClipEditDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function ClipEditDialog({
  clipId,
  title: initialTitle,
  start: initialStart,
  end: initialEnd,
  context,
  overrides,
  sourceUrl,
  minDuration,
  maxDuration,
  onClose,
}: Props & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [title, setTitle] = useState(initialTitle);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [captions, setCaptions] = useState<Record<string, string>>(() => {
    const byKey = new Map((overrides ?? []).map((o) => [segmentKey(o), o.text]));
    return Object.fromEntries(context.map((s) => [segmentKey(s), byKey.get(segmentKey(s)) ?? s.text]));
  });
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const duration = end - start;
  const outOfRange = duration < minDuration || duration > maxDuration;

  /** Écoute le passage [from, end] dans la vidéo source. */
  const preview = (from: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = from;
    void video.play();
    setPreviewing(true);
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (video && previewing && video.currentTime >= end) {
      video.pause();
      setPreviewing(false);
    }
  };

  const save = () => {
    setError(null);
    startSaving(async () => {
      const result = await updateClip(clipId, { title, start, end, captions });
      if (result.error) setError(result.error);
      else dialogRef.current?.close();
    });
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        videoRef.current?.pause();
        onClose();
      }}
      className="m-auto w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="space-y-4 p-4 sm:p-5">
        <header className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">Modifier le clip</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface hover:text-foreground"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Titre</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <TimeField label="Début" value={start} onChange={setStart} />
              <TimeField label="Fin" value={end} onChange={setEnd} />
            </div>
            <p className={`text-sm ${outOfRange ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}>
              Durée : {round1(duration)} s
              {outOfRange && ` (hors des ${minDuration}–${maxDuration} s choisies)`}
            </p>

            {sourceUrl ? (
              <div className="space-y-2">
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  preload="metadata"
                  playsInline
                  controls
                  onTimeUpdate={onTimeUpdate}
                  onPause={() => setPreviewing(false)}
                  className="aspect-video w-full rounded-md bg-black"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => preview(start)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">
                    Écouter le passage
                  </button>
                  <button
                    type="button"
                    onClick={() => preview(Math.max(start, end - 4))}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
                  >
                    Écouter la fin
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Vidéo source indisponible : aperçu impossible.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Transcription et sous-titres</p>
            <p className="text-xs text-muted">
              Les lignes du clip sont modifiables (texte vide = ligne masquée). « Début » / « Fin » calent le clip sur une ligne.
            </p>
            <ol className="max-h-[50dvh] space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {context.map((segment) => {
                const k = segmentKey(segment);
                const inside = segment.end > start && segment.start < end;
                return (
                  <li key={k} className={`rounded px-1.5 py-1 ${inside ? "bg-surface" : "opacity-60"}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 font-mono text-xs text-muted">{formatClock(segment.start)}</span>
                      <button
                        type="button"
                        onClick={() => setStart(segment.start)}
                        className="rounded border border-border px-1.5 text-xs hover:bg-background"
                      >
                        Début
                      </button>
                      <button
                        type="button"
                        onClick={() => setEnd(segment.end)}
                        className="rounded border border-border px-1.5 text-xs hover:bg-background"
                      >
                        Fin
                      </button>
                    </div>
                    {inside ? (
                      <input
                        value={captions[k] ?? ""}
                        onChange={(e) => setCaptions((prev) => ({ ...prev, [k]: e.target.value }))}
                        maxLength={500}
                        aria-label={`Sous-titre à ${formatClock(segment.start)}`}
                        className={`mt-1 w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:border-foreground ${
                          captions[k] !== segment.text ? "border-amber-500/60" : "border-border"
                        }`}
                      />
                    ) : (
                      <p className="mt-1 text-sm">{captions[k]}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <footer className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

/** Champ de temps en secondes (au dixième), avec rappel au format mm:ss et réglage fin. */
function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const nudge = (delta: number) => onChange(Math.max(0, round1(value + delta)));
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">
        {label} <span className="font-mono text-xs text-muted">{formatClock(value)}</span>
      </span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => nudge(-0.5)} className="rounded border border-border px-1.5 py-1 text-xs hover:bg-surface">
          −0,5
        </button>
        <input
          type="number"
          step={0.1}
          min={0}
          value={round1(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground"
        />
        <button type="button" onClick={() => nudge(0.5)} className="rounded border border-border px-1.5 py-1 text-xs hover:bg-surface">
          +0,5
        </button>
      </div>
    </div>
  );
}
