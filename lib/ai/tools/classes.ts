import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getClassesAction,
  createClassAction,
  updateClassAction,
  toggleClassActiveAction,
  getClassBookingsAction,
  getUpcomingClassesAction,
} from "@/lib/actions/classes";

export const classTools = [
  tool({
    name: "get_classes",
    description: "List all gym classes with schedules",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const classes = await getClassesAction(input.locationId ?? undefined);
      return JSON.stringify(classes);
    },
  }),

  tool({
    name: "create_class",
    description: "Create a new gym class with schedule. Requires confirmation.",
    parameters: z.object({
      name: z.string().describe("Class name"),
      description: z.string().nullable().describe("Description"),
      classType: z.string().nullable().describe("Type: yoga, cardio, strength, dance, etc."),
      instructorId: z.number().nullable().describe("Instructor worker ID"),
      locationId: z.number().describe("Location ID"),
      maxCapacity: z.number().describe("Max participants"),
      schedules: z.array(z.object({
        dayOfWeek: z.number().describe("Day: 0=Sun, 1=Mon, ..., 6=Sat"),
        startTime: z.string().describe("Start time HH:MM"),
        endTime: z.string().describe("End time HH:MM"),
      })).describe("Weekly schedule"),
    }),
    async execute(input) {
      const result = await createClassAction(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_class",
    description: "Update an existing class. Requires confirmation.",
    parameters: z.object({
      classId: z.number().describe("Class ID"),
      name: z.string().describe("Class name"),
      description: z.string().nullable().describe("Description"),
      classType: z.string().nullable().describe("Type"),
      instructorId: z.number().nullable().describe("Instructor ID"),
      locationId: z.number().describe("Location ID"),
      maxCapacity: z.number().describe("Max capacity"),
      schedules: z.array(z.object({
        dayOfWeek: z.number(),
        startTime: z.string(),
        endTime: z.string(),
      })).describe("Updated schedule"),
    }),
    async execute(input) {
      const { classId, ...data } = input;
      const result = await updateClassAction(classId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_class_active",
    description: "Activate or deactivate a class. Requires confirmation.",
    parameters: z.object({
      classId: z.number().describe("Class ID"),
    }),
    async execute(input) {
      const result = await toggleClassActiveAction(input.classId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_class_bookings",
    description: "Get bookings for a specific class on a specific date",
    parameters: z.object({
      classId: z.number().describe("Class ID"),
      date: z.string().describe("Date YYYY-MM-DD"),
    }),
    async execute(input) {
      const bookings = await getClassBookingsAction(input.classId, input.date);
      return JSON.stringify(bookings);
    },
  }),

  tool({
    name: "get_upcoming_classes",
    description: "Get today's upcoming class sessions",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const classes = await getUpcomingClassesAction(input.locationId ?? undefined);
      return JSON.stringify(classes);
    },
  }),
];
