/**
 * Faint stack logos — minimal SVG marks, not official brand lockups.
 */
function IconPython({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2C8.5 2 7 3.2 7 5.5V7h4.2c.4 0 .8.4.8.8V9H7c-2.3 0-3.5 1.2-3.5 4.5S5.2 18 7.5 18H9v-1.7c0-.4.4-.8.8-.8h4.4v-3H12c-2.3 0-3.5-1.2-3.5-4.5 0-2.5 1-3.8 3.5-3.8Z"
        fill="currentColor"
        opacity={0.45}
      />
      <path
        d="M12 22c3.5 0 5-1.2 5-3.5V17h-4.2c-.4 0-.8-.4-.8-.8V15h5.5c2.3 0 3.5-1.2 3.5-4.5S18.8 6 16.5 6H15v1.7c0 .4-.4.8-.8.8H10v3h2.5c2.3 0 3.5 1.2 3.5 4.5 0 2.5-1 3.8-3.5 3.8Z"
        fill="currentColor"
        opacity={0.28}
      />
    </svg>
  );
}

function IconNode({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 4 6v12l8 4 8-4V6l-8-4Z"
        stroke="currentColor"
        strokeWidth={1.15}
        strokeLinejoin="round"
        opacity={0.5}
      />
      <path d="M12 22V12M12 12 4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth={1.15} opacity={0.35} />
    </svg>
  );
}

function IconMcp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" opacity={0.45} />
      <circle cx="6" cy="8" r="1.4" stroke="currentColor" strokeWidth={1.2} opacity={0.35} />
      <circle cx="18" cy="8" r="1.4" stroke="currentColor" strokeWidth={1.2} opacity={0.35} />
      <circle cx="6" cy="16" r="1.4" stroke="currentColor" strokeWidth={1.2} opacity={0.35} />
      <circle cx="18" cy="16" r="1.4" stroke="currentColor" strokeWidth={1.2} opacity={0.35} />
      <path d="M7.2 8.8 10.2 11M16.8 8.8 13.8 11M7.2 15.2l3 2.2M16.8 15.2l-3 2.2" stroke="currentColor" strokeWidth={1} opacity={0.28} />
    </svg>
  );
}

function IconDocker({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 14h2v2H4v-2Zm3 0h2v2H7v-2Zm3 0h2v2h-2v-2Zm3 0h2v2h-2v-2Zm-9-3h2v2H4v-2Zm3 0h2v2H7v-2Zm3 0h2v2h-2v-2Zm3 0h2v2h-2v-2Zm3 0h2v2h-2v-2Zm0-3h2v2h-2v-2Zm-3 0h2v2h-2v-2Z"
        fill="currentColor"
        opacity={0.4}
      />
      <path
        d="M19 10c.8 1.2 1 2.4.2 3.4-.5.6-1.4.9-2.2.9h-1V14"
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinecap="round"
        opacity={0.32}
      />
    </svg>
  );
}

const items = [
  { label: 'Python', Icon: IconPython },
  { label: 'Node', Icon: IconNode },
  { label: 'MCP', Icon: IconMcp },
  { label: 'Docker', Icon: IconDocker },
] as const;

export default function TrustTechBar() {
  return (
    <div className="flex flex-col items-center gap-2 pt-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-600">Built on</p>
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-zinc-500">
        {items.map(({ label, Icon }) => (
          <li key={label} className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
            <Icon className="h-6 w-6 shrink-0" />
            <span className="text-xs font-mono text-zinc-500">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
