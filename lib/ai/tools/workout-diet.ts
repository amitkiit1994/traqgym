import { tool } from "@openai/agents";
import { z } from "zod";
import {
  createWorkoutPlanAction,
  assignWorkoutPlanAction,
  getMemberWorkoutAction,
} from "@/lib/actions/workout";
import {
  createDietPlanAction,
  getMemberDietAction,
} from "@/lib/actions/diet";

export const workoutDietTools = [
  tool({
    name: "create_workout_plan",
    description: "Create a new workout plan with exercises grouped by day",
    parameters: z.object({
      name: z.string().describe("Plan name"),
      description: z.string().nullable().describe("Plan description"),
      exercises: z.array(
        z.object({
          name: z.string().describe("Exercise name"),
          sets: z.number().nullable().describe("Number of sets (default 3)"),
          reps: z.number().nullable().describe("Number of reps (default 12)"),
          weight: z.number().nullable().describe("Weight in kg"),
          day: z.string().describe("Day of the week (monday, tuesday, etc.)"),
          order: z.number().nullable().describe("Display order within the day"),
          notes: z.string().nullable().describe("Additional notes"),
        })
      ).describe("List of exercises"),
      createdById: z.number().describe("Worker ID creating the plan"),
    }),
    async execute(input) {
      const result = await createWorkoutPlanAction({
        name: input.name,
        description: input.description ?? undefined,
        exercises: input.exercises.map((ex) => ({
          name: ex.name,
          sets: ex.sets ?? undefined,
          reps: ex.reps ?? undefined,
          weight: ex.weight ?? undefined,
          day: ex.day,
          order: ex.order ?? undefined,
          notes: ex.notes ?? undefined,
        })),
        createdById: input.createdById,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "assign_workout_plan",
    description: "Assign a workout plan to a member. Deactivates any existing active plan.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      planId: z.number().describe("Workout plan ID"),
    }),
    async execute(input) {
      const result = await assignWorkoutPlanAction(input.userId, input.planId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_member_workout",
    description: "Get the active workout plan for a member, with exercises grouped by day",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const workout = await getMemberWorkoutAction(input.userId);
      return JSON.stringify(workout);
    },
  }),

  tool({
    name: "create_diet_plan",
    description: "Create a new diet plan with meals grouped by type (breakfast, lunch, dinner, snack)",
    parameters: z.object({
      name: z.string().describe("Plan name"),
      description: z.string().nullable().describe("Plan description"),
      meals: z.array(
        z.object({
          mealType: z.string().describe("Meal type: breakfast, lunch, dinner, snack"),
          description: z.string().describe("Meal description/items"),
          calories: z.number().nullable().describe("Calories"),
          protein: z.number().nullable().describe("Protein in grams"),
          carbs: z.number().nullable().describe("Carbs in grams"),
          fat: z.number().nullable().describe("Fat in grams"),
          order: z.number().nullable().describe("Display order within meal type"),
        })
      ).describe("List of meals"),
      createdById: z.number().describe("Worker ID creating the plan"),
    }),
    async execute(input) {
      const result = await createDietPlanAction({
        name: input.name,
        description: input.description ?? undefined,
        meals: input.meals.map((m) => ({
          mealType: m.mealType,
          description: m.description,
          calories: m.calories ?? undefined,
          protein: m.protein ?? undefined,
          carbs: m.carbs ?? undefined,
          fat: m.fat ?? undefined,
          order: m.order ?? undefined,
        })),
        createdById: input.createdById,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_member_diet",
    description: "Get the active diet plan for a member, with meals grouped by type",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const diet = await getMemberDietAction(input.userId);
      return JSON.stringify(diet);
    },
  }),
];
