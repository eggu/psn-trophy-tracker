import type { CanonicalSnapshot, GameTitle, Trophy } from '../schemas/index.js';
import { computeSnapshotDiff } from '../collector/src/diff.js';

export interface AgentMetadata {
  account: string;
  lastSuccessfulSync: string;
  generatedAt: string;
  schemaVersion: number;
  lastAttemptedSync?: string;
  outcome?: 'success' | 'failed';
}
const grades = ['platinum', 'gold', 'silver', 'bronze'] as const;
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export const kst = (value?: string | null) => value ? `${formatter.format(new Date(value))} KST` : 'Unknown';
// Escape source text so names/descriptions cannot introduce Markdown links, tables or headings.
export const text = (value: string) => value.replace(/[\\`*_{}\[\]()<>|#!~]/g, '\\$&').replace(/[\r\n]+/g, ' ');
const name = (item: GameTitle | Trophy) => text(item.localized?.['ko-KR']?.name || item.name);
const description = (t: Trophy) => text(t.localized?.['ko-KR']?.description ?? t.description);
const gradeName = (grade: string) => grade[0].toUpperCase() + grade.slice(1);
const table = (columns: string[], rows: string[][]) => `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
const progress = (game: GameTitle) => `${game.progress.earned}/${game.progress.total} (${game.progress.percentage}%)`;
const lastEarned = (game: GameTitle) => game.trophies.reduce<string | null>((latest, trophy) => trophy.earned && trophy.earnedAt && (!latest || Date.parse(trophy.earnedAt) > Date.parse(latest)) ? trophy.earnedAt : latest, null);
const gameLink = (game: GameTitle) => `[${name(game)}](/agent/game/${game.id})`;
export function dataStatus(meta: AgentMetadata, now = Date.now()) {
  return (meta.outcome === 'failed' && Date.parse(meta.lastAttemptedSync || '') >= Date.parse(meta.lastSuccessfulSync)) || now - Date.parse(meta.lastSuccessfulSync) >= 12 * 3600_000 ? 'Stale' : 'Fresh';
}
export function renderStatus(meta: AgentMetadata, now = Date.now()) {
  return `# Sync Status\n\nStatus: ${dataStatus(meta, now)}\nLast successful sync: ${kst(meta.lastSuccessfulSync)}\n${meta.lastAttemptedSync ? `Last attempted sync: ${kst(meta.lastAttemptedSync)}\n` : ''}Generated: ${kst(meta.generatedAt)}\nSource: PlayStation Network\nSchema: ${meta.schemaVersion}\n`;
}
export function renderManifest(meta: AgentMetadata, now = Date.now()) {
  return `# PSN Trophy Tracker — Agent View\n\nAccount: ${text(meta.account)}\nUpdated: ${kst(meta.lastSuccessfulSync)}\nData status: ${dataStatus(meta, now)}\n\n## Available documents\n\n- [Status](/agent/status) — synchronization status\n- [Profile](/agent/profile) — overall trophy profile\n- [Changes](/agent/changes) — changes since previous sync\n- [Recent](/agent/recent) — latest 50 earned trophies\n- [Games](/agent/games) — game index\n- Individual game: /agent/game/{id}\n\n## Usage\n\nGeneral trophy status: read [Changes](/agent/changes) first.\nOverall totals: read [Profile](/agent/profile).\nSpecific game: find its ID in [Games](/agent/games), then read /agent/game/{id}.\nTimes use KST. Names and descriptions use official PSN ko-KR metadata, otherwise original metadata; no machine translation.\nRead [Status](/agent/status) for freshness before relying on data. Do not fetch full canonical JSON unless raw data is explicitly required.\n`;
}
export function renderDocuments(current: CanonicalSnapshot, previous: CanonicalSnapshot | null) {
  const docs: Record<string, string> = {};
  const updated = `Updated: ${kst(current.metadata.lastSuccessfulSync)}\n`;
  const p = current.profile;
  docs.profile = `# PSN Profile — ${text(p.onlineId)}\n\n${updated}\nLevel: ${p.trophyLevel}\nLevel progress: ${p.progress}%\n\n${table(['Trophy', 'Count'], ['total', ...grades].map(g => [gradeName(g), String(p.trophies[g as keyof typeof p.trophies])]))}\nGames: ${p.games.total}\nCompleted games: ${p.games.completed}\n`;
  const recent = current.games.flatMap(game => game.trophies.filter(t => t.earned).map(trophy => ({ game, trophy }))).sort((a, b) => (Date.parse(b.trophy.earnedAt || '') || 0) - (Date.parse(a.trophy.earnedAt || '') || 0));
  docs.recent = `# Recent Trophies\n\n${updated}\n${table(['Earned', 'Game', 'Trophy', 'Grade'], recent.slice(0, 50).map(({game, trophy}) => [kst(trophy.earnedAt), name(game), name(trophy), gradeName(trophy.grade)]))}`;
  docs.games = `# Games\n\n${updated}Dates: KST. Detail: /agent/game/{id}\n\n${table(['Game', 'ID', 'Platform', 'Progress', 'Platinum', 'Last Trophy'], current.games.map(game => [name(game), game.id, text(game.platform.join(', ')), progress(game), game.platinumEarned ? 'Yes' : 'No', lastEarned(game) ? kst(lastEarned(game)).slice(0, 10) : 'Unknown']))}`;
  for (const game of current.games) {
    if (!/^NPWR\d+_\d+$/.test(game.id)) throw new Error('Invalid game ID');
    const trophyList = (earned: boolean) => game.trophies.filter(t => t.earned === earned).map(t => `- [${earned ? 'x' : ' '}] ${name(t)} — ${gradeName(t.grade)}${earned ? ` — ${kst(t.earnedAt)}` : ''}\n  - ${description(t) || 'No description supplied by PSN.'}`).join('\n\n') || 'None.';
    docs[`game/${game.id}`] = `# ${name(game)}\n\nID: ${game.id}\nPlatform: ${text(game.platform.join(', '))}\n${updated}\nProgress: ${progress(game)}\nPlatinum: ${game.platinumEarned ? 'Earned' : 'Not earned'}\nLast trophy: ${kst(lastEarned(game))}\n\n## Trophy Summary\n\n${table(['Grade', 'Earned', 'Total'], grades.map(g => [gradeName(g), String(game.trophySummary[g].earned), String(game.trophySummary[g].total)]))}\n## Remaining Trophies\n\n${trophyList(false)}\n\n## Earned Trophies\n\n${trophyList(true)}\n`;
  }
  docs.changes = `# Trophy Changes\n\nCurrent sync: ${kst(current.metadata.lastSuccessfulSync)}\nPrevious sync: ${previous ? kst(previous.metadata.lastSuccessfulSync) : 'None (first snapshot)'}\n\n## Summary\n\n`;
  if (!previous) docs.changes += 'Initial snapshot; no previous sync available for comparison.\n';
  else {
    const diff = computeSnapshotDiff(previous, current);
    const changed = diff.newTrophies.length > 0 || diff.changedGames.length > 0 || Object.values(diff.summaryDelta).some(n => n !== 0);
    docs.changes += changed ? ['total', ...grades].map(g => { const n = diff.summaryDelta[g as keyof typeof diff.summaryDelta]; return `${gradeName(g)} ${n >= 0 ? '+' : ''}${n}`; }).join('\n') + '\n' : 'No trophy changes since previous sync.\n';
    if (diff.newTrophies.length) docs.changes += `\n## New Trophies\n\n${table(['Time', 'Game', 'Trophy', 'Grade'], diff.newTrophies.map(item => [kst(item.trophy.earnedAt), gameLink(current.games.find(g => g.id === item.gameId)!), name(item.trophy), gradeName(item.trophy.grade)]))}`;
    if (diff.changedGames.length) docs.changes += `\n## Changed Games\n\n${table(['Game', 'ID', 'Previous', 'Current'], diff.changedGames.map(item => [name(current.games.find(g => g.id === item.id)!), `[${item.id}](/agent/game/${item.id})`, item.previous ? `${item.previous.earned}/${item.previous.total}` : 'New game', `${item.current.earned}/${item.current.total}`]))}`;
  }
  return docs;
}
