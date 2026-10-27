"use client";

import { useActionState } from "react";
import { submitVideo, type SubmitVideoState } from "@/app/actions";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground";

export function VideoForm() {
  const [state, formAction, pending] = useActionState<SubmitVideoState, FormData>(submitVideo, {});
  const v = state.values ?? {};

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="space-y-1.5">
        <label htmlFor="url" className="text-sm font-medium">
          URL de ta vidéo YouTube
        </label>
        <input
          id="url"
          name="url"
          type="text"
          inputMode="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          defaultValue={v.url}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="Nombre de clips" htmlFor="clipCount">
          <input
            id="clipCount"
            name="clipCount"
            type="number"
            min={1}
            max={20}
            placeholder="Auto"
            title="Laisser vide pour que l'IA choisisse le nombre de clips"
            defaultValue={v.clipCount ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Durée min (s)" htmlFor="minDuration">
          <input id="minDuration" name="minDuration" type="number" min={5} max={170} defaultValue={v.minDuration ?? 20} className={inputClass} />
        </Field>
        <Field label="Durée max (s)" htmlFor="maxDuration">
          <input id="maxDuration" name="maxDuration" type="number" min={10} max={180} defaultValue={v.maxDuration ?? 60} className={inputClass} />
        </Field>
        <Field label="Langue sous-titres" htmlFor="language">
          <input id="language" name="language" type="text" defaultValue={v.language ?? "fr"} className={inputClass} />
        </Field>
        <Field label="Recadrage" htmlFor="cropMode" className="col-span-2 sm:col-span-1">
          <select id="cropMode" name="cropMode" defaultValue={v.cropMode ?? "blur"} className={inputClass}>
            <option value="blur">Flou en fond</option>
            <option value="center">Crop central</option>
          </select>
        </Field>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-foreground px-4 py-2.5 font-medium text-background hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {pending ? "Vérification…" : "Générer les clips"}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
