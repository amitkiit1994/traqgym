import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getPipelineAction,
  moveStageAction,
} from "@/lib/actions/lead-pipeline";

export const leadPipelineTools = [
  tool({
    name: "get_lead_pipeline",
    description:
      "Get the sales funnel / lead pipeline showing enquiry counts per stage: new, contacted, tour_scheduled, tour_done, trial, negotiation, converted, lost",
    parameters: z.object({
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getPipelineAction(
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "move_lead_stage",
    description:
      "Move an enquiry/lead to a new pipeline stage. Validates the transition is allowed and creates an audit log. Requires confirmation. Admin only.",
    parameters: z.object({
      enquiryId: z.number().describe("Enquiry ID"),
      newStage: z
        .string()
        .describe(
          "Target stage: new, contacted, tour_scheduled, tour_done, trial, negotiation, converted, lost"
        ),
    }),
    async execute(input) {
      const result = await moveStageAction(
        input.enquiryId,
        input.newStage
      );
      return JSON.stringify(result);
    },
  }),
];
