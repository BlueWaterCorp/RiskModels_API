"use client";

import Link from "next/link";
import { useState } from "react";
import { useFeedSecret } from "@/components/feed/useFeedSecret";

type State = "ready" | "saving" | "done" | "doneDelivery" | "doneFeed" | "invalid" | "error";

/** Only the public signup link for this address. Anything else is not shown. */
function colleagueInviteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.pathname.endsWith("/security-master-feed")) return null;
    if (!/^[a-z0-9]{8,32}$/.test(url.searchParams.get("ref") ?? "")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function FeedConfirm() {
  // Read from the stash, not the URL: the head script removed it before analytics loaded.
  const token = useFeedSecret("token");
  const [state, setState] = useState<State>("ready");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

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
      const json = (await r.json().catch(() => ({}))) as {
        purpose?: string;
        delivery?: boolean;
        inviteUrl?: string | null;
      };
      setInviteUrl(colleagueInviteUrl(json.inviteUrl));
      setState(json.purpose === "feed" ? "doneFeed" : json.delivery ? "doneDelivery" : "done");
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
      ) : state === "doneDelivery" || state === "done" ? (
        <>
          <p>
            {state === "doneDelivery"
              ? "This address is confirmed for the security master change feed. Editions go to the other address you named. That address does not need its own confirmation."
              : "This address is confirmed for the security master change feed. Editions will come to this address."}
          </p>
          {inviteUrl ? (
            <p className="mt-6">
              Invite a colleague with your link. When they confirm, the list records that the invitation came from
              you.{" "}
              <Link href={inviteUrl} className="underline break-all">
                {inviteUrl}
              </Link>
            </p>
          ) : null}
        </>
      ) : state === "invalid" ? (
        <p role="alert">
          This confirmation link is invalid or has expired.{" "}
          <Link href="/security-master-feed" className="underline">
            Sign up again from the feed page
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mb-6">
            Confirm that this is your address for the security master change feed. You are not subscribed until you do.
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
