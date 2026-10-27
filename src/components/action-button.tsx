"use client";

import { useState, useTransition } from "react";

/**
 * Bouton qui appelle une server action renvoyant `{ error? }`, avec confirmation optionnelle
 * et affichage de l'erreur.
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  disabledReason,
  variant = "secondary",
}: {
  action: () => Promise<{ error?: string }>;
  label: string;
  pendingLabel: string;
  confirm?: string;
  disabledReason?: string;
  variant?: "primary" | "secondary";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending || !!disabledReason}
        title={disabledReason}
        className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
          variant === "primary"
            ? "bg-foreground font-medium text-background hover:opacity-90"
            : "border border-border hover:bg-surface"
        }`}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="text-xs text-accent">{error}</span>}
    </span>
  );
}
