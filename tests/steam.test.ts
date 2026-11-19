import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectSteam } from '../collector/src/steam.js';
import { CanonicalSnapshotSchema } from '../schemas/index.js';
import { validateAndSaveSnapshot, loadCurrentSnapshot } from '../collector/src/storage.js';
import { computeSnapshotDiff } from '../collector/src/diff.js';
import { handleApiRequest } from '../worker/src/router.js';
import { renderDocuments, dataStatus } from '../agent/render.js';
import worker from '../worker/src/index.js';

const steamId = '76561198000000000';
function fixtureFetch(change: (endpoint: string, data: any) => any = (_, data) => data) {
  return vi.fn(async (input: any) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split('/')[2];
    const korean = url.searchParams.get('l') === 'koreana';
    const fixtures: Record<string, any> = {
      ResolveVanityURL: { response: { success: 1, steamid: steamId } },
      GetPlayerSummaries: { response: { players: [{ steamid: steamId, personaname: 'Test', communityvisibilitystate: 3 }] } },
      GetOwnedGames: { response: { game_count: 2, games: [{ appid: 10, name: 'Test game', rtime_last_played: 1800000000 }, { appid: 20, name: 'No achievements' }] } },
      GetSchemaForGame: { game: url.searchParams.get('appid') === '20' ? {} : { availableGameStats: { achievements: [
        { name: 'FIRST', displayName: korean ? '첫 도전' : 'First', description: korean ? '설명' : 'Description', hidden: 0 },
        { name: 'SECRET', displayName: 'Secret', hidden: 1 }
      ] } } },
      GetPlayerAchievements: { playerstats: { success: true, steamID: steamId, achievements: [
        { apiname: 'FIRST', achieved: 1, unlocktime: 1700000000 }, { apiname: 'SECRET', achieved: 0, unlocktime: 0 }
      ] } }
    };
    return Response.json(change(endpoint, fixtures[endpoint]));
  }) as typeof fetch;
}

it('collects Steam definitions and earned states without inventing PSN grades or unlock times', async () => {
  const fetcher = fixtureFetch();
  const result = await collectSteam({ apiKey: 'test-secret', profile: 'https://steamcommunity.com/id/test/', fetcher });
  expect(result.profile.achievements).toEqual({ earned: 1, total: 2 });
  expect(result.games).toHaveLength(1);
  const game = result.games[0];
  expect(game.id).toBe('steam-10');
  expect(game.platform).toEqual(['Steam']);
  expect(game.lastPlayedAt).toBe('2027-01-15T08:00:00.000Z');
  expect(game.progress).toEqual({ earned: 1, total: 2, percentage: 50 });
  expect(game.platinumEarned).toBe(false);
  expect(game.trophies[0]).toMatchObject({ id: 'FIRST', grade: 'achievement', earned: true, earnedAt: '2023-11-14T22:13:20.000Z', localized: { 'ko-KR': { name: '첫 도전' } } });
  expect(game.trophies[1]).toMatchObject({ hidden: true, earned: false, earnedAt: null });
  expect(game.trophies[1].localized?.['ko-KR']).toBeUndefined();
  expect(vi.mocked(fetcher).mock.calls.every(([url]) => new URL(String(url)).origin === 'https://api.steampowered.com')).toBe(true);
});

it.each(['private', 'incomplete', 'failed', 'mismatch', 'duplicate'])('rejects %s source data before saving', async kind => {
  const fetcher = fixtureFetch((endpoint, data) => {
    if (endpoint === 'GetOwnedGames' && kind === 'private') return { response: {} };
    if (endpoint === 'GetOwnedGames' && kind === 'incomplete') data.response.game_count++;
    if (endpoint === 'GetPlayerAchievements' && kind === 'failed') return { playerstats: { success: false } };
    if (endpoint === 'GetPlayerAchievements' && kind === 'mismatch') data.playerstats.achievements.pop();
    if (endpoint === 'GetPlayerAchievements' && kind === 'duplicate') data.playerstats.achievements[1].apiname = 'FIRST';
    return data;
  });
  await expect(collectSteam({ apiKey: 'secret', profile: steamId, fetcher })).rejects.toThrow();
});

it('redacts network errors containing the API key and keeps English on Korean failure', async () => {
  await expect(collectSteam({ apiKey: 'secret', profile: steamId, fetcher: async () => { throw new Error('https://example.com/?key=secret'); } })).rejects.toThrow('network request failed');
  const fetcher = fixtureFetch((endpoint, data) => endpoint === 'GetSchemaForGame' && data.game.availableGameStats?.achievements[0].displayName === '첫 도전' ? {} : data);
  const result = await collectSteam({ apiKey: 'secret', profile: steamId, fetcher });
  expect(result.games[0].trophies[0].name).toBe('First');
});

