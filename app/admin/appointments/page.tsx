"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
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

type Appointment = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  userId: number;
  userName: string;
  userPhone: string | null;
  trainerId: number;
  trainerName: string;
};

type Trainer = {
  id: number;
  firstname: string;
  lastname: string;
  role: string;
};

type Member = {
  id: number;
  firstname: string;
  lastname: string;
  phone: string | null;
};

// Generate 30-min time slots from 6:00 AM to 10:00 PM
function generateTimeSlots() {
  const slots: string[] = [];
  for (let h = 6; h <= 22; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) {
      slots.push(`${String(h).padStart(2, "0")}:30`);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

function statusBadgeClass(status: string) {
  switch (status) {
    case "booked":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "completed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "cancelled":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    case "no_show":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    default:
      return "";
  }
}

export default function AppointmentsPage() {
  const today = new Date().toISOString().split("T")[0];
  const [filterDate, setFilterDate] = useState(today);
  const [filterTrainer, setFilterTrainer] = useState<number | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [isPending, startTransition] = useTransition();

  // Book dialog state
  const [bookOpen, setBookOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [bookTrainer, setBookTrainer] = useState<number | undefined>(undefined);
  const [bookDate, setBookDate] = useState(today);
  const [bookStart, setBookStart] = useState("09:00");
  const [bookEnd, setBookEnd] = useState("09:30");
  const [bookNotes, setBookNotes] = useState("");
  const [bookError, setBookError] = useState("");

  const loadTrainers = useCallback(() => {
    startTransition(async () => {
      const { getTrainersAction } = await import("@/lib/actions/appointments");
      const data = await getTrainersAction();
      setTrainers(data as Trainer[]);
    });
  }, []);

  const loadAppointments = useCallback(() => {
    startTransition(async () => {
      const { getAppointmentsAction } = await import("@/lib/actions/appointments");
      const data = await getAppointmentsAction({
        date: filterDate || undefined,
        trainerId: filterTrainer,
        status: filterStatus || undefined,
      });
      setAppointments(data as Appointment[]);
    });
  }, [filterDate, filterTrainer, filterStatus]);

  useEffect(() => {
    loadTrainers();
  }, [loadTrainers]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Member search
  useEffect(() => {
    if (memberQuery.length < 2) {
      setMemberResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { searchMembersAction } = await import("@/lib/actions/appointments");
      const results = await searchMembersAction(memberQuery);
      setMemberResults(results as Member[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [memberQuery]);

  const openBookDialog = () => {
    setSelectedMember(null);
    setMemberQuery("");
    setMemberResults([]);
    setBookTrainer(trainers.length > 0 ? trainers[0].id : undefined);
    setBookDate(today);
    setBookStart("09:00");
    setBookEnd("09:30");
    setBookNotes("");
    setBookError("");
    setBookOpen(true);
  };

  const handleBook = () => {
    if (!selectedMember) {
      setBookError("Select a member");
      return;
    }
    if (!bookTrainer) {
      setBookError("Select a trainer");
      return;
    }
    if (bookStart >= bookEnd) {
      setBookError("End time must be after start time");
      return;
    }

    startTransition(async () => {
      const { bookAppointmentAction } = await import("@/lib/actions/appointments");
      const result = await bookAppointmentAction({
        userId: selectedMember.id,
        trainerId: bookTrainer,
        date: bookDate,
        startTime: bookStart,
        endTime: bookEnd,
        notes: bookNotes || undefined,
      });
      if (result.success) {
        setBookOpen(false);
        loadAppointments();
      } else {
        setBookError(result.error ?? "Failed to book");
      }
    });
  };

  const handleCancel = (id: number) => {
    startTransition(async () => {
      const { cancelAppointmentAction } = await import("@/lib/actions/appointments");
      await cancelAppointmentAction(id);
      loadAppointments();
    });
  };

  const handleComplete = (id: number) => {
    startTransition(async () => {
      const { completeAppointmentAction } = await import("@/lib/actions/appointments");
      await completeAppointmentAction(id);
      loadAppointments();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Appointments</h1>
        <Button onClick={openBookDialog}>Book Appointment</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Label className="text-sm">Date:</Label>
          <Input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-1">
          <Label className="text-sm">Trainer:</Label>
          <select
            value={filterTrainer ?? ""}
            onChange={(e) =>
              setFilterTrainer(e.target.value ? Number(e.target.value) : undefined)
            }
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All</option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstname} {t.lastname}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <Label className="text-sm">Status:</Label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="booked">Booked</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
        </div>
      </div>

      {/* Appointments Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Member</TableHead>
            <TableHead className="hidden md:table-cell">Trainer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Notes</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap">{a.date}</TableCell>
              <TableCell className="whitespace-nowrap">
                {a.startTime} - {a.endTime}
              </TableCell>
              <TableCell>
                <div>{a.userName}</div>
                {a.userPhone && (
                  <div className="text-xs text-muted-foreground">{a.userPhone}</div>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">{a.trainerName}</TableCell>
              <TableCell>
                <Badge variant="outline" className={statusBadgeClass(a.status)}>
                  {a.status === "no_show" ? "No Show" : a.status}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell max-w-[200px] truncate">
                {a.notes || "-"}
              </TableCell>
              <TableCell>
                {a.status === "booked" && (
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleComplete(a.id)}
                      disabled={isPending}
                    >
                      Complete
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleCancel(a.id)}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {appointments.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No appointments found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Book Dialog */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Book Appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Member Search */}
            <div>
              <Label>Member</Label>
              {selectedMember ? (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline">
                    {selectedMember.firstname} {selectedMember.lastname}
                    {selectedMember.phone ? ` (${selectedMember.phone})` : ""}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedMember(null);
                      setMemberQuery("");
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Search by name or phone..."
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    className="mt-1"
                  />
                  {memberResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                      {memberResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                          onClick={() => {
                            setSelectedMember(m);
                            setMemberResults([]);
                            setMemberQuery("");
                          }}
                        >
                          {m.firstname} {m.lastname}
                          {m.phone && (
                            <span className="ml-2 text-muted-foreground">
                              {m.phone}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Trainer */}
            <div>
              <Label>Trainer</Label>
              <select
                value={bookTrainer ?? ""}
                onChange={(e) => setBookTrainer(Number(e.target.value))}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstname} {t.lastname} ({t.role})
                  </option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={bookDate}
                onChange={(e) => setBookDate(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time</Label>
                <select
                  value={bookStart}
                  onChange={(e) => {
                    setBookStart(e.target.value);
                    // Auto-set end time to 30 min later
                    const idx = TIME_SLOTS.indexOf(e.target.value);
                    if (idx >= 0 && idx < TIME_SLOTS.length - 1) {
                      setBookEnd(TIME_SLOTS[idx + 1]);
                    }
                  }}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>End Time</Label>
                <select
                  value={bookEnd}
                  onChange={(e) => setBookEnd(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label>Notes</Label>
              <textarea
                value={bookNotes}
                onChange={(e) => setBookNotes(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                placeholder="Optional notes..."
              />
            </div>

            {bookError && (
              <p className="text-xs text-destructive">{bookError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBook} disabled={isPending}>
              Book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
