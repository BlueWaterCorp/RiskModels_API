"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

type State = "ready" | "saving" | "done" | "doneFeed" | "invalid" | "error";

export function FeedConfirm() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>("ready");

  async function confirm() {
    setState("saving");
    try {
      const r = await fetch("/api/feed-waitlist/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        setState(r.status === 400 ? "invalid" : "error");
        return;
      }
      const json = (await r.json().catch(() => ({}))) as { purpose?: string };
      setState(json.purpose === "feed" ? "doneFeed" : "done");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="text-2xl font-semibold text-white mb-4">Confirm your email</h1>
      {state === "doneFeed" ? (
        <p>
          This address is confirmed as a delivery address for the security master change feed. It will receive
          editions once delivery starts.
        </p>
      ) : state === "done" ? (
        <p>
          You are on the early-access list for the security master change feed. We will email you the specification
          and a sample before the first edition. If you asked for the feed to go to a separate address, we are asking
          that address to confirm too.
        </p>
      ) : state === "invalid" ? (
        <p role="alert">
          This confirmation link is invalid or has expired.{" "}
          <Link href="/security-master-feed" className="underline">
            Join again from the early-access page
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mb-6">
            Confirm that this is your address to join the early-access list for the security master change feed. You
            are not on the list until you do.
          </p>
          <button
            type="button"
            disabled={!token || state === "saving"}
            onClick={confirm}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? "Saving…" : "Confirm my email"}
          </button>
          {!token && <p className="mt-4 text-zinc-400">Open the confirmation link from your email.</p>}
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
