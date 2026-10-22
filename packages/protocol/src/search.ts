import { z } from 'zod';
import { IsoDateTime, MessageRole } from './entities';

/** Longest accepted search text. */
export const SEARCH_QUERY_MAX_LENGTH = 200;
/** Hits returned when the query names no limit. */
export const SEARCH_LIMIT_DEFAULT = 20;
/** Most hits one search returns. */
export const SEARCH_LIMIT_MAX = 50;

/**
 * The query behind `GET /api/search`. `q` is required and may not be blank; `before` keeps only messages older
 * than that instant. `limit` arrives as a string from the query string and is coerced to a number.
 */
export const SearchQuery = z.object({
  q: z
    .string()
    .min(1)
    .max(SEARCH_QUERY_MAX_LENGTH)
    .refine((value) => value.trim() !== '', 'q must not be blank'),
  botId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
  before: IsoDateTime.optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

/**
 * One message that matched. `snippet` is the message text trimmed around the match, with whitespace collapsed;
 * it is plain text, never HTML-escaped. `botId`/`botName` are the conversation's bot: a DM's bot or a room's
 * lead bot, falling back to the message author when the thread's bot is unknown.
 */
export const SearchHit = z.object({
  messageId: z.string(),
  threadId: z.string(),
  threadTitle: z.string(),
  botId: z.string().optional(),
  botName: z.string().min(1).optional(),
  role: MessageRole,
  snippet: z.string(),
  createdAt: IsoDateTime,
});
export type SearchHit = z.infer<typeof SearchHit>;
