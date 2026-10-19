import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { SecretName } from '../vault';

/** Wire protocols the relay speaks. Each has its own path allowlist and its own usage shape. */
export const PROVIDER_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;
export type ProviderApi = (typeof PROVIDER_APIS)[number];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const ProviderId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'Use lowercase letters, digits, dot, dash or underscore');

const ModelCost = z
  .object({
    /** USD per million input tokens. */
    input: z.number().finite().nonnegative(),
    /** USD per million output tokens. */
    output: z.number().finite().nonnegative(),
  })
  .strict();

const ProviderModelSchema = z
  .object({
    id: z.string().min(1).max(200),
    cost: ModelCost.optional(),
  })
  .strict();

/**
 * A provider must use https, or http on loopback (local models). Credentials, query strings and fragments are
 * refused, so no key can be written into the file.
 */
const BaseUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
    return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
  }, 'baseUrl must be https (or loopback http) with no credentials, query or fragment')
  .transform((value) => value.replace(/\/+$/, ''));

/** One provider. Only the name of its secret is stored, never the key. Unknown fields are rejected. */
export const ProviderSpecSchema = z
  .object({
    id: ProviderId,
    api: z.enum(PROVIDER_APIS),
    baseUrl: BaseUrl,
    secretName: SecretName,
    models: z.array(ProviderModelSchema).optional(),
    /** Header carrying a stable per-conversation id, for providers that route or cache by session. */
    sessionHeader: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/, 'Use a lowercase header name')
      .optional(),
  })
  .strict();

export type ProviderSpec = z.infer<typeof ProviderSpecSchema>;
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProvidersFileSchema = z.object({ providers: z.array(ProviderSpecSchema) }).strict();

/**
 * Providers every server knows. Costs are USD per million tokens from the `@earendil-works/pi-ai` 1.3.0 catalog
 * (`providers/data/opencode-go.json` and `deepseek.json`). Cache discounts are not applied, so the estimate is
 * high. A model without a cost reports tokens only.
 */
export const SEEDED_PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'opencode-go',
    api: 'openai-completions',
    baseUrl: 'https://opencode.ai/inference/go/v1',
    secretName: 'opencode-go',
    models: [{ id: 'deepseek-v4.1-flash', cost: { input: 0.15, output: 0.6 } }],
    // OpenCode Go rejects requests without it (https://opencode.ai/docs/go/, checked 2026-10-19).
    sessionHeader: 'x-opencode-session',
  },
  {
    id: 'deepseek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    secretName: 'deepseek',
    models: [
      { id: 'deepseek-flash', cost: { input: 0.3, output: 1.2 } },
      { id: 'deepseek-v4-pro', cost: { input: 1.32, output: 3.96 } },
    ],
  },
];

export interface ModelRef {
  provider: string;
  model: string;
}

/** Splits a bot's model string `<provider>/<model>` at the first slash. Model ids may contain further slashes. */
export function parseModelRef(ref: string): ModelRef {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`Model "${ref}" must be <provider>/<model>, for example opencode-go/deepseek-v4.1-flash.`);
  }
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

/** Later layers replace earlier ones with the same id. Order follows first appearance. */
export function mergeProviders(...layers: ReadonlyArray<readonly ProviderSpec[]>): ProviderSpec[] {
  const byId = new Map<string, ProviderSpec>();
  for (const layer of layers) {
    for (const spec of layer) byId.set(spec.id, spec);
  }
  return [...byId.values()];
}

export interface ProviderRegistry {
  get(id: string): ProviderSpec | undefined;
  list(): ProviderSpec[];
}

export function createProviderRegistry(specs: readonly ProviderSpec[]): ProviderRegistry {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
  };
}

/**
 * Reads `providers.json` when it exists. A missing file means no extra providers. An invalid file fails the
 * server's start with the path and the offending field, so a typo never silently drops a provider.
 */
export async function loadProviderFile(path: string): Promise<ProviderSpec[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const parsed = ProvidersFileSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`${path} is invalid: ${problems.join('; ')}`);
  }
  return parsed.data.providers;
}
