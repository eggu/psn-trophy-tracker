import type { GameTitle } from '../../schemas/index.js';

interface LocalizedMetadata {
  name: string;
  version: string;
  trophies: Array<{ trophyId: number | string; trophyName?: string; trophyDetail?: string }>;
}

export async function collectLocalizedMetadata(game: GameTitle, previous: GameTitle | undefined, request: () => Promise<LocalizedMetadata>, locale: 'ko-KR' | 'en-US' = 'ko-KR'): Promise<'cached' | 'available' | 'fallback'> {
  const cached = previous?.localization?.[locale];
  const previousTrophies = new Map(previous?.trophies.map(t => [String(t.id), t]));
  if (cached && cached.trophySetVersion === game.trophySetVersion && previousTrophies.size === game.trophies.length && game.trophies.every(t => previousTrophies.has(String(t.id)))) {
    game.localization = { ...game.localization, [locale]: { ...cached } };
    if (locale === 'en-US' && /[가-힣ㄱ-ㅎㅏ-ㅣぁ-ゟァ-ヿ㐀-鿿]/u.test(JSON.stringify([previous?.localized?.[locale], ...previous!.trophies.map(t => t.localized?.[locale])]))) game.localization[locale].status = 'fallback';
    game.localized = { ...game.localized, [locale]: previous?.localized?.[locale] };
    game.trophies = game.trophies.map(t => ({ ...t, localized: { ...t.localized, [locale]: previousTrophies.get(String(t.id))?.localized?.[locale] } }));
    return 'cached';
  }
  const metadata = await request();
  const definitions = new Map(metadata.trophies.map(t => [String(t.trophyId), t]));
  if (metadata.version !== game.trophySetVersion || definitions.size !== game.trophies.length || game.trophies.some(t => !definitions.has(String(t.id)))) throw new Error('Localized metadata version/IDs do not match original set');
  // ponytail: PSN exposes no supported-locale flag or Content-Language; require observable Korean text. Use an explicit PSN locale signal if one becomes available.
  const text = metadata.name + metadata.trophies.map(t => `${t.trophyName ?? ''} ${t.trophyDetail ?? ''}`).join(' ');
  // ponytail: observable regional script marks en-US fallback; replace with PSN supported-locale metadata if exposed.
  const available = locale === 'en-US' ? !/[가-힣ㄱ-ㅎㅏ-ㅣぁ-ゟァ-ヿ㐀-鿿]/u.test(text) : /[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(text);
  if (available || locale === 'en-US') {
    game.localized = { ...game.localized, [locale]: { name: metadata.name } };
    game.trophies = game.trophies.map(t => {
      const definition = definitions.get(String(t.id))!;
      return { ...t, localized: { ...t.localized, [locale]: { name: definition.trophyName ?? t.name, description: definition.trophyDetail ?? t.description } } };
    });
  } else {
    if (game.localized) delete game.localized[locale];
    game.trophies = game.trophies.map(t => { const localized = { ...t.localized }; delete localized[locale]; return { ...t, localized }; });
  }
  game.localization = { ...game.localization, [locale]: { trophySetVersion: metadata.version, checkedAt: new Date().toISOString(), status: available ? 'available' : 'fallback' } };
  return available ? 'available' : 'fallback';
}
