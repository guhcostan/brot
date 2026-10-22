import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, parsePairingCode } from './payload';

const qr = (body: object) => JSON.stringify(body);

describe('parsePairingCode', () => {
  it('reads the server QR payload', () => {
    const result = parsePairingCode(qr({ v: 1, host: '192.168.1.20', port: 8799, token: 'abc' }));
    expect(result).toEqual({ ok: true, value: { token: 'abc', port: 8799, serverUrl: 'http://192.168.1.20:8799' } });
  });

  it('asks for an address when the QR names a loopback or wildcard host', () => {
    for (const host of ['127.0.0.1', 'localhost', '0.0.0.0', '::1']) {
      const result = parsePairingCode(qr({ v: 1, host, port: 8799, token: 'abc' }));
      expect(result.ok && result.value.serverUrl).toBe(undefined);
    }
  });

  it('brackets IPv6 hosts', () => {
    const result = parsePairingCode(qr({ v: 1, host: 'fd00::5', port: 8799, token: 't' }));
    expect(result.ok && result.value.serverUrl).toBe('http://[fd00::5]:8799');
  });

  it('ignores unknown extra fields', () => {
    const result = parsePairingCode(qr({ v: 1, host: 'mac.local', port: 1, token: 't', relayUrl: 'wss://r' }));
    expect(result.ok).toBe(true);
  });

  it('rejects other QR codes and newer versions with a clear message', () => {
    expect(parsePairingCode('https://example.com')).toEqual({ ok: false, error: 'That is not a Brot pairing code.' });
    expect(parsePairingCode('{bad json')).toMatchObject({ ok: false });
    expect(parsePairingCode(qr({ v: 1, host: 'h', port: 99999, token: 't' }))).toMatchObject({ ok: false });
    const newer = parsePairingCode(qr({ v: 2, host: 'h', port: 1, token: 't' }));
    expect(newer.ok === false && newer.error).toMatch(/newer Brot/);
  });

  it('accepts a pasted raw token', () => {
    const result = parsePairingCode('  Zm9vYmFyYmF6cXV4LXRva2Vu ');
    expect(result).toEqual({ ok: true, value: { token: 'Zm9vYmFyYmF6cXV4LXRva2Vu', port: 8799, serverUrl: undefined } });
  });
});

describe('normalizeServerUrl', () => {
  it('adds http and the default port to a bare host', () => {
    expect(normalizeServerUrl('192.168.1.20')).toEqual({ ok: true, value: 'http://192.168.1.20:8799' });
    expect(normalizeServerUrl('mac.local', 9000)).toEqual({ ok: true, value: 'http://mac.local:9000' });
  });

  it('keeps an explicit port and scheme, dropping trailing slashes', () => {
    expect(normalizeServerUrl('mac.local:8800/')).toEqual({ ok: true, value: 'http://mac.local:8800' });
    expect(normalizeServerUrl('https://brot.example.com/')).toEqual({ ok: true, value: 'https://brot.example.com' });
    expect(normalizeServerUrl('https://brot.example.com/team/')).toEqual({ ok: true, value: 'https://brot.example.com/team' });
  });

  it('rejects empty, non-http and credentialed addresses', () => {
    expect(normalizeServerUrl(' ').ok).toBe(false);
    expect(normalizeServerUrl('ftp://host').ok).toBe(false);
    expect(normalizeServerUrl('http://u:p@host').ok).toBe(false);
    expect(normalizeServerUrl('http://').ok).toBe(false);
  });
});

describe('pairing text typed on iOS', () => {
  it('accepts curly quotes from smart punctuation', () => {
    const typed = '{\u201Cv\u201D:1,\u201Chost\u201D:\u201C127.0.0.1\u201D,\u201Cport\u201D:8799,\u201Ctoken\u201D:\u201Cabcdefghijklmnopqrstuvwxyz0123456789ABCDEFG\u201D}';
    expect(parsePairingCode(typed).ok).toBe(true);
  });
});
