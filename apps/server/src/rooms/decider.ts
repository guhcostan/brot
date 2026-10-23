import type { Repos } from '@brot/db';
import { RoomDeciderSettings } from '@brot/protocol';
import { parseModelRef, type FetchLike, type ProviderRegistry } from '../llm';
import type { Vault } from '../vault';

/** The settings key the decider's model lives under, next to the other server settings. */
export const ROOM_DECIDER_SETTINGS_KEY = 'room-decider';

/** The decider gets one model answer, never a conversation; 10 s is plenty for a 64-token reply. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_ANSWER_TOKENS = 64;

export interface RoomDeciderMember {
  id: string;
  name: string;
  job: string;
}

export interface RoomDeciderInput {
  /** The room's active members, the only bots the decider may pick. */
  members: readonly RoomDeciderMember[];
  /** The user's message, capped before it reaches the model. */
  message: string;
}

/** Picks the room member that should answer a message, or undefined when it cannot decide. */
export interface RoomDecider {
  choose(input: RoomDeciderInput): Promise<string | undefined>;
}

export interface RoomDeciderOptions {
  repos: Pick<Repos, 'settings'>;
  providers: ProviderRegistry;
  vault: Pick<Vault, 'resolveRef'>;
  /** Outbound HTTP. Tests inject a fake upstream; production uses global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** The stored decider settings, or `{}` when none are saved. */
export async function readRoomDeciderSettings(repos: Pick<Repos, 'settings'>): Promise<RoomDeciderSettings> {
  return (await repos.settings.get(ROOM_DECIDER_SETTINGS_KEY, RoomDeciderSettings)) ?? {};
}

/**
 * Saves the decider model, stamping `updatedAt`, or clears the setting with `null`. The returned settings are
 * what GET /api/room-decider sends back.
 */
export async function writeRoomDeciderSettings(
  repos: Pick<Repos, 'settings'>,
  model: string | null,
): Promise<RoomDeciderSettings> {
  if (model === null) {
    await repos.settings.remove(ROOM_DECIDER_SETTINGS_KEY);
    return {};
  }
  const settings = { model, updatedAt: new Date().toISOString() };
  await repos.settings.set(ROOM_DECIDER_SETTINGS_KEY, settings);
  return settings;
}

/**
 * The room decider: asks one configured model which member should answer. It is an optional routing aid, so
 * every failure — no setting, unknown provider, missing vault key, timeout, bad answer — resolves to undefined
 * and the room falls back to the lead. Failures are logged by reason only: never the key or the message body.
 */
export function createRoomDecider(options: RoomDeciderOptions): RoomDecider {
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function fail(reason: string): undefined {
    console.error(`room decider: ${reason}`);
    return undefined;
  }

  return {
    async choose({ members, message }) {
      if (members.length === 0) return undefined;
      const settings = await readRoomDeciderSettings(options.repos);
      if (settings.model === undefined) return undefined;

      let ref: ReturnType<typeof parseModelRef>;
      try {
        ref = parseModelRef(settings.model);
      } catch {
        return fail(`ignoring unreadable model "${settings.model}"`);
      }
      const provider = options.providers.get(ref.provider);
      if (provider === undefined) return fail(`unknown provider "${ref.provider}"`);
      if (provider.api !== 'openai-completions') {
        return fail(`provider "${provider.id}" does not speak openai-completions`);
      }
      const key = await options.vault.resolveRef(`secret://${provider.secretName}`);
      if (key === undefined) return fail(`provider "${provider.id}" has no vault key`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: ref.model,
            messages: [
              { role: 'system', content: deciderPrompt(members) },
              { role: 'user', content: message.slice(0, MAX_MESSAGE_CHARS) },
            ],
            temperature: 0,
            max_tokens: MAX_ANSWER_TOKENS,
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) return fail(`provider "${provider.id}" answered ${response.status}`);
        const body: unknown = await response.json().catch(() => undefined);
        const answer = answerText(body);
        if (answer === undefined) return fail(`provider "${provider.id}" sent no answer`);
        return matchMember(answer, members);
      } catch (error) {
        const reason =
          error instanceof Error && error.name === 'AbortError'
            ? `provider "${provider.id}" timed out after ${timeoutMs} ms`
            : `provider "${provider.id}" request failed`;
        return fail(reason);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The list is one `id — name — job` line per member, so a small model can copy the id it picks. */
function deciderPrompt(members: readonly RoomDeciderMember[]): string {
  const lines = members.map((member) => `${member.id} — ${member.name} — ${member.job}`);
  return [
    'You route messages in a group chat. Pick the ONE bot that should answer the user message.',
    'Bot list, one bot per line, as "id — name — job":',
    ...lines,
    'Answer with only the bot id of your pick, nothing else.',
  ].join('\n');
}

/** The text of the first choice's message, when the provider returned the chat-completions shape. */
function answerText(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) return undefined;
  const choice: unknown = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
  return typeof choice.message.content === 'string' ? choice.message.content : undefined;
}

/** Accepts the member's id, `@id`, or its name (case-insensitive) on the answer's first non-empty line. */
function matchMember(answer: string, members: readonly RoomDeciderMember[]): string | undefined {
  const line = answer.split('\n').find((part) => part.trim() !== '');
  if (line === undefined) return undefined;
  const cleaned = cleanAnswer(line);
  const variants = new Set([cleaned.toLowerCase(), cleaned.replace(/^@/, '').toLowerCase()]);
  for (const member of members) {
    if (variants.has(member.id.toLowerCase()) || variants.has(member.name.trim().toLowerCase())) return member.id;
  }
  return undefined;
}

/** Strips quotes, backticks and punctuation from the edges, keeping letters, numbers and inner punctuation. */
function cleanAnswer(line: string): string {
  return line.replace(/^[^\p{L}\p{N}@]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
