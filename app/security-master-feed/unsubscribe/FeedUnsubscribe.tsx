"use client";

import { useState } from "react";
import { useFeedSecret } from "@/components/feed/useFeedSecret";

type State = "ready" | "saving" | "done" | "error";

export function FeedUnsubscribe() {
  // Read from the stash, not the URL: the head script removed it before analytics loaded.
  const token = useFeedSecret("token");
  const [state, setState] = useState<State>("ready");

  async function unsubscribe() {
    setState("saving");
    try {
      const r = await fetch("/api/feed-waitlist/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="text-2xl font-semibold text-white mb-4">Security master feed emails</h1>
      {state === "done" ? (
        <p>
          You are unsubscribed. We will not send you security master feed emails. Your RiskModels
          account and API access are not affected.
        </p>
      ) : (
        <>
          <p className="mb-6">
            Stop receiving emails about the security master change feed: the early-access updates,
            the launch notice and editions.
          </p>
          <button
            type="button"
            disabled={!token || state === "saving"}
            onClick={unsubscribe}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? "Saving…" : "Unsubscribe"}
          </button>
          {!token && (
            <p className="mt-4 text-zinc-400">Open the unsubscribe link from your RiskModels feed email.</p>
          )}
          {state === "error" && (
            <p role="alert" className="mt-4 text-red-300">
              Could not save. Please try again, or reply to the email and we will unsubscribe you.
            </p>
          )}
        </>
      )}
    </main>
  );
}
