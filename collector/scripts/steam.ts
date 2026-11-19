import path from 'node:path';
import { collectSteam } from '../src/steam.js';
import { loadCurrentSnapshot, validateAndSaveSnapshot, writeSyncStatus } from '../src/storage.js';

const dataDir = path.resolve('data');
const lastAttemptedSync = new Date().toISOString();
try {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) throw new Error('Missing STEAM_API_KEY');
  const snapshot = await loadCurrentSnapshot(dataDir);
  if (!snapshot) throw new Error('Collect a PSN snapshot first');
  const steam = await collectSteam({ apiKey, profile: process.env.STEAM_PROFILE ?? 'https://steamcommunity.com/id/eggu/' });
  snapshot.games = [...snapshot.games.filter(game => !game.platform.includes('Steam')), ...steam.games];
  snapshot.steam = steam.profile;
  snapshot.metadata.schemaVersion = 2;
  snapshot.metadata.source = "playstation-network+steam";
  snapshot.metadata.generatedAt = snapshot.metadata.lastSuccessfulSync = steam.profile.lastSuccessfulSync;
  await validateAndSaveSnapshot(dataDir, snapshot);
  await writeSyncStatus(dataDir, { lastAttemptedSync, outcome: 'success' });
  console.log(`[Steam] Saved ${steam.games.length} games, ${steam.profile.achievements.earned}/${steam.profile.achievements.total} achievements`);
} catch (error) {
  await writeSyncStatus(dataDir, { lastAttemptedSync, outcome: 'failed' });
  // API validation errors can contain source values; never log request URLs or credentials.
  console.error(error instanceof Error && error.name !== 'ZodError' ? error.message : 'Invalid Steam API response');
  process.exitCode = 1;
}
