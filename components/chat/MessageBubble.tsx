'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ToolCallSummary {
  tool: string;
  capability: string | null;
  cost_usd: number;
  latency_ms: number;
  error: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallSummary[] | null;
  error?: boolean;
}

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const isError = message.error;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3.5 py-2 text-sm text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[90%] rounded-2xl rounded-tl-sm px-3.5 py-2 text-sm shadow-sm ${
          isError
            ? 'border border-red-700/40 bg-red-950/40 text-red-100'
            : 'bg-zinc-800/80 text-zinc-100'
        }`}
      >
        <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-zinc-950 prose-pre:text-[11px] prose-code:text-[12px] prose-code:before:content-[''] prose-code:after:content-[''] prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-headings:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-a:text-blue-300">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-700/60 pt-2">
            {message.toolCalls.map((tc, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono ${
                  tc.error
                    ? 'border-red-800/60 bg-red-950/40 text-red-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300'
                }`}
                title={tc.error ?? `${tc.tool} · ${tc.latency_ms}ms${tc.cost_usd ? ` · $${tc.cost_usd.toFixed(4)}` : ''}`}
              >
                <span className="text-emerald-400">{'>'}</span>
                {tc.tool}
                <span className="text-zinc-500">·</span>
                <span className="text-zinc-400">{tc.latency_ms}ms</span>
                {tc.cost_usd > 0 && (
                  <>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-400">${tc.cost_usd.toFixed(4)}</span>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
