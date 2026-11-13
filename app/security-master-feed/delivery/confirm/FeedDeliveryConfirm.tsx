"use client";

import { useState } from "react";
import { useFeedSecret } from "@/components/feed/useFeedSecret";

type State = "ready" | "saving" | "done" | "invalid" | "error";

export function FeedDeliveryConfirm() {
  // Read from the stash, not the URL: the head script removed them before analytics loaded.
  const token = useFeedSecret("token");
  // The inbox the email named, shown so the reader knows what they confirm. The server acts on the
  // inbox stored with the request, never on this value.
  const inbox = useFeedSecret("inbox");
  const [state, setState] = useState<State>("ready");

  async function confirm() {
    setState("saving");
    try {
      const r = await fetch("/api/feed-waitlist/delivery/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(r.ok ? "done" : r.status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="text-2xl font-semibold text-white mb-4">Confirm the team inbox</h1>
      {state === "done" ? (
        <p role="status">
          Done. If that address can receive the feed as a team inbox, we have asked it to confirm for itself, and it
          starts receiving editions when it does. Until then, editions keep coming to your address.
        </p>
      ) : state === "invalid" ? (
        <p role="alert">This link is invalid or has expired. Use the team inbox link in a newer edition.</p>
      ) : (
        <>
          <p className="mb-6">
            Confirm that editions of the Event Ledger should go to{" "}
            {inbox ? <strong className="text-white break-all">{inbox}</strong> : "the team inbox named in your email"}.
          </p>
          <button
            type="button"
            disabled={!token || state === "saving"}
            onClick={confirm}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? "Saving…" : "Confirm the team inbox"}
          </button>
          {token === null && <p className="mt-4 text-zinc-400">Open the link from your email.</p>}
          {state === "error" && (
            <p role="alert" className="mt-4 text-red-300">
              Could not save. Please try again shortly.
            </p>
          )}
        </>
      )}
    </main>
  );
}
