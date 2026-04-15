"use client";

import { useEffect, useState, useTransition } from "react";
import { submitFeedbackAction, getMyFeedbackAction } from "@/lib/actions/member-feedback";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/table";
import { Star, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = ["facility", "trainer", "cleanliness", "general"];

type FeedbackItem = {
  id: number;
  rating: number;
  comment: string | null;
  category: string | null;
  createdAt: string;
};

function StarSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className="p-0.5 transition-transform hover:scale-110"
        >
          <Star
            className={cn(
              "size-7",
              i <= value
                ? "fill-yellow-500 text-yellow-500"
                : "text-muted-foreground/30 hover:text-yellow-500/50"
            )}
          />
        </button>
      ))}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "size-3.5",
            i <= rating
              ? "fill-yellow-500 text-yellow-500"
              : "text-muted-foreground/30"
          )}
        />
      ))}
    </span>
  );
}

export default function MemberFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState("general");
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getMyFeedbackAction();
      setItems(data.items);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      setMessage({ type: "error", text: "Please select a rating" });
      return;
    }
    startTransition(async () => {
      const result = await submitFeedbackAction({
        rating,
        category,
        comment: comment.trim() || undefined,
      });
      if (result.success) {
        setMessage({ type: "success", text: "Thank you for your feedback!" });
        setRating(0);
        setComment("");
        setCategory("general");
        load();
      } else {
        setMessage({ type: "error", text: result.error || "Something went wrong" });
      }
    });
  };

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">Feedback</h1>

      {/* Submit form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Share Your Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Rating</Label>
              <StarSelector value={rating} onChange={setRating} />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="comment">Comment (optional)</Label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none"
                placeholder="Tell us about your experience..."
              />
            </div>
            {message && (
              <p className={cn(
                "text-sm",
                message.type === "success" ? "text-green-600 dark:text-green-400" : "text-destructive"
              )}>
                {message.text}
              </p>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin mr-1" />}
              Submit Feedback
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Past feedback */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Past Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="hidden md:table-cell">Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(f.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <Stars rating={f.rating} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {f.category || "general"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-xs truncate text-muted-foreground">
                    {f.comment || "-"}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No feedback submitted yet.
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
