import type { Approval, ApprovalDecision, CanonicalEvent } from '@brot/protocol';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ApiError, createClient, type BrotClient } from '../api/client';
import { createLiveEvents, type LiveEvents, type LiveStatus } from '../api/liveEvents';
import { createXhrStream } from '../api/sse';
import { secureStorage } from '../session/secureStorage';
import { loadSession, pairDevice, saveSession, unpairDevice, SESSION_KEY, type PairInput, type StoredSession } from '../session/session';
import { applyInboxEvent, initInbox, rememberThread, type InboxState } from '../state/inbox';
import { capabilitiesFor, type Capabilities } from '../state/roles';

export type Phase = 'loading' | 'unpaired' | 'paired';

export interface BrotContextValue {
  phase: Phase;
  session?: StoredSession;
  client?: BrotClient;
  capabilities: Capabilities;
  liveStatus: LiveStatus;
  lastEventAt?: string;
  inbox: InboxState;
  /** True until the first inbox load finishes. */
  inboxLoading: boolean;
  /** Why the last inbox load failed, in plain words. */
  inboxError?: string;
  /** The server rejected this phone's token: it was unpaired from the computer. */
  revoked: boolean;
  refresh(): Promise<void>;
  pair(input: PairInput): Promise<StoredSession>;
  unpair(): Promise<{ revokedOnServer: boolean }>;
  /** Forgets the local session without calling the server, for a phone the server already revoked. */
  forget(): Promise<void>;
  /** Points the session at a new address after checking that the token still works there. */
  changeServerUrl(serverUrl: string): Promise<void>;
  resolveApproval(approval: Approval, decision: ApprovalDecision, reply?: string): Promise<Approval>;
  noteThread(threadId: string, botId: string): void;
  subscribe(listener: (event: CanonicalEvent) => void): () => void;
}

const NO_CAPABILITIES: Capabilities = { chat: false, approve: false, cancel: false, revokeSelf: false };
const EMPTY_INBOX: InboxState = initInbox([], []);

const BrotContext = createContext<BrotContextValue | null>(null);

/** Plain-language reason for a failed request (DESIGN.md section 8: honest about state). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Can’t reach your computer. Check that Brot is running and this phone is on the same network.';
    if (error.unauthorized) return 'This phone is no longer paired.';
    if (error.forbidden) return 'This phone’s role doesn’t allow that.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function BrotProvider({ children }: { children: ReactNode }): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<StoredSession>();
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle');
  const [lastEventAt, setLastEventAt] = useState<string>();
  const [inbox, setInbox] = useState<InboxState>(EMPTY_INBOX);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string>();
  const [revoked, setRevoked] = useState(false);
  const liveRef = useRef<LiveEvents | undefined>(undefined);
  const listeners = useRef(new Set<(event: CanonicalEvent) => void>());

  useEffect(() => {
    let cancelled = false;
    void loadSession(secureStorage).then((stored) => {
      if (cancelled) return;
      setSession(stored);
      setPhase(stored ? 'paired' : 'unpaired');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useMemo(
    () => (session ? createClient({ baseUrl: session.serverUrl, token: session.deviceToken }) : undefined),
    [session],
  );

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const [bots, approvals] = await Promise.all([client.listBots(), client.listApprovals('pending')]);
      setInbox((previous) => initInbox(bots, approvals, previous));
      setInboxError(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.unauthorized) setRevoked(true);
      setInboxError(describeError(error));
    } finally {
      setInboxLoading(false);
    }
  }, [client]);

  // One live stream per session, shared by every screen. It resumes from the last event on reconnect.
  useEffect(() => {
    if (!client) return;
    const live = createLiveEvents({ request: (after) => client.eventStream({ after }), open: createXhrStream() });
    liveRef.current = live;
    const offStatus = live.onStatus((status) => {
      setLiveStatus(status);
      if (status === 'unauthorized') setRevoked(true);
    });
    const offEvents = live.subscribe((event) => {
      setLastEventAt(event.at);
      setInbox((state) => applyInboxEvent(state, event));
      for (const listener of [...listeners.current]) listener(event);
    });
    live.start();
    void refresh();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (live.status === 'idle') live.start();
        else live.reconnect();
        void refresh();
      } else if (state === 'background') {
        live.stop();
      }
    });

    return () => {
      appState.remove();
      offStatus();
      offEvents();
      live.stop();
      liveRef.current = undefined;
    };
  }, [client, refresh]);

  const reset = useCallback(() => {
    setSession(undefined);
    setInbox(EMPTY_INBOX);
    setInboxLoading(true);
    setInboxError(undefined);
    setRevoked(false);
    setLiveStatus('idle');
    setLastEventAt(undefined);
    setPhase('unpaired');
  }, []);

  const pair = useCallback(async (input: PairInput) => {
    const paired = await pairDevice(input, { storage: secureStorage, randomBytes: (n) => Crypto.getRandomBytes(n) });
    setRevoked(false);
    setInboxLoading(true);
    setSession(paired);
    setPhase('paired');
    return paired;
  }, []);

  const unpair = useCallback(async () => {
    if (!session) return { revokedOnServer: false };
    const result = await unpairDevice(session, { storage: secureStorage });
    reset();
    return result;
  }, [session, reset]);

  const forget = useCallback(async () => {
    await secureStorage.deleteItem(SESSION_KEY);
    reset();
  }, [reset]);

  const changeServerUrl = useCallback(
    async (serverUrl: string) => {
      if (!session) return;
      const probe = createClient({ baseUrl: serverUrl, token: session.deviceToken });
      await probe.listBots();
      const next: StoredSession = { ...session, serverUrl: probe.baseUrl };
      await saveSession(secureStorage, next);
      setSession(next);
    },
    [session],
  );

  const resolveApproval = useCallback(
    async (approval: Approval, decision: ApprovalDecision, reply?: string) => {
      if (!client) throw new Error('Not paired');
      const resolved = await client.resolveApproval(approval.id, decision, reply);
      setInbox((state) => {
        if (!state.approvals[approval.id]) return state;
        const approvals = { ...state.approvals };
        delete approvals[approval.id];
        return { ...state, approvals };
      });
      return resolved;
    },
    [client],
  );

  const noteThread = useCallback((threadId: string, botId: string) => {
    setInbox((state) => rememberThread(state, threadId, botId));
  }, []);

  const subscribe = useCallback((listener: (event: CanonicalEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<BrotContextValue>(
    () => ({
      phase,
      session,
      client,
      capabilities: session ? capabilitiesFor(session.role) : NO_CAPABILITIES,
      liveStatus,
      lastEventAt,
      inbox,
      inboxLoading,
      inboxError,
      revoked,
      refresh,
      pair,
      unpair,
      forget,
      changeServerUrl,
      resolveApproval,
      noteThread,
      subscribe,
    }),
    [phase, session, client, liveStatus, lastEventAt, inbox, inboxLoading, inboxError, revoked, refresh, pair, unpair, forget, changeServerUrl, resolveApproval, noteThread, subscribe],
  );

  return <BrotContext.Provider value={value}>{children}</BrotContext.Provider>;
}

export function useBrot(): BrotContextValue {
  const value = useContext(BrotContext);
  if (!value) throw new Error('useBrot must be used inside BrotProvider');
  return value;
}

export type PairedContext = BrotContextValue & { session: StoredSession; client: BrotClient };

/** For screens that only make sense once paired. Null for the moment between unpairing and leaving the screen. */
export function usePaired(): PairedContext | null {
  const value = useBrot();
  return value.session && value.client ? (value as PairedContext) : null;
}
