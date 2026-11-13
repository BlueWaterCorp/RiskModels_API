"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

type State = "ready" | "saving" | "done" | "notLinked" | "invalid" | "error";

export function FeedDeliveryConfirm() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>("ready");

  async function confirm() {
    setState("saving");
    try {
      const r = await fetch("/api/feed-waitlist/delivery/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        setState(r.status === 400 ? "invalid" : "error");
        return;
      }
      const json = (await r.json().catch(() => ({}))) as { linked?: boolean };
      setState(json.linked === false ? "notLinked" : "done");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="text-2xl font-semibold text-white mb-4">Confirm the team inbox</h1>
      {state === "done" ? (
        <p role="status">
          Confirmed. We have asked the team inbox to confirm for itself; it starts receiving editions when it does.
          Until then, editions keep coming to your address.
        </p>
      ) : state === "notLinked" ? (
        <p role="status">
          That address is already on the list as a person&apos;s own address, so it cannot be used as a team inbox.
          Nothing has changed. Ask its owner, or write to service@riskmodels.app.
        </p>
      ) : state === "invalid" ? (
        <p role="alert">This link is invalid or has expired. Use the team inbox link in a newer edition.</p>
      ) : (
        <>
          <p className="mb-6">Confirm that editions of the Event Ledger should go to the team inbox you named.</p>
          <button
            type="button"
            disabled={!token || state === "saving"}
            onClick={confirm}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? "Saving…" : "Confirm the team inbox"}
          </button>
          {!token && <p className="mt-4 text-zinc-400">Open the link from your email.</p>}
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
