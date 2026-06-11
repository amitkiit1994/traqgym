-- Earned Autonomy: complete the loop (outcomes, calibration, graduation state).
-- Additive only — safe on top of 20260611090000_earned_autonomy_action_loop.

-- ActionProposal: measured outcome verdict (hit | miss | unmeasurable)
ALTER TABLE "ActionProposal" ADD COLUMN "outcomeStatus" TEXT;

-- AutonomyPolicy: calibration + graduation/demotion bookkeeping
ALTER TABLE "AutonomyPolicy" ADD COLUMN "calibrationPct" DOUBLE PRECISION;
ALTER TABLE "AutonomyPolicy" ADD COLUMN "measuredCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutonomyPolicy" ADD COLUMN "graduatedAt" TIMESTAMP(3);
ALTER TABLE "AutonomyPolicy" ADD COLUMN "demotedAt" TIMESTAMP(3);
ALTER TABLE "AutonomyPolicy" ADD COLUMN "demotionReason" TEXT;
