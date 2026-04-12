import { prisma } from "@/lib/prisma";

export async function createDietPlan(params: {
  name: string;
  description?: string;
  meals: {
    mealType: string;
    description: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    order?: number;
  }[];
  createdById: number;
}) {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.dietPlan.create({
      data: {
        name: params.name,
        description: params.description ?? null,
        createdById: params.createdById,
        meals: {
          create: params.meals.map((meal, i) => ({
            mealType: meal.mealType,
            description: meal.description,
            calories: meal.calories ?? null,
            protein: meal.protein ?? null,
            carbs: meal.carbs ?? null,
            fat: meal.fat ?? null,
            order: meal.order ?? i,
          })),
        },
      },
      include: { meals: true },
    });

    return { success: true as const, plan };
  });
}

export async function getDietPlans(activeOnly: boolean = true) {
  return prisma.dietPlan.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: {
      _count: { select: { meals: true } },
      createdBy: { select: { firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function assignDietPlan(params: {
  userId: number;
  planId: number;
}) {
  const result = await prisma.$transaction(async (tx) => {
    // Deactivate existing active diet plans for this user
    await tx.userDietPlan.updateMany({
      where: { userId: params.userId, isActive: true },
      data: { isActive: false, endDate: new Date() },
    });

    const assignment = await tx.userDietPlan.create({
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
      type: "diet_assigned",
      title: "New diet plan assigned",
      message: result.assignment.plan?.name,
      link: "/member/diet",
    });
  } catch {}

  return result;
}

export async function getMemberDiet(userId: number) {
  const active = await prisma.userDietPlan.findFirst({
    where: { userId, isActive: true },
    include: {
      plan: {
        include: {
          meals: { orderBy: [{ mealType: "asc" }, { order: "asc" }] },
        },
      },
    },
  });

  if (!active) {
    return null;
  }

  // Group meals by type
  const mealsByType: Record<string, typeof active.plan.meals> = {};
  for (const meal of active.plan.meals) {
    if (!mealsByType[meal.mealType]) {
      mealsByType[meal.mealType] = [];
    }
    mealsByType[meal.mealType].push(meal);
  }

  return {
    planId: active.plan.id,
    planName: active.plan.name,
    description: active.plan.description,
    startDate: active.startDate,
    mealsByType,
  };
}
