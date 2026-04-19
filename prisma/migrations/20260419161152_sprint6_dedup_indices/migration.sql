-- DropIndex
DROP INDEX "AiConversation_channel_telegramChatId_idx";

-- CreateTable
CREATE TABLE "ProcessedTelegramUpdate" (
    "updateId" BIGINT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedTelegramUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
CREATE INDEX "ProcessedTelegramUpdate_processedAt_idx" ON "ProcessedTelegramUpdate"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_channel_telegramChatId_key" ON "AiConversation"("channel", "telegramChatId");
