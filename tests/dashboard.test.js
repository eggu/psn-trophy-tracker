import { it, expect } from 'vitest';
import { displayName, isComplete, lastEarnedTime, sortGames } from '../dashboard/games.js';

const makeGame = (id, name, values = {}) => ({ id, name, platform: ['Steam'], progress: { earned: 1, total: 10, percentage: 10 }, trophies: [], ...values });

it('sorts by actual play and earned dates independently, keeping unknown dates last', () => {
  const games = [
    makeGame('unknown', 'Unknown'),
    makeGame('played', 'Played', { lastPlayedAt: '2026-11-17T00:00:00Z', lastTrophyAt: '2026-12-01T00:00:00Z' }),
    makeGame('earned', 'Earned', { lastPlayedAt: '2026-10-01T00:00:00Z', trophies: [{ earned: true, earnedAt: '2026-11-16T00:00:00Z' }] })
  ];
  expect(sortGames(games, 'played').map(g => g.id)).toEqual(['played', 'earned', 'unknown']);
  expect(sortGames(games, 'recent').map(g => g.id)).toEqual(['earned', 'played', 'unknown']);
  expect(lastEarnedTime(games[1])).toBe(0);
  expect(games.map(g => g.id)).toEqual(['unknown', 'played', 'earned']);
});

it('sorts displayed Korean names and numbers and breaks ties consistently', () => {
  const games = [makeGame('z', 'Game 10'), makeGame('a', 'Game 2'), makeGame('k', 'ZZZ', { localized: { 'ko-KR': { name: '가나다' } } })];
  expect(displayName(games[2])).toBe('가나다');
  const names = sortGames(games, 'name');
  expect(names.indexOf(games[1])).toBeLessThan(names.indexOf(games[0]));
  expect(sortGames(games, 'name_desc')).toEqual([...names].reverse());
  expect(sortGames([makeGame('2', 'Same'), makeGame('1', 'Same')], 'name').map(g => g.id)).toEqual(['1', '2']);
});

it('keeps platinum separate from 100% completion and recommends unfinished games', () => {
  const complete = makeGame('done', 'Done', { progress: { earned: 10, total: 10, percentage: 100 } });
  const near = makeGame('near', 'Near', { platinumEarned: true, progress: { earned: 9, total: 10, percentage: 90 } });
  const started = makeGame('started', 'Started', { progress: { earned: 20, total: 30, percentage: 67 } });
  const unstarted = makeGame('new', 'New', { progress: { earned: 0, total: 1, percentage: 0 } });
  expect(isComplete(complete)).toBe(true);
  expect(isComplete(near)).toBe(false);
  expect(isComplete(makeGame('empty', 'Empty', { progress: { earned: 0, total: 0, percentage: 0 } }))).toBe(false);
  const games = [complete, near, started, unstarted];
  expect(sortGames(games, 'remaining').slice(0, 2)).toEqual([near, started]);
  expect(sortGames(games, 'progress')[0]).toBe(complete);
  expect(sortGames(games, 'earned')[0]).toBe(started);
});
