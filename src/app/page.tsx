import { Suspense } from "react";
import { requireUser } from "@/lib/session";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Mes vidéos</h1>
      <Suspense fallback={<p className="text-muted">Chargement…</p>}>
        <Welcome />
      </Suspense>
    </div>
  );
}

async function Welcome() {
  const user = await requireUser();
  return (
    <p className="text-muted">
      Connecté en tant que {user.name ?? user.email}. Le formulaire d&apos;URL arrive au jalon 2.
    </p>
  );
}
