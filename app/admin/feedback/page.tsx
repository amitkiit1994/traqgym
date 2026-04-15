"use client";

import { useEffect, useState, useTransition } from "react";
import { getFeedbackAction, getFeedbackStatsAction } from "@/lib/actions/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { MessageCircle, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = ["all", "facility", "trainer", "cleanliness", "general"] as const;
const RATINGS = [0, 1, 2, 3, 4, 5] as const;

type FeedbackItem = {
  id: number;
  userId: number;
  rating: number;
  comment: string | null;
  category: string | null;
  createdAt: string;
  userName: string;
  userPhone: string | null;
};

type Stats = {
  averageRating: number;
  totalCount: number;
  countByCategory: Record<string, number>;
  countByRating: Record<number, number>;
  recentTrend: { thisMonth: number; lastMonth: number };
};

function Stars({ rating, size = "sm" }: { rating: number; size?: "sm" | "lg" }) {
  return (
    <span className={cn("inline-flex gap-0.5", size === "lg" ? "text-lg" : "text-sm")}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            size === "lg" ? "size-5" : "size-3.5",
            i <= rating
              ? "fill-yellow-500 text-yellow-500"
              : "text-muted-foreground/30"
          )}
        />
      ))}
    </span>
  );
}

function categoryColor(cat: string): string {
  switch (cat) {
    case "facility":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    case "trainer":
      return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
    case "cleanliness":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    case "general":
      return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    default:
      return "";
  }
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterRating, setFilterRating] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const cat = filterCategory === "all" ? undefined : filterCategory;
      const [data, s] = await Promise.all([
        getFeedbackAction({ category: cat, page, limit: 20 }),
        stats ? Promise.resolve(stats) : getFeedbackStatsAction(),
      ]);
      setItems(data.items);
      setTotalPages(data.totalPages);
      if (s) setStats(s);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory, filterRating, page]);

  // Client-side rating filter
  const displayed = filterRating > 0
    ? items.filter((f) => f.rating === filterRating)
    : items;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Member Feedback</h1>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 py-4 px-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">{stats.averageRating}</span>
                  <Stars rating={Math.round(stats.averageRating)} size="lg" />
                </div>
                <p className="text-xs text-muted-foreground">Average Rating</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4 px-4">
              <MessageCircle className="size-5 text-primary shrink-0" />
              <div>
                <p className="text-2xl font-bold">{stats.totalCount}</p>
                <p className="text-xs text-muted-foreground">Total Feedback</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4 px-4">
              <div>
                <p className="text-2xl font-bold">{stats.recentTrend.thisMonth}</p>
                <p className="text-xs text-muted-foreground">This Month</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={filterCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => { setFilterCategory(cat); setPage(1); }}
              className="capitalize"
            >
              {cat}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {RATINGS.map((r) => (
            <Button
              key={r}
              variant={filterRating === r ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterRating(r)}
            >
              {r === 0 ? "All" : (
                <span className="flex items-center gap-1">
                  {r} <Star className="size-3 fill-current" />
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="hidden md:table-cell">Comment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayed.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {new Date(f.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </TableCell>
              <TableCell className="font-medium">{f.userName}</TableCell>
              <TableCell>
                <Stars rating={f.rating} />
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={cn("capitalize", categoryColor(f.category || "general"))}>
                  {f.category || "general"}
                </Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell max-w-xs truncate text-muted-foreground">
                {f.comment || "-"}
              </TableCell>
            </TableRow>
          ))}
          {displayed.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <MessageCircle className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No feedback found</p>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
