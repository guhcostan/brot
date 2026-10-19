import type { CanonicalEvent, Thread } from '@brot/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyThreadEvent, initThread, latestThread, type ThreadState } from '../state/thread';
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
  send(content: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  reload(): void;
}

const TITLE_LENGTH = 60;

function titleFrom(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH - 1)}…` : flat;
}

/**
 * Loads a bot's thread and keeps it live. Events are buffered while the history loads and folded in
 * afterwards, so nothing that streams in during the fetch is lost; replays are no-ops in the reducer.
 */
export function useThread(botId: string, requestedThreadId?: string): ThreadView {
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
        if (!id) {
          const threads: Thread[] = await client.listThreads(botId);
          id = latestThread(threads)?.id;
        }
        if (cancelled) return;
        threadRef.current = id;
        setThreadId(id);
        if (!id) {
          ready = true;
          setState(undefined);
          return;
        }
        noteThread?.(id, botId);
        const [messages, runs, approvals] = await Promise.all([client.listMessages(id), client.listRuns(id), client.listApprovals()]);
        if (cancelled) return;
        let next = initThread(id, { messages, runs, approvals });
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
    async (content: string) => {
      if (!client) return;
      const text = content.trim();
      if (!text) return;
      setOutgoing({ content: text });
      setSendError(undefined);
      try {
        let id = threadRef.current;
        if (!id) {
          const thread = await client.createThread(botId, { title: titleFrom(text) });
          id = thread.id;
          threadRef.current = id;
          setThreadId(id);
          setState(initThread(id));
          noteThread?.(id, botId);
        }
        await client.postMessage(id, text);
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
