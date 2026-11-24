"use client";

import Link from "next/link";
import { useState } from "react";
import { useFeedSecret } from "@/components/feed/useFeedSecret";

type State = "ready" | "saving" | "done" | "invalid" | "error";

/** Only this site's private feed routes are shown; anything else in the reply is ignored. */
function privateUrl(value: unknown, file: "feed.xml" | "latest.json"): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== `/security-master-feed/private/${file}`) return null;
    return /^rmf_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("key") ?? "") ? url.toString() : null;
  } catch {
    return null;
  }
}

export function FeedAccessIssue() {
  // Read from the stash, not the URL: the head script removed it before analytics loaded.
  const token = useFeedSecret("token");
  const [state, setState] = useState<State>("ready");
  const [rss, setRss] = useState<string | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setState("saving");
    try {
      const r = await fetch("/api/feed-waitlist/access/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        setState(r.status === 400 ? "invalid" : "error");
        return;
      }
      const body = (await r.json().catch(() => ({}))) as { rss_url?: unknown; json_url?: unknown };
      const rssUrl = privateUrl(body.rss_url, "feed.xml");
      if (!rssUrl) {
        setState("error");
        return;
      }
      setRss(rssUrl);
      setJson(privateUrl(body.json_url, "latest.json"));
      setState("done");
    } catch {
      setState("error");
    }
  }

  async function copy() {
    if (!rss) return;
    try {
      await navigator.clipboard.writeText(rss);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
      <h1 className="mb-4 text-2xl font-semibold text-white">Create your feed address</h1>
      {state === "done" && rss ? (
        <>
          <p className="mb-4">
            This is your private RSS address. Add it to your feed reader now: it is shown once and is not emailed.
          </p>
          <p className="mb-3 break-all rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-white">
            {rss}
          </p>
          <button type="button" onClick={copy} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
            {copied ? "Copied" : "Copy the address"}
          </button>
          {json ? (
            <>
              <p className="mb-2 mt-8">The same events as JSON, for a script:</p>
              <p className="break-all rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-white">
                {json}
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                A script can send the key in an <code>Authorization: Bearer</code> header instead of the address.
              </p>
            </>
          ) : null}
          <p className="mt-8 text-sm text-zinc-400">
            The address is personal to you. Please do not share or publish it. If it is lost or exposed,{" "}
            <Link href="/security-master-feed/access" className="underline">
              create a new one
            </Link>
            , which ends this one. Unsubscribing also ends it.
          </p>
        </>
      ) : state === "invalid" ? (
        <p role="alert">
          This link is invalid, already used or expired.{" "}
          <Link href="/security-master-feed/access" className="underline">
            Request a new one
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mb-6">
            Press the button to create your private RSS address for the Event Ledger. Any earlier address for this
            subscription stops working.
          </p>
          <button
            type="button"
            disabled={!token || state === "saving"}
            onClick={create}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? "Creating…" : "Create my feed address"}
          </button>
          {!token && <p className="mt-4 text-zinc-400">Open the link from your access email.</p>}
          {state === "error" && (
            <p role="alert" className="mt-4 text-red-300">
              Could not create the feed address. Please try again shortly.
            </p>
          )}
        </>
      )}
    </main>
  );
}
