#!/usr/bin/env python3
"""Fetch all ExportToExcel reports from FitnessBoard, year by year."""

import csv
import os
import re
import subprocess
import sys
import time
from html.parser import HTMLParser

COOKIE_FILE = "/tmp/fb_cookie_string.txt"
BASE = "https://v3.fitnessboard.in/Dashboard/ExportToExcel"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

EXPORTS = {
    "database": {"mstat": "0"},
    "membership": {"mstat": "0"},
    "payment": {"mstat": "0"},
    "balance": {"mstat": "0"},
    "activeinactive": {"mstat": "0"},
    "memberenrollment": {"mstat": "0"},
    "irregular": {"mstat": "0"},
    "measurements": {"mstat": "0"},
}


class TableExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.headers = []
        self.rows = []
        self._in_row = False
        self._in_cell = False
        self._cell_text = ""
        self._current_row = []
        self._cell_tag = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._in_row = True
            self._current_row = []
        elif self._in_row and tag in ("td", "th"):
            self._in_cell = True
            self._cell_text = ""
            self._cell_tag = tag

    def handle_endtag(self, tag):
        if tag == "tr" and self._in_row:
            if self._current_row:
                if not self.headers:
                    self.headers = self._current_row
                else:
                    self.rows.append(self._current_row)
            self._in_row = False
        elif tag in ("td", "th") and self._in_cell:
            text = re.sub(r"\s+", " ", self._cell_text.strip())
            text = text.replace("\xa0", "").strip()
            self._current_row.append(text)
            self._in_cell = False

    def handle_data(self, data):
        if self._in_cell:
            self._cell_text += data

    def handle_entityref(self, name):
        if self._in_cell:
            if name == "nbsp":
                self._cell_text += ""
            else:
                self._cell_text += f"&{name};"


def fetch_export(export_type, start_date, end_date, cookie, extra_params=""):
    """Fetch a single export."""
    url = f"{BASE}?exportfor={export_type}&StartDate={start_date}&EndDate={end_date}&mstat=0{extra_params}"
    try:
        result = subprocess.run(
            ["curl", "-s", "-m", "60",
             "-H", f"Cookie: {cookie}",
             "-H", "Referer: https://v3.fitnessboard.in/Dashboard/DataReport",
             url],
            capture_output=True, text=True, timeout=65
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)
    return None


def parse_and_save(html, filename):
    """Parse HTML table and save as CSV."""
    ext = TableExtractor()
    ext.feed(html)

    if not ext.headers or not ext.rows:
        return 0

    filepath = os.path.join(OUT_DIR, filename)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(ext.headers)
        for row in ext.rows:
            # Pad or trim to match header length
            if len(row) >= len(ext.headers):
                writer.writerow(row[:len(ext.headers)])
            else:
                writer.writerow(row + [""] * (len(ext.headers) - len(row)))

    print(f"  -> {filename}: {len(ext.rows)} rows, {len(ext.headers)} cols", flush=True)
    return len(ext.rows)


def main():
    export_type = sys.argv[1] if len(sys.argv) > 1 else "all"
    cookie = open(COOKIE_FILE).read().strip()

    types_to_fetch = [export_type] if export_type != "all" else list(EXPORTS.keys())
    grand_total = 0

    for etype in types_to_fetch:
        print(f"\n=== {etype.upper()} ===", flush=True)

        # Try full range first
        print(f"  Trying full range 2012-2026...", flush=True)
        html = fetch_export(etype, "01-01-2012", "14-04-2026", cookie)
        if html and "<table" in html.lower():
            rows = parse_and_save(html, f"export_{etype}_all.csv")
            grand_total += rows
            if rows > 0:
                continue  # Got it in one shot

        # Fall back to year by year
        print(f"  Full range failed, trying year by year...", flush=True)
        for year in range(2012, 2027):
            start = f"01-01-{year}"
            end = f"31-12-{year}" if year < 2026 else "14-04-2026"
            html = fetch_export(etype, start, end, cookie)
            if html and "<table" in html.lower():
                rows = parse_and_save(html, f"export_{etype}_{year}.csv")
                grand_total += rows
            elif html and "exported" in html.lower():
                print(f"  {year}: empty/no data", flush=True)
            else:
                print(f"  {year}: timeout/error", flush=True)
            time.sleep(0.5)

        # If year-by-year also fails, try half-year
        # (skip for now, handled above)

    print(f"\n{'='*60}", flush=True)
    print(f"Grand total: {grand_total} rows", flush=True)


if __name__ == "__main__":
    main()
