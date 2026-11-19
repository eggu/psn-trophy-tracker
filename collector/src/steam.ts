import { z } from 'zod';
import { GameTitleSchema, SteamProfileSchema, type GameTitle } from '../../schemas/index.js';

const appSchema = z.object({ appid: z.number().int().positive(), name: z.string(), rtime_last_played: z.number().int().nonnegative().optional() });
const definitionSchema = z.object({
  name: z.string().min(1), displayName: z.string(), description: z.string().optional().default(''),
  hidden: z.number().int().min(0).max(1), icon: z.string().url().optional(), icongray: z.string().url().optional()
});
const earnedSchema = z.object({ apiname: z.string(), achieved: z.number().int().min(0).max(1), unlocktime: z.number().int().nonnegative() });

export async function collectSteam(options: { apiKey: string; profile: string; fetcher?: typeof fetch }) {
  const fetcher = options.fetcher ?? fetch;
  async function request(endpoint: string, params: Record<string, string> = {}) {
    const url = new URL(`https://api.steampowered.com/${endpoint}/`);
    url.search = new URLSearchParams({ key: options.apiKey, ...params }).toString();
    let response: Response;
    try { response = await fetcher(url, { signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error(`Steam ${endpoint}: network request failed`); }
    if (!response.ok) throw new Error(`Steam ${endpoint}: HTTP ${response.status}`);
    try { return await response.json(); }
    catch { throw new Error(`Steam ${endpoint}: invalid JSON`); }
  }
  let steamId = options.profile;
  if (!/^\d{17}$/.test(steamId)) {
    let vanity = steamId;
    if (steamId.startsWith('https://')) {
      const url = new URL(steamId);
      const match = url.pathname.match(/^\/(id|profiles)\/([A-Za-z0-9_-]+)\/?$/);
      if (url.hostname !== 'steamcommunity.com' || !match) throw new Error('Invalid Steam profile URL');
      vanity = match[2];
      if (match[1] === 'profiles') steamId = vanity;
    }
    if (!/^\d{17}$/.test(steamId)) {
      if (!/^[A-Za-z0-9_-]+$/.test(vanity)) throw new Error('Invalid Steam vanity name');
      const resolved = z.object({ response: z.object({ success: z.literal(1), steamid: z.string().regex(/^\d{17}$/) }) })
        .parse(await request('ISteamUser/ResolveVanityURL/v1', { vanityurl: vanity }));
      steamId = resolved.response.steamid;
    }
  }
  const player = z.object({ response: z.object({ players: z.array(z.object({ steamid: z.string(), personaname: z.string(), communityvisibilitystate: z.number() })) }) })
    .parse(await request('ISteamUser/GetPlayerSummaries/v2', { steamids: steamId })).response.players.find(p => p.steamid === steamId);
  if (!player || player.communityvisibilitystate !== 3) throw new Error('Steam profile must be public');
  const owned = z.object({ response: z.object({ game_count: z.number().int().nonnegative(), games: z.array(appSchema).optional() }) })
    .parse(await request('IPlayerService/GetOwnedGames/v1', { steamid: steamId, include_appinfo: 'true', include_played_free_games: 'true' })).response;
  const apps = owned.games ?? [];
  if (apps.length !== owned.game_count || new Set(apps.map(a => a.appid)).size !== apps.length) throw new Error('Steam game list is incomplete or private');
  const games: GameTitle[] = [];
  for (const [index, app] of apps.entries()) {
    console.log(`[Steam] [${index + 1}/${apps.length}] ${app.appid}`);
    const schema = z.object({ game: z.object({ availableGameStats: z.object({ achievements: z.array(definitionSchema).optional() }).optional() }) })
      .parse(await request('ISteamUserStats/GetSchemaForGame/v2', { appid: String(app.appid), l: 'english' }));
    const definitions = schema.game.availableGameStats?.achievements ?? [];
    if (!definitions.length) continue;
    const states = z.object({ playerstats: z.object({ success: z.literal(true), steamID: z.string(), achievements: z.array(earnedSchema) }) })
      .parse(await request('ISteamUserStats/GetPlayerAchievements/v1', { appid: String(app.appid), steamid: steamId, l: 'english' })).playerstats;
    if (states.steamID !== steamId) throw new Error(`Steam account mismatch: ${app.appid}`);
    const earned = new Map(states.achievements.map(t => [t.apiname, t]));
    if (earned.size !== states.achievements.length || new Set(definitions.map(t => t.name)).size !== definitions.length ||
        definitions.length !== earned.size || definitions.some(t => !earned.has(t.name))) throw new Error(`Steam achievement definitions/states mismatch: ${app.appid}`);
    let korean: z.infer<typeof definitionSchema>[] = [];
    try {
      korean = z.object({ game: z.object({ availableGameStats: z.object({ achievements: z.array(definitionSchema) }) }) })
        .parse(await request('ISteamUserStats/GetSchemaForGame/v2', { appid: String(app.appid), l: 'koreana' })).game.availableGameStats.achievements;
    } catch { console.warn(`[Steam] Korean metadata unavailable: ${app.appid}`); }
    const trophies = definitions.map(t => {
      const state = earned.get(t.name)!;
      const ko = korean.find(k => k.name === t.name);
      return { id: t.name, name: t.displayName, description: t.description, grade: 'achievement', hidden: t.hidden === 1,
        earned: state.achieved === 1, earnedAt: state.achieved === 1 && state.unlocktime > 0 ? new Date(state.unlocktime * 1000).toISOString() : null,
        iconUrl: (state.achieved ? t.icon : t.icongray) ?? t.icon,
        localized: { 'en-US': { name: t.displayName, description: t.description },
          ...(ko && /[가-힣]/.test(ko.displayName + ko.description) ? { 'ko-KR': { name: ko.displayName, description: ko.description } } : {}) }
      };
    });
    const count = trophies.filter(t => t.earned).length;
    const lastTrophyAt = trophies.flatMap(t => t.earnedAt ? [t.earnedAt] : []).sort().at(-1) ?? null;
    games.push(GameTitleSchema.parse({
      lastPlayedAt: app.rtime_last_played ? new Date(app.rtime_last_played * 1000).toISOString() : null,
      id: `steam-${app.appid}`, name: app.name, platform: ['Steam'], imageUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${app.appid}/header.jpg`,
      progress: { earned: count, total: trophies.length, percentage: Math.round(count / trophies.length * 100) }, lastTrophyAt,
      trophySummary: Object.fromEntries(['platinum', 'gold', 'silver', 'bronze'].map(g => [g, { earned: 0, total: 0 }])), trophies
    }));
    // Keep requests sequential to avoid a library-sized burst against Steam.
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const profile = SteamProfileSchema.parse({ steamId, displayName: player.personaname, profileUrl: `https://steamcommunity.com/profiles/${steamId}/`,
    achievements: { earned: games.reduce((n, g) => n + g.progress.earned, 0), total: games.reduce((n, g) => n + g.progress.total, 0) },
    games: { total: games.length, completed: games.filter(g => g.progress.earned === g.progress.total).length }, lastSuccessfulSync: new Date().toISOString() });
  return { profile, games };
}
