"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";

type State = "ready" | "saving" | "done" | "invalid" | "error";

export function FeedDelivery() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>("ready");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("saving");
    setMessage(null);
    try {
      const r = await fetch("/api/feed-waitlist/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          feed_email: form.get("feed_email"),
          stop_contact: form.get("stop_contact") === "on",
        }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!r.ok) {
        setState(json.error === "Invalid link" ? "invalid" : "error");
        setMessage(json.message ?? null);
        return;
      }
      setState("done");
      setMessage(json.message ?? null);
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="text-2xl font-semibold text-white mb-4">Send the Event Ledger to a team inbox</h1>
      {state === "done" ? (
        <p role="status">{message}</p>
      ) : state === "invalid" ? (
        <p role="alert">{message ?? "Open this page from the team inbox link in an edition."}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Name a shared mailbox or an agent inbox. We email the address this edition was sent to and ask it to
            confirm; then the team inbox confirms for itself. Nothing changes until both have.
          </p>
          <div>
            <label htmlFor="fd-inbox" className="block text-xs font-medium text-zinc-400 mb-1">
              Team inbox
            </label>
            <Input id="fd-inbox" name="feed_email" type="email" required autoComplete="off" maxLength={254} />
          </div>
          <label className="flex items-start gap-2 text-sm text-zinc-300 leading-snug">
            <input
              type="checkbox"
              name="stop_contact"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-900 accent-blue-500"
            />
            <span>Stop sending editions to my own address once the team inbox confirms.</span>
          </label>
          <button
            type="submit"
            disabled={!token || state === "saving"}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? "Sending…" : "Ask for confirmation"}
          </button>
          {!token && <p className="text-zinc-400">Open this page from the link in an edition.</p>}
          {state === "error" && (
            <p role="alert" className="text-red-300">
              {message ?? "Could not save. Please try again shortly."}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
