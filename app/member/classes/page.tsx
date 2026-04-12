"use client";

import { useEffect, useState, useTransition, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  getUpcomingClassesAction,
  bookClassAction,
  cancelBookingAction,
  getMemberBookingsAction,
} from "@/lib/actions/classes";
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonCard, SkeletonTable } from "@/components/ui/skeleton-card";

type UpcomingClass = {
  id: number;
  name: string;
  classType: string;
  locationName: string;
  instructorName: string | null;
  maxCapacity: number;
  schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
  bookedCount: number;
  spotsLeft: number;
};

type MyBooking = {
  id: number;
  classId: number;
  className: string;
  classType: string;
  locationName: string;
  scheduleDate: string;
  status: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getNext7Days(): { date: Date; dateStr: string; dayOfWeek: number; label: string }[] {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    days.push({
      date: d,
      dateStr: d.toISOString().split("T")[0],
      dayOfWeek: d.getDay(),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`,
    });
  }
  return days;
}

export default function MemberClassesPage() {
  const { data: session } = useSession();
  const [classes, setClasses] = useState<UpcomingClass[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [typeFilter, setTypeFilter] = useState("all");

  const next7Days = useMemo(() => getNext7Days(), []);

  const load = () => {
    startTransition(async () => {
      const locationId = session?.user?.locationId ?? undefined;
      const [cls, bk] = await Promise.all([
        getUpcomingClassesAction(locationId),
        getMemberBookingsAction(),
      ]);
      setClasses(cls);
      setMyBookings(bk);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (session) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const selectedDay = next7Days[selectedDayIdx];

  // Unique class types for filter chips
  const uniqueTypes = useMemo(() => {
    const types = new Set(classes.map((c) => c.classType));
    return Array.from(types).sort();
  }, [classes]);

  // Filter classes for selected day of week and type
  const classesForDay = useMemo(() => {
    return classes
      .filter((c) =>
        c.schedules.some((s) => s.dayOfWeek === selectedDay.dayOfWeek)
      )
      .filter((c) => typeFilter === "all" || c.classType === typeFilter)
      .map((c) => ({
        ...c,
        schedules: c.schedules.filter((s) => s.dayOfWeek === selectedDay.dayOfWeek),
      }));
  }, [classes, selectedDay, typeFilter]);

  const isBookedOnDate = (classId: number, dateStr: string) => {
    return myBookings.some(
      (b) =>
        b.classId === classId &&
        b.scheduleDate.startsWith(dateStr) &&
        b.status === "booked"
    );
  };

  const getBookingId = (classId: number, dateStr: string) => {
    const booking = myBookings.find(
      (b) =>
        b.classId === classId &&
        b.scheduleDate.startsWith(dateStr) &&
        b.status === "booked"
    );
    return booking?.id;
  };

  const handleBook = (classId: number, dateStr: string) => {
    setError("");
    startTransition(async () => {
      const result = await bookClassAction(classId, dateStr);
      if (!result.success) {
        setError(result.error || "Failed to book");
      }
      load();
    });
  };

  const handleCancel = (bookingId: number) => {
    setError("");
    startTransition(async () => {
      const result = await cancelBookingAction(bookingId);
      if (!result.success) {
        setError(result.error || "Failed to cancel");
      }
      load();
    });
  };

  if (loading) {
    return (
      <div className="space-y-6 p-4">
        <h1 className="text-xl font-semibold">Classes</h1>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonTable rows={3} cols={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-xl font-semibold">Classes</h1>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Day selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {next7Days.map((day, idx) => (
          <Button
            key={day.dateStr}
            variant={selectedDayIdx === idx ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedDayIdx(idx)}
            className="whitespace-nowrap"
          >
            {day.label}
          </Button>
        ))}
      </div>

      {/* Class type filter */}
      {uniqueTypes.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <Button
            variant={typeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setTypeFilter("all")}
          >
            All
          </Button>
          {uniqueTypes.map((type) => (
            <Button
              key={type}
              variant={typeFilter === type ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(type)}
              className="capitalize"
            >
              {type.replace("_", " ")}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Classes &mdash; {selectedDay.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead>Spots Left</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classesForDay.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <div>
                        {c.name}
                        <Badge
                          variant="outline"
                          className="ml-2 capitalize text-xs"
                        >
                          {c.classType.replace("_", " ")}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.schedules.map((s) => `${s.startTime}-${s.endTime}`).join(", ")}
                    </TableCell>
                    <TableCell>{c.instructorName || "-"}</TableCell>
                    <TableCell>
                      <span
                        className={
                          c.spotsLeft <= 3
                            ? "text-status-grace font-semibold"
                            : ""
                        }
                      >
                        {c.spotsLeft}/{c.maxCapacity}
                      </span>
                    </TableCell>
                    <TableCell>
                      {isBookedOnDate(c.id, selectedDay.dateStr) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            const bid = getBookingId(c.id, selectedDay.dateStr);
                            if (bid) handleCancel(bid);
                          }}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={isPending || c.spotsLeft <= 0}
                          onClick={() => handleBook(c.id, selectedDay.dateStr)}
                        >
                          {c.spotsLeft <= 0 ? "Full" : "Book"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {classesForDay.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground"
                    >
                      No classes scheduled for {selectedDay.label.toLowerCase()}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {classesForDay.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No classes scheduled for {selectedDay.label.toLowerCase()}
              </p>
            ) : (
              classesForDay.map((c) => (
                <div
                  key={c.id}
                  className="border rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <Badge variant="outline" className="capitalize text-xs mt-1">
                        {c.classType.replace("_", " ")}
                      </Badge>
                    </div>
                    <span
                      className={`text-sm ${
                        c.spotsLeft <= 3
                          ? "text-status-grace font-semibold"
                          : "text-muted-foreground"
                      }`}
                    >
                      {c.spotsLeft}/{c.maxCapacity}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>{c.schedules.map((s) => `${s.startTime} - ${s.endTime}`).join(", ")}</p>
                    {c.instructorName && <p>Instructor: {c.instructorName}</p>}
                  </div>
                  <div>
                    {isBookedOnDate(c.id, selectedDay.dateStr) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={isPending}
                        onClick={() => {
                          const bid = getBookingId(c.id, selectedDay.dateStr);
                          if (bid) handleCancel(bid);
                        }}
                      >
                        Cancel Booking
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={isPending || c.spotsLeft <= 0}
                        onClick={() => handleBook(c.id, selectedDay.dateStr)}
                      >
                        {c.spotsLeft <= 0 ? "Full" : "Book"}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Upcoming Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myBookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.className}</TableCell>
                    <TableCell>
                      {new Date(b.scheduleDate).toLocaleDateString("en-IN")}
                    </TableCell>
                    <TableCell>{b.locationName}</TableCell>
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
                {myBookings.length === 0 && (
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
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {myBookings.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No upcoming bookings
              </p>
            ) : (
              myBookings.map((b) => (
                <div key={b.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <p className="font-medium text-sm">{b.className}</p>
                    <Badge variant="outline" className="capitalize">
                      {b.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>{new Date(b.scheduleDate).toLocaleDateString("en-IN")}</p>
                    <p>{b.locationName}</p>
                  </div>
                  {b.status === "booked" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={isPending}
                      onClick={() => handleCancel(b.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
