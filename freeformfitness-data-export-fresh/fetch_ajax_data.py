#!/usr/bin/env python3
"""Fetch all AJAX-loaded report data from FitnessBoard."""

import csv
import json
import os
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser

COOKIE = open("/tmp/fb_cookie_string.txt").read().strip()
BASE = "https://v3.fitnessboard.in/Dashboard"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

HEADERS = {
    "Cookie": COOKIE,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Content-Type": "application/json; charset=utf-8",
}


class TableExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self._t = 0; self._r = False; self._c = False
        self._ct = []; self._cr = []; self._cc = ""
    def handle_starttag(self, tag, attrs):
        if tag == "table": self._t += 1; self._ct = [] if self._t == 1 else self._ct
        elif self._t and tag == "tr": self._r = True; self._cr = []
        elif self._r and tag in ("td", "th"): self._c = True; self._cc = ""
        elif self._c and tag == "br": self._cc += " "
    def handle_endtag(self, tag):
        if tag == "table":
            if self._t == 1 and self._ct: self.tables.append(self._ct)
            self._t = max(0, self._t - 1)
        elif tag == "tr" and self._r:
            if self._cr: self._ct.append(self._cr)
            self._r = False
        elif tag in ("td", "th") and self._c:
            self._cr.append(re.sub(r"\s+", " ", self._cc.strip()))
            self._c = False
    def handle_data(self, d):
        if self._c: self._cc += d


def fetch_url(path, visit_parent=None):
    """Fetch a URL and return the response."""
    if visit_parent:
        req = urllib.request.Request(f"{BASE}/{visit_parent}", headers={"Cookie": COOKIE, "User-Agent": HEADERS["User-Agent"]})
        try:
            urllib.request.urlopen(req, timeout=15)
        except:
            pass
        time.sleep(0.3)

    url = f"{BASE}/{path}&_={int(time.time()*1000)}" if "?" in path else f"{BASE}/{path}?_={int(time.time()*1000)}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ERROR fetching {path}: {e}")
        return None


def extract_tables_from_json(json_str):
    """Parse JSON response, extract HTML tables from Data* fields."""
    try:
        data = json.loads(json_str)
    except:
        return []

    all_tables = []
    if isinstance(data, dict):
        for key in sorted(data.keys()):
            val = data[key]
            if val and isinstance(val, str) and "<t" in val.lower():
                ext = TableExtractor()
                ext.feed(val)
                for t in ext.tables:
                    if len(t) > 1 and len(t[0]) > 1:
                        all_tables.append((key, t))
    return all_tables


def save_tables(name, tables):
    """Save extracted tables to CSV."""
    total = 0
    for i, (data_key, table) in enumerate(tables):
        headers = table[0]
        rows = table[1:]
        non_empty = [r for r in rows if any(c.strip() for c in r)]
        if not non_empty:
            continue
        norm_rows = []
        for row in non_empty:
            if len(row) >= len(headers):
                norm_rows.append(row[:len(headers)])
            else:
                norm_rows.append(row + [""] * (len(headers) - len(row)))

        suffix = f"_{data_key}" if len(tables) > 1 else ""
        csv_name = f"ajax_{name}{suffix}.csv"
        filepath = os.path.join(OUT_DIR, csv_name)
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(norm_rows)
        print(f"  -> {csv_name}: {len(norm_rows)} rows")
        total += len(norm_rows)
    return total


def fetch_memberships_year(year, half=None):
    """Fetch membership report for a year (or half-year)."""
    if half == 1:
        start, end = f"01%2F01%2F{year}", f"30%2F06%2F{year}"
        label = f"{year}_h1"
    elif half == 2:
        start, end = f"01%2F07%2F{year}", f"31%2F12%2F{year}"
        label = f"{year}_h2"
    else:
        start, end = f"01%2F01%2F{year}", f"31%2F12%2F{year}"
        label = str(year)

    path = f"FilterMemberShipsReport?Start={start}&End={end}&Staff=0&datefilter=%20ion&Category=0&Status=all&Type=all&Gender=all&trainer=All&PName=0&batchtime=All&renewalstat=All"
    resp = fetch_url(path)
    if resp:
        tables = extract_tables_from_json(resp)
        if tables:
            return save_tables(f"memberships_{label}", tables)
    return 0


