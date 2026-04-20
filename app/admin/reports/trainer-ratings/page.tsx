"use client";

import { useEffect, useState, useTransition } from "react";
import { getTrainerRatingsAction } from "@/lib/actions/trainer-rating";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Star, AlertTriangle, Loader2 } from "lucide-react";

type Row = Awaited<ReturnType<typeof getTrainerRatingsAction>>[number];

const LOW_THRESHOLD = 3.5;

function ratingColor(avg: number): string {
  if (avg >= 4.5) return "text-green-500";
  if (avg >= 3.5) return "text-yellow-500";
  return "text-red-500";
}

export default function TrainerRatingsReportPage() {
  const [sinceDays, setSinceDays] = useState("30");
  const [rows, setRows] = useState<Row[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getTrainerRatingsAction(parseInt(sinceDays, 10));
      // Sort lowest first to surface problems
      data.sort((a, b) => a.averageRating - b.averageRating);
      setRows(data);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinceDays]);

  const flagged = rows.filter((r) => r.count >= 5 && r.averageRating < LOW_THRESHOLD);
  const totalRatings = rows.reduce((s, r) => s + r.count, 0);
  const overallAvg =
    totalRatings > 0
      ? Math.round(
          (rows.reduce((s, r) => s + r.averageRating * r.count, 0) / totalRatings) * 10
        ) / 10
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trainer Ratings Report</h1>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Window</Label>
            <Select value={sinceDays} onValueChange={(v) => setSinceDays(v ?? "30")}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={load} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Trainers Rated</p>
            <p className="text-2xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Ratings</p>
            <p className="text-2xl font-bold">{totalRatings}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Overall Avg</p>
            <p className={`text-2xl font-bold ${ratingColor(overallAvg)}`}>
              {overallAvg.toFixed(1)} <Star className="inline size-4 fill-current" />
            </p>
          </CardContent>
        </Card>
      </div>

      {flagged.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              {flagged.length} trainer{flagged.length === 1 ? "" : "s"} below {LOW_THRESHOLD}/5
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="text-sm space-y-1">
              {flagged.map((f) => (
                <li key={f.trainerId}>
                  <span className="font-medium">{f.trainerName}</span>{" "}
                  <span className="text-destructive">{f.averageRating.toFixed(1)}</span>{" "}
                  <span className="text-muted-foreground">({f.count} ratings)</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By Trainer</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead>Avg Rating</TableHead>
                <TableHead>Ratings</TableHead>
                <TableHead>By Class Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.trainerId}>
                  <TableCell className="font-medium">{r.trainerName}</TableCell>
                  <TableCell>
                    <span className={`font-semibold ${ratingColor(r.averageRating)}`}>
                      {r.averageRating.toFixed(1)}
                    </span>
                    {r.count >= 5 && r.averageRating < LOW_THRESHOLD && (
                      <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive">
                        Low
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.count}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {r.classBreakdown.map((c) => (
                        <Badge key={c.classType} variant="outline" className="text-xs">
                          {c.classType}: {c.averageRating.toFixed(1)} ({c.count})
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No trainer ratings in the selected window.
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
