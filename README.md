# Clipper

Application web perso : colle l'URL d'une de tes vidéos YouTube, Clipper récupère la transcription,
Gemini repère les meilleurs passages et l'app génère des shorts verticaux 9:16 sous-titrés.

> README provisoire (jalon 1). La version complète (ffmpeg, yt-dlp, worker, Coolify) arrive au jalon 5.

## Stack

Next.js 16 (App Router, Cache Components) · Prisma 7 (driver adapter `pg`) · Auth.js v5 (Google) ·
PostgreSQL · pg-boss · Gemini (`@google/genai`) · ffmpeg / yt-dlp.

## Configuration Google Cloud

1. Dans [Google Cloud Console](https://console.cloud.google.com/), crée (ou choisis) un projet.
2. **API et services → Bibliothèque** : active **YouTube Data API v3**.
3. **API et services → Écran de consentement OAuth** (« Google Auth Platform ») :
   - type d'utilisateur **Externe** ;
   - ajoute le scope `https://www.googleapis.com/auth/youtube.force-ssl` (accès aux pistes de sous-titres) ;
   - ajoute ton adresse dans les **utilisateurs de test**.
   - ⚠️ Tant que l'application est en statut **« Test »**, Google fait expirer les refresh tokens au bout de
     **7 jours** (il faudra se reconnecter). Pour un usage durable, passe-la **« En production »** : sans
     validation Google, tu verras juste un avertissement « application non validée » à la connexion.
4. **Identifiants → Créer des identifiants → ID client OAuth**, type **Application Web** :
   - URI de redirection autorisé (local) : `http://localhost:3000/api/auth/callback/google`
   - URI de redirection autorisé (prod) : `https://ton-domaine/api/auth/callback/google`
5. Copie l'ID et le secret dans `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

## Lancement en local

```bash
npm install                 # lance aussi `prisma generate`
cp .env.example .env        # puis remplis les valeurs
npx auth secret             # génère AUTH_SECRET (ou : openssl rand -base64 33)
npm run db:migrate          # applique les migrations (prisma migrate deploy)
npm run dev
```

Ouvre http://localhost:3000 : tu es redirigé vers `/login`. Seuls les emails listés dans
`ALLOWED_EMAILS` (séparés par des virgules) peuvent se connecter.

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` / `npm run start` | build et serveur de production |
| `npm run db:migrate` | applique les migrations (prod et local) |
| `npm run db:migrate:dev` | crée une nouvelle migration après modification du schéma |
| `npm run typecheck` / `npm run lint` / `npm test` | vérifications |
