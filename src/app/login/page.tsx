import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/session";

const ERRORS: Record<string, string> = {
  AccessDenied: "Cette adresse email n'est pas autorisée à utiliser Clipper.",
  MissingScope:
    "L'accès à YouTube est nécessaire : reconnecte-toi en cochant l'autorisation YouTube sur l'écran Google.",
  Configuration: "Erreur de configuration du serveur d'authentification (voir les logs).",
};

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Connexion</h1>
        <p className="text-sm text-muted">
          Connecte-toi avec le compte Google de ta chaîne YouTube.
        </p>
      </div>
      <Suspense fallback={null}>
        <LoginStatus searchParams={props.searchParams} />
      </Suspense>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="w-full rounded-md bg-foreground px-4 py-2.5 font-medium text-background hover:opacity-90"
        >
          Se connecter avec Google
        </button>
      </form>
    </div>
  );
}

async function LoginStatus({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  if (await getCurrentUser()) redirect("/");

  const { error } = await searchParams;
  if (!error) return null;
  const code = Array.isArray(error) ? error[0] : error;

  return (
    <p role="alert" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
      {ERRORS[code] ?? "La connexion a échoué. Réessaie."}
    </p>
  );
}
