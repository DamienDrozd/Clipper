// Worker Clipper : consomme les jobs pg-boss (process séparé du serveur web).
// Lancement : npm run worker
import "dotenv/config";
import { env, geminiConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getBoss, QUEUES, type ProcessVideoJob, type RenderClipJob } from "@/lib/jobs/boss";
import { checkBinaries } from "@/lib/media/binaries";
import { processVideo } from "@/lib/pipeline/process-video";
import { rerenderClip } from "@/lib/pipeline/rerender-clip";

async function main() {
  env(); // échoue tôt si une variable manque
  const gemini = geminiConfig();
  console.log(`✓ Gemini : ${gemini.models.join(" → ")} (retries ${gemini.maxRetries}, timeout ${gemini.timeoutMs / 1000} s)`);
  const versions = await checkBinaries();
  for (const [name, version] of Object.entries(versions)) console.log(`✓ ${name} : ${version}`);

  const boss = await getBoss("worker");

  await boss.work<ProcessVideoJob>(QUEUES.processVideo, { localConcurrency: 1 }, async ([job]) => {
    // Une exception ici = erreur temporaire : pg-boss replanifie le job (voir PROCESS_RETRY_POLICY).
    await processVideo(job.data, job.retryCount);
  });
  // Un rendu à la fois : deux modifications successives d'un même clip sont rendues dans l'ordre.
  await boss.work<RenderClipJob>(QUEUES.renderClip, { localConcurrency: 1 }, async ([job]) => {
    await rerenderClip(job.data, job.retryCount);
  });

  console.log("Worker prêt, en attente de jobs…");

  const shutdown = async (signal: string) => {
    console.log(`${signal} reçu, arrêt du worker…`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(`\n✗ Le worker n'a pas pu démarrer.\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
