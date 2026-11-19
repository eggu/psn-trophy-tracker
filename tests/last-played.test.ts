import { it, expect, vi } from 'vitest';
import { collectPsnLastPlayed } from '../collector/src/last-played.js';
import { GameTitleSchema } from '../schemas/index.js';

function game() {
  return GameTitleSchema.parse({ id: 'NPWR00001_00', name: 'Unrelated display name', platform: ['PS5'], lastPlayedAt: '2026-01-01T00:00:00Z', progress: { earned: 0, total: 0, percentage: 0 }, trophySummary: Object.fromEntries(['platinum', 'gold', 'silver', 'bronze'].map(g => [g, { earned: 0, total: 0 }])) });
}

it('paginates official play history and joins trophy sets by IDs with the latest edition date', async () => {
  const games = [game()];
  const fetchPage = vi.fn(async (offset: number) => ({ totalItemCount: 2, titles: [{ titleId: offset ? 'PPSA00002_00' : 'PPSA00001_00', lastPlayedDateTime: offset ? '2026-11-17T00:00:00Z' : '2026-11-16T00:00:00Z' }] }));
  const fetchTitles = vi.fn(async (ids: string[]) => ({ titles: ids.map(npTitleId => ({ npTitleId, trophyTitles: [{ npCommunicationId: games[0].id }] })) }));
  await collectPsnLastPlayed(games, fetchPage, fetchTitles);
  expect(fetchPage.mock.calls).toEqual([[0], [1]]);
  expect(fetchTitles).toHaveBeenCalledWith(['PPSA00001_00', 'PPSA00002_00']);
  expect(games[0].lastPlayedAt).toBe('2026-11-17T00:00:00Z');
});

it('preserves known dates when a mapping fails or the source is incomplete', async () => {
  const games = [game()];
  const old = games[0].lastPlayedAt;
  const fetchPage = async () => ({ totalItemCount: 6, titles: Array.from({ length: 6 }, (_, i) => ({ titleId: `PPSA${i}`, lastPlayedDateTime: '2026-11-17T00:00:00Z' })) });
  const fetchTitles = vi.fn().mockResolvedValueOnce({ titles: [{ npTitleId: 'PPSA0', trophyTitles: [{ npCommunicationId: games[0].id }] }] }).mockRejectedValueOnce(new Error('Unavailable'));
  await expect(collectPsnLastPlayed(games, fetchPage, fetchTitles)).rejects.toThrow('Unavailable');
  expect(fetchTitles.mock.calls.map(call => call[0].length)).toEqual([5, 1]);
  expect(games[0].lastPlayedAt).toBe(old);
  await expect(collectPsnLastPlayed(games, async () => ({ totalItemCount: 1, titles: [] }), fetchTitles)).rejects.toThrow('Incomplete');
  expect(games[0].lastPlayedAt).toBe(old);
});
