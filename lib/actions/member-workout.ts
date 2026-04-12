"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";

export async function getMyWorkout() {
  const session = await requireMember();
  const userId = parseInt(session.user.id);

  const assignment = await prisma.userWorkoutPlan.findFirst({
    where: { userId, isActive: true },
    include: {
      plan: {
        include: {
          exercises: { orderBy: [{ day: "asc" }, { order: "asc" }] },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  if (!assignment) return null;

  // Group exercises by day
  const exercisesByDay: Record<
    string,
    { name: string; sets: number; reps: number; weight: number | null; notes: string | null }[]
  > = {};

  for (const ex of assignment.plan.exercises) {
    if (!exercisesByDay[ex.day]) exercisesByDay[ex.day] = [];
    exercisesByDay[ex.day].push({
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      weight: ex.weight,
      notes: ex.notes,
    });
  }

  return {
    planName: assignment.plan.name,
    description: assignment.plan.description,
    startDate: assignment.startDate.toISOString(),
    exercisesByDay,
  };
}
