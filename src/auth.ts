import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { isEmailAllowed } from "@/lib/env";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  // Derrière le reverse proxy de Coolify : on fait confiance aux en-têtes Host / X-Forwarded-*.
  trustHost: true,
  providers: [
    Google({
      authorization: {
        params: {
          scope: `openid email profile ${YOUTUBE_SCOPE}`,
          // Refresh token à chaque connexion, stocké dans Account par l'adapter.
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ account, profile }) {
      if (profile?.email_verified !== true || !isEmailAllowed(profile.email)) {
        return false;
      }
      // L'écran de consentement Google permet de décocher l'accès YouTube.
      if (!account?.scope?.split(" ").includes(YOUTUBE_SCOPE)) {
        return "/login?error=MissingScope";
      }
      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // L'adapter n'écrit les tokens qu'à la première liaison du compte : on les
    // remplace à chaque connexion pour garder un refresh token valide.
    async signIn({ account }) {
      if (!account) return;
      await prisma.account.updateMany({
        where: {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
        data: {
          access_token: account.access_token,
          expires_at: account.expires_at,
          scope: account.scope,
          id_token: account.id_token,
          token_type: account.token_type,
          ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
        },
      });
    },
  },
});
