import { prisma } from "@/lib/prisma";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";

export type HeatmapCell = { dayOfWeek: number; hour: number; count: number };
export type PeakHour = { hour: number; avgCount: number };
export type PeakDay = { dayOfWeek: number; avgCount: number };

export type AttendancePatterns = {
  heatmap: HeatmapCell[];
  peakHours: PeakHour[];
  peakDays: PeakDay[];
  totalCheckins: number;
  dateRange: { from: Date; to: Date };
};

export async function analyzeAttendancePatterns(
  locationId?: number
): Promise<AttendancePatterns> {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);

  const where: Record<string, unknown> = {
    checkIn: { gte: from, lte: now },
  };
  if (locationId) where.locationId = locationId;

  const logs = await prisma.attendanceLog.findMany({
    where,
    select: { checkIn: true },
  });

  // Build heatmap: dayOfWeek (0-6) x hour (0-23)
  const grid: Record<string, number> = {};
  for (const log of logs) {
    const d = new Date(log.checkIn);
    const dow = d.getDay();
    const hour = d.getHours();
    const key = `${dow}-${hour}`;
    grid[key] = (grid[key] || 0) + 1;
  }

  const heatmap: HeatmapCell[] = [];
  for (const [key, count] of Object.entries(grid)) {
    const [dow, hour] = key.split("-").map(Number);
    heatmap.push({ dayOfWeek: dow, hour, count });
  }

  // Peak hours: average across days that had check-ins at that hour
  const hourTotals: Record<number, number> = {};
  const hourDays: Record<number, Set<string>> = {};
  for (const log of logs) {
    const d = new Date(log.checkIn);
    const hour = d.getHours();
    const dateKey = d.toISOString().slice(0, 10);
    hourTotals[hour] = (hourTotals[hour] || 0) + 1;
    if (!hourDays[hour]) hourDays[hour] = new Set();
    hourDays[hour].add(dateKey);
  }
  const peakHours: PeakHour[] = Object.entries(hourTotals)
    .map(([h, total]) => ({
      hour: Number(h),
      avgCount: Math.round((total / (hourDays[Number(h)]?.size || 1)) * 10) / 10,
    }))
    .sort((a, b) => b.avgCount - a.avgCount);

  // Peak days: average across weeks
  const dayTotals: Record<number, number> = {};
  const dayWeeks: Record<number, Set<string>> = {};
  for (const log of logs) {
    const d = new Date(log.checkIn);
    const dow = d.getDay();
    // week key = ISO week approximation
    const weekKey = `${d.getFullYear()}-W${Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)}`;
    dayTotals[dow] = (dayTotals[dow] || 0) + 1;
    if (!dayWeeks[dow]) dayWeeks[dow] = new Set();
    dayWeeks[dow].add(weekKey);
  }
  const peakDays: PeakDay[] = Object.entries(dayTotals)
    .map(([dow, total]) => ({
      dayOfWeek: Number(dow),
      avgCount: Math.round((total / (dayWeeks[Number(dow)]?.size || 1)) * 10) / 10,
    }))
    .sort((a, b) => b.avgCount - a.avgCount);

  return {
    heatmap,
    peakHours,
    peakDays,
    totalCheckins: logs.length,
    dateRange: { from, to: now },
  };
}

export async function suggestOptimalSchedule(
  locationId?: number
): Promise<{ patterns: string; suggestions: string[] }> {
  const patterns = await analyzeAttendancePatterns(locationId);

  if (patterns.totalCheckins === 0) {
    return {
      patterns: "No attendance data found for the last 30 days.",
      suggestions: [
        "Not enough data to generate scheduling suggestions. Check back after members start checking in.",
      ],
    };
  }

  // Get current class schedules
  const where: Record<string, unknown> = { isActive: true };
  if (locationId) where.locationId = locationId;

  const classes = await prisma.gymClass.findMany({
    where,
    include: { schedules: true, instructor: true },
  });

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Build context for AI
  const topHours = patterns.peakHours.slice(0, 5);
  const topDays = patterns.peakDays.slice(0, 5);

  const classScheduleSummary = classes.map((c) => {
    const scheds = c.schedules
      .map((s) => `${dayNames[s.dayOfWeek]} ${s.startTime}-${s.endTime}`)
      .join(", ");
    return `- ${c.name} (${c.classType}): ${scheds || "No schedule"} | Instructor: ${c.instructor ? `${c.instructor.firstname} ${c.instructor.lastname}` : "None"} | Capacity: ${c.maxCapacity}`;
  });

  const prompt = `Analyze gym attendance patterns and current class schedule, then suggest optimal scheduling changes.

ATTENDANCE DATA (last 30 days, ${patterns.totalCheckins} total check-ins):

Peak hours (by avg check-ins):
${topHours.map((h) => `  ${h.hour}:00 — avg ${h.avgCount} check-ins`).join("\n")}

Peak days (by avg check-ins):
${topDays.map((d) => `  ${dayNames[d.dayOfWeek]} — avg ${d.avgCount} check-ins`).join("\n")}

CURRENT CLASS SCHEDULE (${classes.length} active classes):
${classScheduleSummary.length > 0 ? classScheduleSummary.join("\n") : "No classes scheduled."}

Provide:
1. A brief summary of the attendance patterns
2. 3-5 specific, actionable suggestions for class scheduling:
   - Best times to add new classes (match peak attendance)
   - Underutilized time slots that could be repurposed
   - Whether current classes align with peak attendance
   - Trainer assignment recommendations if applicable

Format suggestions as a numbered list, each one concise and actionable.`;

  const result = await runProactiveAgent({
    feature: "smart-scheduling",
    prompt,
    allowedToolNames: ["get_classes", "get_class_schedule"],
  });

  // Parse suggestions from AI output
  const lines = result.output.split("\n").filter((l) => l.trim());
  const suggestions: string[] = [];
  let patternSummary = "";

  let inSuggestions = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+[.)]\s/.test(trimmed)) {
      inSuggestions = true;
      suggestions.push(trimmed.replace(/^\d+[.)]\s*/, ""));
    } else if (!inSuggestions) {
      patternSummary += (patternSummary ? " " : "") + trimmed;
    }
  }

  // Fallback: if parsing didn't extract well, use full output
  if (suggestions.length === 0) {
    return {
      patterns: result.output,
      suggestions: ["See the patterns analysis above for scheduling recommendations."],
    };
  }

  return {
    patterns: patternSummary || result.output.slice(0, 500),
    suggestions,
  };
}
