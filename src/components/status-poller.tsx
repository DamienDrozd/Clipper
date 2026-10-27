"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 2500;

/**
 * Interroge /api/videos/[id] toutes les 2,5 s tant que le traitement est en cours,
 * et rafraîchit la page (Server Components) dès que quelque chose change.
 */
export function StatusPoller({ videoId, version }: { videoId: string; version: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { version: string } = await res.json();
        if (data.version !== version) router.refresh();
      } catch {
        // Réseau indisponible : on réessaie au prochain tick.
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [videoId, version, router]);

  return null;
}
