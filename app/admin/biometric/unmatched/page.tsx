"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UnmatchedEvent = {
  id: number;
  deviceUserId: string;
  eventTimestamp: string;
  eventType: string;
  device: { name: string; locationId: number };
};

type PersonOption = {
  id: number;
  name: string;
  type: "member" | "staff";
};

export default function UnmatchedPage() {
  const [events, setEvents] = useState<UnmatchedEvent[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<UnmatchedEvent | null>(
    null
  );
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [selectedPerson, setSelectedPerson] = useState("");
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    fetchUnmatched();
    fetchPeople();
  }, []);

  async function fetchUnmatched() {
    const res = await fetch("/api/biometric/unmatched");
    if (res.ok) setEvents(await res.json());
  }

  async function fetchPeople() {
    const res = await fetch("/api/people");
    if (res.ok) setPeople(await res.json());
  }

  function openResolve(event: UnmatchedEvent) {
    setSelectedEvent(event);
    setSelectedPerson("");
    setDialogOpen(true);
  }

  async function handleResolve() {
    if (!selectedEvent || !selectedPerson) return;
    setResolving(true);

    const [type, id] = selectedPerson.split(":");
    const body: Record<string, number> = { eventId: selectedEvent.id };
    if (type === "member") body.userId = Number(id);
    else body.workerId = Number(id);

    const res = await fetch("/api/biometric/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setDialogOpen(false);
      fetchUnmatched();
    }
    setResolving(false);
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">Unmatched Attendance Events</h1>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device User ID</TableHead>
                <TableHead className="hidden sm:table-cell">Timestamp</TableHead>
                <TableHead className="hidden sm:table-cell">Device</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{e.deviceUserId}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {new Date(e.eventTimestamp).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{e.device.name}</TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => openResolve(e)}>
                      Resolve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground"
                  >
                    No unmatched events
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Mapping</DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3">
              <p className="text-sm">
                Device User ID:{" "}
                <span className="font-mono font-semibold">
                  {selectedEvent.deviceUserId}
                </span>
              </p>
              <div>
                <Label>Assign to</Label>
                <Select
                  value={selectedPerson}
                  onValueChange={(v) => setSelectedPerson(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select member or staff" />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem
                        key={`${p.type}:${p.id}`}
                        value={`${p.type}:${p.id}`}
                      >
                        {p.name} ({p.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={handleResolve}
              disabled={resolving || !selectedPerson}
            >
              {resolving ? "Resolving..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
