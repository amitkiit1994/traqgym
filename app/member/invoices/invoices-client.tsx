"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type InvoiceRow = {
  id: number;
  invoiceNumber: string;
  amount: number;
  date: string;
  status: string;
};

type Props = {
  invoices: InvoiceRow[];
  totalPaid: number;
  page: number;
  totalPages: number;
  search: string;
};

const formatINR = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

export function InvoicesClient({ invoices, totalPaid, page, totalPages, search }: Props) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(search);

  const navigate = (newPage: number, q?: string) => {
    const query = q ?? searchInput;
    const params = new URLSearchParams();
    if (newPage > 1) params.set("page", String(newPage));
    if (query) params.set("q", query);
    const qs = params.toString();
    router.push(`/member/invoices${qs ? `?${qs}` : ""}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(1, searchInput);
  };

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">Invoices</h1>

      {/* Total paid summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Total Paid</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl sm:text-2xl lg:text-3xl font-bold">{formatINR(totalPaid)}</p>
        </CardContent>
      </Card>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-sm">
        <Input
          placeholder="Search invoice number..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              navigate(1, "");
            }}
          >
            Clear
          </Button>
        )}
      </form>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead>Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono">
                    {inv.invoiceNumber}
                  </TableCell>
                  <TableCell>{formatINR(inv.amount)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {new Date(inv.date).toLocaleDateString("en-IN")}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge
                      variant={
                        inv.status === "paid" ? "default" : "secondary"
                      }
                    >
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <a
                      href={`/api/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline text-sm"
                    >
                      Download
                    </a>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    {search ? "No invoices matching search" : "No invoices yet"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => navigate(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => navigate(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
