"use client";

import { useEffect, useState, useTransition } from "react";
import {
  calculatePayroll,
  getPayrollSummary,
  processPayroll,
} from "@/lib/actions/payroll";
import { getWorkers } from "@/lib/actions/workers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type PayrollEntry = {
  id: number;
  workerId: number;
  workerName: string;
  role: string;
  baseSalary: number;
  commission: number;
  bonus: number;
  deductions: number;
  netPayable: number;
  status: string;
  paidAt: string | null;
};

type Worker = {
  id: number;
  firstname: string;
  lastname: string;
  role: string;
};

function statusColor(s: string): string {
  switch (s) {
    case "pending":
      return "bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30";
    case "processed":
      return "bg-status-info-bg text-status-info-foreground border-status-info/30";
    case "paid":
      return "bg-status-active-bg text-status-active-foreground border-status-active/30";
    default:
      return "";
  }
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default function PayrollPage() {
  const [payrolls, setPayrolls] = useState<PayrollEntry[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [month, setMonth] = useState(currentMonthYear().month);
  const [year, setYear] = useState(currentMonthYear().year);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcWorker, setCalcWorker] = useState<Worker | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const [data, ws] = await Promise.all([
        getPayrollSummary(month, year),
        getWorkers(),
      ]);
      setPayrolls(data as PayrollEntry[]);
      setWorkers(ws as Worker[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  const openCalc = (w: Worker) => {
    setCalcWorker(w);
    setErrors({});
    setCalcOpen(true);
  };

  const handleCalc = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!calcWorker) return;
    const fd = new FormData(e.currentTarget);
    const baseSalary = parseFloat(fd.get("baseSalary") as string);
    const bonus = parseFloat(fd.get("bonus") as string) || 0;
    const deductions = parseFloat(fd.get("deductions") as string) || 0;

    if (!baseSalary || baseSalary <= 0) {
      setErrors({ baseSalary: "Enter a valid salary" });
      return;
    }

    startTransition(async () => {
      const result = await calculatePayroll({
        workerId: calcWorker.id,
        month,
        year,
        baseSalary,
        bonus,
        deductions,
      });
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setCalcOpen(false);
        load();
      }
    });
  };

  const handleProcess = (id: number) => {
    startTransition(async () => {
      await processPayroll(id);
      load();
    });
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  const total = payrolls.reduce((s, p) => s + p.netPayable, 0);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Payroll</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Total Payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl md:text-2xl font-bold">{fmt(total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl md:text-2xl font-bold">
              {payrolls.filter((p) => p.status === "pending").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl md:text-2xl font-bold">
              {payrolls.filter((p) => p.status === "paid").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end flex-wrap">
        <div>
          <Label>Month</Label>
          <Input
            type="month"
            value={monthStr}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-");
              setYear(parseInt(y, 10));
              setMonth(parseInt(m, 10));
            }}
            className="w-full sm:w-40"
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Worker</TableHead>
            <TableHead className="text-right hidden md:table-cell">Base Salary</TableHead>
            <TableHead className="text-right hidden md:table-cell">Commission</TableHead>
            <TableHead className="text-right hidden md:table-cell">Bonus</TableHead>
            <TableHead className="text-right hidden md:table-cell">Deductions</TableHead>
            <TableHead className="text-right">Net Payable</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payrolls.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.workerName}</TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmt(p.baseSalary)}</TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmt(p.commission)}</TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmt(p.bonus)}</TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmt(p.deductions)}</TableCell>
              <TableCell className="text-right font-semibold">
                {fmt(p.netPayable)}
              </TableCell>
              <TableCell>
                <Badge className={statusColor(p.status)}>{p.status}</Badge>
              </TableCell>
              <TableCell>
                {p.status !== "paid" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleProcess(p.id)}
                    disabled={isPending}
                  >
                    {p.status === "pending" ? "Process" : "Mark Paid"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {payrolls.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No payroll records for this month
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {payrolls.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold">
                {fmt(total)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {/* Calculate for workers not yet in payroll */}
      {workers.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Calculate Payroll
          </h2>
          <div className="flex flex-wrap gap-2">
            {workers
              .filter(
                (w) => !payrolls.some((p) => p.workerId === w.id)
              )
              .map((w) => (
                <Button
                  key={w.id}
                  variant="outline"
                  size="sm"
                  onClick={() => openCalc(w)}
                >
                  {w.firstname} {w.lastname}
                </Button>
              ))}
          </div>
        </div>
      )}

      <Dialog open={calcOpen} onOpenChange={setCalcOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Calculate Payroll: {calcWorker?.firstname} {calcWorker?.lastname}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCalc} className="space-y-3">
            <div>
              <Label htmlFor="baseSalary">Base Salary</Label>
              <Input
                id="baseSalary"
                name="baseSalary"
                type="number"
                step="1"
                key={`bs-${calcWorker?.id ?? "none"}`}
              />
              {errors.baseSalary && (
                <p className="text-xs text-destructive mt-1">
                  {errors.baseSalary}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="bonus">Bonus</Label>
              <Input
                id="bonus"
                name="bonus"
                type="number"
                step="1"
                defaultValue={0}
                key={`bon-${calcWorker?.id ?? "none"}`}
              />
            </div>
            <div>
              <Label htmlFor="deductions">Deductions</Label>
              <Input
                id="deductions"
                name="deductions"
                type="number"
                step="1"
                defaultValue={0}
                key={`ded-${calcWorker?.id ?? "none"}`}
              />
            </div>
            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Calculate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
