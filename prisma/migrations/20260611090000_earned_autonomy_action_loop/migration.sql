-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" SERIAL NOT NULL,
    "actionType" TEXT NOT NULL,
    "gymContext" JSONB,
    "targetUserId" INTEGER,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "likelihood" DOUBLE PRECISION,
    "projectedImpactInr" INTEGER,
    "clockspeedDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "outcomeMeasuredAt" TIMESTAMP(3),
    "outcomeImpactInr" INTEGER,
    "sourceAgent" TEXT NOT NULL,
    "insightId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutonomyPolicy" (
    "id" SERIAL NOT NULL,
    "actionType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'verify',
    "approvals" INTEGER NOT NULL DEFAULT 0,
    "rejections" INTEGER NOT NULL DEFAULT 0,
    "executedCount" INTEGER NOT NULL DEFAULT 0,
    "outcomeHitRate" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutonomyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionProposal_status_createdAt_idx" ON "ActionProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProposal_actionType_idx" ON "ActionProposal"("actionType");

-- CreateIndex
CREATE UNIQUE INDEX "AutonomyPolicy_actionType_key" ON "AutonomyPolicy"("actionType");

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

