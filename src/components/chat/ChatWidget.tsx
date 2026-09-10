'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { citationsFromSpans } from '@/lib/agent/citations';
import { describePageContext, type ChatScope } from '@/lib/page-context';
import { usePageContext } from './PageContextProvider';

const DEMO_QUESTIONS = [
  'What were net sales last month?',
  'How did this store do last quarter?',
  'Why did sales drop in July 2026 in Mumbai?',
];

type Msg = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string | null;
};

type Span = {
  kind: string;
  name: string;
  error: string | null;
  output: unknown;
};

function TypingDots() {
  return (
    <span className="inline-flex" aria-label="Loading">
      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>
        .
      </span>
      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>
        .
      </span>
      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>
        .
      </span>
    </span>
  );
}

export function ChatWidget() {
  const page = usePageContext();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ChatScope>('page');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [showTrace, setShowTrace] = useState(false);
  const [summaryNote, setSummaryNote] = useState<string | null>(null);

  const chip = useMemo(() => describePageContext(page, scope), [page, scope]);
  const citations = useMemo(() => citationsFromSpans(spans), [spans]);
  const visibleThreads = threads.slice(0, 3);

  const loadThreads = useCallback(async () => {
    const res = await fetch('/api/conversations');
    const json = (await res.json()) as { conversations: { id: string; title: string }[] };
    setThreads(json.conversations ?? []);
    return json.conversations ?? [];
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  function resetComposer() {
    setConversationId(null);
    setMessages([]);
    setRunId(null);
    setSpans([]);
    setSummaryNote(null);
  }

  async function loadConversation(id: string) {
    setConversationId(id);
    const res = await fetch(`/api/conversations/${id}`);
    const json = (await res.json()) as {
      messages: { id: string; role: string; content: string; run_id: string | null }[];
      summary: string | null;
    };
    setMessages(
      json.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        runId: m.run_id,
      })),
    );
    setSummaryNote(json.summary ? 'Earlier turns are summarized for this thread.' : null);
    const lastRun = [...json.messages].reverse().find((m) => m.run_id)?.run_id;
    setRunId(lastRun ?? null);
  }

  function newChat() {
    resetComposer();
  }

  async function closeThread(id: string) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    const remaining = await loadThreads();
    if (conversationId === id) {
      const next = remaining[0];
      if (next) await loadConversation(next.id);
      else resetComposer();
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    let assistant = '';
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          scope,
          pageContext: page,
        }),
      });
      const ctype = res.headers.get('content-type') ?? '';
      if (ctype.includes('application/json')) {
        const json = (await res.json()) as {
          text?: string;
          error?: string;
          conversationId?: string;
          runId?: string;
        };
        if (json.conversationId) setConversationId(json.conversationId);
        if (json.runId) setRunId(json.runId);
        assistant = json.text ?? json.error ?? 'Request failed.';
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: assistant,
            runId: json.runId,
          };
          return copy;
        });
        await loadThreads();
        return;
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No stream');
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          const ev = JSON.parse(line) as {
            type: string;
            text?: string;
            conversationId?: string;
            runId?: string;
            error?: string;
          };
          if (ev.conversationId) setConversationId(ev.conversationId);
          if (ev.runId) setRunId(ev.runId);
          if (ev.type === 'delta' && ev.text) {
            assistant += ev.text;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                role: 'assistant',
                content: assistant,
                runId: ev.runId,
              };
              return copy;
            });
          }
          if (ev.type === 'error') {
            assistant = ev.error ?? 'Error';
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: 'assistant', content: assistant };
              return copy;
            });
          }
        }
      }
      await loadThreads();
    } catch (err) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Chat failed',
        };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!runId || !showTrace) return;
    void fetch(`/api/traces/${runId}`)
      .then((r) => r.json())
      .then((j: { spans: Span[] }) => setSpans(j.spans ?? []));
  }, [runId, showTrace]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 z-40 rounded-full bg-(--ink) px-4 py-3 text-sm text-[#f5f0e8] shadow-lg bottom-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        Ask sales
      </button>
    );
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 flex h-[min(35rem,85dvh)] flex-col overflow-hidden rounded-2xl border border-(--line) bg-(--panel) shadow-2xl md:inset-x-auto md:right-5 md:bottom-5 md:w-95">
      <div className="flex items-center justify-between border-b border-(--line) px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Sales agent</p>
          <p
            className={clsx(
              'mt-0.5 truncate rounded px-1.5 py-0.5 text-[11px]',
              scope === 'page'
                ? 'bg-teal-100 text-teal-900'
                : 'bg-stone-200 text-stone-700',
            )}
          >
            Context: {chip}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-sm text-(--muted)"
        >
          Close
        </button>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-(--line) px-3 py-2 text-xs">
        <button
          type="button"
          className={clsx(
            'rounded px-2 py-1',
            scope === 'page' ? 'bg-teal-700 text-white' : 'bg-stone-100',
          )}
          onClick={() => setScope('page')}
        >
          This page
        </button>
        <button
          type="button"
          className={clsx(
            'rounded px-2 py-1',
            scope === 'all' ? 'bg-teal-700 text-white' : 'bg-stone-100',
          )}
          onClick={() => setScope('all')}
        >
          All data
        </button>
        <button
          type="button"
          className="ml-auto rounded px-2 py-1 bg-stone-100"
          onClick={newChat}
        >
          New chat
        </button>
      </div>
      {visibleThreads.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-(--line) px-2 py-1 text-[11px]">
          {visibleThreads.map((t) => (
            <div key={t.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => void loadConversation(t.id)}
                className={clsx(
                  'rounded px-2 py-1 pr-5',
                  t.id === conversationId ? 'bg-stone-800 text-white' : 'bg-stone-100',
                )}
              >
                {t.title.slice(0, 22)}
              </button>
              <button
                type="button"
                aria-label="Close chat"
                className={clsx(
                  'absolute right-0.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-xs leading-none hover:bg-black/20',
                  t.id === conversationId ? 'text-white' : 'text-stone-600',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeThread(t.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {summaryNote && (
        <p className="border-b border-(--line) px-3 py-1 text-[11px] text-(--muted)">
          {summaryNote}
        </p>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2 text-(--muted)">
            <p>Demo questions (numbers come from SQL tools, not the model):</p>
            <div className="flex flex-wrap gap-1">
              {DEMO_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="rounded-full border border-(--line) bg-white px-2 py-1 text-left text-[11px] text-stone-700"
                  onClick={() => setInput(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={clsx(
              'rounded-lg px-3 py-2 whitespace-pre-wrap',
              m.role === 'user' ? 'ml-6 bg-stone-200' : 'mr-4 bg-teal-50',
            )}
          >
            {m.content || (busy && i === messages.length - 1 ? <TypingDots /> : '')}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-(--line) px-3 py-1 text-[11px]">
        <button
          type="button"
          className="underline"
          onClick={() => setShowTrace((v) => !v)}
        >
          {showTrace ? 'Hide trace' : 'Trace / sources'}
        </button>
      </div>
      {showTrace && (
        <div className="max-h-36 overflow-auto border-t border-(--line) bg-stone-50 px-3 py-2 text-[11px]">
          {spans.length === 0 ? (
            <p className="text-(--muted)">No spans yet. Send a question first.</p>
          ) : (
            <>
              <p className="mb-1 font-medium">Sources</p>
              {citations.length === 0 ? (
                <p className="text-(--muted)">No SQL citations on this run.</p>
              ) : (
                citations.map((c, i) => <p key={`c-${i}`}>• {c}</p>)
              )}
              <p className="mt-2 mb-1 font-medium">Trace</p>
              {spans.map((s, i) => (
                <p key={i}>
                  {s.kind}/{s.name}
                  {s.error ? ` · ${s.error}` : ''}
                </p>
              ))}
            </>
          )}
        </div>
      )}
      <form
        className="flex gap-2 border-t border-(--line) p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about sales…"
          className="flex-1 rounded-md border border-(--line) px-2 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-(--accent) px-3 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
