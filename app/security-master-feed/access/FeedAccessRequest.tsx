"use client";

import Link from "next/link";
import { useState } from "react";

type State = "ready" | "sending" | "sent" | "error";

export function FeedAccessRequest() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<State>("ready");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const r = await fetch("/api/feed-waitlist/access/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      const json = (await r.json().catch(() => ({}))) as { message?: string };
      setMessage(json.message ?? "");
      setState(r.ok ? "sent" : "error");
    } catch {
      setMessage("");
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="mb-4 text-2xl font-semibold text-white">Private feed address</h1>
      <p className="mb-4">
        Approved subscribers can read the current Event Ledger in a feed reader. Enter the address you subscribed
        with and we email it a link that creates your private RSS address. The link works once, for one hour.
      </p>
      <p className="mb-8 text-zinc-400">
        Not a subscriber yet?{" "}
        <Link href="/security-master-feed#join" className="underline">
          Request free access
        </Link>
        . A dated public sample is at{" "}
        <a href="https://www.riskmodels.org/events" className="underline">
          riskmodels.org/events
        </a>
        .
      </p>

      {state === "sent" ? (
        <p role="status">{message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-300">Subscriber email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </label>
          {/* Honeypot: hidden from people, filled by naive bots. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="hidden"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : "Email me the link"}
          </button>
          {state === "error" && (
            <p role="alert" className="text-red-300">
              {message || "Could not process the request. Please try again shortly."}
            </p>
          )}
        </form>
      )}

      <p className="mt-10 text-sm text-zinc-400">
        The address is personal to you. Creating a new one replaces the old one, and unsubscribing ends it. All data
        is end-of-day and historical.
      </p>
    </main>
  );
}
