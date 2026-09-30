import fs from 'node:fs/promises';
import { exchangeNpssoForCode, exchangeCodeForAccessToken, getProfileFromUserName, getUserTitles, getTitleTrophies, getUserTrophiesEarnedForTitle } from 'psn-api';
import { parseTrophyTitleItem, mergeTrophyDefinitionsAndEarned } from '../src/parser.js';

// Log only trophy API paths/statuses. Never headers, tokens or auth responses.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = new URL(String(args[0]));
  if (url.pathname.startsWith('/api/trophy/')) {
    console.log(JSON.stringify({ stage: 'http', path: url.pathname, service: url.searchParams.get('npServiceName'), status: response.status }));
  }
  return response;
};
async function main() {
const authorization = await exchangeCodeForAccessToken(await exchangeNpssoForCode(process.env.PSN_NPSSO!));
const profile = await getProfileFromUserName(authorization, 'eggu_');
const accountId = profile.profile.accountId;
const titles: any[] = [];
for (let offset = 0; ; offset += 100) {
  const page = await getUserTitles(authorization, accountId, { offset, limit: 100 });
  titles.push(...page.trophyTitles);
  if (offset + 100 >= page.totalItemCount) break;
}
const title = titles.find(t => t.npCommunicationId === 'NPWR12310_00');
if (!title) throw new Error('Diagnostic title missing');
console.log(JSON.stringify({ stage: 'discovery', titleId: title.npCommunicationId, platform: title.trophyTitlePlatform, version: title.trophySetVersion, npServiceName: title.npServiceName }));
await fs.mkdir('diagnostics', { recursive: true });
for (const npServiceName of [undefined, 'trophy'] as const) {
  const results: any = { title, service: npServiceName ?? 'omitted' };
  for (const [stage, call] of [
    ['definitions', () => getTitleTrophies(authorization, title.npCommunicationId, 'all', { npServiceName })],
    ['earned', () => getUserTrophiesEarnedForTitle(authorization, accountId, title.npCommunicationId, 'all', { npServiceName })]
  ] as const) {
    try {
      const result: any = await call();
      results[stage] = result;
      console.log(JSON.stringify({ stage, titleId: title.npCommunicationId, npServiceName: npServiceName ?? 'omitted', count: result.trophies?.length ?? 0, version: result.trophySetVersion, apiError: result.error ?? null, exception: null }));
    } catch {
      console.log(JSON.stringify({ stage, titleId: title.npCommunicationId, npServiceName: npServiceName ?? 'omitted', count: 0, exception: 'API request rejected' }));
    }
  }
  const game = parseTrophyTitleItem(title);
  game.trophies = mergeTrophyDefinitionsAndEarned(results.definitions?.trophies ?? [], results.earned?.trophies ?? []);
  console.log(JSON.stringify({ stage: 'merge', service: results.service, count: game.trophies.length, earned: game.trophies.filter(t => t.earned).length }));
  console.log(JSON.stringify({ stage: 'canonical', service: results.service, id: game.id, platform: game.platform, version: game.trophySetVersion, progress: game.progress, count: game.trophies.length }));
  await fs.writeFile(`diagnostics/veronica-${results.service}.json`, JSON.stringify(results, null, 2));
}

}
main().catch(() => { console.error("Diagnosis failed; authentication or API unavailable"); process.exitCode = 1; });
