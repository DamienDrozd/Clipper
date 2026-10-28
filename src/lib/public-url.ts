import { NextRequest } from "next/server";

/**
 * URL publique de la requête. Derrière un reverse proxy (Coolify/Traefik), `request.url` garde
 * l'hôte interne de `next start` (http://localhost:3000) : Auth.js s'en servirait pour ses
 * redirections et pour l'URL de retour envoyée à Google lors de l'échange du code, qui serait alors
 * refusé (« error=Configuration »). On la reconstruit avec X-Forwarded-Host / Host et
 * X-Forwarded-Proto, comme Auth.js le fait déjà pour les server actions (trustHost).
 * AUTH_URL, s'il est défini, reste prioritaire (Auth.js l'applique lui-même).
 */
export function withPublicUrl(request: NextRequest): NextRequest {
  if (process.env.AUTH_URL || process.env.NEXTAUTH_URL) return request;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  if (!host) return request;
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || request.nextUrl.protocol.replace(/:$/, "");
  const url = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `${protocol}://${host}`);
  return url.origin === request.nextUrl.origin ? request : new NextRequest(url, request);
}

/**
 * Redirections relatives (« /login?error=… ») ou vers l'origine interne : Next les compléterait avec
 * http://localhost:3000. On les rend absolues avec l'origine publique.
 */
export function withPublicLocation(response: Response, publicOrigin: string, internalOrigin: string): Response {
  const location = response.headers.get("location");
  if (!location || publicOrigin === internalOrigin) return response;

  let target: string | null = null;
  if (location.startsWith("/") && !location.startsWith("//")) target = `${publicOrigin}${location}`;
  else if (location === internalOrigin || location.startsWith(`${internalOrigin}/`)) {
    target = `${publicOrigin}${location.slice(internalOrigin.length)}`;
  }
  if (!target) return response;

  const rewritten = new Response(response.body, response);
  rewritten.headers.set("location", target);
  return rewritten;
}
