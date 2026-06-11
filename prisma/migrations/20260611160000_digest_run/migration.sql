-- Unified morning digest (Task #78): one DigestRun row per cron run.
-- Shadow mode stores the composed digest + metrics WITHOUT sending, so the
-- DB digest can be diffed against the legacy CSV digest before cutover.
-- Additive only.

-- CreateTable
CREATE TABLE "DigestRun" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestRun_date_key" ON "DigestRun"("date");
