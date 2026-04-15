import { prisma } from "@/lib/prisma";

export type SatisfactionBreakdown = {
  attendance: { score: number; visits: number; expected: number };
  payment: { score: number; onTime: number; total: number };
  feedback: { score: number; avgRating: number; count: number };
  tenure: { score: number; months: number };
  engagement: { score: number; classBookings: number; facilityBookings: number };
};

export type SatisfactionResult = {
  score: number; // 0-100
  breakdown: SatisfactionBreakdown;
  riskLevel: "low" | "medium" | "high";
};

export async function computeSatisfactionScore(userId: number): Promise<SatisfactionResult> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    attendanceCount,
    user,
    tickets,
    feedbacks,
    classBookingCount,
    facilityBookingCount,
  ] = await Promise.all([
    // Attendance in last 30 days
    prisma.attendanceLog.count({
      where: { userId, checkIn: { gte: thirtyDaysAgo } },
    }),
    // User creation date
    prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    }),
    // All tickets with due date info
    prisma.memberTicket.findMany({
      where: { userId },
      select: {
        buyDate: true,
        dueDate: true,
        payments: { select: { createdAt: true } },
      },
    }),
    // Feedback ratings
    prisma.feedback.findMany({
      where: { userId },
      select: { rating: true },
    }),
    // Class bookings
    prisma.classBooking.count({ where: { userId } }),
    // Facility bookings
    prisma.facilityBooking.count({ where: { userId } }),
  ]);

  // --- Attendance (30% weight) ---
  // 4 visits/week ideal = ~17 visits in 30 days
  const expectedVisits = 17;
  const attendanceRaw = Math.min(100, Math.round((attendanceCount / expectedVisits) * 100));
  const attendanceBreakdown = { score: attendanceRaw, visits: attendanceCount, expected: expectedVisits };

  // --- Payment timeliness (25% weight) ---
  let onTimePayments = 0;
  let totalPayments = 0;
  for (const ticket of tickets) {
    for (const payment of ticket.payments) {
      totalPayments++;
      // If no dueDate, count as on-time; otherwise compare payment date to dueDate
      if (!ticket.dueDate || payment.createdAt <= ticket.dueDate) {
        onTimePayments++;
      }
    }
  }
  const paymentRaw = totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 100) : 50; // neutral if no payments
  const paymentBreakdown = { score: paymentRaw, onTime: onTimePayments, total: totalPayments };

  // --- Feedback (20% weight) ---
  let avgRating = 0;
  let feedbackRaw = 50; // neutral default
  if (feedbacks.length > 0) {
    avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;
    // Rating 1-5 mapped to 0-100
    feedbackRaw = Math.round(((avgRating - 1) / 4) * 100);
  }
  const feedbackBreakdown = { score: feedbackRaw, avgRating: Math.round(avgRating * 10) / 10, count: feedbacks.length };

  // --- Tenure (15% weight) ---
  const memberSince = user?.createdAt ?? now;
  const months = Math.max(0, (now.getTime() - memberSince.getTime()) / (30.44 * 24 * 60 * 60 * 1000));
  const tenureRaw = Math.min(100, Math.round((months / 24) * 100)); // cap at 24 months
  const tenureBreakdown = { score: tenureRaw, months: Math.round(months * 10) / 10 };

  // --- Engagement (10% weight) ---
  const totalBookings = classBookingCount + facilityBookingCount;
  const engagementRaw = Math.min(100, Math.round((totalBookings / 10) * 100)); // cap at 10
  const engagementBreakdown = { score: engagementRaw, classBookings: classBookingCount, facilityBookings: facilityBookingCount };

  // --- Weighted total ---
  const score = Math.round(
    attendanceRaw * 0.3 +
    paymentRaw * 0.25 +
    feedbackRaw * 0.2 +
    tenureRaw * 0.15 +
    engagementRaw * 0.1
  );

  const riskLevel: SatisfactionResult["riskLevel"] =
    score > 70 ? "low" : score >= 40 ? "medium" : "high";

  return {
    score,
    breakdown: {
      attendance: attendanceBreakdown,
      payment: paymentBreakdown,
      feedback: feedbackBreakdown,
      tenure: tenureBreakdown,
      engagement: engagementBreakdown,
    },
    riskLevel,
  };
}
