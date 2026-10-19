import type { CanonicalEvent } from '@brot/protocol';
import type { Repos } from '@brot/db';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the bus stamps its id and timestamp. */
export type NewEvent = DistributiveOmit<CanonicalEvent, 'id' | 'at'>;

export type EventListener = (event: CanonicalEvent) => void;

export interface EventBus {
  /** Appends the event to the log, then notifies matching subscribers in order. */
  publish(event: NewEvent): Promise<CanonicalEvent>;
  subscribe(listener: EventListener, options?: { threadId?: string }): () => void;
}

export function createEventBus(events: Repos['events']): EventBus {
  const subscribers = new Set<{ listener: EventListener; threadId: string | undefined }>();

  return {
    async publish(input) {
      const event = {
        ...input,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
      } as CanonicalEvent;
      const stored = await events.append(event);
      for (const subscriber of [...subscribers]) {
        if (subscriber.threadId !== undefined && subscriber.threadId !== stored.threadId) continue;
        try {
          subscriber.listener(stored);
        } catch (error) {
          console.error('event subscriber failed', error);
        }
      }
      return stored;
    },

    subscribe(listener, options = {}) {
      const subscriber = { listener, threadId: options.threadId };
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}
