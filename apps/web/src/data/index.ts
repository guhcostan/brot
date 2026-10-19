/// <reference types="vite/client" />
import type { BrotClient } from './client';
import { createHttpClient } from './httpClient';
import { createMockClient } from './mockClient';

export type { BotEvent, BrotClient } from './client';

/** The in-process mock when VITE_BROT_MOCK=1 (no server needed), otherwise the client for the running server. */
export function createClient(): BrotClient {
  return import.meta.env.VITE_BROT_MOCK === '1' ? createMockClient() : createHttpClient();
}
