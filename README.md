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

### Worker

Les traitements longs (transcription, IA, téléchargement, rendu) tournent dans un process séparé
qui consomme la file de jobs pg-boss (stockée dans le schéma `pgboss` de la même base) :

```bash
npm run worker
```

Au démarrage, il vérifie la présence de `ffmpeg`, `ffprobe` et `yt-dlp` et s'arrête avec un
message explicite s'il en manque un. Il faut aussi **Deno**, que yt-dlp utilise pour YouTube.

```bash
# Windows
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
winget install DenoLand.Deno
# Debian / Ubuntu (ffmpeg des dépôts ; yt-dlp en binaire officiel, à jour)
sudo apt install ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
curl -fsSL https://deno.land/install.sh | sh
```

ffmpeg doit être compilé avec `libass` et `libx264` (c'est le cas des builds courants). Si plusieurs
ffmpeg sont installés (sous Windows, ImageMagick en fournit un ancien), indique le bon avec
`FFMPEG_PATH` / `FFPROBE_PATH` / `YTDLP_PATH`. Pense à mettre yt-dlp à jour régulièrement
(`yt-dlp -U`) : YouTube change souvent ses protections.

#### Vidéos privées et blocage « confirme que tu n'es pas un robot »

yt-dlp télécharge sans être connecté : les vidéos publiques et non répertoriées passent, pas les
privées. Depuis un serveur (IP de datacenter), YouTube peut aussi exiger une session. Dans ces cas,
exporte les cookies d'une session YouTube connectée au format Netscape (`cookies.txt`, par exemple
avec `yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download <url>`), copie le
fichier sur la machine du worker et indique son chemin dans `YTDLP_COOKIES`.

### Stockage

Tout est écrit sous `STORAGE_DIR` (rien dans `public/`) et servi par `/api/files/…` à l'utilisateur
connecté, avec support des requêtes Range :

- `sources/{youtubeId}/source.mp4` : vidéo source (meilleur MP4 ≤ 1080p, H.264), téléchargée une
  seule fois et gardée en cache pour les rendus suivants ;
- `clips/{videoId}/` : pour chaque clip, MP4 1080x1920 (H.264 + AAC), SRT et miniature JPG.

Supprimer une vidéo dans l'interface supprime aussi ses fichiers.

### Quota YouTube

Quota par défaut : 10 000 unités par jour. Une vidéo consomme environ 252 unités
(`videos.list` + `channels.list` : 2, `captions.list` : 50, `captions.download` : 200).
La transcription est mise en cache en base et n'est jamais retéléchargée.

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run worker` | worker de traitement (process séparé) |
| `npm run build` / `npm run start` | build et serveur de production |
| `npm run db:migrate` | applique les migrations (prod et local) |
| `npm run db:migrate:dev` | crée une nouvelle migration après modification du schéma |
| `npm run typecheck` / `npm run lint` / `npm test` | vérifications |
