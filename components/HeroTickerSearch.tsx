"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HeroTickerSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ticker = value.trim().toUpperCase();
    if (ticker) {
      router.push(`/ticker/${ticker}`);
      setValue("");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex items-center gap-2 max-w-sm"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter ticker (e.g. NVDA)"
        className="flex-1 px-4 py-3 text-sm rounded-lg bg-white/10 border border-white/20 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-400/60 transition"
      />
      <button
        type="submit"
        className="px-5 py-3 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition"
      >
        Deep Dive
      </button>
    </form>
  );
}
