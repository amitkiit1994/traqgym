#!/usr/bin/env python3
"""
v3 FitnessBoard → TraqGym nightly sync runner.

Adapted from freeformfitness-data-export/fetch_complete.py. Instead of
writing CSVs to disk, this:

  1. Fetches v3 credentials from the gym's internal API.
  2. Logs in to v3.fitnessboard.in (extracts the session cookie from the
     login redirect).
  3. Pulls the "payment" report for the full date range.
  4. POSTs the parsed rows back to the gym's /api/internal/v3-sync endpoint.
  5. Reports status (also recorded server-side by the sync route).

Usage:
    python sync.py --gym-base-url https://freeformfitness.traqgym.com \
                   --internal-secret <bearer-token>

Env-var alternative:
    GYM_BASE_URL=https://...  INTERNAL_API_SECRET=...  python sync.py

Stdlib-only — uses urllib + html.parser. No pip install required, keeps
the GH Actions runner light.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from html.parser import HTMLParser

V3_BASE = "https://v3.fitnessboard.in"
DEFAULT_START = "01-01-2012"
USER_AGENT = "Mozilla/5.0 (compatible; TraqGym-v3-sync/1.0)"
TIMEOUT = 120
SSL_CTX = ssl.create_default_context()


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ─── HTTP plumbing ─────────────────────────────────────────────────────────
class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Block automatic redirect-following so we can read Set-Cookie + Location."""

    def http_error_302(self, req, fp, code, msg, headers):
        return fp

    http_error_301 = http_error_303 = http_error_307 = http_error_302


def v3_login(mobile: str, password: str) -> str:
    """POST to /Account/Login, return the Cookie header value on success."""
    body = urllib.parse.urlencode({"Mobile": mobile, "Password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{V3_BASE}/Account/Login",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        },
    )
    opener = urllib.request.build_opener(NoRedirect)
    try:
        resp = opener.open(req, timeout=TIMEOUT)
    except urllib.error.HTTPError as e:
        resp = e
    location = resp.headers.get("Location", "")
    if not location or "LoginError" in location:
        raise RuntimeError(f"v3 login failed: status={resp.status}, location={location!r}")
    cookies = resp.headers.get_all("Set-Cookie") or []
    if not cookies:
        raise RuntimeError("v3 login: no Set-Cookie header in response")
    pairs = []
    for raw in cookies:
        first = raw.split(";", 1)[0].strip()
        if first:
            pairs.append(first)
    if not pairs:
        raise RuntimeError("v3 login: empty cookie pairs")
    log(f"v3 login OK → {location}")
    return "; ".join(pairs)


def v3_get(path: str, cookie: str, referer: str | None = None, ajax: bool = False) -> bytes:
    """GET request to v3 with the session cookie attached."""
    url = f"{V3_BASE}{path}" if path.startswith("/") else f"{V3_BASE}/{path}"
    headers = {
        "Cookie": cookie,
        "User-Agent": USER_AGENT,
    }
    if ajax:
        headers["X-Requested-With"] = "XMLHttpRequest"
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as resp:
        return resp.read()


# ─── HTML/CSV table parser (cribbed from fetch_complete.py) ───────────────
class TableExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._t = 0
        self._r = False
        self._c = False
        self._ct: list[list[str]] = []
        self._cr: list[str] = []
        self._cc = ""

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._t += 1
            if self._t == 1:
                self._ct = []
        elif self._t and tag == "tr":
            self._r = True
            self._cr = []
        elif self._r and tag in ("td", "th"):
            self._c = True
            self._cc = ""
        elif self._c and tag == "br":
            self._cc += " "

    def handle_endtag(self, tag):
        if tag == "table":
            if self._t == 1 and self._ct:
                self.tables.append(self._ct)
            self._t = max(0, self._t - 1)
        elif tag == "tr" and self._r:
            if self._cr:
                self._ct.append(self._cr)
            self._r = False
        elif tag in ("td", "th") and self._c:
            text = re.sub(r"\s+", " ", self._cc.strip()).replace("\xa0", "").strip()
            self._cr.append(text)
            self._c = False

    def handle_data(self, d):
        if self._c:
            self._cc += d

    def handle_entityref(self, n):
        if self._c:
            self._cc += "" if n == "nbsp" else f"&{n};"


