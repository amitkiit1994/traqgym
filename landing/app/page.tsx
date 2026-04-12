"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/* ─── Intersection Observer ─── */
function useInView(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}


/* ─── Floating Particles (client-only to avoid hydration mismatch) ─── */
function Particles() {
  const [particles, setParticles] = useState<Array<{ left: string; dur: string; delay: string; w: string; bg: string }>>([]);
  useEffect(() => {
    setParticles(
      Array.from({ length: 20 }).map((_, i) => ({
        left: `${(i * 5 + Math.random() * 5) % 100}%`,
        dur: `${6 + Math.random() * 8}s`,
        delay: `${Math.random() * 10}s`,
        w: `${1 + Math.random() * 2}px`,
        bg: i % 3 === 0 ? "rgba(34, 211, 238, 0.4)" : i % 3 === 1 ? "rgba(192, 132, 252, 0.4)" : "rgba(129, 140, 248, 0.5)",
      }))
    );
  }, []);

  if (particles.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: p.left,
            bottom: "-10px",
            animationDuration: p.dur,
            animationDelay: p.delay,
            width: p.w,
            height: p.w,
            background: p.bg,
          }}
        />
      ))}
    </div>
  );
}


/* ─── Dashboard with AI View Toggle ─── */
function DashboardContent() {
  const [showAI, setShowAI] = useState(false);
  const [convoIndex, setConvoIndex] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const currentConvo = dashAIConversations[convoIndex];

  // Toggle between dashboard and AI view
  useEffect(() => {
    // Show dashboard for 4s, then switch to AI
    const t = setTimeout(() => setShowAI(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Auto-type messages when AI view is shown
  useEffect(() => {
    if (!showAI) return;
    if (msgIndex < currentConvo.length) {
      const t = setTimeout(() => setMsgIndex(i => i + 1), 1800);
      return () => clearTimeout(t);
    }
    // After conversation ends, switch back to dashboard, then show next convo
    const t = setTimeout(() => {
      setShowAI(false);
      setTimeout(() => {
        setMsgIndex(0);
        setConvoIndex(i => (i + 1) % dashAIConversations.length);
        setShowAI(true);
      }, 3000);
    }, 3000);
    return () => clearTimeout(t);
  }, [showAI, msgIndex, currentConvo.length]);

  return (
    <div className="flex min-h-[300px] md:min-h-[480px]">
      {/* Sidebar */}
      <div className="w-48 border-r border-white/[0.06] bg-surface/50 p-4 hidden md:block shrink-0">
        <div className="flex items-center gap-2 mb-6">
          <Image src="/logo.png" alt="EGym" width={20} height={20} />
          <span className="text-[12px] font-semibold">EGym</span>
        </div>
        {["Dashboard", "Members", "Attendance", "Plans", "Billing", "Reports", "Staff", "Settings"].map((item, i) => (
          <div key={item} className={`text-[12px] py-2 px-3 rounded-lg mb-0.5 flex items-center gap-2.5 ${i === 0 && !showAI ? "bg-accent/10 text-accent font-medium" : "text-dim hover:text-sub"}`}>
            <div className={`w-1 h-1 rounded-full ${i === 0 && !showAI ? "bg-accent" : "bg-transparent"}`} />
            {item}
          </div>
        ))}
        {/* AI nav item */}
        <div className={`text-[12px] py-2 px-3 rounded-lg mt-4 flex items-center gap-2.5 border border-accent/10 ${showAI ? "bg-accent/10 text-accent font-medium" : "text-dim"}`}>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
          Ask AI
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Dashboard View */}
        <div className={`absolute inset-0 p-5 transition-all duration-500 ${showAI ? "opacity-0 scale-95 pointer-events-none" : "opacity-100 scale-100"}`}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-[15px] font-semibold">Dashboard</h3>
              <p className="text-[11px] text-dim mt-0.5">Welcome back, Admin</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-5">
            {[
              { label: "Active Members", value: "342", change: "+12", color: "text-green-400" },
              { label: "Today's Check-ins", value: "87", change: "+5", color: "text-green-400" },
              { label: "Revenue (MTD)", value: "\u20B94.2L", change: "+18%", color: "text-green-400" },
              { label: "Expiring This Week", value: "14", change: "", color: "text-amber-400" },
            ].map(s => (
              <div key={s.label} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3.5">
                <p className="text-[10px] text-dim uppercase tracking-wider">{s.label}</p>
                <div className="flex items-end gap-2 mt-1.5">
                  <span className="text-xl font-bold">{s.value}</span>
                  {s.change && <span className={`text-[10px] ${s.color} font-medium`}>{s.change}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-3 rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[12px] font-medium">Revenue Overview</p>
                <div className="flex gap-3">
                  {["Week", "Month", "Year"].map((t, i) => (
                    <span key={t} className={`text-[10px] ${i === 1 ? "text-accent" : "text-dim"}`}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-2.5 h-28">
                {[40, 55, 35, 65, 80, 60, 75, 90, 70, 85, 95, 78].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%` }}>
                    <div className="w-full h-full rounded-t-sm bg-gradient-to-t from-accent/40 to-accent/10" />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => (
                  <span key={m} className="text-[8px] text-dim flex-1 text-center">{m}</span>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
              <p className="text-[12px] font-medium mb-3">Recent Members</p>
              {[
                { name: "Priya Sharma", plan: "6 Month", status: "Active" },
                { name: "Rahul Verma", plan: "Annual", status: "Active" },
                { name: "Ankit Patel", plan: "Monthly", status: "Expiring" },
                { name: "Sneha Iyer", plan: "3 Month", status: "Active" },
                { name: "Karan Singh", plan: "Annual", status: "Active" },
              ].map((m, i) => (
                <div key={m.name} className={`flex items-center justify-between py-2 ${i > 0 ? "border-t border-white/[0.04]" : ""}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent/20 to-cyan-brand/10 flex items-center justify-center">
                      <span className="text-[9px] text-accent font-bold">{m.name.charAt(0)}</span>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium">{m.name}</p>
                      <p className="text-[9px] text-dim">{m.plan}</p>
                    </div>
                  </div>
                  <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${m.status === "Active" ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400"}`}>{m.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Chat View — ChatGPT style */}
        <div className={`absolute inset-0 flex flex-col transition-all duration-500 ${showAI ? "opacity-100 scale-100" : "opacity-0 scale-105 pointer-events-none"}`}>
          {/* Messages area */}
          <div className="flex-1 overflow-hidden px-4 py-4 md:px-8 md:py-6">
            {msgIndex === 0 && (
              <div className="h-full flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-cyan-brand flex items-center justify-center mb-4">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                </div>
                <p className="text-[14px] font-medium text-sub">How can I help with your gym today?</p>
              </div>
            )}
            <div className="max-w-lg mx-auto space-y-4">
              {currentConvo.slice(0, msgIndex).map((msg, i) => (
                <div key={`${convoIndex}-${i}`} className="anim-fade-up">
                  {msg.role === "user" ? (
                    <div className="flex items-start gap-3 justify-end">
                      <div className="bg-accent/10 border border-accent/15 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]">
                        <p className="text-[12px] leading-relaxed text-white/90">{msg.text}</p>
                      </div>
                      <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[10px] text-accent font-bold">A</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-cyan-brand flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      </div>
                      <div className="bg-white/[0.03] border border-white/[0.05] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[80%]">
                        <p className="text-[12px] leading-relaxed text-sub">{msg.text}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {showAI && msgIndex > 0 && msgIndex < currentConvo.length && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-cyan-brand flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                  </div>
                  <div className="flex items-center gap-1.5 pt-2.5">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Big prompt box — ChatGPT style */}
          <div className="px-4 pb-4 md:px-6 md:pb-5">
            <div className="max-w-lg mx-auto">
              <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.1] rounded-2xl px-5 py-4 shadow-lg shadow-accent/5">
                <svg className="w-4 h-4 text-dim shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                <span className="text-[13px] text-dim flex-1">Ask anything about your gym...</span>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-r from-accent to-cyan-brand flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" /></svg>
                  </div>
                </div>
              </div>
              <div className="flex justify-center gap-3 mt-3">
                {["Expiring today", "Revenue report", "Send reminders"].map(s => (
                  <span key={s} className="text-[10px] text-dim px-2.5 py-1 rounded-full border border-white/[0.06] bg-white/[0.02]">{s}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const dashAIConversations = [
  [
    { role: "user" as const, text: "Who hasn't paid this month?" },
    { role: "ai" as const, text: "7 members have overdue payments totalling ₹43,200. Want me to send WhatsApp reminders?" },
    { role: "user" as const, text: "Yes, send reminders" },
    { role: "ai" as const, text: "Done! 7 WhatsApp reminders sent. I'll notify you when payments come in." },
  ],
  [
    { role: "user" as const, text: "Freeze Rahul's plan for 2 weeks" },
    { role: "ai" as const, text: "Rahul Verma — Annual Plan, active till Dec 2026. Freezing for 14 days will extend expiry to Jan 10. Confirm?" },
    { role: "user" as const, text: "Confirm" },
    { role: "ai" as const, text: "Plan frozen. Rahul has been notified on WhatsApp. Expiry updated." },
  ],
  [
    { role: "user" as const, text: "How's today looking?" },
    { role: "ai" as const, text: "87 check-ins so far, ₹28,400 collected. 3 memberships expiring today — Priya, Ankit, Sneha. 2 new enquiries pending follow-up." },
    { role: "user" as const, text: "Send renewal reminder to the 3 expiring" },
    { role: "ai" as const, text: "Sent! Personalised WhatsApp messages with payment links delivered to all 3." },
  ],
  [
    { role: "user" as const, text: "Show revenue for last 3 months" },
    { role: "ai" as const, text: "Jan: ₹4.1L, Feb: ₹3.8L, Mar: ₹4.6L. March was your best month — 12% growth. Top plan: Annual (₹2.1L)." },
    { role: "user" as const, text: "Why did Feb dip?" },
    { role: "ai" as const, text: "14 fewer renewals vs Jan. 8 members switched to quarterly plans. Suggest running a promo for annual upgrades?" },
  ],
];


/* ─── Data ─── */
const features = [
  { title: "AI-Powered Operations", desc: "Manage everything through natural language. Renewals, reports, reminders — just ask.", icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z", color: "accent" },
  { title: "Smart Billing & POS", desc: "UPI QR payments, GST invoices, point-of-sale, partial payments, balance tracking — all built in.", icon: "M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z", color: "cyan-brand" },
  { title: "WhatsApp & SMS", desc: "Automated renewal reminders, payment receipts, welcome messages. Bulk notify with one click.", icon: "M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z", color: "accent" },
  { title: "Biometric Check-in", desc: "Kiosk mode with fingerprint sync. Members check in by phone — no cards needed.", icon: "M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33", color: "accent-bright" },
  { title: "Workout & Diet Plans", desc: "Create and assign custom workout routines and diet plans. Members access them from their portal.", icon: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12", color: "cyan-brand" },
  { title: "Enquiry & Lead Management", desc: "Track walk-ins, follow up on leads, convert prospects to members. Never lose a potential sale.", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z", color: "accent-bright" },
  { title: "Expense Tracking & P&L", desc: "Track expenses, payroll, and revenue. P&L reports, membership matrix, and source analysis built in.", icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "accent" },
  { title: "Facility & Class Booking", desc: "Manage classes, slots, and facility bookings. Members book from their portal, staff manages capacity.", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5", color: "cyan-brand" },
  { title: "Family Groups & Gift Cards", desc: "Link family memberships together. Sell and redeem gift cards. Promos and discount codes.", icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z", color: "accent-bright" },
  { title: "Analytics & Reports", desc: "Revenue trends, membership matrix, source analysis, staff performance, payment followups — all real-time.", icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z", color: "cyan-brand" },
  { title: "Data Migration", desc: "Switching from another platform? We migrate your members, payments, and history — zero data loss.", icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5", color: "accent" },
  { title: "Staff & Member Portals", desc: "Dedicated portals for staff (attendance, leaves, payroll) and members (plans, invoices, waivers, bookings).", icon: "M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3", color: "accent-bright" },
];

const plans = [
  { name: "Starter", price: "4,999", period: "/mo", desc: "Single-location gyms", items: ["1 location", "Unlimited members", "500 AI queries/mo", "Billing & GST invoices", "WhatsApp & SMS", "Biometric check-in", "Analytics & reports"] },
  { name: "Growth", price: "3,999", period: "/location/mo", desc: "Gym chains & franchises", items: ["Unlimited locations", "Everything in Starter", "1,000 AI queries/location", "Centralized dashboard", "Per-location staff", "Cross-location reports", "Priority support"], featured: true },
  { name: "Self-Hosted", price: "Custom", period: "", desc: "Your servers, your data", items: ["Full data isolation", "Everything in Growth", "Unlimited AI (your API key)", "Source code access", "Custom integrations", "Dedicated engineer", "White-label"] },
];

const partners = [
  { name: "Free Form Fitness", area: "Oshiwara, Mumbai", rating: "4.4", type: "Fitness Center" },
  { name: "EGym Lokhandwala", area: "Andheri West, Mumbai", rating: "4.1", type: "Gym" },
];

const iconColorMap: Record<string, string> = {
  accent: "text-accent bg-accent/10 border-accent/15 shadow-accent/5",
  "cyan-brand": "text-cyan-brand bg-cyan-brand/10 border-cyan-brand/15 shadow-cyan-brand/5",
  "accent-bright": "text-accent-bright bg-accent-bright/10 border-accent-bright/15 shadow-accent-bright/5",
};

/* ═══════════════════════════════════════ */
export default function Home() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hero = useInView(0.1);
  const dash = useInView(0.1);
  const feat = useInView(0.1);
  const price = useInView(0.1);
  const partner = useInView(0.1);
  const cta = useInView(0.1);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header>
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.04] bg-[#050507]/60 backdrop-blur-2xl">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="TraqGym" width={28} height={28} className="drop-shadow-[0_0_8px_rgba(129,140,248,0.3)]" priority />
            <span className="text-[15px] font-semibold tracking-tight">TraqGym</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-[13px] text-dim hover:text-accent transition-colors">Features</a>
            <a href="#pricing" className="text-[13px] text-dim hover:text-accent transition-colors">Pricing</a>
          </div>
          <a href="mailto:contactus@traqgym.com?subject=TraqGym Enquiry" className="hidden md:inline-flex glow-btn text-[13px] font-medium bg-gradient-to-r from-accent to-cyan-brand text-white px-5 py-2 rounded-lg transition-all hover:scale-[1.03]">
            Get Started
          </a>
          <button onClick={() => setMobileNavOpen(v => !v)} className="md:hidden p-2 text-dim hover:text-white transition-colors" aria-label="Toggle menu">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileNavOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              }
            </svg>
          </button>
        </div>
        {mobileNavOpen && (
          <div className="md:hidden border-t border-white/[0.04] bg-[#050507]/95 backdrop-blur-2xl px-6 py-3 space-y-2">
            <a href="#features" onClick={() => setMobileNavOpen(false)} className="block text-sm text-dim hover:text-accent py-2">Features</a>
            <a href="#pricing" onClick={() => setMobileNavOpen(false)} className="block text-sm text-dim hover:text-accent py-2">Pricing</a>
            <a href="mailto:contactus@traqgym.com?subject=TraqGym Enquiry" className="block text-sm font-medium text-accent py-2">Get Started</a>
          </div>
        )}
      </nav>
      </header>

      <main>
      {/* Hero */}
      <section ref={hero.ref} className="relative pt-24 pb-16 md:pt-36 md:pb-28 overflow-hidden">
        <div className="aurora" />
        <Particles />
        <div className="orb-violet -top-40 left-1/2 -translate-x-1/2" />
        <div className="orb-cyan top-20 -right-40" />
        <div className="orb-pink bottom-0 left-20" />

        <div className="relative mx-auto max-w-5xl px-6 text-center">
          {/* Badge */}
          <div className={`inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full border border-accent/20 bg-accent/[0.05] ${hero.inView ? "anim-fade-up" : "opacity-0"}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse" />
            <span className="text-[11px] text-accent font-medium tracking-wide">Powered by AI</span>
          </div>

          <h1 className={`text-[clamp(2.5rem,7vw,5.5rem)] font-bold tracking-[-0.03em] leading-[1.02] ${hero.inView ? "anim-fade-up d-100" : "opacity-0"}`}>
            The <span className="gradient-text">AI-native</span> gym
            <br />management platform
          </h1>

          <p className={`mt-7 text-[17px] md:text-lg text-sub max-w-xl mx-auto leading-relaxed ${hero.inView ? "anim-fade-up d-200" : "opacity-0"}`}>
            Members, billing, attendance, notifications — all managed through natural language. Just tell it what you need.
          </p>

          <div className={`mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 ${hero.inView ? "anim-fade-up d-300" : "opacity-0"}`}>
            <a href="mailto:contactus@traqgym.com?subject=TraqGym Enquiry" className="glow-btn group bg-gradient-to-r from-accent via-accent-bright to-cyan-brand text-white px-5 md:px-8 py-3.5 rounded-xl text-sm font-semibold transition-all hover:scale-[1.04] shadow-lg shadow-accent/20">
              Get Started
              <span className="inline-block ml-2 group-hover:translate-x-1 transition-transform">&rarr;</span>
            </a>
            <a href="#features" className="group border border-accent/15 px-5 md:px-8 py-3.5 rounded-xl text-sm font-medium hover:bg-accent/[0.05] hover:border-accent/25 transition-all flex items-center gap-2">
              See Features
              <span className="inline-block group-hover:translate-x-1 transition-transform">&darr;</span>
            </a>
          </div>

          {/* Stats */}
          <div className={`mt-24 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-8 max-w-xl mx-auto ${hero.inView ? "anim-fade-up d-400" : "opacity-0"}`}>
            {[
              { value: "< 2 min", l: "Setup Time" },
              { value: "Zero", l: "Spreadsheets Needed" },
              { value: "24/7", l: "AI Assistant" },
            ].map((s, i) => (
              <div key={s.l} className="text-center relative">
                {i > 0 && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-px h-8 bg-gradient-to-b from-transparent via-accent/20 to-transparent" />}
                <div className="text-3xl md:text-4xl font-bold tracking-tight gradient-text stat-glow">
                  {s.value}
                </div>
                <div className="text-[10px] text-dim mt-2 uppercase tracking-[0.15em] font-medium">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard Preview */}
      <section ref={dash.ref} className="pb-16 md:pb-28 -mt-8 relative overflow-hidden">
        <div className="relative mx-auto max-w-5xl px-6">
          <div className={`${dash.inView ? "anim-fade-up d-200" : "opacity-0"}`}>
            {/* Browser frame */}
            <div className="rounded-2xl border border-white/[0.08] bg-card overflow-hidden shadow-2xl shadow-accent/5">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-surface">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="bg-white/[0.04] border border-white/[0.06] rounded-md px-4 py-1 text-[11px] text-dim font-mono">
                    egymlokhandwala.traqgym.com/admin
                  </div>
                </div>
              </div>

              {/* Dashboard content */}
              <DashboardContent />
            </div>

            {/* Reflection glow */}
            <div className="h-40 bg-gradient-to-b from-accent/[0.03] to-transparent rounded-b-3xl -mt-1" />
          </div>
        </div>
      </section>

      <div className="gradient-line" />

      {/* Features */}
      <section id="features" ref={feat.ref} className="py-16 md:py-28 relative overflow-hidden">
        <div className="dot-grid absolute inset-0 opacity-60" />
        <Particles />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className={`text-center mb-16 ${feat.inView ? "anim-fade-up" : "opacity-0"}`}>
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full border border-dim/20 bg-white/[0.02]">
              <span className="text-[10px] text-dim font-semibold uppercase tracking-[0.15em]">Features</span>
            </div>
            <h2 className="text-3xl md:text-[2.75rem] font-bold tracking-tight">
              Everything your gym needs.
              <br />
              <span className="gradient-text">Nothing it doesn&apos;t.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <div key={f.title} className={`glass shine rounded-2xl p-5 md:p-7 group ${feat.inView ? `anim-fade-up d-${(i + 1) * 100}` : "opacity-0"}`}>
                <div className={`w-11 h-11 rounded-xl border flex items-center justify-center mb-5 transition-all ${iconColorMap[f.color]}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                  </svg>
                </div>
                <h3 className="font-semibold text-[15px] mb-2 group-hover:text-accent transition-colors">{f.title}</h3>
                <p className="text-[13px] text-dim leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="gradient-line" />

      {/* Pricing */}
      <section id="pricing" ref={price.ref} className="py-16 md:py-28 relative overflow-hidden">
        <div className="orb-cyan -bottom-40 right-0 opacity-25" />
        <div className="orb-violet -top-40 -left-40 opacity-20" />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className={`text-center mb-16 ${price.inView ? "anim-fade-up" : "opacity-0"}`}>
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full border border-dim/20 bg-white/[0.02]">
              <span className="text-[10px] text-dim font-semibold uppercase tracking-[0.15em]">Pricing</span>
            </div>
            <h2 className="text-3xl md:text-[2.75rem] font-bold tracking-tight">
              Simple pricing.
              <br />
              <span className="gradient-text">No per-member fees.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {plans.map((plan, i) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-5 md:p-7 transition-all duration-400 hover:scale-[1.03] relative ${
                  plan.featured
                    ? "animated-border !overflow-visible bg-gradient-to-b from-accent/[0.06] to-transparent shadow-[0_0_60px_rgba(129,140,248,0.08)]"
                    : "glow-card"
                } ${price.inView ? `anim-fade-up d-${(i + 1) * 100}` : "opacity-0"}`}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-accent to-cyan-brand text-white text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-wider shadow-lg shadow-accent/20">
                    Popular
                  </span>
                )}
                <h3 className="font-semibold text-base">{plan.name}</h3>
                <p className="text-[12px] text-dim mt-1">{plan.desc}</p>
                <div className="mt-5 mb-6">
                  <span className={`text-[2.25rem] font-bold tracking-tight ${plan.featured ? "gradient-text" : ""}`}>
                    {plan.price === "Custom" ? "" : "\u20B9"}{plan.price}
                  </span>
                  <span className="text-dim text-sm">{plan.period}</span>
                </div>
                <ul className="space-y-2.5 mb-7">
                  {plan.items.map(item => (
                    <li key={item} className="flex items-center gap-2.5 text-[13px]">
                      <svg className={`w-3.5 h-3.5 shrink-0 ${plan.featured ? "text-cyan-brand" : "text-accent"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sub">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className={`text-center mt-10 ${price.inView ? "anim-fade-up d-400" : "opacity-0"}`}>
            <a href="mailto:contactus@traqgym.com?subject=TraqGym Pricing Enquiry" className="glow-btn inline-flex items-center gap-2 bg-gradient-to-r from-accent to-cyan-brand text-white px-5 md:px-8 py-3.5 rounded-xl text-sm font-semibold transition-all hover:scale-[1.03] shadow-lg shadow-accent/20">
              Get Started
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </a>
            <p className="text-[12px] text-dim mt-3">Email us at contactus@traqgym.com</p>
          </div>
        </div>
      </section>

      <div className="gradient-line" />

      {/* Partners */}
      <section ref={partner.ref} className="py-16 md:py-28 relative overflow-hidden">
        <div className="relative mx-auto max-w-6xl px-6">
          <p className={`text-[11px] text-dim uppercase tracking-[0.2em] font-semibold text-center mb-14 ${partner.inView ? "anim-fade-up" : "opacity-0"}`}>
            Trusted by gyms across India
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6 max-w-2xl mx-auto mb-20">
            {partners.map((p, i) => (
              <div key={p.name} className={`glass shine rounded-2xl p-6 text-center flex-1 max-w-xs ${partner.inView ? `anim-fade-up d-${(i + 1) * 100}` : "opacity-0"}`}>
                <p className="font-semibold text-[16px] text-white/90">{p.name}</p>
                <p className="text-[12px] text-sub mt-1">{p.area}</p>
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  <div className="flex gap-0.5">
                    {[...Array(5)].map((_, j) => (
                      <svg key={j} className={`w-3 h-3 ${j < Math.floor(parseFloat(p.rating)) ? "text-amber-400" : "text-dim/30"}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                    ))}
                  </div>
                  <span className="text-[11px] text-white/60 font-medium">{p.rating}</span>
                  <span className="text-[10px] text-dim">· {p.type}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div className={`max-w-2xl mx-auto ${partner.inView ? "anim-fade-up d-500" : "opacity-0"}`}>
            <div className="glow-card rounded-2xl p-10 text-center relative">
              <div className="absolute -top-px left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
              <div className="flex justify-center gap-1.5 mb-6">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
              <p className="text-[15px] text-sub italic leading-relaxed">
                &ldquo;TraqGym replaced three different tools we were juggling — billing spreadsheets, WhatsApp groups for reminders, and a paper register for attendance. Now it&apos;s all in one place, and the AI just works.&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold">Robin Carruthers</p>
                <p className="text-[12px] text-dim mt-0.5">Owner, Free Form Fitness &mdash; Mumbai</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="gradient-line" />

      {/* CTA */}
      <section ref={cta.ref} className="py-16 md:py-28 relative overflow-hidden">
        <Particles />
        <div className="mx-auto max-w-6xl px-6">
          <div className={`relative rounded-3xl border border-accent/15 overflow-hidden ${cta.inView ? "anim-scale-in" : "opacity-0"}`}>
            {/* CTA background */}
            <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.06] via-transparent to-cyan-brand/[0.04]" />
            <div className="absolute inset-0 mesh-grid opacity-40" />
            <div className="orb-violet top-0 right-0 opacity-40" />
            <div className="orb-cyan bottom-0 left-0 opacity-30" />
            <div className="orb-pink top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20" />

            <div className="relative py-12 md:py-24 px-5 md:px-8 text-center">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-5">
                Ready to <span className="gradient-text">transform</span> your gym?
              </h2>
              <p className="text-dim max-w-md mx-auto mb-10 text-[15px]">Stop juggling spreadsheets, WhatsApp groups, and paper registers. Let AI handle it all.</p>
              <a href="mailto:contactus@traqgym.com?subject=TraqGym Demo Request" className="glow-btn inline-flex items-center gap-2.5 bg-gradient-to-r from-accent via-accent-bright to-cyan-brand text-white px-10 py-4 rounded-xl text-sm font-semibold transition-all hover:scale-[1.04] shadow-xl shadow-accent/20">
                Get Started
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-10">
        <div className="mx-auto max-w-6xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="TraqGym" width={20} height={20} className="drop-shadow-[0_0_6px_rgba(129,140,248,0.2)]" />
            <span className="text-[12px] text-dim">&copy; {new Date().getFullYear()} TraqGym</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-[12px] text-dim hover:text-accent transition-colors">Features</a>
            <a href="#pricing" className="text-[12px] text-dim hover:text-accent transition-colors">Pricing</a>
            <a href="mailto:contactus@traqgym.com" className="text-[12px] text-dim hover:text-accent transition-colors">contactus@traqgym.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
