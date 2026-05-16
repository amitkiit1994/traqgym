import { z } from "zod";
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

export const LIST_CSVS_TOOL = {
  type: "function" as const,
  function: {
    name: "list_csvs",
    description:
      "List all available CSVs with their columns and sample rows. Call once before query_csv.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

export const QUERY_CSV_TOOL = {
  type: "function" as const,
  function: {
    name: "query_csv",
    description:
      "Query one CSV with filters/agg/group_by/order_by/limit. " +
      "Use list_csvs first to discover available CSV names and columns.",
    parameters: {
      type: "object",
      required: ["csv"],
      additionalProperties: false,
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
  },
};
