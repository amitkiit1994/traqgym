"use client";

import { useState, useTransition } from "react";
import { requestGymSignup } from "@/lib/actions/gym-signup";

export function SignupForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    gymName: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    subdomain: "",
    city: "",
    notes: "",
  });

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-500/40 bg-green-50 dark:bg-green-950/30 p-4 text-sm">
        <p className="font-medium">Got it! 🎉</p>
        <p className="text-muted-foreground mt-1">
          We&apos;ll be in touch within 24 hours with your TraqGym instance login.
        </p>
      </div>
    );
  }

  const input = (
    label: string,
    key: keyof typeof form,
    type = "text",
    required = true,
    placeholder = "",
  ) => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && " *"}
      </label>
      <input
        type={type}
        required={required}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await requestGymSignup(form);
          if (res.success) setSubmitted(true);
          else setError(res.error);
        });
      }}
      className="space-y-3"
    >
      {input("Gym name", "gymName", "text", true, "e.g. Free Form Fitness")}
      {input("Your name", "ownerName", "text", true)}
      {input("Email", "ownerEmail", "email", true)}
      {input("Phone", "ownerPhone", "tel", true, "10-digit mobile")}
      {input("City", "city", "text", false)}
      {input(
        "Preferred subdomain",
        "subdomain",
        "text",
        false,
        "e.g. freeformfitness → freeformfitness.traqgym.com",
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Anything else?</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          placeholder="Current software, number of members, etc."
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Submitting..." : "Request my TraqGym instance"}
      </button>
    </form>
  );
}
