"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TickerSearch() {
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
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter ticker..."
        className="w-36 px-3 py-1.5 text-sm rounded-lg bg-white/10 border border-white/20 text-white placeholder-slate-400 focus:outline-none focus:border-white/40"
      />
      <button
        type="submit"
        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-white/15 text-white hover:bg-white/25 transition border border-white/20"
      >
        Go
      </button>
    </form>
  );
}
