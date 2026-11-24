import type { FeedEvent } from '@/lib/site/live';

/** Rows of the public feed sample, as served by /security-master-feed/latest.json. */
export function FeedTable({ events }: { events: FeedEvent[] }) {
  return (
    <div className="rm-scroll-x">
      <table className="rm-table min-w-[40rem]">
        <thead>
          <tr>
            <th scope="col">Known</th>
            <th scope="col">Effective</th>
            <th scope="col">Company</th>
            <th scope="col">Event</th>
            <th scope="col">SEC filing</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.event_id}>
              <td className="rm-mono whitespace-nowrap text-[0.8125rem]">{e.known_date ?? '—'}</td>
              <td className="rm-mono whitespace-nowrap text-[0.8125rem]">{e.effective_date ?? '—'}</td>
              <td>{e.company ?? e.ticker ?? '—'}</td>
              <td>{e.event}</td>
              <td className="rm-mono text-[0.8125rem]">
                {e.source_url ? (
                  <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="rm-link">
                    {e.source_label ?? 'filing'}
                  </a>
                ) : (
                  (e.source_label ?? '—')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
