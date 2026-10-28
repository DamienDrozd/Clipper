import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getChannelSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Mes vidéos
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Réglages</h1>
        <p className="text-sm text-muted">
          Contexte de ta chaîne, utilisé par l&apos;IA pour rédiger les titres, descriptions et tags de tes shorts.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Chargement…</p>}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  const user = await requireUser();
  return <SettingsForm values={await getChannelSettings(user.id)} />;
}
