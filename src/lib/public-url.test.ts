import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withPublicLocation, withPublicUrl } from "./public-url";

const request = (headers: Record<string, string>) =>
  new NextRequest("http://localhost:3000/api/auth/callback/google?code=abc&state=xyz", { headers });

afterEach(() => vi.unstubAllEnvs());

describe("withPublicUrl", () => {
  it("derrière le proxy : hôte et protocole publics, chemin et paramètres conservés", () => {
    const result = withPublicUrl(
      request({ host: "clipper.exemple.io", "x-forwarded-host": "clipper.exemple.io", "x-forwarded-proto": "https" }),
    );
    expect(result.url).toBe("https://clipper.exemple.io/api/auth/callback/google?code=abc&state=xyz");
  });

  it("sans X-Forwarded-* : utilise l'en-tête Host", () => {
    expect(withPublicUrl(request({ host: "clipper.217.154.116.90.sslip.io" })).url).toBe(
      "http://clipper.217.154.116.90.sslip.io/api/auth/callback/google?code=abc&state=xyz",
    );
  });

  it("listes séparées par des virgules (plusieurs proxys) : premier élément", () => {
    const result = withPublicUrl(
      request({ host: "interne", "x-forwarded-host": "clipper.exemple.io, interne", "x-forwarded-proto": "https,http" }),
    );
    expect(result.nextUrl.origin).toBe("https://clipper.exemple.io");
  });

  it("conserve la méthode, les en-têtes et les cookies", () => {
    const result = withPublicUrl(request({ host: "clipper.exemple.io", cookie: "authjs.pkce.code_verifier=v" }));
    expect(result.method).toBe("GET");
    expect(result.headers.get("cookie")).toBe("authjs.pkce.code_verifier=v");
  });

  it("AUTH_URL défini : requête inchangée (Auth.js l'applique lui-même)", () => {
    vi.stubEnv("AUTH_URL", "https://clipper.exemple.io");
    const original = request({ host: "autre.io" });
    expect(withPublicUrl(original)).toBe(original);
  });

  it("en local (même origine) : requête inchangée", () => {
    const original = new NextRequest("http://localhost:3000/api/auth/session", { headers: { host: "localhost:3000" } });
    expect(withPublicUrl(original)).toBe(original);
  });
});

describe("withPublicLocation", () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "set-cookie": "a=1" } });
  const internal = "http://localhost:3000";
  const publicOrigin = "https://clipper.exemple.io";

  it("redirection relative → absolue sur l'origine publique, cookies conservés", () => {
    const result = withPublicLocation(redirect("/login?error=Configuration"), publicOrigin, internal);
    expect(result.headers.get("location")).toBe("https://clipper.exemple.io/login?error=Configuration");
    expect(result.status).toBe(302);
    expect(result.headers.get("set-cookie")).toBe("a=1");
  });

  it("redirection vers l'origine interne → origine publique", () => {
    const result = withPublicLocation(redirect("http://localhost:3000/"), publicOrigin, internal);
    expect(result.headers.get("location")).toBe("https://clipper.exemple.io/");
  });

  it("redirection externe (Google) inchangée", () => {
    const google = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";
    expect(withPublicLocation(redirect(google), publicOrigin, internal).headers.get("location")).toBe(google);
  });

  it("en local (même origine) : réponse inchangée", () => {
    const original = redirect("/login");
    expect(withPublicLocation(original, internal, internal)).toBe(original);
  });
});
