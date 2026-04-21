'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Loader2, Info } from 'lucide-react';
import { MessageBubble, type ChatMessage, type ToolCallSummary } from './MessageBubble';
import { SuggestionChip } from './SuggestionChip';

const STORAGE_MESSAGES = 'rm_chat_messages_v1';
const STORAGE_API_KEY = 'riskmodels_api_key';

const SUGGESTIONS = [
  "What is NVDA's L3 hedge ratio?",
  'How correlated is AAPL with oil?',
  "What's TSLA's explained risk breakdown?",
  'Compare MSFT and GOOGL residual risk',
];

interface ChatApiResponse {
  message: { role: 'assistant'; content: string };
  model?: string;
  usage?: { total_tokens?: number };
  tool_calls_summary?: ToolCallSummary[] | null;
  _demo?: {
    demo_mode: boolean;
    messages_remaining: number;
    allowed_tickers: string[];
  };
  _agent?: { cost_usd: number };
  error?: string;
  message_detail?: string;
}

export function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sessionCostUsd, setSessionCostUsd] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_MESSAGES);
      if (stored) setMessages(JSON.parse(stored));
    } catch {}
    try {
      const key = localStorage.getItem(STORAGE_API_KEY);
      if (key) setApiKey(key);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        textareaRef.current?.focus();
      }, 50);
    }
  }, [open, messages.length]);

  const isDemo = !apiKey;
  const endpoint = isDemo ? '/api/landing/chat' : '/api/chat';

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const newUser: ChatMessage = { role: 'user', content: trimmed };
      const history = [...messages, newUser];
      setMessages(history);
      setInput('');
      setLoading(true);

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        const body: ChatApiResponse = await res.json().catch(() => ({} as ChatApiResponse));

        if (!res.ok) {
          const errMsg =
            body?.error === 'Rate limit exceeded'
              ? "Demo limit reached. [Create an API key](https://riskmodels.app/get-key) for unlimited access."
              : res.status === 503
              ? 'AI chat is not configured yet. Please contact the RiskModels team.'
              : body?.message_detail ||
                (body as any)?.message ||
                body?.error ||
                `Request failed (${res.status})`;

          setMessages((cur) => [
            ...cur,
            { role: 'assistant', content: errMsg, error: true },
          ]);
        } else {
          const assistant: ChatMessage = {
            role: 'assistant',
            content: body.message?.content ?? '(no response)',
            toolCalls: body.tool_calls_summary ?? null,
          };
          setMessages((cur) => [...cur, assistant]);

          if (body._demo?.messages_remaining !== undefined) {
            setRemaining(body._demo.messages_remaining);
          }
          if (typeof body._agent?.cost_usd === 'number') {
            setSessionCostUsd((c) => c + body._agent!.cost_usd);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error';
        setMessages((cur) => [
          ...cur,
          { role: 'assistant', content: `Error: ${msg}`, error: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, apiKey, endpoint],
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      setInput(text);
      textareaRef.current?.focus();
    },
    [],
  );

  const clearConversation = useCallback(() => {
    setMessages([]);
    setRemaining(null);
    setSessionCostUsd(0);
    try {
      sessionStorage.removeItem(STORAGE_MESSAGES);
    } catch {}
  }, []);

  return (
    <>
      {/* Launcher bubble */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open RiskModels AI chat"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-900/40 transition hover:scale-105 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          <MessageCircle className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 flex h-[600px] max-h-[85vh] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
          role="dialog"
          aria-label="RiskModels AI chat"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-gradient-to-r from-blue-950/60 via-zinc-900 to-zinc-900 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-blue-600/20 text-blue-300">
                <MessageCircle className="h-4 w-4" />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 bg-emerald-500" />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-100">RiskModels AI Analyst</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {isDemo ? 'Demo · MAG7 only' : 'Full access'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearConversation}
                  className="rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col gap-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
                  <div className="mb-1 font-medium text-zinc-200">
                    Hi — I&apos;m a risk analyst agent with live ERM3 data.
                  </div>
                  <div className="leading-relaxed">
                    Ask about hedge ratios, correlations, residual risk, or factor exposures.
                    {isDemo && ' Demo supports MAG7 tickers; create an API key for the full 3,000+ ticker universe.'}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Try
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <SuggestionChip key={s} label={s} onSelect={handleSuggestion} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-zinc-800/80 px-3.5 py-2 text-xs text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing live risk data…
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Footer strip */}
          <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 py-2 text-[10px] text-zinc-500">
            {isDemo ? (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Demo mode — MAG7 only.
                </span>
                <a
                  href="/get-key"
                  className="text-blue-400 hover:text-blue-300"
                >
                  Get API key →
                </a>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span>Full access · live ERM3 data</span>
                {sessionCostUsd > 0 && (
                  <span className="font-mono">Session: ${sessionCostUsd.toFixed(4)}</span>
                )}
              </div>
            )}
            {isDemo && remaining !== null && (
              <div className="mt-1 text-zinc-600">
                {remaining} demo message{remaining === 1 ? '' : 's'} remaining this hour
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            className="border-t border-zinc-800 bg-zinc-950 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Ask about hedge ratios, correlations…"
                disabled={loading}
                className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                style={{ maxHeight: 120 }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
