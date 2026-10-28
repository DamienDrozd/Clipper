"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { updateClipFraming } from "@/app/actions";
import {
  aspectForForegroundHeight,
  cropFromCenter,
  cropToCenter,
  foregroundHeightRatio,
  frameAspect,
  MAX_ZOOM,
  OUTPUT_ASPECT,
  type CropRect,
  type FramingMode,
} from "@/lib/clips/crop";

/** Formats proposés pour le premier plan en fond flouté (largeur/hauteur). */
const FOREGROUND_PRESETS: { label: string; aspect: number | null }[] = [
  { label: "Vidéo entière", aspect: null },
  { label: "4:3", aspect: 4 / 3 },
  { label: "1:1", aspect: 1 },
  { label: "4:5", aspect: 4 / 5 },
  { label: "3:4", aspect: 3 / 4 },
];
import { formatClock } from "@/lib/transcript/format";

type Props = {
  clipId: string;
  title: string;
  sourceUrl: string | null;
  start: number;
  end: number;
  cropMode: FramingMode;
  crop: CropRect | null;
  /** Raison pour laquelle le recadrage est indisponible (traitement en cours…). */
  disabledReason?: string;
};

export function CropEditorButton(props: Props) {
  const [open, setOpen] = useState(false);
  const reason = props.disabledReason ?? (props.sourceUrl ? undefined : "Vidéo source indisponible");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!!reason}
        title={reason}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        Recadrer
      </button>
      {open && props.sourceUrl && (
        <CropEditorDialog {...props} sourceUrl={props.sourceUrl} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

const MODES: { value: FramingMode; label: string; hint: string }[] = [
  { value: "CENTER", label: "Remplir l'écran", hint: "La zone choisie occupe tout le short." },
  {
    value: "BLUR",
    label: "Flou en fond",
    hint: "La zone choisie est centrée sur un fond flouté de l'image. Agrandis le premier plan pour réduire les bandes floues.",
  },
];

function CropEditorDialog({
  clipId,
  title,
  sourceUrl,
  start,
  end,
  cropMode,
  crop,
  onClose,
}: Props & { sourceUrl: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<FramingMode>(cropMode);
  const [aspect, setAspect] = useState<number | null>(null);
  const [center, setCenter] = useState({ cx: 0.5, cy: 0.5 });
  const [zoom, setZoom] = useState(1);
  /** Fond flouté : format de la zone (null = celui de la source, vidéo entière). */
  const [blurAspect, setBlurAspect] = useState<number | null>(null);
  const [time, setTime] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const rect = useMemo(
    () => (aspect ? cropFromCenter(mode, aspect, center, zoom, blurAspect) : null),
    [aspect, mode, center, zoom, blurAspect],
  );

  // Valeurs lues par la boucle de dessin sans la redémarrer.
  const drawState = useRef({ rect, mode });
  useEffect(() => {
    drawState.current = { rect, mode };
  }, [rect, mode]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Aperçu 9:16 dessiné en continu depuis la vidéo source.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const { rect: r, mode: m } = drawState.current;
      if (!video || !canvas || !r || video.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawPreview(ctx, canvas.width, canvas.height, video, r, m);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const sourceAspect = video.videoWidth / video.videoHeight;
    setAspect(sourceAspect);
    const initial = cropToCenter(cropMode, sourceAspect, crop);
    setCenter({ cx: initial.cx, cy: initial.cy });
    setZoom(initial.zoom);
    setBlurAspect(initial.blurAspect);
    video.currentTime = start;
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime >= end || video.currentTime < start - 0.5) video.currentTime = start;
    setTime(video.currentTime);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  /** Recentre la zone sur un point de l'image (fractions), en la gardant dans l'image. */
  const moveTo = useCallback(
    (cx: number, cy: number) => {
      if (!aspect) return;
      const r = cropFromCenter(mode, aspect, { cx, cy }, zoom, blurAspect);
      setCenter({ cx: r.x + r.w / 2, cy: r.y + r.h / 2 });
    },
    [aspect, mode, zoom, blurAspect],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage || !rect) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    const box = stage.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    const inside = px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
    // Clic hors de la zone : on la centre sur le point cliqué, puis on la fait glisser.
    const origin = inside ? { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 } : { cx: px, cy: py };
    if (!inside) moveTo(px, py);

    const onMove = (e: PointerEvent) => {
      moveTo(origin.cx + (e.clientX - event.clientX) / box.width, origin.cy + (e.clientY - event.clientY) / box.height);
    };
    const onUp = () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
  };

  const changeMode = (next: FramingMode) => {
    setMode(next);
    setZoom(1);
  };

  const reset = () => {
    setCenter({ cx: 0.5, cy: 0.5 });
    setZoom(1);
    setBlurAspect(null);
  };

  // Fond flouté : taille du premier plan, en % de la hauteur du short (bandes floues = le reste).
  const canResizeForeground = mode === "BLUR" && aspect !== null && aspect > OUTPUT_ASPECT;
  const minForeground = aspect ? Math.ceil(foregroundHeightRatio(aspect) * 100) : 100;
  const foreground = aspect ? Math.round(foregroundHeightRatio(frameAspect("BLUR", aspect, blurAspect)) * 100) : 100;
  const setForeground = (percent: number) =>
    setBlurAspect(percent <= minForeground ? null : aspectForForegroundHeight(percent / 100));

  const save = () => {
    if (!rect || !aspect) return;
    const defaultRect = cropFromCenter(mode, aspect, { cx: 0.5, cy: 0.5 }, 1);
    const isDefault = (["x", "y", "w", "h"] as const).every((k) => Math.abs(rect[k] - defaultRect[k]) < 0.001);
    setError(null);
    startSaving(async () => {
      const result = await updateClipFraming(clipId, { cropMode: mode, crop: isDefault ? null : rect });
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
      className="m-auto w-[min(64rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="space-y-4 p-4 sm:p-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Recadrer le clip</h2>
            <p className="text-sm text-muted">{title}</p>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface hover:text-foreground"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        <div className="grid gap-5 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div
              ref={stageRef}
              onPointerDown={onPointerDown}
              className="relative w-full touch-none select-none overflow-hidden rounded-md bg-black"
              style={{ aspectRatio: aspect ?? 16 / 9, cursor: rect ? "move" : "default" }}
            >
              <video
                ref={videoRef}
                src={sourceUrl}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              {rect ? (
                <div
                  className="pointer-events-none absolute border-2 border-white"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
                  }}
                />
              ) : (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                  Chargement de la vidéo source…
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                className="w-20 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
              >
                {playing ? "Pause" : "Lecture"}
              </button>
              <input
                type="range"
                min={start}
                max={end}
                step={0.1}
                value={time}
                onChange={(e) => {
                  const video = videoRef.current;
                  if (video) video.currentTime = Number(e.target.value);
                  setTime(Number(e.target.value));
                }}
                className="flex-1"
                aria-label="Position dans le clip"
              />
              <span className="w-24 text-right font-mono text-xs text-muted">
                {formatClock(time - start)} / {formatClock(end - start)}
              </span>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Mode</legend>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => changeMode(m.value)}
                    title={m.hint}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      mode === m.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border hover:bg-surface"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">{MODES.find((m) => m.value === mode)?.hint}</p>
            </fieldset>

            {canResizeForeground && aspect && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Taille du premier plan</legend>
                <div className="flex flex-wrap gap-2">
                  {FOREGROUND_PRESETS.filter((p) => p.aspect === null || p.aspect < aspect).map((preset) => {
                    const active =
                      preset.aspect === null ? blurAspect === null : blurAspect !== null && Math.abs(blurAspect - preset.aspect) < 0.01;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setBlurAspect(preset.aspect)}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-surface"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="range"
                    min={minForeground}
                    max={100}
                    step={1}
                    value={foreground}
                    onChange={(e) => setForeground(Number(e.target.value))}
                    className="flex-1"
                    aria-label="Hauteur du premier plan"
                  />
                  <span className="w-28 text-right text-xs text-muted">{foreground} % de la hauteur</span>
                </label>
                <p className="text-xs text-muted">
                  Plus le premier plan est haut, plus les bandes floues sont fines (les côtés de l&apos;image sont rognés).
                </p>
              </fieldset>
            )}

            <label className="flex items-center gap-3 text-sm">
              <span className="font-medium">Zoom</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-12 text-right font-mono text-xs text-muted">×{zoom.toFixed(2)}</span>
            </label>

            <p className="text-xs text-muted">
              Fais glisser le cadre (ou clique ailleurs dans l&apos;image) pour choisir ce que montre le short.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Aperçu</p>
            <canvas
              ref={canvasRef}
              width={270}
              height={480}
              className="mx-auto block h-[min(480px,60dvh)] w-auto rounded-md border border-border bg-black"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <footer className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={reset} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">
            Recentrer
          </button>
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
            disabled={!rect || saving}
            className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer et relancer le rendu"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

/** Reproduit le rendu ffmpeg (voir lib/media/filters) dans un canvas 9:16. */
function drawPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  video: HTMLVideoElement,
  rect: CropRect,
  mode: FramingMode,
) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = rect.x * vw;
  const sy = rect.y * vh;
  const sw = rect.w * vw;
  const sh = rect.h * vh;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  if (mode === "CENTER") {
    // Zone 9:16 étirée sur tout le canvas (même rapport, donc sans déformation).
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    // Fond : image entière en « cover », floutée.
    const cover = Math.max(width / vw, height / vh);
    ctx.filter = "blur(10px)";
    ctx.drawImage(video, (width - vw * cover) / 2, (height - vh * cover) / 2, vw * cover, vh * cover);
    ctx.filter = "none";
    // Premier plan : la zone choisie, en « contain », centrée.
    const fit = Math.min(width / sw, height / sh);
    const dw = sw * fit;
    const dh = sh * fit;
    ctx.drawImage(video, sx, sy, sw, sh, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  // Emplacement des sous-titres (bas du texte à 75 % de la hauteur, comme le fichier ASS).
  ctx.font = `bold ${Math.round(height * 0.045)}px Poppins, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, height * 0.006);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";
  ctx.strokeText("Sous-titres ici", width / 2, height * 0.75);
  ctx.fillText("Sous-titres ici", width / 2, height * 0.75);
}
