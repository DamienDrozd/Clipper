import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { isEmailAllowed } from "@/lib/env";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

/** Session courante, ou null. À appeler sous un <Suspense> (lecture de cookies). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Auth.js utilise crypto.getRandomValues() avant de lire les cookies : on signale
  // explicitement à Next (cacheComponents) que ce rendu dépend de la requête.
  await connection();
  const session = await auth();
  const user = session?.user;
  // Re-vérifie la liste blanche : un email retiré d'ALLOWED_EMAILS perd l'accès immédiatement.
  if (!user?.id || !user.email || !isEmailAllowed(user.email)) return null;
  return { id: user.id, email: user.email, name: user.name ?? null, image: user.image ?? null };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
