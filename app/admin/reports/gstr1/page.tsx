"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLocations } from "@/lib/actions/locations";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LocationOption = { id: number; name: string; isActive: boolean };

const QUARTERS: { value: string; label: string }[] = [
  { value: "1", label: "Q1 (Apr-Jun)" },
  { value: "2", label: "Q2 (Jul-Sep)" },
  { value: "3", label: "Q3 (Oct-Dec)" },
  { value: "4", label: "Q4 (Jan-Mar)" },
];

function currentIndianFiscalQuarter(): { quarter: string; year: string } {
  const d = new Date();
  const m = d.getMonth(); // 0-indexed
  if (m >= 3 && m <= 5) return { quarter: "1", year: String(d.getFullYear()) };
  if (m >= 6 && m <= 8) return { quarter: "2", year: String(d.getFullYear()) };
  if (m >= 9 && m <= 11) return { quarter: "3", year: String(d.getFullYear()) };
  return { quarter: "4", year: String(d.getFullYear()) };
}

export default function Gstr1Page() {
  const initial = currentIndianFiscalQuarter();
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [quarter, setQuarter] = useState(initial.quarter);
  const [year, setYear] = useState(initial.year);
  const [locationId, setLocationId] = useState("");
  const [scheme, setScheme] = useState<string>("regular");

  useEffect(() => {
    getLocations().then((locs) => {
      const active = locs.filter((l) => l.isActive);
      setLocations(active);
      if (active.length === 1) setLocationId(String(active[0].id));
    });
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.gym_gst_scheme === "string") {
          setScheme(data.gym_gst_scheme || "regular");
        }
      })
      .catch(() => undefined);
  }, []);

  const isComposition = scheme === "composition";

  const downloadHref = (() => {
    const params = new URLSearchParams();
    params.set("quarter", quarter);
    params.set("year", year);
    if (locationId) params.set("locationId", locationId);
    return `/api/admin/reports/gstr1?${params.toString()}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/reports"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Reports
        </Link>
        <h1 className="text-xl font-semibold">GSTR-1 (Quarterly)</h1>
      </div>

      {isComposition && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">
              Your gym is on the GST <strong>composition</strong> scheme. File
              <span className="font-medium"> CMP-08</span> instead of GSTR-1 —
              this report is not applicable. Update the scheme in
              <Link
                href="/admin/settings"
                className="underline underline-offset-2 ml-1"
              >
                Settings &rarr; Tax &amp; Accounting
              </Link>{" "}
              if needed.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Download a quarterly GSTR-1 CSV summarising taxable value, CGST,
            SGST and IGST for each invoice. Customers with a saved GSTIN are
            classified as B2B; the rest are B2C. State of supply is inferred
            from the gym GSTIN vs the customer GSTIN state code.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Quarter</Label>
              <Select
                value={quarter}
                onValueChange={(v) => setQuarter(v ?? "1")}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Year</Label>
              <Select value={year} onValueChange={(v) => setYear(v ?? String(currentYear))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {locations.length > 1 && (
              <div>
                <Label>Location</Label>
                <Select
                  value={locationId}
                  onValueChange={(v) => setLocationId(v ?? "")}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All locations">
                      {locationId
                        ? locations.find((l) => String(l.id) === locationId)
                            ?.name ?? "All Locations"
                        : "All Locations"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Locations</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {locations.length === 1 && (
              <div>
                <Label>Location</Label>
                <span className="flex h-9 items-center text-sm text-muted-foreground">
                  {locations[0].name}
                </span>
              </div>
            )}
            {isComposition ? (
              <span
                className={buttonVariants({ variant: "outline" })}
                aria-disabled
                style={{ opacity: 0.5, pointerEvents: "none" }}
              >
                Download CSV
              </span>
            ) : (
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants()}
              >
                Download CSV
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
