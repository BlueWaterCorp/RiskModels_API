"use client";

import { useEffect, useState } from "react";
import { readFeedSecret, type FEED_SECRET_PARAMS } from "@/lib/feed-url-secrets";

/**
 * A feed-link secret (token, inbox) for this page, read after mount from where the
 * head script stashed it (lib/feed-url-secrets.ts), never left in the address bar.
 * `undefined` until read, then the value or null.
 */
export function useFeedSecret(name: (typeof FEED_SECRET_PARAMS)[number]): string | null | undefined {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setValue(readFeedSecret(name));
  }, [name]);
  return value;
}
