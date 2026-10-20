import { createContext, useContext } from 'react';
import type { BrotClient } from '../data/client';

const ClientContext = createContext<BrotClient | null>(null);

export const ClientProvider = ClientContext.Provider;

/** The data client, for components that talk to the server directly (the live screen, settings). */
export function useClient(): BrotClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient needs a ClientProvider');
  return client;
}
