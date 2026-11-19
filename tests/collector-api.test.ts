import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from './fixtures/veronica-ps4.json' with { type: 'json' };
import * as psn from 'psn-api';
import { runCollector } from '../collector/src/index.js';

vi.mock('psn-api', () => ({
  exchangeNpssoForCode: vi.fn().mockResolvedValue('test-code'),
  exchangeCodeForAccessToken: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
  getProfileFromUserName: vi.fn().mockResolvedValue({ profile: { accountId: 'test-account' } }),
  getUserPlayedGames: vi.fn().mockResolvedValue({ titles: [], totalItemCount: 0 }),
  getUserTrophiesForSpecificTitle: vi.fn(),
  getUserTitles: vi.fn(), getTitleTrophies: vi.fn(), getTitleTrophyGroups: vi.fn().mockResolvedValue({ trophyTitleName: fixture.title.trophyTitleName, trophySetVersion: fixture.definitions.trophySetVersion }), getUserTrophiesEarnedForTitle: vi.fn()
}));
vi.mock('../collector/src/storage.js', async importOriginal => ({
  ...await importOriginal<typeof import('../collector/src/storage.js')>(),
  loadCurrentSnapshot: vi.fn().mockResolvedValue(null)
}));

beforeEach(() => { vi.clearAllMocks(); });
describe('Collector API routing', () => {
  it.each(['PS4', 'PS5'])('passes the correct service to BOTH %s requests', async platform => {
    const service = platform === 'PS5' ? 'trophy2' : 'trophy';
    vi.mocked(psn.getUserTitles).mockResolvedValue({ trophyTitles: [{ ...fixture.title, trophyTitlePlatform: platform, npServiceName: service }], totalItemCount: 1 } as any);
    vi.mocked(psn.getUserPlayedGames).mockResolvedValueOnce({ titles: [{ titleId: 'CUSA00001_00', lastPlayedDateTime: '2026-11-17T00:00:00Z' }], totalItemCount: 1 } as any);
    vi.mocked(psn.getUserTrophiesForSpecificTitle).mockResolvedValue({ titles: [{ npTitleId: 'CUSA00001_00', trophyTitles: [fixture.title] }] } as any);
    vi.mocked(psn.getTitleTrophies).mockResolvedValue(fixture.definitions as any);
    vi.mocked(psn.getUserTrophiesEarnedForTitle).mockResolvedValue(fixture.earned as any);
    const { snapshot } = await runCollector({ npsso: 'test', dryRun: true, full: true });
    expect(psn.getTitleTrophies).toHaveBeenCalledWith(expect.anything(), 'NPWR12310_00', 'all', { npServiceName: service, offset: 0, limit: 1000 });
    expect(psn.getUserTrophiesEarnedForTitle).toHaveBeenCalledWith(expect.anything(), 'test-account', 'NPWR12310_00', 'all', { npServiceName: service, offset: 0, limit: 1000 });
    expect(snapshot.games[0].lastPlayedAt).toBe('2026-11-17T00:00:00Z');
    expect(snapshot.games[0].trophies).toHaveLength(30);
    expect(snapshot.games[0].trophies.filter(t => t.earned)).toHaveLength(9);
  });
});

it('rejects error/malformed title pages instead of publishing an empty account', async () => {
  vi.mocked(psn.getUserTitles).mockResolvedValue({ error: { message: 'Unavailable' } } as any);
  await expect(runCollector({ npsso: 'test', dryRun: true })).rejects.toThrow('Invalid trophy title API response');
  expect(psn.getTitleTrophies).not.toHaveBeenCalled();
});

it('preserves Steam games and their original sync time during PSN-only collection', async () => {
  const { loadCurrentSnapshot } = await import('../collector/src/storage.js');
  const { CanonicalSnapshotSchema, GameTitleSchema } = await import('../schemas/index.js');
  const { readFile } = await import('node:fs/promises');
  const previous = CanonicalSnapshotSchema.parse(JSON.parse(await readFile('data/current.json', 'utf8')));
  previous.games = previous.games.filter(game => !game.platform.includes('Steam'));
  const steamGame = GameTitleSchema.parse({ ...previous.games[0], id: 'steam-10', platform: ['Steam'], trophies: [], progress: { earned: 0, total: 0, percentage: 0 } });
  previous.games.push(steamGame);
  previous.steam = { steamId: '76561198000000000', displayName: 'Test', profileUrl: 'https://steamcommunity.com/id/test/', achievements: { earned: 0, total: 0 }, games: { total: 1, completed: 0 }, lastSuccessfulSync: '2026-01-01T00:00:00.000Z' };
  vi.mocked(loadCurrentSnapshot).mockResolvedValueOnce(previous);
  vi.mocked(psn.getUserTitles).mockResolvedValue({ trophyTitles: [], totalItemCount: 0 } as any);
  const { snapshot } = await runCollector({ npsso: 'test', steamApiKey: '', dryRun: true });
  expect(snapshot.steam).toEqual(previous.steam);
  expect(snapshot.games).toEqual([steamGame]);
  expect(snapshot.profile.games.total).toBe(0);
});
