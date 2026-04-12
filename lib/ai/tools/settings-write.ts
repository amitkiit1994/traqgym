import { tool } from "@openai/agents";
import { z } from "zod";
import { setSetting } from "@/lib/services/settings";

export const settingsWriteTools = [
  tool({
    name: "set_setting",
    description:
      "Update a gym setting value (key-value pair). Admin only. Requires confirmation.",
    parameters: z.object({
      key: z
        .string()
        .describe("Setting key, e.g. 'gym_name', 'gst_rate', 'upi_vpa'"),
      value: z.string().describe("New value for the setting"),
    }),
    async execute(input) {
      await setSetting(input.key, input.value);
      return JSON.stringify({ success: true, key: input.key, value: input.value });
    },
  }),
];
