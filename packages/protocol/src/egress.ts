import { z } from 'zod';

/** Upper bound on allowlist entries per bot. */
export const MAX_EGRESS_HOSTS = 200;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa'];

/** Returns why a lowercase, trimmed entry is not a valid egress host, or undefined when it is. */
function egressHostProblem(host: string): string | undefined {
  if (host.length > 253) return 'is longer than 253 characters';
  if (/:\/\/|[\s/?#@]/.test(host)) return 'must be a bare hostname: no scheme, path, query or credentials';
  if (host.includes(':')) return 'must not contain ":": no ports and no IPv6 literals';
  if (/^\d+(\.\d+){3}$/.test(host)) return 'is an IP address; use a hostname';

  const wildcard = host.startsWith('*.');
  const name = wildcard ? host.slice(2) : host;
  if (name.includes('*')) return 'may only use a wildcard as the leading "*." label';

  const labels = name.split('.');
  if (labels.length < 2) return 'needs at least two labels, such as example.com';
  if (!labels.every((label) => LABEL.test(label))) return 'labels may only contain a-z, 0-9 and inner hyphens';
  if (!/[a-z]/.test(labels[labels.length - 1] ?? '')) return 'top-level label must contain a letter';
  if (PRIVATE_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) {
    return 'is a local or private name';
  }
  return undefined;
}

/**
 * One egress allowlist entry: a hostname such as `api.example.com`, or `*.example.com`, which matches
 * subdomains only (it does not match `example.com`; list both to allow both). Stored lowercase.
 *
 * This is a syntax check. Hosts are matched by name, so the enforcement layer must also refuse names
 * that resolve to loopback, private or link-local addresses (DNS rebinding).
 */
export const EgressHost = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((host, ctx) => {
    const problem = egressHostProblem(host);
    if (problem) ctx.addIssue({ code: 'custom', message: `${JSON.stringify(host)} ${problem}` });
  });
export type EgressHost = z.infer<typeof EgressHost>;

export const EgressMode = z.enum(['deny', 'allowlist']);
export type EgressMode = z.infer<typeof EgressMode>;

/**
 * Network policy for a bot's computer. `deny` allows no hosts. `allowlist` allows only `allow`.
 * The server always adds the model provider's hosts at runtime; they are never stored here.
 * Ports, paths and schemes are not part of the policy. `allow` must be empty when mode is `deny`.
 */
export const EgressPolicy = z
  .object({
    mode: EgressMode,
    allow: z.array(EgressHost).max(MAX_EGRESS_HOSTS),
  })
  .superRefine((policy, ctx) => {
    if (policy.mode === 'deny' && policy.allow.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['allow'], message: 'must be empty when mode is "deny"' });
    }
    const seen = new Set<string>();
    policy.allow.forEach((host, index) => {
      if (seen.has(host)) {
        ctx.addIssue({ code: 'custom', path: ['allow', index], message: `duplicate host ${host}` });
      }
      seen.add(host);
    });
  });
export type EgressPolicy = z.infer<typeof EgressPolicy>;

/** The policy every new bot gets: no network beyond the model provider. Returns a fresh object each call. */
export function defaultEgressPolicy(): EgressPolicy {
  return { mode: 'deny', allow: [] };
}
