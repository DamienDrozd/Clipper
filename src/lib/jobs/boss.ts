import { PgBoss } from "pg-boss";

export const QUEUES = {
  processVideo: "process-video",
} as const;

export type ProcessVideoJob = { videoId: string; userId: string };

/** Durée max d'un job (téléchargement d'une longue vidéo + rendu de tous les clips). */
const JOB_TIMEOUT_SECONDS = 4 * 3600;

const QUEUE_OPTIONS = {
  [QUEUES.processVideo]: { expireInSeconds: JOB_TIMEOUT_SECONDS },
};

/**
 * Nouvelles tentatives automatiques des erreurs passagères (Gemini surchargé, réseau…).
 * Délai exponentiel avec aléa calculé par pg-boss : 30–60 s, 1–2 min, 2–4 min, 4–8 min.
 * Passé à l'envoi de chaque job : une file existante ne reprend pas ses options.
 * Le pipeline relance l'erreur pour déclencher le retry, ou passe la vidéo en FAILED
 * si l'erreur est définitive.
 */
export const RETRY_POLICY = { retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 } as const;
export const MAX_ATTEMPTS = RETRY_POLICY.retryLimit + 1;

/** Délai maximal (s) avant la tentative suivante, pour l'afficher (même formule que pg-boss). */
export function retryDelayUpperBound(retryCount: number): number {
  return Math.min(RETRY_POLICY.retryDelayMax, RETRY_POLICY.retryDelay * 2 ** (retryCount + 1));
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
  // singletonKey : un seul traitement en file par vidéo.
  await boss.send(QUEUES.processVideo, job, {
    singletonKey: job.videoId,
    expireInSeconds: JOB_TIMEOUT_SECONDS,
    ...RETRY_POLICY,
  });
}

/**
 * Annule les jobs d'une vidéo encore en file. Un job déjà démarré n'est pas interrompu
 * par pg-boss : le pipeline détecte lui-même la suppression (voir watchDeletion).
 */
export async function cancelVideoJobs(videoId: string): Promise<void> {
  const boss = await getBoss();
  const jobs = await boss.findJobs(QUEUES.processVideo, { key: videoId, queued: true });
  if (jobs.length > 0) {
    await boss.cancel(QUEUES.processVideo, jobs.map((job) => job.id));
  }
}
