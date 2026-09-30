import fs from 'node:fs/promises';
import { exchangeNpssoForCode, exchangeCodeForAccessToken, getTitleTrophies, getTitleTrophyGroups } from 'psn-api';
import { getNpServiceName } from '../src/parser.js';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = new URL(String(args[0]));
  if (url.pathname.startsWith('/api/trophy/')) console.log(JSON.stringify({ path: url.pathname, status: response.status, contentLanguage: response.headers.get('content-language') }));
  return response;
};
async function main() {
  const authorization = await exchangeCodeForAccessToken(await exchangeNpssoForCode(process.env.PSN_NPSSO!));
  const snapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
  await fs.mkdir('diagnostics', { recursive: true });
  for (const game of snapshot.games.filter((g: any) => g.id === 'NPWR12310_00' || g.name === 'SILENT HILL f' || g.name === 'Clair Obscur: Expedition 33')) {
    const npServiceName = getNpServiceName({ trophyTitlePlatform: game.platform.join(',') });
    const ko = await getTitleTrophies(authorization, game.id, 'all', { npServiceName, headerOverrides: { 'Accept-Language': 'ko-KR' }, limit: 1000 });
    const en = await getTitleTrophies(authorization, game.id, 'all', { npServiceName, headerOverrides: { 'Accept-Language': 'en-US' }, limit: 1000 });
    const groups = await getTitleTrophyGroups(authorization, game.id, { npServiceName, headerOverrides: { 'Accept-Language': 'ko-KR' } });
    console.log(JSON.stringify({ id: game.id, originalName: game.name, koName: groups.trophyTitleName, koCount: ko.trophies?.length, examples: ko.trophies?.slice(0, 2) }));
    await fs.writeFile(`diagnostics/locale-${game.id}.json`, JSON.stringify({ game, ko, en, groups }, null, 2));
  }
}
main().catch(() => { console.error('Localization probe failed'); process.exitCode = 1; });
