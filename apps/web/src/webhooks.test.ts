import { describe, expect, it } from 'vitest';
import { parseWebhookInfo, stripPort, webhookHostname, webhookUrl } from './webhooks';

describe('webhookUrl', () => {
  it('builds the URL with the host, port and URL-encoded secret', () => {
    expect(webhookUrl('example.com', 8992, 'abc123')).toBe('http://example.com:8992/h/abc123');
    expect(webhookUrl('127.0.0.1', 8992, 'a b/c?d')).toBe('http://127.0.0.1:8992/h/a%20b%2Fc%3Fd');
  });

  it('strips an existing port from the hostname', () => {
    expect(webhookUrl('example.com:5291', 8992, 's')).toBe('http://example.com:8992/h/s');
    expect(webhookUrl('[::1]:5291', 8992, 's')).toBe('http://[::1]:8992/h/s');
  });

  it('falls back to 127.0.0.1 for an empty hostname', () => {
    expect(webhookUrl('  ', 8992, 's')).toBe('http://127.0.0.1:8992/h/s');
  });

  it('uses a clear placeholder when the port is unknown', () => {
    expect(webhookUrl('example.com', undefined, 's')).toBe('http://example.com:<port>/h/s');
  });
});

describe('stripPort', () => {
  it('keeps hostnames without ports and strips bare ports', () => {
    expect(stripPort('example.com')).toBe('example.com');
    expect(stripPort('example.com:5291')).toBe('example.com');
    expect(stripPort('[::1]:5291')).toBe('[::1]');
    expect(stripPort('[::1]')).toBe('[::1]');
    expect(stripPort('  mac.local  ')).toBe('mac.local');
  });
});

describe('webhookHostname', () => {
  it('reads the current window hostname without its web port', () => {
    expect(webhookHostname({ location: { hostname: 'brot.example.com:5291' } })).toBe('brot.example.com');
    expect(webhookHostname({ location: { hostname: 'localhost' } })).toBe('localhost');
  });

  it('falls back to 127.0.0.1 in SSR and tests', () => {
    expect(webhookHostname({})).toBe('127.0.0.1');
    expect(webhookHostname(undefined)).toBe('127.0.0.1');
    expect(webhookHostname({ location: { hostname: '' } })).toBe('127.0.0.1');
  });
});

describe('parseWebhookInfo', () => {
  it('keeps a valid port and tolerates malformed payloads', () => {
    expect(parseWebhookInfo({ port: 8992 })).toEqual({ port: 8992 });
    expect(parseWebhookInfo({})).toEqual({});
    expect(parseWebhookInfo(null)).toEqual({});
    expect(parseWebhookInfo({ port: 0 })).toEqual({});
    expect(parseWebhookInfo({ port: 70_000 })).toEqual({});
    expect(parseWebhookInfo({ port: '8992' })).toEqual({});
  });
});
