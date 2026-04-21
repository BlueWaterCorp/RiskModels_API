'use client';

interface Props {
  label: string;
  onSelect: (text: string) => void;
}

export function SuggestionChip({ label, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(label)}
      className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs text-zinc-300 transition hover:border-blue-500/60 hover:bg-zinc-800 hover:text-zinc-100"
    >
      {label}
    </button>
  );
}
