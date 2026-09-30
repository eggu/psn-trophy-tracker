import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import worker from '../worker/src/index.js';
import { selectHistoryEntry } from '../worker/src/history.js';

it('selects the closest prior snapshot, not the oldest or current snapshot', () => {
  const entries = [1, 2, 3, 4].map(day => ({ timestamp: `2026-09-0${day}T00:00:00Z`, path: `${day}` }));
  expect(selectHistoryEntry(entries, entries[3].timestamp, null)?.path).toBe('3');
  expect(selectHistoryEntry(entries, entries[3].timestamp, '2026-09-02T12:00:00Z')?.path).toBe('2');
  expect(selectHistoryEntry(entries, entries[3].timestamp, '2020-01-01T00:00:00Z')?.path).toBe('1');
  expect(() => selectHistoryEntry(entries, entries[3].timestamp, 'invalid')).toThrow();
});

it('serves current data and loads only the index + one history snapshot for changes', async () => {
  const paths: string[] = [];
  const env = { ASSETS: { fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    paths.push(path);
    try { return new Response(await fs.readFile(`dashboard/dist${path}`, 'utf8'), { headers: { 'content-type': 'application/json' } }); }
    catch { return new Response('missing', { status: 404 }); }
  } } };
  const response = await worker.fetch(new Request('https://example.com/api/v1/games/NPWR12310_00/trophies'), env);
  expect(response.status).toBe(200);
  expect((await response.json() as any).total).toBe(30);
  expect(paths).toEqual(['/data/current.json']);
  paths.length = 0;
  const changes = await worker.fetch(new Request('https://example.com/api/v1/changes'), env);
  expect(changes.status).toBe(200);
  expect((await changes.json() as any).from).toBeTruthy();
  expect(paths).toHaveLength(3);
  expect(paths[1]).toBe('/data/history/index.json');
  expect((await worker.fetch(new Request('https://example.com/api/v1/changes?since=invalid'), env)).status).toBe(400);
  expect((await worker.fetch(new Request('https://example.com/api/v1/profile', { method: 'POST' }), env)).status).toBe(405);
  expect((await worker.fetch(new Request('https://example.com/api/v1/profile'), { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } })).status).toBe(503);
});

it('does not report restored historical details as newly earned trophies', async () => {
  const { computeSnapshotDiff } = await import('../collector/src/diff.js');
  const current = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
  const previous = structuredClone(current);
  previous.metadata.lastSuccessfulSync = '2026-09-30T03:59:20.473Z';
  previous.games.find((g: any) => g.id === 'NPWR12310_00').trophies = [];
  expect(computeSnapshotDiff(previous, current).newTrophies).toHaveLength(0);
});
