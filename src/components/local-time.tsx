"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Heure (HH:MM) dans le fuseau du navigateur. Le serveur ne connaît pas ce fuseau : rien n'est
 * affiché pendant le rendu serveur, l'heure apparaît à l'hydratation.
 */
export function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    () => null,
  );
  return <time dateTime={iso}>{text ?? "…"}</time>;
}
