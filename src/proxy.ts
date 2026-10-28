import { NextResponse, type NextRequest } from "next/server";
import { withPublicUrl } from "@/lib/public-url";

// Vérification optimiste : présence du cookie de session uniquement.
// La vraie vérification (session en base + email autorisé) se fait côté serveur via `requireUser()`.
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  // URL publique : derrière le reverse proxy, request.url pointe vers localhost.
  return NextResponse.redirect(new URL("/login", withPublicUrl(request).url));
}

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
