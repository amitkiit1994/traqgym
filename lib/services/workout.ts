import { prisma } from "@/lib/prisma";

export async function createWorkoutPlan(params: {
  name: string;
  description?: string;
  exercises: {
    name: string;
    sets?: number;
    reps?: number;
    weight?: number;
    day: string;
    order?: number;
    notes?: string;
  }[];
  createdById: number;
}) {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.workoutPlan.create({
      data: {
        name: params.name,
        description: params.description ?? null,
        createdById: params.createdById,
        exercises: {
          create: params.exercises.map((ex, i) => ({
            name: ex.name,
            sets: ex.sets ?? 3,
            reps: ex.reps ?? 12,
            weight: ex.weight ?? null,
            day: ex.day,
            order: ex.order ?? i,
            notes: ex.notes ?? null,
          })),
        },
      },
      include: { exercises: true },
    });

    return { success: true as const, plan };
  });
}

export async function getWorkoutPlans(activeOnly: boolean = true) {
  return prisma.workoutPlan.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: {
      _count: { select: { exercises: true } },
      createdBy: { select: { firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function assignWorkoutPlan(params: {
  userId: number;
  planId: number;
}) {
  const result = await prisma.$transaction(async (tx) => {
    // Deactivate existing active plans for this user
    await tx.userWorkoutPlan.updateMany({
      where: { userId: params.userId, isActive: true },
      data: { isActive: false, endDate: new Date() },
    });

    const assignment = await tx.userWorkoutPlan.create({
      data: {
        userId: params.userId,
        planId: params.planId,
        isActive: true,
      },
      include: { plan: { select: { name: true } } },
    });

    return { success: true as const, assignment };
  });

  // In-app notification for member (fire-and-forget, outside transaction)
  try {
    const { notifyUser } = await import("@/lib/services/in-app-notification");
    await notifyUser({
      userId: params.userId,
      type: "workout_assigned",
      title: "New workout plan assigned",
      message: result.assignment.plan?.name,
      link: "/member/workout",
    });
  } catch {}

  return result;
}

export async function getMemberWorkout(userId: number) {
  const active = await prisma.userWorkoutPlan.findFirst({
    where: { userId, isActive: true },
    include: {
      plan: {
        include: {
          exercises: { orderBy: [{ day: "asc" }, { order: "asc" }] },
        },
      },
    },
  });

  if (!active) {
    return null;
  }

  // Group exercises by day
  const exercisesByDay: Record<string, typeof active.plan.exercises> = {};
  for (const ex of active.plan.exercises) {
    if (!exercisesByDay[ex.day]) {
      exercisesByDay[ex.day] = [];
    }
    exercisesByDay[ex.day].push(ex);
  }

  return {
    planId: active.plan.id,
    planName: active.plan.name,
    description: active.plan.description,
    startDate: active.startDate,
    exercisesByDay,
  };
}
