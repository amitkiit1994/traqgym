"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Device = {
  id: number;
  name: string;
  locationId: number;
  deviceType: string;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  location: { name: string };
};

type SyncRun = {
  id: number;
  runType: string;
  status: string;
  totalRecords: number;
  matchedRecords: number;
  unmatchedRecords: number;
  duplicateRecords: number;
  completedAt: string | null;
  createdAt: string;
  device: { name: string };
};

type UnmatchedEvent = {
  id: number;
  deviceId: number;
  deviceUserId: string;
  eventTimestamp: string;
  eventType: string;
  device: { name: string; locationId: number };
};

type SearchResult = {
  id: number;
  label: string;
  type: "member" | "worker";
};

type ImportResult = {
  total: number;
  matched: number;
  unmatched: number;
  duplicates: number;
  warning?: string;
};

export default function BiometricPage() {
  // Devices (one per location)
  const [devices, setDevices] = useState<Device[]>([]);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [setupName, setSetupName] = useState("");
  const [setupLocation, setSetupLocation] = useState("");
  const [setupType, setSetupType] = useState("fingerprint");
  const [creating, setCreating] = useState(false);

  // SDK status
  const [sdkStatus, setSdkStatus] = useState<"checking" | "connected" | "not_configured" | "error">("checking");
  const [sdkError, setSdkError] = useState("");

  // Sync
  const [syncingDevice, setSyncingDevice] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [csvDevice, setCsvDevice] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // History
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);

  // Unmatched
  const [unmatchedEvents, setUnmatchedEvents] = useState<UnmatchedEvent[]>([]);
  const [resolveEventId, setResolveEventId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [resolving, setResolving] = useState(false);

  const [error, setError] = useState("");

  const fetchDevices = useCallback(async () => {
    const res = await fetch("/api/biometric/devices");
    if (res.ok) setDevices(await res.json());
  }, []);

  const fetchSyncRuns = useCallback(async () => {
    const res = await fetch("/api/biometric/sync-runs");
    if (res.ok) setSyncRuns(await res.json());
  }, []);

  const fetchUnmatched = useCallback(async () => {
    const res = await fetch("/api/biometric/unmatched");
    if (res.ok) setUnmatchedEvents(await res.json());
  }, []);

  const checkSdkStatus = useCallback(async () => {
    setSdkStatus("checking");
    try {
      const res = await fetch("/api/biometric/test-connection", { method: "POST" });
      const data = await res.json();
      if (data.connected) {
        setSdkStatus("connected");
      } else if (data.error === "BioMax SDK URL not configured") {
        setSdkStatus("not_configured");
      } else {
        setSdkStatus("error");
        setSdkError(data.error);
      }
    } catch {
      setSdkStatus("not_configured");
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    fetch("/api/locations").then((r) => r.ok ? r.json() : []).then(setLocations);
    fetchSyncRuns();
    fetchUnmatched();
    checkSdkStatus();
  }, [fetchDevices, fetchSyncRuns, fetchUnmatched, checkSdkStatus]);

  // Locations that already have a device
  const usedLocationIds = new Set(devices.map((d) => d.locationId));
  const availableLocations = locations.filter((l) => !usedLocationIds.has(l.id));

  async function handleSetupDevice() {
    if (!setupName || !setupLocation) return;
    setCreating(true);
    const res = await fetch("/api/biometric/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: setupName, locationId: Number(setupLocation), deviceType: setupType }),
    });
    if (res.ok) {
      setSetupName("");
      setSetupLocation("");
      setSetupType("fingerprint");
      fetchDevices();
    }
    setCreating(false);
  }

  async function handleSdkSync(deviceId: number) {
    setSyncingDevice(deviceId);
    setSyncResult(null);
    setError("");
    try {
      const res = await fetch("/api/biometric/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`Synced: ${data.total} total, ${data.matched} matched, ${data.unmatched} unmatched`);
        fetchDevices();
        fetchSyncRuns();
        fetchUnmatched();
      } else {
        setError(data.error || "Sync failed");
      }
    } catch {
      setError("SDK sync failed");
    }
    setSyncingDevice(null);
  }

  async function handleCsvImport() {
    if (!csvDevice || !csvContent) return;
    setImporting(true);
    setError("");
    setImportResult(null);
    const res = await fetch("/api/biometric/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: Number(csvDevice), csvContent }),
    });
    if (res.ok) {
      setImportResult(await res.json());
      fetchSyncRuns();
      fetchUnmatched();
    } else {
      const err = await res.json();
      setError(err.error || "Import failed");
    }
    setImporting(false);
  }

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const res = await fetch(`/api/biometric/search-people?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      setSearchResults([...data.members, ...data.workers]);
    }
  }

  async function handleResolve(eventId: number, person: SearchResult) {
    setResolving(true);
    const body: Record<string, number> = { eventId };
    if (person.type === "member") body.userId = person.id;
    else body.workerId = person.id;

    const res = await fetch("/api/biometric/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setResolveEventId(null);
      setSearchQuery("");
      setSearchResults([]);
      fetchUnmatched();
    }
    setResolving(false);
  }

  function formatDate(d: string | null) {
    if (!d) return "Never";
    return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl font-semibold">Biometric Attendance</h1>

      {/* SDK Connection Status Banner */}
      {sdkStatus === "not_configured" && (
        <div className="rounded-md border border-status-expiring/40 bg-status-expiring-bg px-4 py-3 text-sm">
          <p className="font-medium">BioMax SDK not configured</p>
          <p className="text-muted-foreground mt-1">
            SDK sync requires connection credentials. Configure them in{" "}
            <a href="/admin/settings" className="underline font-medium">
              Settings &gt; Integrations
            </a>
            . You can still use CSV import without SDK.
          </p>
        </div>
      )}
      {sdkStatus === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium">SDK connection failed</p>
          <p className="text-muted-foreground mt-1">
            {sdkError} — check your credentials in{" "}
            <a href="/admin/settings" className="underline font-medium">
              Settings &gt; Integrations
            </a>
          </p>
        </div>
      )}
      {sdkStatus === "connected" && (
        <div className="rounded-md border border-status-active/30 bg-status-active-bg px-4 py-3 text-sm flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-status-active" />
          <span className="font-medium">BioMax SDK connected</span>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
      {syncResult && <p className="text-sm text-status-active">{syncResult}</p>}

      {/* Devices — one per location */}
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">One biometric device per location.</p>

          {devices.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead className="hidden sm:table-cell">Location</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Last Sync</TableHead>
                  <TableHead>SDK Sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{d.location.name}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary">{d.deviceType}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {formatDate(d.lastSyncAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={syncingDevice !== null || sdkStatus !== "connected"}
                        title={sdkStatus !== "connected" ? "Configure SDK in Settings > Integrations" : undefined}
                        onClick={() => handleSdkSync(d.id)}
                      >
                        {syncingDevice === d.id ? "Syncing..." : "Sync Now"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {availableLocations.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end sm:flex-wrap border-t pt-4">
              <div>
                <Label>Device Name</Label>
                <Input
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  placeholder="Lobby Scanner"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Select value={setupLocation} onValueChange={(v) => setSetupLocation(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location">{setupLocation ? availableLocations.find((l) => String(l.id) === setupLocation)?.name ?? "Select location" : "Select location"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableLocations.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={setupType} onValueChange={(v) => setSetupType(v ?? "fingerprint")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fingerprint">Fingerprint</SelectItem>
                    <SelectItem value="face">Face Recognition</SelectItem>
                    <SelectItem value="card">Card / RFID</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSetupDevice} disabled={creating}>
                {creating ? "Adding..." : "Add Device"}
              </Button>
            </div>
          ) : devices.length > 0 ? (
            <p className="text-xs text-muted-foreground border-t pt-3">All locations have a device assigned.</p>
          ) : null}
        </CardContent>
      </Card>

      {/* CSV Import */}
      {devices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>CSV Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Format: deviceUserId, eventTimestamp, eventType (check_in / check_out)
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end sm:flex-wrap">
              {devices.length > 1 ? (
                <div>
                  <Label>Device</Label>
                  <Select value={csvDevice} onValueChange={(v) => setCsvDevice(v ?? "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select device" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name} ({d.location.name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="flex-1">
                <Label>CSV File</Label>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) file.text().then(setCsvContent);
                    // Auto-select device if only one
                    if (devices.length === 1) setCsvDevice(String(devices[0].id));
                  }}
                />
              </div>
              <Button onClick={handleCsvImport} disabled={importing || !csvDevice || !csvContent}>
                {importing ? "Importing..." : "Import"}
              </Button>
            </div>

            {importResult && (
              <div className="border rounded-md p-4">
                {importResult.warning && (
                  <p className="text-status-expiring text-sm mb-2">{importResult.warning}</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total</span>
                    <p className="text-lg font-semibold">{importResult.total}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Matched</span>
                    <p className="text-lg font-semibold text-status-active">{importResult.matched}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Unmatched</span>
                    <p className="text-lg font-semibold text-status-grace">{importResult.unmatched}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duplicates</span>
                    <p className="text-lg font-semibold text-muted-foreground">{importResult.duplicates}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Unmatched Events */}
      {devices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Unmatched Events
              {unmatchedEvents.length > 0 && (
                <Badge variant="secondary" className="ml-2">{unmatchedEvents.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {unmatchedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unmatched events</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  These records couldn&apos;t be matched to a member or worker. Search and assign the correct person.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Device User ID</TableHead>
                      <TableHead className="hidden sm:table-cell">Timestamp</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmatchedEvents.map((evt) => (
                      <TableRow key={evt.id}>
                        <TableCell className="font-mono text-sm">{evt.deviceUserId}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{formatDate(evt.eventTimestamp)}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="secondary">{evt.eventType}</Badge>
                        </TableCell>
                        <TableCell>
                          {resolveEventId === evt.id ? (
                            <div className="space-y-2 min-w-[250px]">
                              <Input
                                placeholder="Search member or worker..."
                                value={searchQuery}
                                onChange={(e) => handleSearch(e.target.value)}
                                autoFocus
                              />
                              {searchResults.length > 0 && (
                                <div className="border rounded-md max-h-40 overflow-y-auto">
                                  {searchResults.map((r) => (
                                    <button
                                      key={`${r.type}-${r.id}`}
                                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between"
                                      disabled={resolving}
                                      onClick={() => handleResolve(evt.id, r)}
                                    >
                                      <span>{r.label}</span>
                                      <Badge variant="outline" className="text-xs ml-2">
                                        {r.type}
                                      </Badge>
                                    </button>
                                  ))}
                                </div>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setResolveEventId(null);
                                  setSearchQuery("");
                                  setSearchResults([]);
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setResolveEventId(evt.id)}
                            >
                              Resolve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sync History */}
      {devices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sync History</CardTitle>
          </CardHeader>
          <CardContent>
            {syncRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sync runs yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead className="hidden sm:table-cell">Unmatched</TableHead>
                    <TableHead className="hidden md:table-cell">Duplicates</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Badge variant="outline">{run.runType === "csv" ? "CSV" : "SDK"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={run.status === "completed" ? "secondary" : "destructive"}>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{run.totalRecords}</TableCell>
                      <TableCell className="text-status-active">{run.matchedRecords}</TableCell>
                      <TableCell className="hidden sm:table-cell text-status-grace">{run.unmatchedRecords}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{run.duplicateRecords}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {formatDate(run.completedAt || run.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
