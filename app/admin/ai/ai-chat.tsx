"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, Trash2, MessageSquare, Sparkles, Loader2, PanelRightClose, PanelRightOpen, Copy, Check, RefreshCw, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: number;
  title: string | null;
  updatedAt: string;
  _count: { messages: number };
};

const QUICK_PROMPTS = [
  "How's today looking?",
  "Who hasn't paid this month?",
  "Show expiring memberships",
  "Today's attendance summary",
];

export function AiChat({
  workerName,
  role,
}: {
  workerName: string;
  role: string;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll: observe DOM mutations in the scroll container
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const scroll = () => { container.scrollTop = container.scrollHeight; };
    const observer = new MutationObserver(scroll);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    scroll();
    return () => observer.disconnect();
  }, [activeConvoId]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      const res = await fetch("/api/admin/ai/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch {
      // silent
    }
  }

  async function loadConversation(id: number) {
    try {
      const res = await fetch(`/api/admin/ai/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setActiveConvoId(id);
        setMessages(
          data.messages.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        );
        setError(null);
      }
    } catch {
      // silent
    }
  }

  async function deleteConversation(id: number) {
    try {
      await fetch(`/api/admin/ai/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvoId === id) {
        setActiveConvoId(null);
        setMessages([]);
      }
    } catch {
      // silent
    }
  }

  async function deleteAllConversations() {
    if (!confirm("Delete all chat threads?")) return;
    try {
      await Promise.all(conversations.map((c) => fetch(`/api/admin/ai/conversations/${c.id}`, { method: "DELETE" })));
      setConversations([]);
      setActiveConvoId(null);
      setMessages([]);
    } catch {
      // silent
    }
  }

  function startNewChat() {
    setActiveConvoId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function sendMessage(text?: string) {
    const msg = text || input.trim();
    if (!msg || isStreaming) return;

    setInput("");
    setError(null);
    setIsStreaming(true);

    const userMsg: Message = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch("/api/admin/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          conversationId: activeConvoId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send message");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          let data;
          try {
            data = JSON.parse(trimmed.slice(6));
          } catch {
            continue; // skip malformed chunks
          }

          if (data.type === "conversation_id") {
            setActiveConvoId(data.id);
          } else if (data.type === "text") {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + data.content,
                };
              }
              return updated;
            });
          } else if (data.type === "error") {
            setError(data.error);
          }
        }
      }

      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      // Remove empty assistant message on error
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last.role === "assistant" && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function copyMessage(index: number) {
    navigator.clipboard.writeText(messages[index].content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditText(messages[index].content);
  }

  function submitEdit(index: number) {
    if (!editText.trim() || isStreaming) return;
    // Trim conversation to before this message and resend
    setMessages(messages.slice(0, index));
    setEditingIndex(null);
    // Use setTimeout to let state update before sending
    setTimeout(() => sendMessage(editText.trim()), 0);
  }

  function regenerate() {
    if (isStreaming || messages.length < 2) return;
    // Find last user message
    const lastUserIndex = messages.length - (messages[messages.length - 1].role === "assistant" ? 2 : 1);
    if (lastUserIndex < 0 || messages[lastUserIndex].role !== "user") return;
    const lastUserMsg = messages[lastUserIndex].content;
    // Remove the last assistant response
    setMessages(messages.slice(0, lastUserIndex));
    setTimeout(() => sendMessage(lastUserMsg), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-3 -mt-2 md:-m-6 md:-mt-2 overflow-x-hidden">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">TraqGym AI</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {workerName} · {role}
            </span>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Show threads"
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-4 md:py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold mb-1">TraqGym AI</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Ask me anything about your gym — members, payments, attendance,
                classes, and more.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="px-3 py-1.5 text-sm rounded-full border border-border/50 hover:bg-muted hover:border-primary/30 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`group flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  {editingIndex === i ? (
                    <div className="w-[80%] space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submitEdit(i);
                          }
                          if (e.key === "Escape") setEditingIndex(null);
                        }}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-primary/50 bg-muted/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingIndex(null)}
                          className="px-3 py-1 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => submitEdit(i)}
                          className="px-3 py-1 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted rounded-bl-md"
                        }`}
                      >
                        {msg.role === "assistant" && !msg.content && isStreaming ? (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Thinking...</span>
                          </div>
                        ) : msg.role === "assistant" ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:rounded-lg">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        )}
                      </div>
                      {/* Action buttons */}
                      {msg.content && !isStreaming && (
                        <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => copyMessage(i)}
                            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy"
                          >
                            {copiedIndex === i ? (
                              <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {msg.role === "user" && (
                            <button
                              onClick={() => startEdit(i)}
                              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit & resend"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {msg.role === "assistant" && i === messages.length - 1 && (
                            <button
                              onClick={regenerate}
                              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Regenerate"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2">
            <div className="max-w-3xl mx-auto text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-3 py-2 md:px-4 md:py-3 border-t border-border/50">
          <div className="max-w-3xl mx-auto flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about members, payments, attendance..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border/50 bg-muted/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 placeholder:text-muted-foreground/60"
              disabled={isStreaming}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isStreaming}
              className="shrink-0 h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Thread sidebar — right side */}
      <div
        className={`border-l border-border/50 flex-col bg-muted/30 transition-all duration-200 hidden sm:flex ${
          sidebarOpen ? "w-64" : "w-0 overflow-hidden"
        }`}
      >
        <div className="p-3 border-b border-border/50 flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Close threads"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
          <button
            onClick={startNewChat}
            className="flex-1 flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
          {conversations.length > 0 && (
            <button
              onClick={deleteAllConversations}
              className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
              title="Delete all threads"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
                activeConvoId === c.id
                  ? "bg-primary/12 text-primary"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => loadConversation(c.id)}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate flex-1">
                {c.title || "Untitled"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
