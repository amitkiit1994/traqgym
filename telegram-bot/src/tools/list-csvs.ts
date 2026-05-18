import { parseCsv, unhealthyColumns } from "../data/csv-parse.js";
import type { ColumnDiagnostic } from "../data/csv-parse.js";
import type { BlobStore } from "../data/blob-store.js";

export interface CsvMeta {
  name: string;
  rows: number;
  columns: string[];
  date_columns: string[];
  number_columns: string[];
  sample_rows: Record<string, string | number | null>[];
  /** Per-column parse failure stats. Empty if no hinted typed columns. */
  column_diagnostics: Record<string, ColumnDiagnostic>;
  /** Columns whose parse-failure rate exceeds 5% — model MUST refuse to
   * filter/aggregate on these and surface the misalignment to the user. */
  unhealthy_columns: string[];
  /** Structural CSV parse errors from Papa (delimiter/quote issues). */
  parse_errors: string[];
  /** True iff any hinted typed column is unhealthy. The agent's prompt
   * treats unhealthy CSVs as "refuse to answer numeric questions; tell the
   * user the snapshot is misaligned for column X". */
  unhealthy: boolean;
}

export interface ListCsvsResult {
  gym: string;
  snapshot_date: string;
  snapshot_ist: string;
  csvs: CsvMeta[];
}

export const CSV_HINTS: Record<string, { date: string[]; number: string[] }> = {
  payments: {
    date: ["Payment Date", "Start Date", "End Date", "Created On"],
    number: ["Membership Amount", "Total Amount", "Discount", "Net Amount", "Paid Amount", "Balance Amount"],
  },
  members: {
    date: ["Joining Date", "Date of Birth", "Start Date", "End Date"],
    number: ["Membership Amount", "Paid Amount", "Balance Amount"],
  },
  balance: {
    date: ["Start Date", "End Date", "Payment Date"],
    number: ["Total Amount", "Paid Amount", "Balance Amount"],
  },
  memberenrollment: {
    date: ["Joining Date", "Start Date", "End Date"],
    number: ["Membership Amount", "Paid Amount", "Balance Amount"],
  },
  activeinactive: {
    date: ["Joining Date", "Start Date", "End Date"],
    number: ["Membership Amount", "Balance Amount"],
  },
  database: {
    date: ["Joining Date", "Date of Birth"],
    number: [],
  },
  member_details: {
    date: ["Joining Date", "Date of Birth"],
    number: ["Balance Amount"],
  },
  sessionreport: {
    date: ["Session Date"],
    number: ["Sessions"],
  },
};

const SAMPLE_SIZE = 2;

export async function buildListCsvsResult(store: BlobStore): Promise<ListCsvsResult> {
  const pointer = await store.fetchLatest();
  const names = Object.keys(pointer.blob_urls);
  const csvs: CsvMeta[] = [];
  for (const name of names) {
    const hint = CSV_HINTS[name] ?? { date: [], number: [] };
    const text = await store.fetchCsv(name);
    const { columns, rows, parse_errors, column_diagnostics } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const unhealthy = unhealthyColumns(column_diagnostics);
    csvs.push({
      name,
      rows: rows.length,
      columns,
      date_columns: hint.date.filter(d => columns.includes(d)),
      number_columns: hint.number.filter(d => columns.includes(d)),
      sample_rows: rows.slice(0, SAMPLE_SIZE),
      column_diagnostics,
      unhealthy_columns: unhealthy,
      parse_errors,
      unhealthy: unhealthy.length > 0 || parse_errors.length > 0,
    });
  }
  return {
    gym: store.gym,
    snapshot_date: pointer.snapshot_date,
    snapshot_ist: pointer.snapshot_ist,
    csvs,
  };
}
