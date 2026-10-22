import { describe, expect, it } from 'vitest';
import { createHttpClient, downloadName, parseImportCounts, type FetchLike } from './httpClient';

const counts = { teams: 1, bots: 2, rooms: 1, routines: 1, skills: 1 };

interface Call {
  method: string;
  path: string;
  search: string;
  headers: Headers;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const markdown = (filename: string | null, content = '# Brot team package\n\n```json\n{}\n```\n') =>
  new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      ...(filename === null ? {} : { 'Content-Disposition': `attachment; filename="${filename}"` }),
    },
  });

describe('team package export', () => {
  it('downloads a team package and keeps the server filename', async () => {
    const { fetch, calls } = fakeFetch(() => markdown('brot-team-growth.md'));
    const client = createHttpClient({ fetch });

    await expect(client.exportTeamPackage('team_growth')).resolves.toEqual({
      content: '# Brot team package\n\n```json\n{}\n```\n',
      filename: 'brot-team-growth.md',
    });

    expect(calls[0]?.path).toBe('/api/team-packages/export');
    expect(calls[0]?.search).toBe('?teamId=team_growth');
    expect(calls[0]?.headers.get('Accept')).toBe('text/markdown');
  });

  it('exports the whole workspace without a team id', async () => {
    const { fetch, calls } = fakeFetch(() => markdown('brot-workspace.md'));
    const client = createHttpClient({ fetch });

    await expect(client.exportTeamPackage()).resolves.toMatchObject({ filename: 'brot-workspace.md' });
    expect(calls[0]?.search).toBe('');
  });

  it('falls back to brot-team.md when the header is missing', async () => {
    const { fetch } = fakeFetch(() => markdown(null));
    const client = createHttpClient({ fetch });

    await expect(client.exportTeamPackage()).resolves.toMatchObject({ filename: 'brot-team.md' });
  });

  it('prefers the RFC 5987 filename when present', async () => {
    const response = new Response('x', {
      status: 200,
      headers: {
        'Content-Disposition': "attachment; filename=\"brot-team-x.md\"; filename*=UTF-8''brot-team-gr%C3%BCn.md",
      },
    });
    const { fetch } = fakeFetch(() => response);
    const client = createHttpClient({ fetch });

    await expect(client.exportTeamPackage()).resolves.toMatchObject({ filename: 'brot-team-grün.md' });
  });

  it('surfaces the 404 of an unknown team and the 400 of an empty scope', async () => {
    const { fetch } = fakeFetch((call) =>
      call.search.includes('missing') ? json({ error: 'Team not found' }, 404) : json({ error: 'There are no bots to export.' }, 400),
    );
    const client = createHttpClient({ fetch });

    await expect(client.exportTeamPackage('missing')).rejects.toThrow('404 Team not found');
    await expect(client.exportTeamPackage('empty')).rejects.toThrow('400 There are no bots to export.');
  });
});

describe('team package import', () => {
  it('posts the package text and returns the created counts', async () => {
    const { fetch, calls } = fakeFetch(() => json(counts, 201));
    const client = createHttpClient({ fetch });

    await expect(client.importTeamPackage('# Package')).resolves.toEqual(counts);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/team-packages/import', body: { content: '# Package' } });
  });

  it('rejects empty content before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(counts, 201));
    const client = createHttpClient({ fetch });

    await expect(client.importTeamPackage('')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces the parse issues of a refused package', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'Invalid team package', issues: [{ path: [], message: 'the package is empty' }] }, 400),
    );
    const client = createHttpClient({ fetch });

    await expect(client.importTeamPackage('nope')).rejects.toThrow('400 Invalid team package: the package is empty');
  });

  it('rejects a response whose counts are missing', async () => {
    const { fetch } = fakeFetch(() => json({ teams: 1 }, 201));
    const client = createHttpClient({ fetch });

    await expect(client.importTeamPackage('x')).rejects.toThrow('Expected bots to be a count');
  });
});

describe('team package helpers', () => {
  it('parses download names and count bodies', () => {
    expect(downloadName(null)).toBeUndefined();
    expect(downloadName('attachment; filename=brot-team.md')).toBe('brot-team.md');
    expect(downloadName('attachment; filename="a b.md"')).toBe('a b.md');
    expect(parseImportCounts(counts)).toEqual(counts);
    expect(() => parseImportCounts(null)).toThrow('Expected the import counts');
    expect(() => parseImportCounts({ ...counts, rooms: -1 })).toThrow('Expected rooms to be a count');
  });
});
