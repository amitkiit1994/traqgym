/* eslint-disable @typescript-eslint/no-explicit-any */
/** Convert all null values to undefined so nullable zod fields match service signatures */
export function n<T extends Record<string, any>>(obj: T): any {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = value === null ? undefined : value;
  }
  return result;
}
