import { PgBoss } from "pg-boss";

export const QUEUES = {
  processVideo: "process-video",
  renderClip: "render-clip",
} as const;

export type ProcessVideoJob = {
  videoId: string;
  userId: string;
  /** Ignorer le cache des réponses Gemini (« Régénérer la sélection »). */
  bypassCache?: boolean;
};
/** Nouveau rendu d'un seul clip (après recadrage, etc.). */
export type RenderClipJob = { clipId: string; videoId: string };

/** Durée max d'un job (téléchargement d'une longue vidéo + rendu de tous les clips). */
const JOB_TIMEOUT_SECONDS = 4 * 3600;

const QUEUE_OPTIONS = {
  [QUEUES.processVideo]: { expireInSeconds: JOB_TIMEOUT_SECONDS },
  [QUEUES.renderClip]: { expireInSeconds: JOB_TIMEOUT_SECONDS },
};

/**
 * Reprises longues du pipeline d'une vidéo, quand une étape échoue sur une erreur temporaire
 * malgré les retries courts (toute la chaîne Gemini surchargée, réseau…) : la vidéo passe en
 * WAITING_RETRY et pg-boss replanifie le job. Délai exponentiel avec aléa calculé par pg-boss :
 * ~5–10 min, 10–20 min, 20–40 min, puis 40–60 min. Le pipeline relance l'erreur pour
 * déclencher la reprise, ou passe la vidéo en FAILED si l'erreur est définitive.
 * Options passées à l'envoi de chaque job : une file existante ne reprend pas ses options.
 */
export const PROCESS_RETRY_POLICY = { retryLimit: 4, retryDelay: 300, retryBackoff: true, retryDelayMax: 3600 } as const;
export const MAX_PROCESS_ATTEMPTS = PROCESS_RETRY_POLICY.retryLimit + 1;

/** Reprises du rendu d'un seul clip (téléchargement de la source) : plus rapprochées. */
export const RENDER_RETRY_POLICY = { retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 } as const;
export const MAX_RENDER_ATTEMPTS = RENDER_RETRY_POLICY.retryLimit + 1;

/** Délai maximal (s) avant la reprise suivante d'un rendu, pour l'afficher (formule de pg-boss). */
export function renderRetryDelayUpperBound(retryCount: number): number {
  return Math.min(RENDER_RETRY_POLICY.retryDelayMax, RENDER_RETRY_POLICY.retryDelay * 2 ** (retryCount + 1));
}

type Role = "web" | "worker";

const globalForBoss = globalThis as unknown as { bossPromise?: Promise<PgBoss> };

/**
 * Instance pg-boss partagée. Côté web, elle sert seulement à envoyer des jobs :
 * la maintenance et la planification tournent dans le worker.
 */
export function getBoss(role: Role = "web"): Promise<PgBoss> {
  globalForBoss.bossPromise ??= (async () => {
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      supervise: role === "worker",
      schedule: role === "worker",
    });
    boss.on("error", (error) => console.error("[pg-boss]", error));
    await boss.start();
    for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
      await boss.createQueue(name, options);
    }
    return boss;
  })().catch((error) => {
    globalForBoss.bossPromise = undefined;
    throw error;
  });
  return globalForBoss.bossPromise;
}

export async function enqueueProcessVideo(job: ProcessVideoJob): Promise<void> {
  const boss = await getBoss();
  // singletonKey = videoId : clé de recherche (findJobs, annulation). Dans une file « standard »,
  // elle n'empêche pas les doublons : l'interface évite d'en créer.
  await boss.send(QUEUES.processVideo, job, {
    singletonKey: job.videoId,
    expireInSeconds: JOB_TIMEOUT_SECONDS,
    ...PROCESS_RETRY_POLICY,
  });
}

/** Heure de la prochaine reprise planifiée par pg-boss pour une vidéo en WAITING_RETRY. */
export async function getNextRetryAt(videoId: string): Promise<Date | null> {
  const boss = await getBoss();
  const jobs = await boss.findJobs(QUEUES.processVideo, { key: videoId, queued: true });
  const times = jobs.filter((job) => job.state === "retry").map((job) => new Date(job.startAfter).getTime());
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

/**
 * Met un clip en file pour un nouveau rendu. Pas de singletonKey : si l'utilisateur modifie
 * encore le clip pendant un rendu, un second rendu doit suivre (le worker relit le clip en
 * base au démarrage du job, et traite ces jobs un par un).
 */
export async function enqueueRenderClip(job: RenderClipJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.renderClip, job, { expireInSeconds: JOB_TIMEOUT_SECONDS, ...RENDER_RETRY_POLICY });
}

/**
 * Annule les jobs d'une vidéo encore en file. Un job déjà démarré n'est pas interrompu
 * par pg-boss : le pipeline détecte lui-même la suppression (voir watchDeletion).
 */
export async function cancelVideoJobs(videoId: string): Promise<void> {
  const boss = await getBoss();
  const [processJobs, renderJobs] = await Promise.all([
    boss.findJobs(QUEUES.processVideo, { key: videoId, queued: true }),
    boss.findJobs(QUEUES.renderClip, { data: { videoId }, queued: true }),
  ]);
  if (processJobs.length > 0) await boss.cancel(QUEUES.processVideo, processJobs.map((job) => job.id));
  if (renderJobs.length > 0) await boss.cancel(QUEUES.renderClip, renderJobs.map((job) => job.id));
}