def main():
    group = sys.argv[1] if len(sys.argv) > 1 else "all"
    grand_total = 0

    if group in ("all", "reports"):
        print("\n=== REPORT DATA (date-range endpoints) ===")

        # These endpoints work with wide date ranges
        endpoints = [
            ("FilterBillPaymentReports", "Start=01%2F01%2F2015&End=14%2F04%2F2026&mode=all&type=all", "BillPaymentReports", "bill_payments"),
            ("FilterExpenseReports", "Start=01%2F01%2F2015&End=14%2F04%2F2026&type=all&mode=all", "DailyExpenseReport", "expenses"),
            ("FilterExtendedReport", "Start=01%2F01%2F2015&End=14%2F04%2F2026", "ExtensionReport", "extensions"),
            ("FilterFreezeReports", "Start=01%2F01%2F2015&End=14%2F04%2F2026", "FreezeReports", "freeze"),
            ("FilterBalanceList", "Start=01%2F01%2F2015&End=14%2F04%2F2026&packid=0&modes=all&trainer=0", "BalanceReports", "balance"),
            ("FilterActInact", "memb=0", "ActiveInactiveMember", "active_inactive"),
            ("FilterDataReports", "Start=01%2F01%2F2015&End=14%2F04%2F2026&source=all&type=all", "DataReport", "data_report"),
            ("FilterMemberEnrollment", "start=01%2F01%2F2015&end=14%2F04%2F2026&field=all", "MemberEnrollmentReport", "enrollment"),
            ("FilterMemberAccessReport", "Start=01%2F01%2F2015&End=14%2F04%2F2026&pcate=0", None, "access"),
        ]

        for endpoint, params, parent, name in endpoints:
            print(f"\n[{name}]")
            path = f"{endpoint}?{params}"
            resp = fetch_url(path, visit_parent=parent)
            if resp:
                tables = extract_tables_from_json(resp)
                grand_total += save_tables(name, tables)
                if not tables:
                    print("  (no table data)")
            time.sleep(0.5)

    if group in ("all", "attendance"):
        print("\n=== ATTENDANCE (month by month) ===")
        # Attendance needs to be fetched month by month
        for year in range(2015, 2027):
            for month in range(1, 13):
                if year == 2026 and month > 4:
                    break
                last_day = 28 if month == 2 else (30 if month in (4, 6, 9, 11) else 31)
                start = f"01%2F{month:02d}%2F{year}"
                end = f"{last_day}%2F{month:02d}%2F{year}"
                path = f"FilterAttendanceReport?Start={start}&End={end}"
                resp = fetch_url(path)
                if resp:
                    tables = extract_tables_from_json(resp)
                    if tables:
                        rows = save_tables(f"attendance_{year}_{month:02d}", tables)
                        grand_total += rows
                        if rows:
                            print(f"  {year}-{month:02d}: {rows} rows")
                time.sleep(0.2)

    if group in ("all", "absent"):
        print("\n=== ABSENT MEMBERS ===")
        for days in [7, 15, 30, 60, 90, 180, 365]:
            path = f"FilterAbsentReport?days={days}&OnlyMembers=0"
            resp = fetch_url(path)
            if resp:
                tables = extract_tables_from_json(resp)
                if tables:
                    rows = save_tables(f"absent_{days}d", tables)
                    grand_total += rows
            time.sleep(0.3)

    if group in ("all", "invoices"):
        print("\n=== INVOICES (year by year) ===")
        for year in range(2015, 2027):
            start = f"01%2F01%2F{year}"
            end = f"31%2F12%2F{year}" if year < 2026 else f"14%2F04%2F{year}"
            path = f"FilterInvoiceList?Start={start}&End={end}"
            resp = fetch_url(path, visit_parent="InvoiceList")
            if resp:
                tables = extract_tables_from_json(resp)
                if tables:
                    rows = save_tables(f"invoices_{year}", tables)
                    grand_total += rows
                    print(f"  {year}: {rows} rows")
            time.sleep(0.3)

    if group in ("all", "payoverview"):
        print("\n=== PAYMENT OVERVIEW (year by year) ===")
        for year in range(2015, 2027):
            start = f"01%2F01%2F{year}"
            end = f"31%2F12%2F{year}" if year < 2026 else f"14%2F04%2F{year}"
            path = f"FilterPayOverview?Start={start}&End={end}"
            resp = fetch_url(path)
            if resp:
                tables = extract_tables_from_json(resp)
                if tables:
                    rows = save_tables(f"payoverview_{year}", tables)
                    grand_total += rows
                    print(f"  {year}: {rows} rows")
                # Also save raw JSON for summary stats
                try:
                    data = json.loads(resp)
                    # Data2 often has chart data
                    if data.get("Data2"):
                        with open(os.path.join(OUT_DIR, f"ajax_payoverview_{year}_chart.txt"), "w") as f:
                            f.write(str(data["Data2"]))
                except:
                    pass
            time.sleep(0.3)

    if group in ("all", "prospect"):
        print("\n=== PROSPECTS (month by month, 500s on wide ranges) ===")
        for year in range(2020, 2027):
            for month in range(1, 13):
                if year == 2026 and month > 4:
                    break
                last_day = 28 if month == 2 else (30 if month in (4, 6, 9, 11) else 31)
                start = f"01%2F{month:02d}%2F{year}"
                end = f"{last_day}%2F{month:02d}%2F{year}"
                path = f"FilterProspects?Start={start}&End={end}&subject=All&source=all"
                resp = fetch_url(path)
                if resp:
                    tables = extract_tables_from_json(resp)
                    if tables:
                        rows = save_tables(f"prospects_{year}_{month:02d}", tables)
                        grand_total += rows
                        print(f"  {year}-{month:02d}: {rows} rows")
                time.sleep(0.2)

    if group in ("all", "calls"):
        print("\n=== CALL LOGS (month by month) ===")
        for year in range(2020, 2027):
            for month in range(1, 13):
                if year == 2026 and month > 4:
                    break
                last_day = 28 if month == 2 else (30 if month in (4, 6, 9, 11) else 31)
                start = f"01%2F{month:02d}%2F{year}"
                end = f"{last_day}%2F{month:02d}%2F{year}"
                path = f"FilterCallReports?Start={start}&End={end}&subject=All&subject1=All"
                resp = fetch_url(path)
                if resp:
                    tables = extract_tables_from_json(resp)
                    if tables:
                        rows = save_tables(f"calls_{year}_{month:02d}", tables)
                        grand_total += rows
                        print(f"  {year}-{month:02d}: {rows} rows")
                time.sleep(0.2)

    if group in ("all", "formdata"):
        print("\n=== FORM DATA / FEEDBACK / DIET / APPOINTMENTS ===")
        # These are per-member. Try with memb=0 or staffid=0 for all
        per_member_endpoints = [
            ("FilterFormData", "memb=0", "form_data"),
            ("FilterFeedbacks", "staffid=0", "feedbacks"),
            ("FilterDietReport", "StartDate=01%2F01%2F2015&EndDate=14%2F04%2F2026&memb=0", "diet"),
            ("FilterAppointment", "typeid=0&filtypeid=0&membid=0", "appointments"),
            ("FilterLockers", "membid=0", "lockers"),
            ("FilterClasses", "typeid=0&filtypeid=0", "classes"),
        ]
        for endpoint, params, name in per_member_endpoints:
            print(f"\n[{name}]")
            path = f"{endpoint}?{params}"
            resp = fetch_url(path)
            if resp:
                tables = extract_tables_from_json(resp)
                grand_total += save_tables(name, tables)
                if not tables:
                    print("  (no table data)")
            time.sleep(0.5)

    if group in ("all", "pages"):
        print("\n=== HTML PAGES (scrape full page for tables) ===")
        pages = [
            "StaffList", "Package", "PackageCategory", "ProductCategory", "Products",
            "TaxType", "Occupation", "Designation", "Shift",
            "Configuration", "GlobalSettings", "OtherPaymentMaster",
            "PTAttendance", "SessionReport",
        ]
        for page in pages:
            print(f"\n[{page}]")
            url = f"{BASE}/{page}"
            req = urllib.request.Request(url, headers={"Cookie": COOKIE, "User-Agent": HEADERS["User-Agent"]})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    html = resp.read().decode("utf-8", errors="replace")
                ext = TableExtractor()
                ext.feed(html)
                for i, t in enumerate(ext.tables):
                    if len(t) > 1 and len(t[0]) > 1:
                        headers = t[0]
                        rows = t[1:]
                        non_empty = [r for r in rows if any(c.strip() for c in r)]
                        if non_empty:
                            norm_rows = []
                            for row in non_empty:
                                if len(row) >= len(headers):
                                    norm_rows.append(row[:len(headers)])
                                else:
                                    norm_rows.append(row + [""] * (len(headers) - len(row)))
                            csv_name = f"page_{page.lower()}.csv"
                            filepath = os.path.join(OUT_DIR, csv_name)
                            with open(filepath, "w", newline="", encoding="utf-8") as f:
                                writer = csv.writer(f)
                                writer.writerow(headers)
                                writer.writerows(norm_rows)
                            print(f"  -> {csv_name}: {len(norm_rows)} rows")
                            grand_total += len(norm_rows)
                # Also extract select options
                selects = {}
                for m in re.finditer(r'<select[^>]*id="([^"]*)"[^>]*>(.*?)</select>', html, re.DOTALL):
                    options = re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)</option>', m.group(2))
                    if len(options) > 3:
                        csv_name = f"page_{page.lower()}_select_{m.group(1)}.csv"
                        filepath = os.path.join(OUT_DIR, csv_name)
                        with open(filepath, "w", newline="", encoding="utf-8") as f:
                            writer = csv.writer(f)
                            writer.writerow(["value", "label"])
                            writer.writerows(options)
                        print(f"  -> {csv_name}: {len(options)} rows")
                        grand_total += len(options)
            except Exception as e:
                print(f"  ERROR: {e}")
            time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"Grand total: {grand_total} rows fetched")


if __name__ == "__main__":
    main()
