// Worker Clipper : consomme les jobs pg-boss (process séparé du serveur web).
// Lancement : npm run worker
import "dotenv/config";
import { env, geminiConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getBoss, QUEUES, type ProcessVideoJob } from "@/lib/jobs/boss";
import { checkBinaries } from "@/lib/media/binaries";
import { processVideo } from "@/lib/pipeline/process-video";

async function main() {
  env(); // échoue tôt si une variable manque
  const { model } = geminiConfig();
  console.log(`✓ Gemini : ${model}`);
  const versions = await checkBinaries();
  for (const [name, version] of Object.entries(versions)) console.log(`✓ ${name} : ${version}`);

  const boss = await getBoss("worker");

  await boss.work<ProcessVideoJob>(QUEUES.processVideo, { localConcurrency: 1 }, async ([job]) => {
    await processVideo(job.data);
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
