"use client";

import { useState, useTransition } from "react";
import {
  getSegmentMembers,
  sendBulkNotification,
  sendTargetedNotification,
} from "@/lib/actions/bulk-notify";
import { searchMembers } from "@/lib/actions/renewals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Copy, Eye, Send } from "lucide-react";

const segments = [
  { value: "all_active", label: "All Active Members" },
  { value: "expiring_7d", label: "Expiring in 7 Days" },
  { value: "expired", label: "Expired Members" },
];

const templates = [
  { value: "renewal_reminder", label: "Renewal Reminder" },
  { value: "general_announcement", label: "General Announcement" },
  { value: "offer_notification", label: "Offer / Promo Notification" },
  { value: "birthday_greeting", label: "Birthday Greeting" },
  { value: "custom_message", label: "Custom Message" },
];

const templateVariables: Record<string, string[]> = {
  renewal_reminder: ["{memberName}", "{planName}", "{expiryDate}"],
  general_announcement: ["{memberName}", "{customMessage}"],
  offer_notification: ["{memberName}", "{customMessage}"],
  birthday_greeting: ["{memberName}"],
  custom_message: ["{memberName}", "{customMessage}"],
};

const SMS_CHAR_LIMIT = 160;
const RATE_LIMIT_THRESHOLD = 100;

type SelectedMember = {
  id: number;
  firstname: string;
  lastname: string;
  phone: string | null;
};

