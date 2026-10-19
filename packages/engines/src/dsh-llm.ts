import { createHash } from 'node:crypto';
import type { LlmRoute } from '@brot/protocol';

/**
 * Environment variable that carries a run's relay token into DSH. The overlay names it as the route's
 * `apiKeyEnv`, so DSH resolves the token per request and never needs a provider key.
 */
export const LLM_TOKEN_ENV = 'BROT_LLM_TOKEN';

/**
 * DSH rows that call a provider directly with a key of their own. A run routed through the relay disables
 * them, so no model or web request can reach a provider without going through Brot.
 */
export const DIRECT_PROVIDER_ROWS = [
  'llm-deepseek',
  'llm-deepseek-account',
  'web-search-deepseek',
  'web-deepseek-api',
] as const;

/** The model id the engine's session lists for a route: `provider/model`. */
export function routeModelId(llm: LlmRoute): string {
  return `${llm.provider}/${llm.model}`;
}

/**
 * `--patch` overlay that sends every model request of a run to the relay. The route lists only the run's
 * model, the session's default selection is that route, and the direct provider rows are disabled.
 * Each row is one JSON value, which YAML reads as a flow mapping.
 */
export function llmOverlay(llm: LlmRoute): string {
  const selection = { provider: llm.provider, model: llm.model };
  const rows = [
    {
      id: 'llm-pi-ai',
      config: {
        providers: {
          [llm.provider]: {
            api: llm.api,
            baseURL: llm.baseUrl,
            apiKeyEnv: LLM_TOKEN_ENV,
            models: [{ id: llm.model }],
          },
        },
      },
    },
    { id: 'acp', config: selection },
    { id: 'agent-default-model', config: selection },
    ...DIRECT_PROVIDER_ROWS.map((id) => ({ id, disabled: true })),
  ];
  return rows.map((row) => `- ${JSON.stringify(row)}\n`).join('');
}

/**
 * What a DSH process was started with for a route. The token is hashed: it is passed to the process once,
 * and the key only decides whether an open process can keep serving the next run.
 */
export function llmLaunchKey(llm: LlmRoute): string {
  const token = createHash('sha256').update(llm.token).digest('hex');
  return JSON.stringify([llm.provider, llm.model, llm.api, llm.baseUrl, token]);
}
