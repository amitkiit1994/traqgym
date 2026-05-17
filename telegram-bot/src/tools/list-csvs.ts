import { parseCsv } from "../data/csv-parse.js";
import type { BlobStore } from "../data/blob-store.js";

export interface CsvMeta {
  name: string;
  rows: number;
  columns: string[];
  date_columns: string[];
  number_columns: string[];
  sample_rows: Record<string, string | number | null>[];
}

export interface ListCsvsResult {
  /** Gym slug this listing belongs to. Echoes the store's gym so the model
   * sees which gym's data it just got back. */
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
    const { columns, rows } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    csvs.push({
      name,
      rows: rows.length,
      columns,
      date_columns: hint.date.filter(d => columns.includes(d)),
      number_columns: hint.number.filter(d => columns.includes(d)),
      sample_rows: rows.slice(0, SAMPLE_SIZE),
    });
  }
  return {
    gym: store.gym,
    snapshot_date: pointer.snapshot_date,
    snapshot_ist: pointer.snapshot_ist,
    csvs,
  };
}
