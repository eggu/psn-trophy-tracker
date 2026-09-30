import { it, expect, vi } from 'vitest';
import fixture from './fixtures/silent-hill-f-ko.json' with { type: 'json' };
import veronica from './fixtures/veronica-ps4.json' with { type: 'json' };
import { collectKoreanMetadata } from '../collector/src/localization.js';
import { mergeTrophyDefinitionsAndEarned, parseTrophyTitleItem } from '../collector/src/parser.js';
import { CanonicalSnapshotSchema, GameTitleSchema } from '../schemas/index.js';
import fs from 'node:fs/promises';

it('keeps originals and earned states, stores official Korean fields, caches and refreshes by version', async () => {
  const game = GameTitleSchema.parse(fixture.game);
  const original = structuredClone(game);
  const request = vi.fn().mockResolvedValue({ name: fixture.groups.trophyTitleName, version: fixture.ko.trophySetVersion, trophies: fixture.ko.trophies });
  expect(await collectKoreanMetadata(game, undefined, request)).toBe('available');
  expect(game.name).toBe(original.name);
  expect(game.trophies[0].name).toBe(original.trophies[0].name);
  expect(game.trophies[0].localized?.['ko-KR']?.name).toBe('둥지를 떠나는 새끼 새에게 영광 있으라');
  expect(game.trophies[0].localized?.['ko-KR']?.description).toBe('모든 트로피를 획득했다.');
  expect(game.trophies.map(t => [t.id, t.grade, t.earned, t.earnedAt])).toEqual(original.trophies.map(t => [t.id, t.grade, t.earned, t.earnedAt]));
  expect(GameTitleSchema.parse(game).localized).toEqual(game.localized);
  const updated = structuredClone(original);
  expect(await collectKoreanMetadata(updated, game, request)).toBe('cached');
  expect(request).toHaveBeenCalledTimes(1);
  expect(updated.trophies[0].localized).toEqual(game.trophies[0].localized);
  updated.trophySetVersion = '02.00';
  request.mockResolvedValue({ name: fixture.groups.trophyTitleName, version: '02.00', trophies: fixture.ko.trophies });
  expect(await collectKoreanMetadata(updated, game, request)).toBe('available');
  expect(request).toHaveBeenCalledTimes(2);
});

it('negative-caches PSN language fallback, but not request failures', async () => {
  const game = parseTrophyTitleItem(veronica.title);
  game.trophies = mergeTrophyDefinitionsAndEarned(veronica.definitions.trophies, veronica.earned.trophies);
  const request = vi.fn().mockResolvedValue({ name: game.name, version: game.trophySetVersion, trophies: veronica.definitions.trophies });
  expect(await collectKoreanMetadata(game, undefined, request)).toBe('fallback');
  expect(game.localized).toBeUndefined();
  expect(await collectKoreanMetadata(structuredClone(game), game, request)).toBe('cached');
  expect(request).toHaveBeenCalledTimes(1);
  const fresh = structuredClone(game);
  delete fresh.localization;
  request.mockRejectedValue(new Error('network'));
  await expect(collectKoreanMetadata(fresh, undefined, request)).rejects.toThrow('network');
  expect(fresh.localization).toBeUndefined();
});

it('rejects mismatched locale trophy IDs instead of attaching metadata to wrong trophies', async () => {
  const game = GameTitleSchema.parse(fixture.game);
  await expect(collectKoreanMetadata(game, undefined, async () => ({ name: game.name, version: game.trophySetVersion!, trophies: [] }))).rejects.toThrow('version/IDs');
  const snapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
  expect(CanonicalSnapshotSchema.safeParse(snapshot).success).toBe(true);
});
