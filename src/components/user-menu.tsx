import Link from "next/link";
import { signOut } from "@/auth";
import { getCurrentUser } from "@/lib/session";

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-muted sm:inline">{user.email}</span>
      <Link href="/settings" className="rounded-md px-2 py-1.5 hover:bg-surface">
        Réglages
      </Link>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 hover:bg-surface"
        >
          Déconnexion
        </button>
      </form>
    </div>
  );
}
