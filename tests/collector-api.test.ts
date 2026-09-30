import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from './fixtures/veronica-ps4.json' with { type: 'json' };
import * as psn from 'psn-api';
import { runCollector } from '../collector/src/index.js';

vi.mock('psn-api', () => ({
  exchangeNpssoForCode: vi.fn().mockResolvedValue('test-code'),
  exchangeCodeForAccessToken: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
  getProfileFromUserName: vi.fn().mockResolvedValue({ profile: { accountId: 'test-account' } }),
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
    vi.mocked(psn.getTitleTrophies).mockResolvedValue(fixture.definitions as any);
    vi.mocked(psn.getUserTrophiesEarnedForTitle).mockResolvedValue(fixture.earned as any);
    const { snapshot } = await runCollector({ npsso: 'test', dryRun: true, full: true });
    expect(psn.getTitleTrophies).toHaveBeenCalledWith(expect.anything(), 'NPWR12310_00', 'all', { npServiceName: service, offset: 0, limit: 1000 });
    expect(psn.getUserTrophiesEarnedForTitle).toHaveBeenCalledWith(expect.anything(), 'test-account', 'NPWR12310_00', 'all', { npServiceName: service, offset: 0, limit: 1000 });
    expect(snapshot.games[0].trophies).toHaveLength(30);
    expect(snapshot.games[0].trophies.filter(t => t.earned)).toHaveLength(9);
  });
});

it('rejects error/malformed title pages instead of publishing an empty account', async () => {
  vi.mocked(psn.getUserTitles).mockResolvedValue({ error: { message: 'Unavailable' } } as any);
  await expect(runCollector({ npsso: 'test', dryRun: true })).rejects.toThrow('Invalid trophy title API response');
  expect(psn.getTitleTrophies).not.toHaveBeenCalled();
});
