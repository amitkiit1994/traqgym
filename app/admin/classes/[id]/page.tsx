"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getClassByIdAction,
  getClassBookingsAction,
} from "@/lib/actions/classes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type ClassDetail = {
  id: number;
  name: string;
  description: string | null;
  classType: string;
  instructorId: number | null;
  instructor: { firstname: string; lastname: string } | null;
  locationId: number;
  location: { name: string };
  maxCapacity: number;
  isActive: boolean;
  schedules: { id: number; dayOfWeek: number; startTime: string; endTime: string }[];
};

type BookingRow = {
  id: number;
  userId: number;
  userName: string;
  phone: string | null;
  status: string;
  scheduleDate: string;
};

export default function ClassDetailPage() {
  const params = useParams();
  const classId = Number(params.id);
  const [gymClass, setGymClass] = useState<ClassDetail | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const cls = await getClassByIdAction(classId);
      setGymClass(cls as ClassDetail | null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    startTransition(async () => {
      const bk = await getClassBookingsAction(classId, selectedDate);
      setBookings(bk);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, selectedDate]);

  if (!gymClass) {
    return <p className="text-muted-foreground p-4">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/classes">
          <Button variant="ghost" size="sm">
            &larr; Back
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">{gymClass.name}</h1>
        <Badge
          variant={gymClass.isActive ? "active" : "expired"}
        >
          {gymClass.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Class Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="capitalize">
                {gymClass.classType.replace("_", " ")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location</span>
              <span>{gymClass.location.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Instructor</span>
              <span>
                {gymClass.instructor
                  ? `${gymClass.instructor.firstname} ${gymClass.instructor.lastname}`
                  : "None"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Capacity</span>
              <span>{gymClass.maxCapacity}</span>
            </div>
            {gymClass.description && (
              <div>
                <span className="text-muted-foreground">Description</span>
                <p className="mt-1">{gymClass.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gymClass.schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{DAYS[s.dayOfWeek]}</TableCell>
                    <TableCell>
                      {s.startTime} - {s.endTime}
                    </TableCell>
                  </TableRow>
                ))}
                {gymClass.schedules.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="text-center text-muted-foreground"
                    >
                      No schedules
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Bookings</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="bookingDate" className="text-sm">
                Date
              </Label>
              <Input
                id="bookingDate"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.userName}</TableCell>
                  <TableCell>{b.phone || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {b.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 && !isPending && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center text-muted-foreground"
                  >
                    No bookings for this date
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
