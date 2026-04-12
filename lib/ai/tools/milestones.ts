import { tool } from "@openai/agents";
import { z } from "zod";
import { getTodayMilestones } from "@/lib/services/member-milestones";

export const milestoneTools = [
  tool({
    name: "get_today_milestones",
    description:
      "Get member milestones for today: attendance streaks (30/50/100/200/365 days) and membership anniversaries (6/12/24 months)",
    parameters: z.object({}),
    async execute() {
      const result = await getTodayMilestones();
      return JSON.stringify(result);
    },
  }),
];
