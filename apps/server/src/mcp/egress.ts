import { BlockList, isIP } from 'node:net';

/**
 * Whether a hostname is covered by an egress allowlist. Entries are lowercase hostnames, or `*.` wildcards
 * that match subdomains only (`*.example.com` does not match `example.com`).
 */
export function hostAllowed(hostname: string, allow: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allow.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}

/**
 * Addresses a bot's tool must never reach after name resolution: loopback, private, link-local (which
 * includes cloud metadata at 169.254.169.254), shared, multicast and reserved ranges. IPv4 reached through
 * IPv6 translation or mapping is refused too. Anything that is not an IP address is refused.
 *
 * Each family has its own list. A BlockList rule for an IPv6 range also matches IPv4 addresses checked
 * in their mapped form, so mixing the families would refuse public IPv4 addresses.
 */
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();

const BLOCKED_IPV4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_IPV6: ReadonlyArray<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['2002::', 16],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

for (const [network, prefix] of BLOCKED_IPV4) BLOCKED_V4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of BLOCKED_IPV6) BLOCKED_V6.addSubnet(network, prefix, 'ipv6');

export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED_V4.check(address, 'ipv4');
  if (family === 6) return BLOCKED_V6.check(address, 'ipv6');
  return true;
}
