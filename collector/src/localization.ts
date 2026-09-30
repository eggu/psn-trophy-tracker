import type { GameTitle } from '../../schemas/index.js';

interface KoreanMetadata {
  name: string;
  version: string;
  trophies: Array<{ trophyId: number | string; trophyName?: string; trophyDetail?: string }>;
}

export async function collectKoreanMetadata(game: GameTitle, previous: GameTitle | undefined, request: () => Promise<KoreanMetadata>): Promise<'cached' | 'available' | 'fallback'> {
  const cached = previous?.localization;
  const previousTrophies = new Map(previous?.trophies.map(t => [String(t.id), t]));
  if (cached && cached.trophySetVersion === game.trophySetVersion && game.trophies.every(t => previousTrophies.has(String(t.id)))) {
    game.localization = cached;
    game.localized = previous?.localized;
    game.trophies = game.trophies.map(t => ({ ...t, localized: previousTrophies.get(String(t.id))?.localized }));
    return 'cached';
  }
  const metadata = await request();
  const definitions = new Map(metadata.trophies.map(t => [String(t.trophyId), t]));
  if (metadata.version !== game.trophySetVersion || definitions.size !== game.trophies.length || game.trophies.some(t => !definitions.has(String(t.id)))) throw new Error('Korean metadata version/IDs do not match original set');
  // ponytail: PSN exposes no supported-locale flag or Content-Language; require observable Korean text. Use an explicit PSN locale signal if one becomes available.
  const available = /[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(metadata.name + metadata.trophies.map(t => `${t.trophyName ?? ''} ${t.trophyDetail ?? ''}`).join(' '));
  if (available) {
    game.localized = { 'ko-KR': { name: metadata.name } };
    game.trophies = game.trophies.map(t => {
      const definition = definitions.get(String(t.id))!;
      return { ...t, localized: { 'ko-KR': { name: definition.trophyName ?? t.name, description: definition.trophyDetail ?? t.description } } };
    });
  } else {
    delete game.localized;
    game.trophies = game.trophies.map(({ localized, ...t }) => t);
  }
  game.localization = { locale: 'ko-KR', trophySetVersion: metadata.version, checkedAt: new Date().toISOString(), status: available ? 'available' : 'fallback' };
  return game.localization.status;
}
