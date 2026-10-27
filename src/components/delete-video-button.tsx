"use client";

import { useFormStatus } from "react-dom";
import { deleteVideo } from "@/app/actions";

export function DeleteVideoButton({ videoId, inProgress }: { videoId: string; inProgress: boolean }) {
  const message = inProgress
    ? "Supprimer cette vidéo ? Le traitement en cours sera interrompu et tout ce qui a été généré sera effacé."
    : "Supprimer cette vidéo, sa transcription et tous ses clips ?";

  return (
    <form
      action={deleteVideo.bind(null, videoId)}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-accent/40 px-3 py-1.5 text-sm text-accent hover:bg-accent/10 disabled:opacity-50"
    >
      {pending ? "Suppression…" : "Supprimer"}
    </button>
  );
}
