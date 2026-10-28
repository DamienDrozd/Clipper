-- CreateEnum
CREATE TYPE "TextsStatus" AS ENUM ('IDLE', 'PENDING', 'FAILED');

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "publishDescription" TEXT,
ADD COLUMN     "publishTitle" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "textsError" TEXT,
ADD COLUMN     "textsStatus" "TextsStatus" NOT NULL DEFAULT 'IDLE';

-- CreateTable
CREATE TABLE "ChannelSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "channelDescription" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "fixedHashtags" TEXT NOT NULL DEFAULT '',
    "appendSourceLink" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSettings_userId_key" ON "ChannelSettings"("userId");

-- AddForeignKey
ALTER TABLE "ChannelSettings" ADD CONSTRAINT "ChannelSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

