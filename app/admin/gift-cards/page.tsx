"use client";

import { useEffect, useState, useTransition } from "react";
import { createGiftCard, getGiftCards } from "@/lib/actions/gift-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GiftCard = {
  id: number;
  code: string;
  amount: number;
  balance: number;
  status: string;
  recipientName: string | null;
  recipientPhone: string | null;
  purchaserId: number | null;
  expiresAt: string | Date | null;
  createdAt: string | Date;
};

function statusColor(s: string): string {
  switch (s) {
    case "active":
      return "bg-status-active-bg text-status-active-foreground border-status-active/30";
    case "redeemed":
      return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300";
    case "expired":
      return "bg-status-expired-bg text-status-expired-foreground border-status-expired/30";
    default:
      return "";
  }
}

export default function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const status = filterStatus && filterStatus !== "all" ? filterStatus : undefined;
      const data = await getGiftCards(status);
      setCards(data as GiftCard[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const openCreate = () => {
    setErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = parseFloat(fd.get("amount") as string);
    const recipientName = (fd.get("recipientName") as string).trim() || undefined;
    const recipientPhone = (fd.get("recipientPhone") as string).trim() || undefined;
    const expiresAt = (fd.get("expiresAt") as string) || undefined;

    if (!amount || amount <= 0) {
      setErrors({ amount: "Enter a valid amount" });
      return;
    }

    startTransition(async () => {
      const result = await createGiftCard({
        amount,
        recipientName,
        recipientPhone,
        expiresAt,
      });
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setDialogOpen(false);
        load();
      }
    });
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Gift Cards</h1>
        <Button onClick={openCreate}>Create Gift Card</Button>
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label>Status</Label>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="redeemed">Redeemed</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Recipient</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono font-medium">{c.code}</TableCell>
              <TableCell className="text-right">{fmt(c.amount)}</TableCell>
              <TableCell className="text-right">{fmt(c.balance)}</TableCell>
              <TableCell>
                <Badge className={statusColor(c.status)}>{c.status}</Badge>
              </TableCell>
              <TableCell>{c.recipientName ?? "-"}</TableCell>
              <TableCell>{c.recipientPhone ?? "-"}</TableCell>
              <TableCell>
                {c.expiresAt
                  ? new Date(c.expiresAt).toLocaleDateString("en-IN")
                  : "-"}
              </TableCell>
              <TableCell>
                {new Date(c.createdAt).toLocaleDateString("en-IN")}
              </TableCell>
            </TableRow>
          ))}
          {cards.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No gift cards found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Gift Card</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="1"
                key="new-amount"
              />
              {errors.amount && (
                <p className="text-xs text-destructive mt-1">{errors.amount}</p>
              )}
            </div>
            <div>
              <Label htmlFor="recipientName">Recipient Name</Label>
              <Input
                id="recipientName"
                name="recipientName"
                key="new-rname"
              />
            </div>
            <div>
              <Label htmlFor="recipientPhone">Recipient Phone</Label>
              <Input
                id="recipientPhone"
                name="recipientPhone"
                key="new-rphone"
              />
            </div>
            <div>
              <Label htmlFor="expiresAt">Expiry Date</Label>
              <Input
                id="expiresAt"
                name="expiresAt"
                type="date"
                key="new-expiry"
              />
            </div>
            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
