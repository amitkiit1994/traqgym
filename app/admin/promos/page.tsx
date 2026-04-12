"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getPromoCodes,
  createPromoCode,
  togglePromoCode,
} from "@/lib/actions/promos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type PromoCode = {
  id: number;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses: number | null;
  usedCount: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  planIds: string | null;
  createdAt: string;
};

export default function PromosPage() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [isPending, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState("");

  // Form
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [planIds, setPlanIds] = useState("");

  const load = () => {
    startTransition(async () => {
      setPromos(await getPromoCodes());
    });
  };

  useEffect(() => { load(); }, []);

  const handleCreate = () => {
    setError("");
    startTransition(async () => {
      const res = await createPromoCode({
        code,
        discountType,
        discountValue: parseFloat(discountValue),
        maxUses: maxUses ? parseInt(maxUses, 10) : undefined,
        validFrom,
        validTo,
        planIds: planIds || undefined,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setNewOpen(false);
      setCode(""); setDiscountType("percentage"); setDiscountValue("");
      setMaxUses(""); setValidFrom(""); setValidTo(""); setPlanIds("");
      load();
    });
  };

  const handleToggle = (id: number, active: boolean) => {
    startTransition(async () => {
      await togglePromoCode(id, !active);
      load();
    });
  };

  const isExpired = (validTo: string) => {
    return new Date(validTo) < new Date();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Promo Codes</h1>
        <Button onClick={() => setNewOpen(true)}>New Promo</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Code</th>
                  <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Value</th>
                  <th className="px-4 py-2 text-left font-medium hidden md:table-cell">Valid From</th>
                  <th className="px-4 py-2 text-left font-medium hidden md:table-cell">Valid To</th>
                  <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">Uses</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="px-4 py-2 font-mono font-medium">{p.code}</td>
                    <td className="px-4 py-2 capitalize hidden sm:table-cell">{p.discountType}</td>
                    <td className="px-4 py-2">
                      {p.discountType === "percentage"
                        ? `${p.discountValue}%`
                        : `Rs.${p.discountValue}`}
                    </td>
                    <td className="px-4 py-2 hidden md:table-cell">{new Date(p.validFrom).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-2 hidden md:table-cell">{new Date(p.validTo).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-2 hidden sm:table-cell">
                      {p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""}
                    </td>
                    <td className="px-4 py-2">
                      {isExpired(p.validTo) ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : p.isActive ? (
                        <Badge variant="active">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggle(p.id, p.isActive)}
                        disabled={isPending}
                      >
                        {p.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {promos.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No promo codes
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Promo Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Code *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g., WELCOME20" />
            </div>
            <div>
              <Label>Discount Type</Label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="flat">Flat (Rs.)</option>
              </select>
            </div>
            <div>
              <Label>Discount Value *</Label>
              <Input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "percentage" ? "e.g., 20" : "e.g., 500"}
              />
            </div>
            <div>
              <Label>Max Uses (leave blank for unlimited)</Label>
              <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Valid From *</Label>
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div>
                <Label>Valid To *</Label>
                <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Plan IDs (comma-separated, blank = all)</Label>
              <Input value={planIds} onChange={(e) => setPlanIds(e.target.value)} placeholder="e.g., 1,2,3" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
