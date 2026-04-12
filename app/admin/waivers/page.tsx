"use client";

import { useEffect, useState, useTransition } from "react";
import { createTemplate, getTemplates } from "@/lib/actions/waivers";
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

type Template = {
  id: number;
  name: string;
  content: string;
  required: boolean;
  isActive: boolean;
  createdAt: string | Date;
};

export default function WaiversPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getTemplates();
      setTemplates(data as Template[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const content = (fd.get("content") as string).trim();
    const required = fd.get("required") === "on";

    if (!name) {
      setErrors({ name: "Name is required" });
      return;
    }
    if (!content) {
      setErrors({ content: "Content is required" });
      return;
    }

    startTransition(async () => {
      const result = await createTemplate({ name, content, required });
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setDialogOpen(false);
        load();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Waiver Templates</h1>
        <Button onClick={openCreate}>Create Template</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell>
                <Badge
                  className={
                    t.required
                      ? "bg-status-expired-bg text-status-expired-foreground border-status-expired/30"
                      : "bg-status-active-bg text-status-active-foreground border-status-active/30"
                  }
                >
                  {t.required ? "Required" : "Optional"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  className={
                    t.isActive
                      ? "bg-status-active-bg text-status-active-foreground border-status-active/30"
                      : "bg-status-expired-bg text-status-expired-foreground border-status-expired/30"
                  }
                >
                  {t.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                {new Date(t.createdAt).toLocaleDateString("en-IN")}
              </TableCell>
            </TableRow>
          ))}
          {templates.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No waiver templates found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Waiver Template</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" key="new-name" />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="content">Content</Label>
              <textarea
                id="content"
                name="content"
                rows={6}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                key="new-content"
              />
              {errors.content && (
                <p className="text-xs text-destructive mt-1">{errors.content}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="required"
                name="required"
                defaultChecked
                className="size-4 rounded border-input"
              />
              <Label htmlFor="required">Required for all members</Label>
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
