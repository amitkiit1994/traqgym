"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createFamilyGroup,
  addMember,
  removeMember,
  getFamilyGroups,
} from "@/lib/actions/family";
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

type FamilyMember = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  isPrimary: boolean;
};

type FamilyGroup = {
  id: number;
  name: string;
  primaryMemberId: number;
  memberCount: number;
  members: FamilyMember[];
};

export default function FamilyPage() {
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addToGroupId, setAddToGroupId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getFamilyGroups();
      setGroups(data as FamilyGroup[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = (groupId: number) => {
    setExpandedGroup(expandedGroup === groupId ? null : groupId);
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const primaryMemberId = parseInt(fd.get("primaryMemberId") as string, 10);

    if (!name) {
      setErrors({ name: "Group name is required" });
      return;
    }
    if (!primaryMemberId) {
      setErrors({ primaryMemberId: "Enter a valid member ID" });
      return;
    }

    startTransition(async () => {
      const result = await createFamilyGroup({ name, primaryMemberId });
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setCreateOpen(false);
        load();
      }
    });
  };

  const openAddMember = (groupId: number) => {
    setAddToGroupId(groupId);
    setErrors({});
    setAddMemberOpen(true);
  };

  const handleAddMember = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!addToGroupId) return;
    const fd = new FormData(e.currentTarget);
    const userId = parseInt(fd.get("userId") as string, 10);

    if (!userId) {
      setErrors({ userId: "Enter a valid member ID" });
      return;
    }

    startTransition(async () => {
      const result = await addMember(addToGroupId, userId);
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setAddMemberOpen(false);
        load();
      }
    });
  };

  const handleRemove = (groupId: number, userId: number) => {
    startTransition(async () => {
      await removeMember(groupId, userId);
      load();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Family Groups</h1>
        <Button
          onClick={() => {
            setErrors({});
            setCreateOpen(true);
          }}
        >
          Create Group
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group Name</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <>
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{g.members.length} members</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleExpand(g.id)}
                    >
                      {expandedGroup === g.id ? "Collapse" : "Expand"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openAddMember(g.id)}
                    >
                      Add Member
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              {expandedGroup === g.id &&
                g.members.map((m) => (
                  <TableRow key={`${g.id}-${m.id}`} className="bg-muted/30">
                    <TableCell className="pl-8">
                      {m.name}
                      {m.isPrimary && (
                        <Badge className="ml-2 bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 hidden sm:inline-flex">
                          Primary
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{m.email}</TableCell>
                    <TableCell>
                      {!m.isPrimary && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemove(g.id, m.id)}
                          disabled={isPending}
                        >
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </>
          ))}
          {groups.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No family groups found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Family Group</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label htmlFor="name">Group Name</Label>
              <Input id="name" name="name" key="new-gname" />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="primaryMemberId">Primary Member ID</Label>
              <Input
                id="primaryMemberId"
                name="primaryMemberId"
                type="number"
                key="new-pmid"
              />
              {errors.primaryMemberId && (
                <p className="text-xs text-destructive mt-1">
                  {errors.primaryMemberId}
                </p>
              )}
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

      {/* Add Member Dialog */}
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Member to Group</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-3">
            <div>
              <Label htmlFor="userId">Member ID</Label>
              <Input
                id="userId"
                name="userId"
                type="number"
                key={`add-${addToGroupId ?? "none"}`}
              />
              {errors.userId && (
                <p className="text-xs text-destructive mt-1">{errors.userId}</p>
              )}
            </div>
            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
