# Logic Audit — Known Bugs and Design Concerns

## 1. Freeze cancel-after-renewal date corruption

- **File**: `lib/services/freeze.ts`, lines 92-118
- **Issue**: `cancelFreeze` subtracts `daysAdded` from the ticket's **current** `expireDate`. If a renewal occurred between freeze and cancel, the expiry was already replaced by the renewal. Subtracting the freeze days from the new expiry steals days from the paid renewal.
- **Scenario**: Ticket expires day 30. Freeze adds 10 days (expiry = 40). Renewal sets expiry = 70. Cancel freeze: 70 - 10 = 60. Member loses 10 paid days.
- **Root cause**: `MembershipFreeze` stores `daysAdded` but not the original pre-freeze expiry date. `cancelFreeze` assumes the current expiry is still the freeze-extended value.
- **Impact**: Financial loss for members who renew while frozen.
- **Severity**: **Critical**
- **Fix**: Store `originalExpiry` on `MembershipFreeze` at freeze time. On cancel, restore `originalExpiry` instead of doing arithmetic. Alternatively, skip subtraction if `ticket.expireDate` differs from `(originalExpiry + daysAdded)`.

## 2. Churn detection silently caps at 50

- **File**: `lib/services/churn-detection.ts`, line 56
- **Issue**: The inactive members query has a hard-coded `take: 50`. Gyms with more than 50 at-risk members will silently miss the rest. No warning, no pagination, no log.
- **Impact**: Churn alerts become unreliable as a gym grows. Staff thinks they have 50 at-risk members when there are 200.
- **Severity**: **High**
- **Fix**: Remove the `take: 50` or make it configurable. If performance is a concern, add pagination with a `page`/`cursor` parameter, or at minimum return a `hasMore` flag so the UI can warn staff.

## 3. Invoice year boundary (UTC vs IST)

- **File**: `lib/services/invoice.ts`, line 13
- **Issue**: `getNextInvoiceNumber` uses `new Date().getFullYear()` which returns the year in the server's timezone. If the server runs in UTC, invoices generated between 18:30 UTC Dec 31 and 00:00 UTC Jan 1 (which is 00:00-05:30 IST Jan 1) get the wrong year prefix: `INV-2025-NNNN` instead of `INV-2026-NNNN`.
- **Impact**: Invoice numbering is wrong for ~5.5 hours around New Year. This can cause accounting/GST issues for Indian businesses.
- **Severity**: **Medium** (only affects the ~5.5h window around midnight IST on Dec 31)
- **Fix**: Use the project's existing `todayIST()` or `nowIST()` from `lib/utils/date.ts` instead of raw `new Date()`.

## 4. Attendance dedup is per-location

- **File**: `lib/services/attendance.ts`, lines 49-55
- **Schema**: `@@unique([userId, locationId, attendanceDate])` in `AttendanceLog`
- **Issue**: The unique constraint and the dedup query both include `locationId`. A member can check in at location A and location B on the same day. This may be intentional for multi-location gyms, but it is not documented and could inflate attendance metrics.
- **Impact**: Attendance counts and reports may double-count members who visit multiple locations. Revenue-per-visit calculations could be skewed.
- **Severity**: **Low** (likely intentional, but undocumented)
- **Fix**: If intentional, add a code comment and handle in reporting. If not, change the unique constraint to `@@unique([userId, attendanceDate])` and remove `locationId` from the dedup query.

## 5. Auth email collision — Worker wins

- **File**: `lib/auth.ts`, lines 18-49
- **Issue**: The `authorize` callback checks the `Worker` table first, then `User`. If the same email exists in both tables with the same password, the user always gets a worker session. There is no way to choose which identity to log in as.
- **Impact**: A person who is both a staff member and a gym member (e.g., a trainer with a personal membership) can never access the member portal if their Worker and User accounts share the same email and password.
- **Severity**: **Medium**
- **Fix**: Add a `loginAs` field to the credentials form (e.g., "staff" or "member") and check the appropriate table first. Or enforce email uniqueness across both tables at registration time.
