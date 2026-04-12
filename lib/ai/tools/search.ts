import { tool } from "@openai/agents";
import { z } from "zod";
import { globalSearch } from "@/lib/actions/search";

export const searchTools = [
  tool({
    name: "global_search",
    description:
      "Search across members, workers, plans, classes, and enquiries by name, phone, or email. Returns up to 5 members, 3 workers, 3 plans, 3 classes, 3 enquiries.",
    parameters: z.object({
      query: z.string().describe("Search term (minimum 2 characters)"),
    }),
    async execute(input) {
      const result = await globalSearch(input.query);
      return JSON.stringify(result);
    },
  }),
];
