"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getProductsAction,
  sellProductAction,
  restockProductAction,
} from "@/lib/actions/pos";
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
import { Loader2 } from "lucide-react";

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  isActive: boolean;
};

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sellOpen, setSellOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getProductsAction();
      setProducts(data as Product[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSell = (p: Product) => {
    setSelected(p);
    setErrors({});
    setSellOpen(true);
  };

  const openRestock = (p: Product) => {
    setSelected(p);
    setErrors({});
    setRestockOpen(true);
  };

  const handleSell = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    const quantity = parseInt(fd.get("quantity") as string, 10);
    const paymentMode = fd.get("paymentMode") as string;

    if (!quantity || quantity < 1) {
      setErrors({ quantity: "Enter a valid quantity" });
      return;
    }
    if (!paymentMode) {
      setErrors({ paymentMode: "Select payment mode" });
      return;
    }

    startTransition(async () => {
      const result = await sellProductAction({
        productId: selected.id,
        quantity,
        paymentMode,
      });
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setSellOpen(false);
        load();
      }
    });
  };

  const handleRestock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    const quantity = parseInt(fd.get("quantity") as string, 10);
    const reason = fd.get("reason") as string;

    if (!quantity || quantity < 1) {
      setErrors({ quantity: "Enter a valid quantity" });
      return;
    }

    startTransition(async () => {
      const result = await restockProductAction(
        selected.id,
        quantity,
        reason || undefined
      );
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setRestockOpen(false);
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Point of Sale</h1>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="hidden md:table-cell">
                <Badge variant="outline" className="capitalize">
                  {p.category}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{fmt(p.price)}</TableCell>
              <TableCell className="text-right">
                {p.stock}
                {p.stock < 10 && (
                  <Badge className="ml-2 bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30">
                    Low
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => openSell(p)}
                    disabled={p.stock === 0}
                  >
                    Sell
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openRestock(p)}
                  >
                    Restock
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {products.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No products found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Sell Dialog */}
      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sell: {selected?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSell} className="space-y-3">
            <div>
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                max={selected?.stock ?? 1}
                defaultValue={1}
                key={`sell-qty-${selected?.id ?? "none"}`}
              />
              {errors.quantity && (
                <p className="text-xs text-destructive mt-1">{errors.quantity}</p>
              )}
            </div>
            <div>
              <Label htmlFor="paymentMode">Payment Mode</Label>
              <select
                id="paymentMode"
                name="paymentMode"
                defaultValue=""
                key={`sell-pm-${selected?.id ?? "none"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select...</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
              </select>
              {errors.paymentMode && (
                <p className="text-xs text-destructive mt-1">{errors.paymentMode}</p>
              )}
            </div>
            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Confirm Sale
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Restock Dialog */}
      <Dialog open={restockOpen} onOpenChange={setRestockOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restock: {selected?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRestock} className="space-y-3">
            <div>
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                defaultValue={1}
                key={`restock-qty-${selected?.id ?? "none"}`}
              />
              {errors.quantity && (
                <p className="text-xs text-destructive mt-1">{errors.quantity}</p>
              )}
            </div>
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                name="reason"
                defaultValue=""
                key={`restock-reason-${selected?.id ?? "none"}`}
              />
            </div>
            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Restock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
