"use client";

import { useActionState } from "react";
import { saveChannelSettings, type SettingsState } from "@/app/actions";
import type { ChannelSettingsValues } from "@/lib/settings";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground";

export function SettingsForm({ values }: { values: ChannelSettingsValues }) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveChannelSettings, {});

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <Field label="Nom de la chaîne" htmlFor="channelName">
        <input id="channelName" name="channelName" defaultValue={values.channelName} maxLength={200} className={inputClass} />
      </Field>

      <Field
        label="La chaîne et son public"
        htmlFor="channelDescription"
        hint="Thème, type de vidéos, public visé (ex. « menuiserie et rénovation pour bricoleurs amateurs »)."
      >
        <textarea
          id="channelDescription"
          name="channelDescription"
          defaultValue={values.channelDescription}
          maxLength={2000}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field label="Ton souhaité" htmlFor="tone" hint="Ex. « décontracté, tutoiement, pédagogique, sans exagération »." >
        <input id="tone" name="tone" defaultValue={values.tone} maxLength={500} className={inputClass} />
      </Field>

      <Field
        label="Hashtags toujours inclus"
        htmlFor="fixedHashtags"
        hint="Ajoutés automatiquement à la fin de chaque description (ex. « #menuiserie #atelier »)."
      >
        <input id="fixedHashtags" name="fixedHashtags" defaultValue={values.fixedHashtags} maxLength={500} className={inputClass} />
      </Field>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="appendSourceLink" defaultChecked={values.appendSourceLink} className="mt-0.5" />
        <span>
          Ajouter le lien vers la vidéo complète
          <span className="block text-xs text-muted">Ligne « Vidéo complète : &lt;url&gt; » en fin de description.</span>
        </span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {state.saved && !pending && <span className="text-sm text-muted">Réglages enregistrés.</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
