"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";

export async function getMyDiet() {
  const session = await requireMember();
  const userId = parseInt(session.user.id);

  const assignment = await prisma.userDietPlan.findFirst({
    where: { userId, isActive: true },
    include: {
      plan: {
        include: {
          meals: { orderBy: [{ mealType: "asc" }, { order: "asc" }] },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  if (!assignment) return null;

  // Group meals by type
  const mealsByType: Record<
    string,
    {
      description: string;
      calories: number | null;
      protein: number | null;
      carbs: number | null;
      fat: number | null;
    }[]
  > = {};

  for (const meal of assignment.plan.meals) {
    if (!mealsByType[meal.mealType]) mealsByType[meal.mealType] = [];
    mealsByType[meal.mealType].push({
      description: meal.description,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
    });
  }

  return {
    planName: assignment.plan.name,
    description: assignment.plan.description,
    startDate: assignment.startDate.toISOString(),
    mealsByType,
  };
}
