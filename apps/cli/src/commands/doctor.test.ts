import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineDriver } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { BrotClient } from '../client';
import { runDoctor, type Check } from './doctor';
import { capture, fakeFetch, json, unreachable } from '../testing';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-doctor-'));
  dirs.push(dir);
  return dir;
}

function driver(id: string, availability: Awaited<ReturnType<EngineDriver['detect']>> | 'throw'): EngineDriver {
  return {
    id,
    label: id,
    async detect() {
      if (availability === 'throw') throw new Error('probe exploded');
      return availability;
    },
    async models() {
      return [];
    },
    async *run() {
      yield* [];
    },
  };
}

const healthy = () => fakeFetch({ 'GET /api/health': () => json({ ok: true, version: '0.1.0', protocol: 1 }) }).fetch;

function checksOf(text: string): Check[] {
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Check);
}

describe('runDoctor', () => {
  it('passes with a current Node, a writable home, and a running server', async () => {
    const io = capture();
    const code = await runDoctor({
      home: await tempDir(),
      nodeVersion: '24.15.0',
      engines: [driver('mock', { available: true }), driver('claude', { available: true, version: '2.1.303' })],
      client: new BrotClient('http://127.0.0.1:8799', healthy()),
      stdout: io,
      json: true,
    });

    expect(code).toBe(0);
    const checks = checksOf(io.text());
    expect(checks.map((check) => [check.check, check.status])).toEqual([
      ['node', 'ok'],
      ['brot_home', 'ok'],
      ['engine mock', 'ok'],
      ['engine claude', 'ok'],
      ['server', 'ok'],
    ]);
    expect(checks.find((check) => check.check === 'engine claude')?.detail).toBe('2.1.303');
    expect(checks.find((check) => check.check === 'server')?.detail).toContain('runs Brot 0.1.0 (protocol 1)');
  });

  it('fails when Node is older than 24, and says why', async () => {
    const io = capture();
    const code = await runDoctor({
      home: await tempDir(),
      nodeVersion: '22.12.0',
      engines: [],
      client: new BrotClient('http://127.0.0.1:8799', unreachable),
      stdout: io,
      json: false,
    });

    expect(code).toBe(1);
    expect(io.text()).toMatch(/^fail node: v22\.12\.0; Brot needs Node 24 or newer\n/);
  });

  it('fails when the home path is a file', async () => {
    const dir = await tempDir();
    const file = join(dir, 'brot-home');
    await writeFile(file, '');
    const io = capture();

    const code = await runDoctor({
      home: file,
      nodeVersion: '24.15.0',
      engines: [],
      client: new BrotClient('http://127.0.0.1:8799', unreachable),
      stdout: io,
      json: true,
    });

    expect(code).toBe(1);
    expect(checksOf(io.text()).find((check) => check.check === 'brot_home')).toMatchObject({
      status: 'fail',
      required: true,
    });
  });

  it('accepts a home that does not exist yet when its parent is writable, and creates nothing', async () => {
    const dir = await tempDir();
    const home = join(dir, 'not', 'yet');
    const io = capture();

    const code = await runDoctor({
      home,
      nodeVersion: '24.15.0',
      engines: [],
      client: new BrotClient('http://127.0.0.1:8799', unreachable),
      stdout: io,
      json: true,
    });

    expect(code).toBe(0);
    expect(checksOf(io.text()).find((check) => check.check === 'brot_home')?.detail).toContain('will be created');
    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('warns, without failing, for unavailable engines, failed probes, and a stopped server', async () => {
    const io = capture();
    const code = await runDoctor({
      home: await tempDir(),
      nodeVersion: '24.15.0',
      engines: [
        driver('codex', { available: false, reason: 'codex is not installed' }),
        driver('acp', 'throw'),
      ],
      client: new BrotClient('http://127.0.0.1:8799', unreachable),
      stdout: io,
      json: true,
    });

    expect(code).toBe(0);
    const checks = checksOf(io.text());
    expect(checks.find((check) => check.check === 'engine codex')).toMatchObject({
      status: 'warn',
      required: false,
      detail: 'codex is not installed',
    });
    expect(checks.find((check) => check.check === 'engine acp')?.detail).toBe('detection failed (probe exploded)');
    expect(checks.find((check) => check.check === 'server')).toMatchObject({ status: 'warn', required: false });
  });

  it('prints aligned text lines in text mode', async () => {
    const io = capture();
    await runDoctor({
      home: await tempDir(),
      nodeVersion: '24.15.0',
      engines: [],
      client: new BrotClient('http://127.0.0.1:8799', healthy()),
      stdout: io,
      json: false,
    });

    expect(io.text().split('\n')[0]).toBe('ok   node: v24.15.0');
  });
});
