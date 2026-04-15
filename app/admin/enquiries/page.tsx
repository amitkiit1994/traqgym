"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getEnquiries,
  createEnquiry,
  updateEnquiry,
  convertEnquiry,
} from "@/lib/actions/enquiries";
import { getActiveLocations } from "@/lib/actions/renewals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { TablePagination } from "@/components/ui/table-pagination";

type Enquiry = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  interest: string | null;
  locationName: string | null;
  locationId: number | null;
  status: string;
  followUpDate: string | null;
  notes: string | null;
  assignedTo: number | null;
  convertedUserId: number | null;
  createdAt: string;
};

type Location = { id: number; name: string; isActive: boolean };

const statusColors: Record<string, string> = {
  new: "bg-status-info-bg text-status-info-foreground",
  contacted: "bg-status-frozen-bg text-status-frozen-foreground",
  follow_up: "bg-status-expiring-bg text-status-expiring-foreground",
  converted: "bg-status-active-bg text-status-active-foreground",
  lost: "bg-status-expired-bg text-status-expired-foreground",
};

const sourceLabels: Record<string, string> = {
  walk_in: "Walk-in",
  referral: "Referral",
  social_media: "Social Media",
  website: "Website",
  advertisement: "Advertisement",
  passing_by: "Passing By",
  phone_enquiry: "Phone Enquiry",
  banner: "Banner",
  email_campaign: "Email Campaign",
  other: "Other",
};

const statusOptions = ["all", "overdue", "new", "contacted", "follow_up", "converted", "lost"];
const PAGE_SIZE = 25;

