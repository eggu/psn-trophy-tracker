import { it, expect, vi } from 'vitest';
import fixture from './fixtures/silent-hill-f-ko.json' with { type: 'json' };
import veronica from './fixtures/veronica-ps4.json' with { type: 'json' };
import { collectLocalizedMetadata } from '../collector/src/localization.js';
import { mergeTrophyDefinitionsAndEarned, parseTrophyTitleItem } from '../collector/src/parser.js';
import { CanonicalSnapshotSchema, GameTitleSchema } from '../schemas/index.js';
import fs from 'node:fs/promises';

it('keeps originals and earned states, stores official Korean fields, caches and refreshes by version', async () => {
  const game = GameTitleSchema.parse(fixture.game);
  const original = structuredClone(game);
  const request = vi.fn().mockResolvedValue({ name: fixture.groups.trophyTitleName, version: fixture.ko.trophySetVersion, trophies: fixture.ko.trophies });
  expect(await collectLocalizedMetadata(game, undefined, request)).toBe('available');
  expect(game.name).toBe(original.name);
  expect(game.trophies[0].name).toBe(original.trophies[0].name);
  expect(game.trophies[0].localized?.['ko-KR']?.name).toBe('둥지를 떠나는 새끼 새에게 영광 있으라');
  expect(game.trophies[0].localized?.['ko-KR']?.description).toBe('모든 트로피를 획득했다.');
  expect(game.trophies.map(t => [t.id, t.grade, t.earned, t.earnedAt])).toEqual(original.trophies.map(t => [t.id, t.grade, t.earned, t.earnedAt]));
  expect(GameTitleSchema.parse(game).localized).toEqual(game.localized);
  const updated = structuredClone(original);
  expect(await collectLocalizedMetadata(updated, game, request)).toBe('cached');
  expect(request).toHaveBeenCalledTimes(1);
  expect(updated.trophies[0].localized).toEqual(game.trophies[0].localized);
  updated.trophySetVersion = '02.00';
  request.mockResolvedValue({ name: fixture.groups.trophyTitleName, version: '02.00', trophies: fixture.ko.trophies });
  expect(await collectLocalizedMetadata(updated, game, request)).toBe('available');
  expect(request).toHaveBeenCalledTimes(2);
});

it('negative-caches PSN language fallback, but not request failures', async () => {
  const game = parseTrophyTitleItem(veronica.title);
  game.trophies = mergeTrophyDefinitionsAndEarned(veronica.definitions.trophies, veronica.earned.trophies);
  const request = vi.fn().mockResolvedValue({ name: game.name, version: game.trophySetVersion, trophies: veronica.definitions.trophies });
  expect(await collectLocalizedMetadata(game, undefined, request)).toBe('fallback');
  expect(game.localized?.["ko-KR"]).toBeUndefined();
  expect(await collectLocalizedMetadata(structuredClone(game), game, request)).toBe('cached');
  expect(request).toHaveBeenCalledTimes(1);
  const fresh = structuredClone(game);
  delete fresh.localization;
  request.mockRejectedValue(new Error('network'));
  await expect(collectLocalizedMetadata(fresh, undefined, request)).rejects.toThrow('network');
  expect(fresh.localization).toBeUndefined();
});

it('rejects mismatched locale trophy IDs instead of attaching metadata to wrong trophies', async () => {
  const game = GameTitleSchema.parse(fixture.game);
  await expect(collectLocalizedMetadata(game, undefined, async () => ({ name: game.name, version: game.trophySetVersion!, trophies: [] }))).rejects.toThrow('version/IDs');
  const snapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
  expect(CanonicalSnapshotSchema.safeParse(snapshot).success).toBe(true);
});

it('stores and independently caches both locales without replacing originals or Korean metadata', async () => {
  const game = GameTitleSchema.parse(fixture.game);
  const original = structuredClone(game);
  const ko = vi.fn().mockResolvedValue({ name: fixture.groups.trophyTitleName, version: fixture.ko.trophySetVersion, trophies: fixture.ko.trophies });
  const en = vi.fn().mockResolvedValue({ name: 'SILENT HILL f', version: game.trophySetVersion, trophies: game.trophies.map(t => ({ trophyId: t.id, trophyName: 'English name', trophyDetail: 'English description' })) });
  await collectLocalizedMetadata(game, undefined, ko, 'ko-KR');
  await collectLocalizedMetadata(game, undefined, en, 'en-US');
  expect(game.trophies[0].localized?.['ko-KR']?.name).toBe('둥지를 떠나는 새끼 새에게 영광 있으라');
  expect(game.trophies[0].localized?.['en-US']?.name).toBe('English name');
  expect(game.name).toBe(original.name);
  expect(game.trophies[0].name).toBe(original.trophies[0].name);
  const next = structuredClone(original);
  expect(await collectLocalizedMetadata(next, game, ko, 'ko-KR')).toBe('cached');
  expect(await collectLocalizedMetadata(next, game, en, 'en-US')).toBe('cached');
  expect(ko).toHaveBeenCalledTimes(1);
  expect(en).toHaveBeenCalledTimes(1);
  expect(next.trophies[0].localized).toEqual(game.trophies[0].localized);
  expect(GameTitleSchema.parse({ ...original, localization: { locale: 'ko-KR', trophySetVersion: '01.00', checkedAt: '2026-09-30', status: 'fallback' } }).localization?.['ko-KR']?.status).toBe('fallback');
});

it('preserves a regional fallback returned for en-US and labels its cached response honestly', async () => {
  const game = GameTitleSchema.parse(fixture.game);
  const request = vi.fn().mockResolvedValue({ name: fixture.groups.trophyTitleName, version: fixture.ko.trophySetVersion, trophies: fixture.ko.trophies });
  expect(await collectLocalizedMetadata(game, undefined, request, 'en-US')).toBe('fallback');
  expect(game.trophies[0].localized?.['en-US']?.name).toBe('둥지를 떠나는 새끼 새에게 영광 있으라');
  game.localization!['en-US'].status = 'available'; // migrate earlier cache classification without another PSN request
  const next = GameTitleSchema.parse(fixture.game);
  expect(await collectLocalizedMetadata(next, game, request, 'en-US')).toBe('cached');
  expect(next.localization?.['en-US']?.status).toBe('fallback');
  expect(request).toHaveBeenCalledTimes(1);
});
