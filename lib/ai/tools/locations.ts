import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getLocations,
  createLocation,
  updateLocation,
  toggleLocationActive,
  getOpeningHours,
  updateOpeningHours,
} from "@/lib/actions/locations";
import {
  getEquipment,
  createEquipment,
  updateEquipment,
} from "@/lib/actions/equipment";

export const locationTools = [
  tool({
    name: "get_locations",
    description: "List all gym locations",
    parameters: z.object({}),
    async execute() {
      const locations = await getLocations();
      return JSON.stringify(locations);
    },
  }),

  tool({
    name: "create_location",
    description: "Create a new location. Requires confirmation.",
    parameters: z.object({
      name: z.string().describe("Location name"),
      code: z.string().describe("Short code (e.g. MAIN, BRANCH1)"),
      address: z.string().nullable().describe("Address"),
      phone: z.string().nullable().describe("Phone"),
    }),
    async execute(input) {
      const result = await createLocation(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_location",
    description: "Update a location's details. Requires confirmation.",
    parameters: z.object({
      locationId: z.number().describe("Location ID"),
      name: z.string().describe("Name"),
      code: z.string().describe("Code"),
      address: z.string().nullable().describe("Address"),
      phone: z.string().nullable().describe("Phone"),
    }),
    async execute(input) {
      const { locationId, ...data } = input;
      const result = await updateLocation(locationId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_location_active",
    description: "Activate or deactivate a location. Requires confirmation.",
    parameters: z.object({
      locationId: z.number().describe("Location ID"),
    }),
    async execute(input) {
      const result = await toggleLocationActive(input.locationId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_opening_hours",
    description: "Get opening hours for a location",
    parameters: z.object({
      locationId: z.number().describe("Location ID"),
    }),
    async execute(input) {
      const hours = await getOpeningHours(input.locationId);
      return JSON.stringify(hours);
    },
  }),

  tool({
    name: "update_opening_hours",
    description: "Update opening hours for a location. Requires confirmation.",
    parameters: z.object({
      locationId: z.number().describe("Location ID"),
      hours: z.array(z.object({
        dayOfWeek: z.number().describe("0=Sun, 1=Mon, ..., 6=Sat"),
        openTime: z.string().describe("Open time HH:MM"),
        closeTime: z.string().describe("Close time HH:MM"),
        isClosed: z.boolean().describe("Whether closed this day"),
      })).describe("7-element array for each day"),
    }),
    async execute(input) {
      const result = await updateOpeningHours(input.locationId, input.hours);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_equipment",
    description: "List gym equipment with optional filters",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location"),
      category: z.string().nullable().describe("Filter by category"),
      condition: z.string().nullable().describe("Filter by condition: new, good, fair, poor, broken"),
    }),
    async execute(input) {
      const equipment = await getEquipment(input.locationId ?? undefined, input.category ?? undefined, input.condition ?? undefined);
      return JSON.stringify(equipment);
    },
  }),

  tool({
    name: "create_equipment",
    description: "Add new equipment. Requires confirmation.",
    parameters: z.object({
      name: z.string().describe("Equipment name"),
      category: z.string().describe("Category: cardio, strength, free_weights, machines, other"),
      locationId: z.number().describe("Location ID"),
      purchaseDate: z.string().nullable().describe("Purchase date YYYY-MM-DD"),
      purchasePrice: z.number().nullable().describe("Purchase price"),
      condition: z.string().nullable().describe("Condition"),
      notes: z.string().nullable().describe("Notes"),
    }),
    async execute(input) {
      const result = await createEquipment(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_equipment",
    description: "Update equipment details. Requires confirmation.",
    parameters: z.object({
      equipmentId: z.number().describe("Equipment ID"),
      name: z.string().describe("Name"),
      category: z.string().describe("Category"),
      locationId: z.number().describe("Location ID"),
      purchaseDate: z.string().nullable(),
      purchasePrice: z.number().nullable(),
      condition: z.string().nullable(),
      notes: z.string().nullable(),
    }),
    async execute(input) {
      const { equipmentId, ...data } = input;
      const result = await updateEquipment(equipmentId, n(data));
      return JSON.stringify(result);
    },
  }),
];
