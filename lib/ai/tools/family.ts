import { tool } from "@openai/agents";
import { z } from "zod";
import {
  createFamilyGroup,
  addMember,
  getFamilyMembers,
} from "@/lib/actions/family";

export const familyTools = [
  tool({
    name: "create_family_group",
    description: "Create a family/group account with a primary member. Admin only. Requires confirmation.",
    parameters: z.object({
      name: z.string().describe("Family group name"),
      primaryMemberId: z.number().describe("User ID of the primary member"),
    }),
    async execute(input) {
      const result = await createFamilyGroup(input);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_family_members",
    description: "List all members in a family group.",
    parameters: z.object({
      groupId: z.number().describe("Family group ID"),
    }),
    async execute(input) {
      const result = await getFamilyMembers(input.groupId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "add_to_family",
    description: "Add a member to an existing family group. Max 6 members per group.",
    parameters: z.object({
      groupId: z.number().describe("Family group ID"),
      userId: z.number().describe("User ID to add"),
    }),
    async execute(input) {
      const result = await addMember(input.groupId, input.userId);
      return JSON.stringify(result);
    },
  }),
];
