import type { CanonicalEvent, Thread } from '@brot/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrotClient } from '../api/client';
import { applyThreadEvent, initThread, latestThread, withHistory, type ThreadState } from '../state/thread';
import { describeError, usePaired } from './BrotProvider';

export interface OutgoingMessage {
  content: string;
}

export interface ThreadView {
  threadId?: string;
  state?: ThreadState;
  loading: boolean;
  error?: string;
  /** What the user just sent, shown until the server echoes it back as a message. */
  outgoing?: OutgoingMessage;
  /** Why the last send failed. The composer keeps the text so it can be sent again. */
  sendError?: string;
  send(content: string, mentions?: string[]): Promise<void>;
  cancel(runId: string): Promise<void>;
  reload(): void;
}

export interface ThreadTarget {
  /** A DM: the bot whose DM thread to open (or create on first send). */
  botId?: string;
  /** A specific thread, e.g. a room or a task's work thread. */
  threadId?: string;
}

const TITLE_LENGTH = 60;
/** The server pages the log 500 events at a time; a phone only needs the recent team activity. */
const HISTORY_PAGES = 4;

function titleFrom(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH - 1)}…` : flat;
}

/** The thread's stored log, a few pages at most. Older servers without the endpoint yield nothing. */
async function loadHistory(client: BrotClient, threadId: string): Promise<CanonicalEvent[]> {
  const all: CanonicalEvent[] = [];
  let after: string | undefined;
  try {
    for (let page = 0; page < HISTORY_PAGES; page++) {
      const events = await client.listEvents(threadId, after);
      all.push(...events);
      const next = events.at(-1)?.id;
      if (next === undefined || next === after) break;
      after = next;
    }
  } catch {
    // Team rows are an extra; messages and runs still load.
  }
  return all;
}

/**
 * Loads a thread and keeps it live. Events are buffered while the history loads and folded in
 * afterwards, so nothing that streams in during the fetch is lost; replays are no-ops in the reducer.
 */
export function useThread({ botId, threadId: requestedThreadId }: ThreadTarget): ThreadView {
  const paired = usePaired();
  const client = paired?.client;
  const subscribe = paired?.subscribe;
  const noteThread = paired?.noteThread;

  const [threadId, setThreadId] = useState(requestedThreadId);
  const [state, setState] = useState<ThreadState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [outgoing, setOutgoing] = useState<OutgoingMessage>();
  const [sendError, setSendError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const threadRef = useRef(threadId);
  threadRef.current = threadId;

  useEffect(() => {
    if (!client || !subscribe) return;
    let cancelled = false;
    let ready = false;
    const buffer: CanonicalEvent[] = [];

    const unsubscribe = subscribe((event) => {
      if (event.threadId !== threadRef.current) return;
      if (!ready) buffer.push(event);
      else setState((current) => (current ? applyThreadEvent(current, event) : current));
      if (event.type === 'message.completed' && event.message.role === 'user') setOutgoing(undefined);
    });

    const load = async () => {
      setLoading(true);
      setError(undefined);
      try {
        let id = requestedThreadId;
        if (!id && botId) {
          const threads: Thread[] = await client.listThreads(botId, 'dm');
          id = latestThread(threads.filter((thread) => (thread.kind ?? 'dm') === 'dm'))?.id;
        }
        if (cancelled) return;
        threadRef.current = id;
        setThreadId(id);
        if (!id) {
          ready = true;
          setState(undefined);
          return;
        }
        if (botId) noteThread?.(id, botId);
        const [messages, runs, approvals, history] = await Promise.all([
          client.listMessages(id),
          client.listRuns(id),
          client.listApprovals(),
          loadHistory(client, id),
        ]);
        if (cancelled) return;
        let next = withHistory(initThread(id, { messages, runs, approvals }), history);
        for (const event of buffer.splice(0)) next = applyThreadEvent(next, event);
        ready = true;
        setState(next);
      } catch (cause) {
        if (!cancelled) setError(describeError(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, subscribe, noteThread, botId, requestedThreadId, attempt]);

  const send = useCallback(
    async (content: string, mentions?: string[]) => {
      if (!client) return;
      const text = content.trim();
      if (!text) return;
      setOutgoing({ content: text });
      setSendError(undefined);
      try {
        let id = threadRef.current;
        if (!id) {
          if (!botId) return;
          const thread = await client.createThread(botId, { title: titleFrom(text) });
          id = thread.id;
          threadRef.current = id;
          setThreadId(id);
          setState(initThread(id));
          noteThread?.(id, botId);
        }
        await client.postMessage(id, text, mentions);
      } catch (cause) {
        setOutgoing(undefined);
        setSendError(describeError(cause));
        throw cause;
      }
    },
    [client, botId, noteThread],
  );

  const cancel = useCallback(
    async (runId: string) => {
      if (!client) return;
      await client.cancelRun(runId);
    },
    [client],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { threadId, state, loading, error, outgoing, sendError, send, cancel, reload };
}