export default function BulkNotifyPage() {
  // Bulk tab
  const [segment, setSegment] = useState("all_active");
  const [template, setTemplate] = useState("renewal_reminder");
  const [customMessage, setCustomMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<number | null>(null);
  const [segmentMembers, setSegmentMembers] = useState<SelectedMember[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  } | null>(null);

  // Targeted tab
  const [tab, setTab] = useState<"bulk" | "targeted">("bulk");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SelectedMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);
  const [targetTemplate, setTargetTemplate] = useState("renewal_reminder");
  const [targetMessage, setTargetMessage] = useState("");
  const [targetResult, setTargetResult] = useState<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  } | null>(null);

  const handlePreview = () => {
    startTransition(async () => {
      const members = await getSegmentMembers(segment);
      setSegmentMembers(members as SelectedMember[]);
      setPreview(members.length);
      setResult(null);
    });
  };

  const handleSend = () => {
    startTransition(async () => {
      const res = await sendBulkNotification(
        segment,
        template,
        customMessage || undefined
      );
      setResult(res);
      if (res.sent > 0) toast.success(`${res.sent} notification(s) sent`);
      if (res.failed > 0) toast.error(`${res.failed} notification(s) failed`);
    });
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    startTransition(async () => {
      const results = await searchMembers(query);
      setSearchResults(
        results
          .filter((r) => !selectedMembers.some((s) => s.id === r.id))
          .map((r) => ({
            id: r.id,
            firstname: r.firstname,
            lastname: r.lastname,
            phone: r.phone,
          }))
      );
    });
  };

  const addMember = (member: SelectedMember) => {
    setSelectedMembers((prev) => [...prev, member]);
    setSearchResults((prev) => prev.filter((r) => r.id !== member.id));
    setSearchQuery("");
  };

  const removeMember = (id: number) => {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleTargetedSend = () => {
    startTransition(async () => {
      const res = await sendTargetedNotification(
        selectedMembers.map((m) => m.id),
        targetTemplate,
        targetMessage || undefined
      );
      setTargetResult(res);
      if (res.sent > 0) toast.success(`${res.sent} notification(s) sent`);
      if (res.failed > 0) toast.error(`${res.failed} notification(s) failed`);
    });
  };

  const copyPhoneNumbers = (members: SelectedMember[]) => {
    const phones = members
      .map((m) => m.phone)
      .filter(Boolean)
      .join(", ");
    if (!phones) {
      toast.error("No phone numbers to copy");
      return;
    }
    navigator.clipboard.writeText(phones);
    toast.success("Copied!");
  };

  const currentTemplate = tab === "bulk" ? template : targetTemplate;
  const currentMessage = tab === "bulk" ? customMessage : targetMessage;
  const availableVars = templateVariables[currentTemplate] || ["{memberName}"];

  const messagePreviewText = currentMessage
    ? currentMessage
        .replace("{memberName}", "Rahul Sharma")
        .replace("{planName}", "Monthly Premium")
        .replace("{expiryDate}", "15/04/2026")
        .replace("{customMessage}", currentMessage)
    : `Hi Rahul Sharma, ${templates.find((t) => t.value === currentTemplate)?.label || "notification"}...`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Notifications</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 max-w-lg">
        <Button
          variant={tab === "bulk" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("bulk")}
        >
          Bulk Send
        </Button>
        <Button
          variant={tab === "targeted" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("targeted")}
        >
          Send to Selected Members
        </Button>
      </div>

      {/* Bulk Send */}
      {tab === "bulk" && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Bulk Notification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Channel is configured in Settings &gt; Communication. Sends via the selected channel (WhatsApp, SMS, or both).
            </p>

            <div>
              <Label>Segment</Label>
              <select
                value={segment}
                onChange={(e) => { setSegment(e.target.value); setPreview(null); setSegmentMembers([]); setResult(null); }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {segments.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Template</Label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {templates.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Template Variables */}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">Available variables:</span>
              {availableVars.map((v) => (
                <Badge key={v} variant="outline" className="text-xs font-mono">
                  {v}
                </Badge>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Custom Message (optional)</Label>
                <span className={`text-xs ${customMessage.length > SMS_CHAR_LIMIT ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {customMessage.length}/{SMS_CHAR_LIMIT}
                </span>
              </div>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Custom message to include..."
              />
              {customMessage.length > SMS_CHAR_LIMIT && (
                <p className="text-xs text-destructive mt-1">
                  Message exceeds SMS limit ({SMS_CHAR_LIMIT} chars). Will be split into multiple SMS.
                </p>
              )}
            </div>

            {/* Rate limit warning */}
            {preview !== null && preview > RATE_LIMIT_THRESHOLD && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="size-4 text-yellow-600 mt-0.5 shrink-0" />
                <p className="text-xs text-yellow-700 dark:text-yellow-400">
                  Sending to {preview} members may take a while. Messages will be queued and sent sequentially.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePreview} disabled={isPending}>
                {isPending ? "Loading..." : "Preview Recipients"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="size-3.5 mr-1.5" />
                {showPreview ? "Hide Preview" : "Message Preview"}
              </Button>
              <Button onClick={handleSend} disabled={isPending || preview === null || preview === 0}>
                <Send className="size-3.5 mr-1.5" />
                {isPending ? "Sending..." : "Send"}
              </Button>
              {segmentMembers.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPhoneNumbers(segmentMembers)}
                >
                  <Copy className="size-3.5 mr-1.5" />
                  Copy Phone Numbers
                </Button>
              )}
            </div>

            {preview !== null && !result && (
              <p className="text-sm text-muted-foreground">
                {preview} recipient{preview !== 1 ? "s" : ""} will receive this notification.
              </p>
            )}

            {/* Message Preview */}
            {showPreview && (
              <div className="p-3 rounded-md border bg-muted/50">
                <p className="text-xs font-medium text-muted-foreground mb-1">Message Preview (how it looks to a member):</p>
                <p className="text-sm">{messagePreviewText}</p>
              </div>
            )}

            {result && <NotifResult result={result} />}
          </CardContent>
        </Card>
      )}

      {/* Targeted Send */}
      {tab === "targeted" && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Send to Selected Members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Search and pick individual members. Channel is configured in Settings &gt; Communication.
            </p>

            <div>
              <Label>Search Members</Label>
              <Input
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Type name, email, or phone..."
              />
              {searchResults.length > 0 && (
                <div className="mt-1 border rounded-md max-h-40 overflow-y-auto">
                  {searchResults.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between items-center"
                      onClick={() => addMember(m)}
                    >
                      <span>{m.firstname} {m.lastname}</span>
                      <span className="text-xs text-muted-foreground">{m.phone || "No phone"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedMembers.length > 0 && (
              <div>
                <Label>Selected ({selectedMembers.length})</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedMembers.map((m) => (
                    <Badge key={m.id} variant="secondary" className="gap-1">
                      {m.firstname} {m.lastname}
                      <button
                        type="button"
                        className="ml-1 text-xs hover:text-destructive"
                        onClick={() => removeMember(m.id)}
                      >
                        x
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label>Template</Label>
              <select
                value={targetTemplate}
                onChange={(e) => setTargetTemplate(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {templates.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Template Variables */}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">Available variables:</span>
              {(templateVariables[targetTemplate] || ["{memberName}"]).map((v) => (
                <Badge key={v} variant="outline" className="text-xs font-mono">
                  {v}
                </Badge>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Custom Message (optional)</Label>
                <span className={`text-xs ${targetMessage.length > SMS_CHAR_LIMIT ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {targetMessage.length}/{SMS_CHAR_LIMIT}
                </span>
              </div>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                value={targetMessage}
                onChange={(e) => setTargetMessage(e.target.value)}
                placeholder="Custom message to include..."
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="size-3.5 mr-1.5" />
                {showPreview ? "Hide Preview" : "Message Preview"}
              </Button>
              <Button
                onClick={handleTargetedSend}
                disabled={isPending || selectedMembers.length === 0}
              >
                <Send className="size-3.5 mr-1.5" />
                {isPending ? "Sending..." : `Send to ${selectedMembers.length} Member${selectedMembers.length !== 1 ? "s" : ""}`}
              </Button>
              {selectedMembers.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPhoneNumbers(selectedMembers)}
                >
                  <Copy className="size-3.5 mr-1.5" />
                  Copy Phone Numbers
                </Button>
              )}
            </div>

            {/* Message Preview */}
            {showPreview && (
              <div className="p-3 rounded-md border bg-muted/50">
                <p className="text-xs font-medium text-muted-foreground mb-1">Message Preview:</p>
                <p className="text-sm">{messagePreviewText}</p>
              </div>
            )}

            {targetResult && <NotifResult result={targetResult} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NotifResult({ result }: { result: { total: number; sent: number; failed: number; skipped: number } }) {
  return (
    <div className="p-3 border rounded-md space-y-1">
      <p className="text-sm font-medium">Notification Results</p>
      <p className="text-sm text-muted-foreground">Total: {result.total}</p>
      <p className="text-sm text-green-600">Sent: {result.sent}</p>
      {result.failed > 0 && <p className="text-sm text-destructive">Failed: {result.failed}</p>}
      {result.skipped > 0 && <p className="text-sm text-muted-foreground">Skipped (already sent today): {result.skipped}</p>}
    </div>
  );
}
