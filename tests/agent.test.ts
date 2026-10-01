import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { renderDocuments, renderStatus, kst, text } from '../agent/render.js';
import worker from '../worker/src/index.js';
import type { CanonicalSnapshot } from '../schemas/index.js';

it('renders compact Korean views with remaining first, precise KST dates and meaningful changes', async () => {
  const current: CanonicalSnapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
  const previous = structuredClone(current);
  const code = current.games.find(g => g.id === 'NPWR12310_00')!;
  const docs = renderDocuments(current, previous);
  expect(docs.changes).toContain('No trophy changes since previous sync.');
  expect(docs.games.split('\n').filter(line => line.startsWith('| '))).toHaveLength(170);
  expect(docs.games).not.toContain('iconUrl');
  expect(docs.recent.split('\n').filter(line => line.startsWith('| '))).toHaveLength(52);
  const detail = docs[`game/${code.id}`];
  const earned = code.trophies.filter(trophy => trophy.earned);
  const remaining = code.trophies.filter(trophy => !trophy.earned);
  const lastEarned = earned.reduce<string | null>((latest, trophy) => trophy.earnedAt && (!latest || Date.parse(trophy.earnedAt) > Date.parse(latest)) ? trophy.earnedAt : latest, null);
  expect(detail.indexOf('Remaining Trophies')).toBeLessThan(detail.indexOf('Earned Trophies'));
  expect(detail.match(/- \[ \]/g)).toHaveLength(remaining.length);
  expect(detail.match(/- \[x\]/g)).toHaveLength(earned.length);
  expect(detail).toContain(`Progress: ${code.progress.earned}/${code.progress.total} (${code.progress.percentage}%)`);
  expect(detail).toContain(`Last trophy: ${kst(lastEarned)}`);
  const ko = current.games.find(g => g.localized?.['ko-KR'])!;
  expect(docs[`game/${ko.id}`]).toContain(ko.localized!['ko-KR']!.name);
  expect(kst('2026-09-29T15:09:01Z')).toBe('2026-09-30 00:09:01 KST');
  expect(text('[click](https://bad) |\n# heading')).toBe('\\[click\\]\\(https://bad\\) \\| \\# heading');
  expect(renderDocuments(current, null).changes).toContain('Initial snapshot');
  const oldTrophy = previous.games.find(g => g.id === code.id)!.trophies.find(t => t.earned)!;
  oldTrophy.earned = false;
  previous.games.find(g => g.id === code.id)!.progress.earned--;
  previous.profile.trophies.total--;
  expect(renderDocuments(current, previous).changes).toContain('## New Trophies');
  expect(renderDocuments(current, previous).changes).toContain('Total +1');
  const meta = { account: current.profile.onlineId, ...current.metadata };
  const now = Date.parse(meta.lastSuccessfulSync);
  expect(renderStatus(meta, now)).toContain('Status: Fresh');
  expect(renderStatus(meta, now + 12 * 3600_000)).toContain('Status: Stale');
  expect(renderStatus({ ...meta, outcome: 'failed', lastAttemptedSync: new Date(now + 1000).toISOString() }, now)).toContain('Status: Stale');
});

it('serves only small derived assets for Agent requests and never the canonical snapshot', async () => {
  const paths: string[] = [];
  const env = { ASSETS: { fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    paths.push(path);
    try { return new Response(await fs.readFile(`dashboard/dist${path}`, 'utf8'), { headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'text/markdown' } }); }
    catch { return new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }); }
  } } };
  for (const path of ['/agent', '/agent/status', '/agent/profile', '/agent/changes', '/agent/recent', '/agent/games', '/agent/game/NPWR12310_00']) {
    const response = await worker.fetch(new Request(`https://example.com${path}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toMatch(/^# /);
  }
  expect(paths).toHaveLength(7);
  expect(paths.every(path => path.startsWith('/agent/'))).toBe(true);
  expect(paths.some(path => path.includes('current.json'))).toBe(false);
  for (const path of ['/agent/unknown', '/agent/game/not-an-id', '/agent/game/NPWR999999_00']) expect((await worker.fetch(new Request(`https://example.com${path}`), env)).status).toBe(404);
  expect((await worker.fetch(new Request('https://example.com/agent', { method: 'OPTIONS' }), env)).status).toBe(204);
  expect((await worker.fetch(new Request('https://example.com/agent', { method: 'POST' }), env)).status).toBe(405);
  const head = await worker.fetch(new Request('https://example.com/agent/games', { method: 'HEAD' }), env);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
});

it('publishes a safe failed-attempt marker while preserving canonical data', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { runCollector } = await import('../collector/src/index.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'psn-failure-'));
  const { vi } = await import('vitest');
  vi.stubEnv('PSN_NPSSO', '');
  try {
    await fs.writeFile(path.join(dir, 'current.json'), 'preserved');
    await expect(runCollector({ dataDir: dir })).rejects.toThrow('Missing PSN_NPSSO');
    expect(await fs.readFile(path.join(dir, 'current.json'), 'utf8')).toBe('preserved');
    const status = JSON.parse(await fs.readFile(path.join(dir, 'sync-status.json'), 'utf8'));
    expect(status.outcome).toBe('failed');
    expect(Object.keys(status).sort()).toEqual(['lastAttemptedSync', 'outcome']);
  } finally { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); }
});

it('forwards small Markdown from Pages for the standalone Worker without fetching protected .md asset routes', async () => {
  const { vi } = await import('vitest');
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    urls.push(request.url);
    return new Response('# Sync Status\n\nStatus: Fresh\n', { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
  });
  try {
    const response = await worker.fetch(new Request('https://worker.example/agent/status'), { DATA_BASE_URL: 'https://pages.example' });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Status: Fresh');
    expect(urls).toEqual(['https://pages.example/agent/status']);
    expect((await worker.fetch(new Request('https://worker.example/agent'), {})).status).toBe(503);
    expect((await worker.fetch(new Request('https://worker.example/agent'), { DATA_BASE_URL: 'https://worker.example' })).status).toBe(503);
  } finally { vi.unstubAllGlobals(); }
});

it('writes the requested repository Markdown layout with working relative links', async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const current: CanonicalSnapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
  const game = current.games.find(g => g.id === 'NPWR12310_00')!;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'psn-agent-files-'));
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-agent.mjs', dir]);
    const expected = ['README.md', 'STATUS.md', 'PROFILE.md', 'CHANGES.md', 'RECENT.md', 'GAMES.md', 'games/NPWR12310_00.md'];
    for (const file of expected) expect(await fs.readFile(path.join(dir, file), 'utf8')).toMatch(/^# /);
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('[Changes](CHANGES.md)');
    expect(readme).toContain('games/{id}.md');
    expect(readme).not.toContain('](/agent/');
    expect(await fs.readdir(path.join(dir, 'games'))).toHaveLength(168);
    const code = await fs.readFile(path.join(dir, 'games/NPWR12310_00.md'), 'utf8');
    expect(code.match(/- \[ \]/g)).toHaveLength(game.trophies.filter(trophy => !trophy.earned).length);
    expect(code.match(/- \[x\]/g)).toHaveLength(game.trophies.filter(trophy => trophy.earned).length);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
