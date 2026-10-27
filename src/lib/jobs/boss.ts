import { PgBoss } from "pg-boss";

export const QUEUES = {
  processVideo: "process-video",
} as const;

export type ProcessVideoJob = { videoId: string; userId: string };

const QUEUE_OPTIONS = {
  // Les erreurs sont gérées par le pipeline (statut FAILED + message) : pas de retry automatique.
  [QUEUES.processVideo]: { retryLimit: 0, expireInSeconds: 30 * 60 },
};

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
  await boss.send(QUEUES.processVideo, job, { singletonKey: job.videoId });
}