export default function EnquiriesPage() {
  const searchParams = useSearchParams();
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filter, setFilter] = useState(() => {
    const urlStatus = searchParams.get("status");
    if (urlStatus && statusOptions.includes(urlStatus)) return urlStatus;
    return "all";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isPending, startTransition] = useTransition();

  // New enquiry dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newSource, setNewSource] = useState("walk_in");
  const [newInterest, setNewInterest] = useState("");
  const [newLocationId, setNewLocationId] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newFollowUp, setNewFollowUp] = useState("");

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editEnquiry, setEditEnquiry] = useState<Enquiry | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFollowUp, setEditFollowUp] = useState("");

  const router = useRouter();

  // Convert dialog
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertEnquiryId, setConvertEnquiryId] = useState<number | null>(null);
  const [convertError, setConvertError] = useState("");

  const load = (p?: number, search?: string) => {
    const currentPage = p ?? page;
    const currentSearch = search ?? searchQuery;
    startTransition(async () => {
      const [result, locs] = await Promise.all([
        getEnquiries({
          status: filter === "all" ? undefined : filter,
          search: currentSearch || undefined,
          page: currentPage,
          pageSize: PAGE_SIZE,
          sortBy,
          sortOrder,
        }),
        getActiveLocations(),
      ]);
      setEnquiries(result.data);
      setTotal(result.total);
      setLocations(locs);
    });
  };

  useEffect(() => {
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sortBy, sortOrder]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleCreate = () => {
    startTransition(async () => {
      const res = await createEnquiry({
        name: newName,
        phone: newPhone,
        email: newEmail || undefined,
        source: newSource,
        interest: newInterest || undefined,
        locationId: newLocationId ? parseInt(newLocationId, 10) : undefined,
        notes: newNotes || undefined,
        followUpDate: newFollowUp || undefined,
      });
      if (res.success) {
        setNewOpen(false);
        setNewName(""); setNewPhone(""); setNewEmail(""); setNewSource("walk_in");
        setNewInterest(""); setNewLocationId(""); setNewNotes(""); setNewFollowUp("");
        load();
      }
    });
  };

  const handleEdit = (e: Enquiry) => {
    setEditEnquiry(e);
    setEditStatus(e.status);
    setEditNotes(e.notes || "");
    setEditFollowUp(e.followUpDate ? e.followUpDate.split("T")[0] : "");
    setEditOpen(true);
  };

  const handleUpdate = () => {
    if (!editEnquiry) return;
    startTransition(async () => {
      await updateEnquiry(editEnquiry.id, {
        status: editStatus,
        notes: editNotes,
        followUpDate: editFollowUp || null,
      });
      setEditOpen(false);
      load();
    });
  };

  const handleConvertClick = (e: Enquiry) => {
    setConvertEnquiryId(e.id);
    setConvertError("");
    setConvertOpen(true);
  };

  const handleConvert = () => {
    if (!convertEnquiryId) return;

    startTransition(async () => {
      const result = await convertEnquiry(convertEnquiryId);

      if (result.error) {
        setConvertError(result.error);
        return;
      }

      setConvertOpen(false);
      if (result.userId) {
        router.push(`/admin/renewals?userId=${result.userId}`);
      } else {
        load();
      }
    });
  };

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold">Enquiries</h1>
          <Button onClick={() => setNewOpen(true)}>New Enquiry</Button>
        </div>

        {/* Status Filter */}
        <div className="flex gap-2 flex-wrap">
          {statusOptions.map((s) => (
            <Button
              key={s}
              variant={filter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(s)}
            >
              {s === "all" ? "All" : s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </Button>
          ))}
        </div>

        <SearchInput
          placeholder="Search by name or phone..."
          defaultValue={searchQuery}
          onSearch={(q) => {
            setSearchQuery(q);
            setPage(1);
            load(1, q);
          }}
          isPending={isPending}
          className="w-full sm:w-72"
        />
      </div>

      {/* Table */}
      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CardContent className="flex-1 min-h-0 overflow-y-auto p-0">
          {enquiries.length === 0 && !isPending ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <MessageSquare className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No enquiries found</p>
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>Name</SortableTableHead>
                    <SortableTableHead field="phone" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden md:table-cell">Phone</SortableTableHead>
                    <SortableTableHead field="source" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden md:table-cell">Source</SortableTableHead>
                    <TableHead>Interest</TableHead>
                    <SortableTableHead field="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>Status</SortableTableHead>
                    <SortableTableHead field="followUpDate" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden md:table-cell">Follow-up</SortableTableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enquiries.map((e) => {
                    const daysSinceCreated = Math.floor(
                      (Date.now() - new Date(e.createdAt).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    const isStale = daysSinceCreated > 30 && !["converted", "lost"].includes(e.status);
                    return (
                    <TableRow
                      key={e.id}
                      className={`cursor-pointer hover:bg-muted/30 ${isStale ? "opacity-60" : ""}`}
                      onClick={() => handleEdit(e)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {e.name}
                          {isStale && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">Stale</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{e.phone}</TableCell>
                      <TableCell className="hidden md:table-cell">{sourceLabels[e.source] || e.source}</TableCell>
                      <TableCell>{e.interest || "-"}</TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[e.status] || ""}`}>
                          {e.status.replace("_", " ")}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {e.followUpDate ? new Date(e.followUpDate).toLocaleDateString("en-IN") : "-"}
                      </TableCell>
                      <TableCell>
                        {e.status === "converted" ? (
                          <Badge variant="active">Converted</Badge>
                        ) : e.status !== "lost" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(ev) => { ev.stopPropagation(); handleConvertClick(e); }}
                          >
                            Convert
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
          )}
        </CardContent>
      </Card>

      <div className="shrink-0">
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p) => {
            setPage(p);
            load(p);
          }}
          disabled={isPending}
        />
      </div>

      {/* New Enquiry Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Enquiry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div>
              <Label>Source</Label>
              <select
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Interest</Label>
              <Input value={newInterest} onChange={(e) => setNewInterest(e.target.value)} placeholder="e.g., Monthly plan" />
            </div>
            <div>
              <Label>Location</Label>
              <select
                value={newLocationId}
                onChange={(e) => setNewLocationId(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="">None</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Follow-up Date</Label>
              <Input type="date" value={newFollowUp} onChange={(e) => setNewFollowUp(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Enquiry - {editEnquiry?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Status</Label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="follow_up">Follow Up</option>
                <option value="converted">Converted</option>
                <option value="lost">Lost</option>
              </select>
            </div>
            <div>
              <Label>Follow-up Date</Label>
              <Input type="date" value={editFollowUp} onChange={(e) => setEditFollowUp(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <textarea
                className="flex w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm min-h-[80px]"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUpdate} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isPending ? "Saving..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will create a new member account from this enquiry and redirect you to set up their first membership.
            </p>
            {convertError && (
              <p className="text-sm text-destructive">{convertError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
            <Button onClick={handleConvert} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isPending ? "Converting..." : "Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
