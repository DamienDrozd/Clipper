# Clipper

Application web perso pour transformer ses vidéos YouTube longues en shorts verticaux : on colle
l'URL d'une de **ses** vidéos, Clipper récupère la transcription, Gemini repère les meilleurs
passages, puis l'app génère des clips 9:16 sous-titrés, prêts à télécharger.

- Usage mono-utilisateur, limité aux emails de `ALLOWED_EMAILS` et aux vidéos de sa propre chaîne.
- Entrée : une URL YouTube (pas d'upload). Sortie : MP4 + SRT à télécharger (pas de publication).

## Fonctionnalités

- **Soumission** : URL (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`…) + options : nombre de clips
  (vide = l'IA décide), durées min/max (20–60 s par défaut), langue des sous-titres (`fr`),
  recadrage (flou en fond par défaut).
- **Contrôle de propriété** : la vidéo doit appartenir à la chaîne du compte Google connecté.
- **Transcription** via l'API YouTube (piste manuelle dans la langue voulue > manuelle autre langue >
  auto-générée), mise en cache en base.
- **Sélection par Gemini** (sortie JSON structurée), puis calage sur la transcription, durées
  min/max, sans chevauchement, triés par score.
- **Rendu ffmpeg** : 1080x1920, H.264 + AAC, sous-titres incrustés (blocs de 2 à 4 mots), SRT et
  miniature. Deux modes : *remplir l'écran* (crop 9:16) ou *flou en fond* (vidéo entière sur fond flouté).
- **Édition de chaque clip** : début/fin (avec la transcription autour et l'écoute du passage),
  correction des sous-titres, titre, recadrage manuel (zone et zoom, aperçu en direct), nouveau rendu.
- **Régénérer la sélection** : relance seulement l'analyse Gemini (transcription et vidéo en cache).
- Suivi en direct (statut, progression), retry automatique des erreurs passagères, suppression
  d'une vidéo même en cours de traitement.

## Architecture

```
Navigateur ──► Next.js (web)  ── server actions, pages, /api/files (Range), /api/videos/[id] (polling)
                  │   ▲
                  ▼   │ PostgreSQL : données (Prisma) + file de jobs (pg-boss, schéma « pgboss »)
                  │   │
             Worker (npm run worker) ── API YouTube · Gemini · yt-dlp · ffmpeg
                  │
                  ▼
             STORAGE_DIR (sources/, clips/) ◄── lu par le web, écrit par le worker
```

- **Web** (`npm run start`) : interface, authentification, mise en file des jobs. Aucun traitement
  long dans une requête HTTP.
- **Worker** (`npm run worker`, process séparé) : files pg-boss `process-video` (transcription →
  analyse → téléchargement → rendu) et `render-clip` (nouveau rendu d'un clip).
- Statuts d'une vidéo : `PENDING → FETCHING_TRANSCRIPT → ANALYZING → DOWNLOADING → RENDERING → DONE | FAILED`,
  avec `WAITING_RETRY` en cas d'échec temporaire (reprise automatique planifiée).

Stack : Next.js 16 (App Router, Cache Components) · Prisma 7 (adapter `pg`) · Auth.js v5 (Google) ·
PostgreSQL · pg-boss · Gemini (`@google/genai`) · googleapis · ffmpeg · yt-dlp · zod · vitest.

## Prérequis

- **Node.js ≥ 22.12** et **PostgreSQL** (14 ou plus).
- Pour le worker : **ffmpeg** (avec `libass` et `libx264`) et **ffprobe**, **yt-dlp**, **Deno**
  (runtime JavaScript que yt-dlp utilise pour YouTube).

```bash
# Windows
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
winget install DenoLand.Deno

# Debian / Ubuntu
sudo apt install ffmpeg
sudo curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
sudo chmod a+rx /usr/local/bin/yt-dlp
curl -fsSL https://deno.land/install.sh | sh
```

Le worker vérifie ces outils au démarrage et s'arrête avec un message explicite s'il en manque un.
Si plusieurs ffmpeg sont installés (sous Windows, ImageMagick en fournit un ancien), indique le bon
avec `FFMPEG_PATH` / `FFPROBE_PATH` / `YTDLP_PATH`. Mets yt-dlp à jour régulièrement (`yt-dlp -U`) :
YouTube change souvent ses protections.

## Configuration Google Cloud

1. Dans [Google Cloud Console](https://console.cloud.google.com/), crée (ou choisis) un projet.
2. **API et services → Bibliothèque** : active **YouTube Data API v3**.
3. **Google Auth Platform → Écran de consentement / Audience** :
   - type d'utilisateur **Externe** ;
   - dans **Accès aux données**, ajoute le scope `https://www.googleapis.com/auth/youtube.force-ssl`
     (nécessaire pour télécharger les pistes de sous-titres) ;
   - ajoute ton adresse dans les **utilisateurs de test**.
   - ⚠️ En statut **« Test »**, Google fait expirer les refresh tokens au bout de **7 jours** (il faut
     alors se reconnecter). Pour un usage durable, passe l'application **« En production »** : sans
     validation Google, un avertissement « application non validée » s'affiche à la connexion, il
     suffit de continuer.
4. **Clients → Créer un client**, type **Application Web**, avec les URI de redirection autorisés :
   - local : `http://localhost:3000/api/auth/callback/google`
   - production : `https://ton-domaine/api/auth/callback/google`
5. Copie l'ID client et le secret dans `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

À la connexion, Clipper demande un accès hors ligne (`access_type=offline`, `prompt=consent`) : le
refresh token est stocké en base et rafraîchi automatiquement (le worker en a besoin). Si l'accès
est révoqué, l'interface demande de se reconnecter.

**Quota YouTube** : 10 000 unités par jour par défaut ; une vidéo en consomme environ 252
(`videos.list` + `channels.list` : 2, `captions.list` : 50, `captions.download` : 200). La
transcription est mise en cache et n'est jamais retéléchargée.

## Clé Gemini

Crée une clé sur [Google AI Studio](https://aistudio.google.com/apikey) et renseigne `GEMINI_API_KEY`.
Les modèles sont listés dans `GEMINI_MODELS`, dans l'ordre d'essai (le premier est le principal,
les suivants servent de secours). Tous les appels passent par `src/lib/llm/gemini-client.ts` :

- **retries courts** par modèle sur les erreurs temporaires (503/500, timeout, réseau), avec backoff
  exponentiel et jitter ; sur un 429, attente du délai conseillé par l'API ;
- **bascule** sur le modèle suivant si le modèle reste surchargé ou limité (même prompt, même schéma,
  même validation) ;
- **coupe-circuit** : un modèle qui enchaîne les 503 est écarté quelques minutes ;
- **arrêt immédiat** sur un quota journalier ou un plafond de dépenses atteint, une clé ou un modèle
  invalide, ou un contenu refusé ;
- **reprise longue** : si toute la chaîne échoue sur des erreurs temporaires, la vidéo passe
  « En attente de nouvelle tentative » et pg-boss relance le traitement environ 5, 10, 20 puis
  40 minutes plus tard (heure affichée dans l'interface, bouton « Relancer maintenant ») ;
- **cache** : une réponse validée est réutilisée pour une requête identique (même transcription,
  options et version du prompt) ; « Régénérer la sélection » force un nouvel appel ;
- **journal** : chaque tentative est enregistrée dans la table `LlmCallLog` (modèle, type d'erreur,
  code HTTP, durée, tokens) et dans les logs du worker. Exemple pour suivre les 503 :

```sql
SELECT date_trunc('hour', "createdAt") AS heure, model,
       count(*) FILTER (WHERE "errorKind" = 'OVERLOADED') AS surcharges,
       count(*) AS appels
FROM "LlmCallLog"
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

Les réglages (retries, délais, timeout, coupe-circuit) sont documentés dans [.env.example](.env.example).

## Variables d'environnement

Voir [.env.example](.env.example).

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | URL PostgreSQL (`postgresql://user:mdp@hôte:5432/clipper?schema=public`) |
| `AUTH_SECRET` | secret Auth.js (`npx auth secret` ou `openssl rand -base64 33`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | client OAuth Google |
| `ALLOWED_EMAILS` | emails autorisés à se connecter, séparés par des virgules |
| `GEMINI_API_KEY` / `GEMINI_MODELS` | clé et chaîne de modèles Gemini (obligatoires pour le worker) |
| `GEMINI_MAX_RETRIES`, `GEMINI_BACKOFF_*`, `GEMINI_TIMEOUT_MS`, `GEMINI_BREAKER_*` | *optionnel* : réglages de la couche d'appel Gemini |
| `STORAGE_DIR` | dossier des fichiers (sources, rendus), partagé par le web et le worker |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH` | *optionnel* : chemins des binaires (défaut : PATH) |
| `YTDLP_COOKIES` | *optionnel* : fichier `cookies.txt` pour yt-dlp (voir plus bas) |

## Lancement en local

```bash
npm install                 # lance aussi `prisma generate`
cp .env.example .env        # puis remplis les valeurs
npm run db:migrate          # applique les migrations (prisma migrate deploy)
npm run dev                 # terminal 1 : http://localhost:3000
npm run worker              # terminal 2 : worker
```

Seuls les emails de `ALLOWED_EMAILS` peuvent se connecter.

### Migrations Prisma

- `npm run db:migrate` (`prisma migrate deploy`) applique les migrations du dossier
  `prisma/migrations` : à lancer après chaque mise à jour, en local comme en production.
- Après une modification de `prisma/schema.prisma`, `npm run db:migrate:dev` crée une nouvelle
  migration (nécessite une base de développement).

### Tests

```bash
npm test            # vitest : parsing d'URL et de VTT, post-traitement, sous-titres, filtres ffmpeg…
npm run typecheck
npm run lint
```

## Déploiement sur Coolify

Le web et le worker sont deux processus séparés, construits depuis le même dépôt. Sur Coolify, on
crée donc **deux ressources** (build pack **Nixpacks**, pas de Dockerfile) qui partagent la même
base PostgreSQL et le même dossier de stockage.

Le fichier [nixpacks.toml](nixpacks.toml) installe ffmpeg, Deno et la dernière version de yt-dlp
dans les deux images.

### 1. Base de données

Crée une base PostgreSQL (ressource Coolify ou serveur existant) et note son URL.

### 2. Dossier de stockage partagé

Les fichiers sont écrits par le worker et servis par le web : les deux conteneurs doivent monter
le **même dossier de l'hôte**. Sur le serveur :

```bash
sudo mkdir -p /data/clipper
```

Dans chaque ressource : **Persistent Storage → Add → Directory Mount**, source `/data/clipper`,
destination `/data/clipper`. Puis `STORAGE_DIR=/data/clipper` dans les variables des deux ressources.

### 3. Ressource « web »

- Source : ce dépôt Git, build pack **Nixpacks**.
- Build : `npm run build` · Start : `npm run start` · Port exposé : `3000`.
- **Pre-deployment command** : `npx prisma migrate deploy` (migrations appliquées à chaque déploiement).
- Domaine : `https://ton-domaine` (ajoute l'URI de redirection Google correspondante).
- Variables : toutes celles du tableau ci-dessus.

### 4. Ressource « worker »

- Même dépôt, build pack **Nixpacks**.
- Start : `npm run worker` · pas de domaine ni de port exposé (désactive le health check HTTP).
- Variables : les mêmes que le web (au minimum `DATABASE_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
  `AUTH_SECRET`, `ALLOWED_EMAILS`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `STORAGE_DIR`, et
  `YTDLP_COOKIES` si besoin).
- Les logs de démarrage affichent la version de chaque outil (`✓ ffmpeg : …`).

Un seul worker suffit (les rendus sont faits un par un, ffmpeg utilise déjà tous les cœurs).
L'arrêt est propre (`SIGTERM` : le job en cours se termine ou sera repris).

### Points à vérifier au premier déploiement

- Les dépendances de développement (Tailwind, TypeScript) servent au `next build` : si le build
  ne les trouve pas, ajoute la variable de build `NPM_CONFIG_PRODUCTION=false`.
- Si l'installation des outils via `nixpacks.toml` échoue, regarde les logs de build de Coolify ;
  le worker indique au démarrage quel outil manque.

### yt-dlp : vidéos privées et blocage « confirme que tu n'es pas un robot »

yt-dlp télécharge sans être connecté : les vidéos publiques et non répertoriées passent, pas les
privées. Depuis un serveur (IP de datacenter), YouTube exige aussi souvent une session. Dans ces cas :

1. Exporte les cookies d'une session YouTube connectée au format Netscape, par exemple depuis ton
   ordinateur : `yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download <url d'une de tes vidéos>`.
2. Copie `cookies.txt` sur le serveur, par exemple dans `/data/clipper/cookies.txt`.
3. Renseigne `YTDLP_COOKIES=/data/clipper/cookies.txt` dans le worker.

Les cookies finissent par expirer : refais l'export si l'erreur revient.

## Stockage

Tout est écrit sous `STORAGE_DIR` (rien dans `public/`) et servi par `/api/files/…` au seul
propriétaire, avec support des requêtes HTTP Range (lecture et déplacement dans le lecteur) :

- `sources/{youtubeId}/source.mp4` : vidéo source (meilleur MP4 ≤ 1080p, H.264), téléchargée une
  seule fois et gardée en cache pour les rendus suivants et l'éditeur ;
- `clips/{videoId}/` : pour chaque clip, MP4 1080x1920, SRT et miniature JPG (renommés à chaque rendu).

Supprimer une vidéo dans l'interface supprime aussi ses fichiers. Compte environ 1,2 Go de source
pour une heure de vidéo en 1080p.

## Dépannage

| Message | Cause et solution |
| --- | --- |
| « L'accès à ton compte YouTube a expiré ou a été révoqué » | Déconnecte-toi puis reconnecte-toi (refresh token expiré : app Google en statut « Test » ?). |
| « Quota de l'API YouTube dépassé » | Attends minuit (heure du Pacifique). |
| « Aucune piste de sous-titres disponible » | Vidéo trop récente (sous-titres auto pas encore générés) : réessaie plus tard. |
| « Gemini est surchargé (modèles essayés : …) » | Reprise automatique planifiée ; ajoute un modèle de secours dans `GEMINI_MODELS` si ça arrive souvent. |
| « Quota Gemini atteint » | Quota journalier ou plafond de dépenses : réessaie le lendemain ou augmente le plafond. |
| « YouTube bloque le téléchargement… » / « Vidéo privée » | Configure `YTDLP_COOKIES`. |
| « yt-dlp a besoin d'un runtime JavaScript » | Installe Deno. |
| HTTP 403 au téléchargement | Mets yt-dlp à jour (`yt-dlp -U`, ou redéploie). |

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` / `npm run start` | build et serveur de production |
| `npm run worker` | worker de traitement (process séparé) |
| `npm run db:migrate` | applique les migrations |
| `npm run db:migrate:dev` | crée une migration après modification du schéma |
| `npm test` / `npm run typecheck` / `npm run lint` | vérifications |
