"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getFacilitiesAction,
  getAvailableSlotsAction,
  bookSlotAction,
  cancelBookingAction,
} from "@/lib/actions/facility-booking";
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

type Facility = {
  id: number;
  name: string;
  type: string;
  locationId: number | null;
  isActive: boolean;
};

type Slot = {
  id: number;
  facilityId: number;
  date: string | Date;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  bookedCount: number;
  available: number;
  status: string;
};

export default function FacilityBookingsPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null);
  const [slotDate, setSlotDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookSlotId, setBookSlotId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const loadFacilities = () => {
    startTransition(async () => {
      const data = await getFacilitiesAction();
      setFacilities(data as Facility[]);
    });
  };

  const loadSlots = () => {
    if (!selectedFacility) return;
    startTransition(async () => {
      const data = await getAvailableSlotsAction(selectedFacility, slotDate);
      setSlots(data as Slot[]);
    });
  };

  useEffect(() => {
    loadFacilities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacility, slotDate]);

  const openBook = (slotId: number) => {
    setBookSlotId(slotId);
    setErrors({});
    setBookOpen(true);
  };

  const handleBook = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bookSlotId) return;
    const fd = new FormData(e.currentTarget);
    const userId = parseInt(fd.get("userId") as string, 10);

    if (!userId) {
      setErrors({ userId: "Enter a valid member ID" });
      return;
    }

    startTransition(async () => {
      const result = await bookSlotAction(bookSlotId, userId);
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setBookOpen(false);
        loadSlots();
      }
    });
  };

  const handleCancel = (bookingId: number) => {
    startTransition(async () => {
      await cancelBookingAction(bookingId);
      loadSlots();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Facility Bookings</h1>
      </div>

      {/* Facility List */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Facility</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {facilities.map((f) => (
            <TableRow
              key={f.id}
              className={selectedFacility === f.id ? "bg-muted/50" : ""}
            >
              <TableCell className="font-medium">{f.name}</TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {f.type}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  className={
                    f.isActive
                      ? "bg-status-active-bg text-status-active-foreground border-status-active/30"
                      : "bg-status-expired-bg text-status-expired-foreground border-status-expired/30"
                  }
                >
                  {f.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant={selectedFacility === f.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedFacility(f.id)}
                >
                  View Slots
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {facilities.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No facilities found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Slot Viewer */}
      {selectedFacility && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              Slots:{" "}
              {facilities.find((f) => f.id === selectedFacility)?.name}
            </h2>
            <Input
              type="date"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              className="w-40"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Booked</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.startTime} - {s.endTime}
                  </TableCell>
                  <TableCell>{s.maxCapacity}</TableCell>
                  <TableCell>{s.bookedCount}</TableCell>
                  <TableCell>{s.available}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        s.status === "full"
                          ? "bg-status-expired-bg text-status-expired-foreground border-status-expired/30"
                          : "bg-status-active-bg text-status-active-foreground border-status-active/30"
                      }
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {s.available > 0 && s.status !== "blocked" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openBook(s.id)}
                      >
                        Book
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {slots.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    No slots for this date
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Book Dialog */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book Slot</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBook} className="space-y-3">
            <div>
              <Label htmlFor="userId">Member ID</Label>
              <Input
                id="userId"
                name="userId"
                type="number"
                key={`book-${bookSlotId ?? "none"}`}
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
                Book
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
