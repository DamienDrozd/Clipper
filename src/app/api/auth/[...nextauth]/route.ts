import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { withPublicLocation, withPublicUrl } from "@/lib/public-url";

/** Auth.js avec l'URL publique, derrière le reverse proxy (sinon redirections vers localhost). */
async function handle(handler: (request: NextRequest) => Promise<Response>, request: NextRequest) {
  const publicRequest = withPublicUrl(request);
  const response = await handler(publicRequest);
  return withPublicLocation(response, publicRequest.nextUrl.origin, request.nextUrl.origin);
}

export const GET = (request: NextRequest) => handle(handlers.GET, request);
export const POST = (request: NextRequest) => handle(handlers.POST, request);
