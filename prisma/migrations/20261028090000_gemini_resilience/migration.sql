-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'WAITING_RETRY';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "analysisModel" TEXT;

-- CreateTable
CREATE TABLE "LlmCache" (
    "hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCache_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "LlmCallLog" (
    "id" TEXT NOT NULL,
    "videoId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorKind" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCallLog_createdAt_idx" ON "LlmCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "LlmCallLog_model_createdAt_idx" ON "LlmCallLog"("model", "createdAt");

