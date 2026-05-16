import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import type { QueryArgs } from "./query-csv.js";

const cellSchema = z.union([z.string(), z.number(), z.null()]);

const filterSchema = z.discriminatedUnion("op", [
  z.object({
    col: z.string(),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "icontains"]),
    val: cellSchema,
  }),
  z.object({
    col: z.string(),
    op: z.literal("between"),
    val: z.tuple([cellSchema, cellSchema]),
  }),
  z.object({
    col: z.string(),
    op: z.literal("in"),
    val: z.array(cellSchema),
  }),
  z.object({
    col: z.string(),
    op: z.enum(["isblank", "notblank"]),
  }),
]);

export const queryArgsSchema = z.object({
  csv: z.string(),
  filters: z.array(filterSchema).optional(),
  group_by: z.array(z.string()).optional(),
  agg: z.object({
    col: z.string(),
    fn: z.enum(["sum", "count", "avg", "min", "max"]),
  }).optional(),
  select: z.array(z.string()).optional(),
  order_by: z.object({
    col: z.string(),
    dir: z.enum(["asc", "desc"]),
  }).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export type ParsedQueryArgs = z.infer<typeof queryArgsSchema> & { csv: string } & QueryArgs;

export function parseQueryArgs(raw: unknown): ParsedQueryArgs {
  return queryArgsSchema.parse(raw) as ParsedQueryArgs;
}

// Gemini function declarations (parametersJsonSchema accepts standard JSON-Schema).
export const LIST_CSVS_DECL: FunctionDeclaration = {
  name: "list_csvs",
  description:
    "List all available CSVs with their columns. Call once before query_csv if you are unsure of CSV names or columns.",
  parametersJsonSchema: { type: "object", properties: {} },
};

export const QUERY_CSV_DECL: FunctionDeclaration = {
  name: "query_csv",
  description:
    "Query one CSV with filters/agg/group_by/order_by/limit. " +
    "Use list_csvs first to discover available CSV names and columns.",
  parametersJsonSchema: {
    type: "object",
    required: ["csv"],
    properties: {
      csv: {
        type: "string",
        description: "CSV name from list_csvs (e.g. 'payments')",
      },
      filters: {
        type: "array",
        items: {
          type: "object",
          required: ["col", "op"],
          properties: {
            col: { type: "string" },
            op: {
              type: "string",
              enum: [
                "eq", "neq", "gt", "gte", "lt", "lte",
                "between", "in", "icontains", "isblank", "notblank",
              ],
            },
            val: {},
          },
        },
      },
      group_by: { type: "array", items: { type: "string" } },
      agg: {
        type: "object",
        required: ["col", "fn"],
        properties: {
          col: { type: "string" },
          fn: { type: "string", enum: ["sum", "count", "avg", "min", "max"] },
        },
      },
      select: { type: "array", items: { type: "string" } },
      order_by: {
        type: "object",
        required: ["col", "dir"],
        properties: {
          col: { type: "string" },
          dir: { type: "string", enum: ["asc", "desc"] },
        },
      },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
  },
};
