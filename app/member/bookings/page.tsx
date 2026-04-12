"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getMyBookings,
  getAvailableFacilities,
  bookFacilitySlot,
  cancelMyBooking,
} from "@/lib/actions/member-bookings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Calendar } from "lucide-react";

type Booking = {
  id: number;
  facilityName: string;
  facilityType: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
};

type FacilityWithSlots = {
  id: number;
  name: string;
  type: string;
  slots: {
    id: number;
    date: string;
    startTime: string;
    endTime: string;
    spotsLeft: number;
  }[];
};

export default function MemberBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [facilities, setFacilities] = useState<FacilityWithSlots[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const [bk, fac] = await Promise.all([
        getMyBookings(),
        getAvailableFacilities(),
      ]);
      setBookings(bk);
      setFacilities(fac);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBook = (slotId: number) => {
    setError("");
    startTransition(async () => {
      const result = await bookFacilitySlot(slotId);
      if (!result.success) {
        setError(result.error || "Failed to book");
      } else {
        setDialogOpen(false);
      }
      load();
    });
  };

  const handleCancel = (bookingId: number) => {
    setError("");
    startTransition(async () => {
      const result = await cancelMyBooking(bookingId);
      if (!result.success) {
        setError(result.error || "Failed to cancel");
      }
      load();
    });
  };

  const facilitiesWithSlots = facilities.filter((f) => f.slots.length > 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Facility Bookings</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button size="sm" />}>Book New</DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Available Facilities</DialogTitle>
            </DialogHeader>
            {facilitiesWithSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No available slots for today or tomorrow
              </p>
            ) : (
              <div className="space-y-4">
                {facilitiesWithSlots.map((f) => (
                  <div key={f.id}>
                    <p className="font-medium mb-2">
                      {f.name}{" "}
                      <Badge variant="outline" className="capitalize ml-1">
                        {f.type}
                      </Badge>
                    </p>
                    <div className="space-y-1">
                      {f.slots.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between text-sm border rounded px-3 py-2"
                        >
                          <div>
                            <span>
                              {new Date(s.date).toLocaleDateString("en-IN", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                            <span className="ml-2 text-muted-foreground">
                              {s.startTime} - {s.endTime}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {s.spotsLeft} left
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isPending}
                              onClick={() => handleBook(s.id)}
                            >
                              Book
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facility</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    {b.facilityName}
                    <Badge variant="outline" className="capitalize ml-2 text-xs">
                      {b.facilityType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(b.date).toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    {b.startTime} - {b.endTime}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {b.status === "booked" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleCancel(b.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No upcoming bookings
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {bookings.length === 0 && !isPending && (
        <div className="flex flex-col items-center py-6 text-center">
          <Calendar className="size-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            Book a facility slot to get started
          </p>
        </div>
      )}
    </div>
  );
}
