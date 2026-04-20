"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLocations } from "@/lib/actions/locations";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function startOfMonthStr(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1)
    .toISOString()
    .split("T")[0];
}

function endOfMonthStr(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];
}

export default function TallyExportPage() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [from, setFrom] = useState(startOfMonthStr());
  const [to, setTo] = useState(endOfMonthStr());
  const [locationId, setLocationId] = useState("");

  useEffect(() => {
    getLocations().then((locs) => {
      const active = locs.filter((l) => l.isActive);
      setLocations(active);
      if (active.length === 1) setLocationId(String(active[0].id));
    });
  }, []);

  const downloadHref = (() => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (locationId) params.set("locationId", locationId);
    return `/api/admin/reports/tally-export?${params.toString()}`;
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
        <h1 className="text-xl font-semibold">Tally Prime Export</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Download a voucher XML for your CA. Import into Tally Prime via
            <span className="font-medium"> Gateway of Tally &rarr; Import Data &rarr; Vouchers</span>,
            then point to the downloaded file. One sales voucher is created
            per invoice in the selected date range, with CGST/SGST or IGST
            split based on the gym and customer GSTIN state codes.
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
              <Label htmlFor="tally-from">From</Label>
              <Input
                id="tally-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <div>
              <Label htmlFor="tally-to">To</Label>
              <Input
                id="tally-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full sm:w-44"
              />
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
            <a
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants()}
              aria-disabled={!from || !to}
            >
              Download XML
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
