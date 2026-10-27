import { google, type youtube_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toYouTubeError } from "./errors";

/**
 * Client YouTube authentifié avec les tokens Google de l'utilisateur (table Account).
 * Le token d'accès est rafraîchi si besoin et les nouveaux tokens sont réécrits en base.
 * Utilisable depuis le serveur web comme depuis le worker.
 */
export async function getYouTubeClient(userId: string): Promise<youtube_v3.Youtube> {
  const account = await prisma.account.findFirst({ where: { userId, provider: "google" } });
  if (!account?.refresh_token) {
    throw new AppError(
      "AUTH_EXPIRED",
      "Aucun accès YouTube enregistré : déconnecte-toi puis reconnecte-toi.",
    );
  }

  const { AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET } = env();
  const oauth = new google.auth.OAuth2(AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET);
  oauth.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : null,
    scope: account.scope ?? undefined,
    // Pas de token_type : Auth.js stocke "bearer" en minuscules, que google-auth-library
    // recopie tel quel dans l'en-tête Authorization… et que Google ignore (requête vue
    // comme anonyme : « Method doesn't allow unregistered callers »). Défaut : "Bearer".
  });

  // Émis à chaque rafraîchissement (y compris pendant un job long).
  oauth.on("tokens", (tokens) => {
    prisma.account
      .update({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
        data: {
          access_token: tokens.access_token ?? undefined,
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
          ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        },
      })
      .catch((error) => console.error("[youtube] impossible d'enregistrer les tokens :", error));
  });

  // Rafraîchit maintenant si nécessaire : un refresh token révoqué donne une erreur claire
  // avant le moindre appel d'API.
  try {
    await oauth.getAccessToken();
  } catch (error) {
    throw toYouTubeError(error, "rafraîchissement du token");
  }

  return google.youtube({ version: "v3", auth: oauth });
}