def parse_html_table(raw: bytes) -> list[dict[str, str]]:
    html = raw.decode("utf-8", errors="replace")
    if "<table" not in html.lower():
        return []
    ext = TableExtractor()
    ext.feed(html)
    if not ext.tables:
        return []
    # First table wins (the export views render one)
    table = ext.tables[0]
    if len(table) < 2:
        return []
    headers = table[0]
    rows: list[dict[str, str]] = []
    for r in table[1:]:
        if not any(c.strip() for c in r):
            continue
        # Pad/trim to header length
        padded = (r + [""] * len(headers))[: len(headers)]
        rows.append({h: v for h, v in zip(headers, padded)})
    return rows


# ─── Internal API ─────────────────────────────────────────────────────────
def fetch_credentials(base_url: str, secret: str) -> dict:
    url = f"{base_url.rstrip('/')}/api/internal/v3-credentials"
    req = urllib.request.Request(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
        data=b"{}",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def push_dataset(base_url: str, secret: str, dataset: str, rows: list[dict]) -> dict:
    url = f"{base_url.rstrip('/')}/api/internal/v3-sync"
    body = json.dumps({"dataset": dataset, "rows": rows}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"sync API error: HTTP {e.code} — {body}") from None


# ─── Main pipeline ────────────────────────────────────────────────────────
def fetch_payments(cookie: str) -> list[dict]:
    """Fetch payment rows from v3, falling back to year-by-year on empty result.

    Larger gym accounts (E-GYM Lokhandwala with 14k+ payments) sometimes return
    empty or time out on the full-range request and need year-by-year chunking.
    """
    today = date.today().strftime("%d-%m-%Y")
    today_year = date.today().year

    rows = _fetch_payment_range(cookie, DEFAULT_START, today)
    log(f"  parsed {len(rows)} payment rows from v3 (full range)")

    if not rows:
        log("  full range empty — falling back to year-by-year")
        for year in range(2020, today_year + 1):
            start = f"01-01-{year}"
            end = today if year == today_year else f"31-12-{year}"
            year_rows = _fetch_payment_range(cookie, start, end)
            if year_rows:
                log(f"    {year}: {len(year_rows)} rows")
                rows.extend(year_rows)

    return _normalise_payments(rows)


def _fetch_payment_range(cookie: str, start_date: str, end_date: str) -> list[dict]:
    """Single date-range fetch. Returns [] on server 500 / timeout / XLSX response."""
    url = (
        f"/Dashboard/ExportToExcel?exportfor=payment"
        f"&StartDate={start_date}&EndDate={end_date}&mstat=0"
    )
    try:
        raw = v3_get(url, cookie, referer=f"{V3_BASE}/Dashboard/DataReport")
    except urllib.error.HTTPError as e:
        log(f"    v3 HTTP {e.code} for {start_date}..{end_date} — skipping")
        return []
    except Exception as e:
        log(f"    v3 error for {start_date}..{end_date}: {type(e).__name__} — skipping")
        return []
    if raw.startswith(b"PK\x03\x04"):
        return []
    return parse_html_table(raw)


def _normalise_payments(rows: list[dict]) -> list[dict]:
    """Map v3's column names (with spaces) to the keys the sync API expects.

    Real v3 export headers (verified from actual export):
      Sr No., Reg. Id, Branch Name, Member Id, Billing Name, Contact No,
      Reciept No, Transanction Id, Bill No, GST No, Payment Date,
      Payment Mode, Package Name, Start Date, End Date, Membership Amount,
      Total Amount, Discount, Net Amount, Paid Amount, Balance Amount,
      Payment Type, Sales Rep, Trainer, Created By, Created On

    Note the spaces — earlier versions used camelCase keys that never matched,
    silently dropping every row.
    """
    normalised: list[dict] = []
    for r in rows:
        bill_no = (r.get("Bill No") or r.get("BillNo") or r.get("InvoiceNo") or "").strip()
        if not bill_no:
            continue
        normalised.append(
            {
                "BillNo": bill_no,
                "ContactNo": (r.get("Contact No") or r.get("ContactNo") or r.get("Mobile") or "").strip(),
                "Amount": (r.get("Paid Amount") or r.get("Amount") or "0").strip(),
                "PaymentMode": (r.get("Payment Mode") or r.get("PaymentMode") or "").strip(),
                "PaymentDate": (r.get("Payment Date") or r.get("PaymentDate") or "").strip(),
                "PaymentFor": (r.get("Payment Type") or r.get("Payment For") or "").strip(),
                "Remarks": (r.get("Remarks") or "").strip(),
                # Extras useful for member lookup at sync time
                "MemberId": (r.get("Member Id") or r.get("MemberId") or "").strip(),
                "BillingName": (r.get("Billing Name") or r.get("Name") or "").strip(),
                "PackageName": (r.get("Package Name") or "").strip(),
                "StartDate": (r.get("Start Date") or "").strip(),
                "EndDate": (r.get("End Date") or "").strip(),
                "Trainer": (r.get("Trainer") or "").strip(),
                "SalesRep": (r.get("Sales Rep") or "").strip(),
            }
        )
    return normalised


def run(base_url: str, secret: str) -> int:
    log(f"sync target: {base_url}")
    creds = fetch_credentials(base_url, secret)
    if not creds.get("configured"):
        log("v3 not configured on this gym — nothing to sync")
        return 0
    if not creds.get("syncEnabled"):
        log("v3 sync disabled on this gym — nothing to sync")
        return 0

    mobile = creds["mobile"]
    password = creds["password"]
    cookie = v3_login(mobile, password)

    payments = fetch_payments(cookie)
    if payments:
        log(f"pushing {len(payments)} payment rows to {base_url}")
        result = push_dataset(base_url, secret, "payment", payments)
        log(f"sync result (payment): {json.dumps(result)}")
    else:
        log("no payment rows to push")

    balances = fetch_balances(cookie)
    if balances:
        log(f"pushing {len(balances)} balance rows to {base_url}")
        result = push_dataset(base_url, secret, "balance", balances)
        log(f"sync result (balance): {json.dumps(result)}")
    else:
        log("no balance rows to push")

    attendance = fetch_attendance(cookie, days=30)
    if attendance:
        log(f"pushing {len(attendance)} attendance rows to {base_url}")
        result = push_dataset(base_url, secret, "attendance", attendance)
        log(f"sync result (attendance): {json.dumps(result)}")
    else:
        log("no attendance rows to push")

    return 0


def fetch_attendance(cookie: str, days: int = 30) -> list[dict]:
    """Fetch the last N days of attendance from v3 via FilterAttendanceReport.

    AJAX endpoint, JSON-wrapped HTML table response. We chunk by month to
    avoid v3 server 500s on wide ranges, capped to `days` calendar days
    back from today.
    """
    # Set session context first — server-side filter state lives in the page.
    try:
        v3_get("/Dashboard/AttendanceReport", cookie, referer=f"{V3_BASE}/Dashboard/Index")
    except Exception:
        pass  # best-effort warm-up

    today = date.today()
    start_date = today - timedelta(days=days)
    rows: list[dict] = []

    # Walk month-by-month from start_date to today
    cur_year, cur_month = start_date.year, start_date.month
    end_year, end_month = today.year, today.month
    while (cur_year, cur_month) <= (end_year, end_month):
        last_day = 28 if cur_month == 2 else (30 if cur_month in (4, 6, 9, 11) else 31)
        month_start = max(date(cur_year, cur_month, 1), start_date)
        month_end = min(date(cur_year, cur_month, last_day), today)
        start_enc = month_start.strftime("%d%%2F%m%%2F%Y")
        end_enc = month_end.strftime("%d%%2F%m%%2F%Y")
        path = (
            f"/Dashboard/FilterAttendanceReport?Start={start_enc}&End={end_enc}"
            f"&_={int(date.today().toordinal())}"  # cache buster
        )
        try:
            raw = v3_get(
                path,
                cookie,
                referer=f"{V3_BASE}/Dashboard/AttendanceReport",
                ajax=True,
            )
        except urllib.error.HTTPError as e:
            log(f"  attendance v3 HTTP {e.code} for {month_start}..{month_end} — skipping")
            cur_month += 1
            if cur_month > 12:
                cur_month = 1
                cur_year += 1
            continue
        except Exception as e:
            log(f"  attendance error for {month_start}..{month_end}: {type(e).__name__} — skipping")
            cur_month += 1
            if cur_month > 12:
                cur_month = 1
                cur_year += 1
            continue
        month_rows = _parse_attendance_json(raw)
        if month_rows:
            log(f"    {month_start.strftime('%Y-%m')}: {len(month_rows)} rows")
            rows.extend(month_rows)
        cur_month += 1
        if cur_month > 12:
            cur_month = 1
            cur_year += 1

    log(f"  parsed {len(rows)} attendance rows from v3 (last {days} days)")
    return _normalise_attendance(rows)


def _parse_attendance_json(raw: bytes) -> list[dict]:
    """v3's FilterAttendanceReport returns JSON with HTML tables under Data* keys."""
    try:
        text = raw.decode("utf-8", errors="replace")
        if not text.startswith("{"):
            return []
        data = json.loads(text)
    except Exception:
        return []
    all_rows: list[dict] = []
    for key in sorted(data.keys()):
        v = data[key]
        if v and isinstance(v, str) and "<t" in v.lower():
            try:
                rows = parse_html_table(v.encode("utf-8"))
                all_rows.extend(rows)
            except Exception:
                continue
    return all_rows


def _normalise_attendance(rows: list[dict]) -> list[dict]:
    """Map v3 attendance columns. v3 typically returns:
      Member Id, Name, Contact No, Check In, Check Out, Date, Branch
    Field names vary across v3 versions — we accept several aliases.
    """
    normalised: list[dict] = []
    for r in rows:
        member_id = (r.get("Member Id") or r.get("MemberId") or "").strip()
        contact = (r.get("Contact No") or r.get("ContactNo") or "").strip()
        check_in = (r.get("Check In") or r.get("CheckIn") or r.get("In Time") or "").strip()
        check_out = (r.get("Check Out") or r.get("CheckOut") or r.get("Out Time") or "").strip()
        att_date = (r.get("Date") or r.get("Attendance Date") or r.get("AttendanceDate") or "").strip()
        if not (member_id or contact):
            continue
        if not check_in:
            continue
        normalised.append(
            {
                "MemberId": member_id,
                "ContactNo": contact,
                "MemberName": (r.get("Name") or r.get("Member Name") or "").strip(),
                "CheckIn": check_in,
                "CheckOut": check_out,
                "AttendanceDate": att_date,
            }
        )
    return normalised


def fetch_balances(cookie: str) -> list[dict]:
    """Fetch the v3 'balance' report — members with outstanding balances."""
    today = date.today().strftime("%d-%m-%Y")
    url = (
        f"/Dashboard/ExportToExcel?exportfor=balance"
        f"&StartDate={DEFAULT_START}&EndDate={today}&mstat=0"
    )
    try:
        raw = v3_get(url, cookie, referer=f"{V3_BASE}/Dashboard/DataReport")
    except urllib.error.HTTPError as e:
        log(f"  balance v3 HTTP {e.code} — skipping")
        return []
    if raw.startswith(b"PK\x03\x04"):
        log("  balance returned XLSX binary — skipping (can't decode)")
        return []
    rows = parse_html_table(raw)
    log(f"  parsed {len(rows)} balance rows from v3")
    return _normalise_balances(rows)


def _normalise_balances(rows: list[dict]) -> list[dict]:
    """Map v3 balance columns to the keys the sync API expects.

    v3 export headers:
      Sr No., Reg. Id, Branch Name, Member Id, Member Name, Contact No,
      Balance Amt., Next FollowUp Date, Email Id, Sales Rep., Trainer,
      Membership, Billing Owner, External No., Prospect Stat, Purchased Date,
      Pending Since
    """
    normalised: list[dict] = []
    for r in rows:
        member_id = (r.get("Member Id") or r.get("MemberId") or "").strip()
        contact = (r.get("Contact No") or r.get("ContactNo") or "").strip()
        if not member_id and not contact:
            continue
        normalised.append(
            {
                "MemberId": member_id,
                "ContactNo": contact,
                "MemberName": (r.get("Member Name") or r.get("Name") or "").strip(),
                "BalanceAmount": (r.get("Balance Amt.") or r.get("BalanceAmount") or "0").strip(),
                "Membership": (r.get("Membership") or "").strip(),
                "PurchasedDate": (r.get("Purchased Date") or "").strip(),
                "PendingSince": (r.get("Pending Since") or "").strip(),
                "NextFollowUpDate": (r.get("Next FollowUp Date") or "").strip(),
                "Trainer": (r.get("Trainer") or "").strip(),
                "SalesRep": (r.get("Sales Rep.") or r.get("SalesRep") or "").strip(),
            }
        )
    return normalised


def main() -> int:
    p = argparse.ArgumentParser(description="v3 FitnessBoard → TraqGym sync")
    p.add_argument("--gym-base-url", default=os.environ.get("GYM_BASE_URL"))
    p.add_argument("--internal-secret", default=os.environ.get("INTERNAL_API_SECRET"))
    args = p.parse_args()
    if not args.gym_base_url or not args.internal_secret:
        print(
            "ERROR: --gym-base-url and --internal-secret (or GYM_BASE_URL + "
            "INTERNAL_API_SECRET env vars) are required.",
            file=sys.stderr,
        )
        return 2
    try:
        return run(args.gym_base_url, args.internal_secret)
    except Exception as e:
        log(f"FATAL: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
