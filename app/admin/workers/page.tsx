"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getWorkers,
  createWorker,
  updateWorker,
  toggleWorkerActive,
} from "@/lib/actions/workers";
import { getLocations } from "@/lib/actions/locations";
import { resetWorkerPassword } from "@/lib/actions/password";
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
import { UserCog } from "lucide-react";

type Worker = {
  id: number;
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  role: string;
  locationId: number | null;
  location: { id: number; name: string } | null;
  isActive: boolean;
  createdAt: Date;
};

type LocationOption = {
  id: number;
  name: string;
};

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedRole, setSelectedRole] = useState("staff");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwWorkerId, setResetPwWorkerId] = useState<number | null>(null);
  const [resetPwMsg, setResetPwMsg] = useState("");

  const load = () => {
    startTransition(async () => {
      const [w, l] = await Promise.all([getWorkers(), getLocations()]);
      setWorkers(w as Worker[]);
      setLocations(l.map((loc) => ({ id: loc.id, name: loc.name })));
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setErrors({});
    setSelectedRole("staff");
    setSelectedLocationId("");
    setDialogOpen(true);
  };

  const openEdit = (w: Worker) => {
    setEditing(w);
    setErrors({});
    setSelectedRole(w.role);
    setSelectedLocationId(w.locationId ? String(w.locationId) : "");
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const locId = selectedLocationId
      ? parseInt(selectedLocationId, 10)
      : null;

    if (editing) {
      const data = {
        firstname: fd.get("firstname") as string,
        lastname: fd.get("lastname") as string,
        email: fd.get("email") as string,
        role: selectedRole,
        locationId: locId,
        password: (fd.get("password") as string) || undefined,
      };
      startTransition(async () => {
        const result = await updateWorker(editing.id, data);
        if (result.errors) {
          setErrors(result.errors);
        } else {
          setDialogOpen(false);
          load();
        }
      });
    } else {
      const data = {
        firstname: fd.get("firstname") as string,
        lastname: fd.get("lastname") as string,
        email: fd.get("email") as string,
        password: fd.get("password") as string,
        role: selectedRole,
        locationId: locId,
      };
      startTransition(async () => {
        const result = await createWorker(data);
        if (result.errors) {
          setErrors(result.errors);
        } else {
          setDialogOpen(false);
          load();
        }
      });
    }
  };

  const openResetPw = (id: number) => {
    setResetPwWorkerId(id);
    setResetPwMsg("");
    setResetPwOpen(true);
  };

  const handleResetPw = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resetPwWorkerId) return;
    const fd = new FormData(e.currentTarget);
    const newPassword = fd.get("newPassword") as string;
    const result = await resetWorkerPassword(resetPwWorkerId, newPassword);
    if (result.errors) {
      setResetPwMsg(result.errors.password || "Error");
      return;
    }
    setResetPwMsg("Password reset successfully");
    setTimeout(() => setResetPwOpen(false), 1500);
  };

  const handleToggle = (id: number) => {
    startTransition(async () => {
      await toggleWorkerActive(id);
      load();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workers</h1>
        <Button onClick={openCreate}>Add Worker</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workers.map((w) => (
            <TableRow key={w.id}>
              <TableCell>
                {w.firstname} {w.lastname}
              </TableCell>
              <TableCell>{w.email}</TableCell>
              <TableCell>{w.role}</TableCell>
              <TableCell>{w.location?.name ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={w.isActive ? "default" : "secondary"}>
                  {w.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(w)}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => openResetPw(w.id)}>
                  Reset PW
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggle(w.id)}
                  disabled={isPending}
                >
                  {w.isActive ? "Deactivate" : "Activate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {workers.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <UserCog className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No workers found</p>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Worker Password</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleResetPw} className="space-y-3">
            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <Input id="newPassword" name="newPassword" type="password" minLength={6} required />
            </div>
            {resetPwMsg && (
              <p className={`text-xs ${resetPwMsg.includes("success") ? "text-status-active" : "text-destructive"}`}>
                {resetPwMsg}
              </p>
            )}
            <DialogFooter>
              <Button type="submit">Reset Password</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Worker" : "Add Worker"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="firstname">First Name</Label>
              <Input
                id="firstname"
                name="firstname"
                defaultValue={editing?.firstname ?? ""}
                key={`fn-${editing?.id ?? "new"}`}
              />
              {errors.firstname && (
                <p className="text-xs text-destructive mt-1">{errors.firstname}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastname">Last Name</Label>
              <Input
                id="lastname"
                name="lastname"
                defaultValue={editing?.lastname ?? ""}
                key={`ln-${editing?.id ?? "new"}`}
              />
              {errors.lastname && (
                <p className="text-xs text-destructive mt-1">{errors.lastname}</p>
              )}
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={editing?.email ?? ""}
                key={`em-${editing?.id ?? "new"}`}
              />
              {errors.email && (
                <p className="text-xs text-destructive mt-1">{errors.email}</p>
              )}
            </div>
            <div>
              <Label htmlFor="password">
                Password{editing ? " (leave blank to keep)" : ""}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                key={`pw-${editing?.id ?? "new"}`}
              />
              {errors.password && (
                <p className="text-xs text-destructive mt-1">{errors.password}</p>
              )}
            </div>
            <div>
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v ?? "staff")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="staff">staff</SelectItem>
                </SelectContent>
              </Select>
              {errors.role && (
                <p className="text-xs text-destructive mt-1">{errors.role}</p>
              )}
            </div>
            <div>
              <Label>Location</Label>
              <Select
                value={selectedLocationId}
                onValueChange={(v) => setSelectedLocationId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select location">{selectedLocationId ? locations.find((l) => String(l.id) === selectedLocationId)?.name ?? "Select location" : "Select location"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
