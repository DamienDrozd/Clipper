"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { regenerateClipTexts, updateClipTexts } from "@/app/actions";
import {
  composeDescription,
  composePublishText,
  TAGS_MAX_CHARS,
  TITLE_MAX,
  TITLE_VISIBLE,
  type PublishSettings,
} from "@/lib/clips/publish";

export type PublishTexts = { publishTitle: string | null; publishDescription: string | null; tags: string[] };

type Props = {
  clipId: string;
  texts: PublishTexts;
  textsStatus: "IDLE" | "PENDING" | "FAILED";
  textsError: string | null;
  settings: PublishSettings;
  videoUrl: string;
  txtUrl: string;
};

export function PublishTextsButton(props: Props) {
  const [open, setOpen] = useState(false);
  const missing = !props.texts.publishTitle;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
        title="Titre, description et tags pour YouTube"
      >
        Textes YouTube{props.textsStatus === "PENDING" ? " (génération…)" : missing ? " (à générer)" : ""}
      </button>
      {open && (
        // Remonté quand les textes changent côté serveur (régénération terminée, enregistrement).
        <PublishTextsDialog key={JSON.stringify(props.texts)} {...props} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

const tagsToText = (tags: string[]) => tags.join(", ");
const textToTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

function PublishTextsDialog({
  clipId,
  texts,
  textsStatus,
  textsError,
  settings,
  videoUrl,
  txtUrl,
  onClose,
}: Props & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(texts.publishTitle ?? "");
  const [description, setDescription] = useState(texts.publishDescription ?? "");
  const [tagsText, setTagsText] = useState(tagsToText(texts.tags));
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const tags = textToTags(tagsText);
  const fullDescription = composeDescription(description, settings, videoUrl);
  const augmented = fullDescription !== description.trim();
  const tagsChars = tags.reduce((sum, t) => sum + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
  const dirty =
    title !== (texts.publishTitle ?? "") ||
    description !== (texts.publishDescription ?? "") ||
    tagsText !== tagsToText(texts.tags);
  const generating = textsStatus === "PENDING";

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      setError("Copie impossible : le navigateur a refusé l'accès au presse-papiers.");
    }
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateClipTexts(clipId, { publishTitle: title, publishDescription: description, tags });
      if (result.error) setError(result.error);
    });
  };

  const regenerate = () => {
    if (dirty && !window.confirm("Remplacer tes modifications par de nouveaux textes générés par l'IA ?")) return;
    setError(null);
    startTransition(async () => {
      const result = await regenerateClipTexts(clipId);
      if (result.error) setError(result.error);
    });
  };

  const copyButton = (key: string, value: string, label = "Copier") => (
    <button
      type="button"
      onClick={() => copy(key, value)}
      disabled={!value}
      className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface disabled:opacity-50"
    >
      {copied === key ? "Copié !" : label}
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="space-y-4 p-4 sm:p-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Textes YouTube</h2>
            <p className="text-sm text-muted">À copier-coller lors de la publication du short.</p>
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

        {generating && (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
            Génération des textes en cours… {textsError}
          </p>
        )}
        {textsStatus === "FAILED" && textsError && (
          <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            Échec de la génération : {textsError}
          </p>
        )}
        {!texts.publishTitle && !generating && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Textes à générer : clique sur « Régénérer les textes » ou rédige-les toi-même.
          </p>
        )}

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="publishTitle" className="text-sm font-medium">
              Titre
            </label>
            <span className="flex items-center gap-2">
              <span className={`text-xs ${title.length > TITLE_MAX ? "text-accent" : "text-muted"}`}>
                {title.length}/{TITLE_MAX}
              </span>
              {copyButton("title", title)}
            </span>
          </div>
          <input
            id="publishTitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="à générer"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
          {title.length > TITLE_VISIBLE && (
            <p className="text-xs text-muted">
              Visible sur mobile : « <strong className="font-medium text-foreground">{title.slice(0, TITLE_VISIBLE)}</strong>… »
            </p>
          )}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="publishDescription" className="text-sm font-medium">
              Description
            </label>
            {copyButton("description", fullDescription)}
          </div>
          <textarea
            id="publishDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="à générer"
            rows={6}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
          {augmented && (
            <div className="text-xs text-muted">
              <p>Description publiée, avec les ajouts automatiques des réglages (c&apos;est elle qui est copiée) :</p>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-surface p-2 font-sans">{fullDescription}</pre>
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="tags" className="text-sm font-medium">
              Tags <span className="font-normal text-muted">(séparés par des virgules)</span>
            </label>
            <span className="flex items-center gap-2">
              <span className={`text-xs ${tagsChars > TAGS_MAX_CHARS ? "text-accent" : "text-muted"}`}>
                {tags.length} tags · {tagsChars}/{TAGS_MAX_CHARS}
              </span>
              {copyButton("tags", tags.join(", "))}
            </span>
          </div>
          <textarea
            id="tags"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="à générer"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
        </section>

        {error && (
          <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={regenerate}
              disabled={pending || generating}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
            >
              {generating ? "Génération…" : "Régénérer les textes"}
            </button>
            <a href={txtUrl} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">
              Télécharger .txt
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty && (
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
              >
                {pending ? "Enregistrement…" : "Enregistrer"}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                copy("all", composePublishText({ title, description: fullDescription, tags }))
              }
              disabled={!title && !description && tags.length === 0}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {copied === "all" ? "Copié !" : "Tout copier"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