it('round-trips mixed snapshots through storage, diff, JSON API and Agent routes', async () => {
  const previous = CanonicalSnapshotSchema.parse(JSON.parse(await fs.readFile('data/current.json', 'utf8')));
  previous.steam = undefined;
  previous.games = previous.games.filter(game => !game.platform.includes('Steam'));
  const steam = await collectSteam({ apiKey: 'secret', profile: steamId, fetcher: fixtureFetch() });
  const current = { ...previous, steam: steam.profile, games: [...previous.games.filter(g => !g.platform.includes('Steam')), ...steam.games] };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-tracker-'));
  try {
    await validateAndSaveSnapshot(dir, current);
    expect((await loadCurrentSnapshot(dir))?.steam).toEqual(steam.profile);
    const diff = computeSnapshotDiff(previous, current);
    expect(diff.newTrophies.filter(t => t.gameId === "steam-10")).toHaveLength(0);
    expect(diff.summaryDelta.achievements).toBe(1);
    expect(diff.summaryDelta.total).toBe(1);
    expect(diff.summaryDelta.bronze).toBe(0);
    const list = await handleApiRequest({ snapshot: current, requestUrl: 'https://example.com/api/v1/games?platform=Steam' });
    expect(JSON.parse(list.body).games.map((g: any) => g.id)).toEqual(['steam-10']);
    const profile = await handleApiRequest({ snapshot: current, requestUrl: 'https://example.com/api/v1/profile' });
    expect(JSON.parse(profile.body).trophies).toEqual(previous.profile.trophies);
    expect(JSON.parse(profile.body).steam.achievements.earned).toBe(1);
    const docs = renderDocuments(current, previous);
    expect(docs['game/steam-10']).toContain('Platinum: N/A');
    expect(docs['game/steam-10']).toContain('| Achievement | 1 | 2 |');
    expect(docs.profile).toContain('## Steam');
    expect(docs.changes).toContain('Achievements +1');
    const response = await worker.fetch(new Request('https://example.com/agent/game/steam-10'), { ASSETS: { fetch: async () => new Response(docs['game/steam-10'], { headers: { 'content-type': 'text/markdown' } }) } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('첫 도전');
    current.games.at(-1)!.trophies = [];
    await expect(validateAndSaveSnapshot(dir, current)).rejects.toThrow('Missing trophy details');
    expect((await loadCurrentSnapshot(dir))?.games.at(-1)?.trophies).toHaveLength(2);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

it('keeps stale Steam data visible as stale even after a fresh PSN sync', () => {
  const now = Date.now();
  expect(dataStatus({ account: 'test', generatedAt: new Date(now).toISOString(), schemaVersion: 2, lastSuccessfulSync: new Date(now).toISOString(), sources: { psn: new Date(now).toISOString(), steam: new Date(now - 86400_000).toISOString() } }, now)).toBe('Stale');
});


it('does not substitute achievement unlock time for an unavailable play time', async () => {
  const fetcher = fixtureFetch((endpoint, data) => {
    if (endpoint === 'GetOwnedGames') data.response.games[0].rtime_last_played = 0;
    return data;
  });
  const result = await collectSteam({ apiKey: 'secret', profile: steamId, fetcher });
  expect(result.games[0].lastPlayedAt).toBeNull();
  expect(result.games[0].trophies[0].earnedAt).toBeTruthy();
});


it.each([400, 429, 503])('retries transient HTTP %s without dropping achievements', async status => {
  vi.useFakeTimers();
  try {
    const base = fixtureFetch();
    let attempts = 0;
    const fetcher = (async (input, init) => {
      if (String(input).includes('GetPlayerAchievements') && attempts++ === 0) return Response.json({}, { status });
      return base(input, init);
    }) as typeof fetch;
    const pending = collectSteam({ apiKey: 'secret', profile: steamId, fetcher });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.profile.achievements.earned).toBe(1);
    expect(attempts).toBe(2);
  } finally { vi.useRealTimers(); }
});

it('stops after three HTTP failures and retains safe error context', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async () => Response.json({}, { status: 400 })) as typeof fetch;
    const pending = expect(collectSteam({ apiKey: 'secret', profile: steamId, fetcher })).rejects.toThrow('Steam ISteamUser/GetPlayerSummaries/v2: HTTP 400');
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});
