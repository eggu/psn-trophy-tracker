export const displayName = item => item.localized?.['ko-KR']?.name || item.name;
export const isSteam = game => game.platform.includes('Steam');
export const isComplete = game => game.progress.total > 0 && game.progress.earned === game.progress.total;
export const lastEarnedTime = game => game.trophies.reduce((latest, trophy) => trophy.earned ? Math.max(latest, Date.parse(trophy.earnedAt) || 0) : latest, 0);

export function sortGames(games, sort) {
  const byName = (a, b) => displayName(a).localeCompare(displayName(b), 'ko', { numeric: true }) || a.id.localeCompare(b.id);
  const remaining = game => game.progress.earned > 0 && !isComplete(game) ? game.progress.total - game.progress.earned : Infinity;
  const compare = {
    name: byName,
    name_desc: (a, b) => -byName(a, b),
    played: (a, b) => (Date.parse(b.lastPlayedAt) || 0) - (Date.parse(a.lastPlayedAt) || 0),
    recent: (a, b) => lastEarnedTime(b) - lastEarnedTime(a),
    progress: (a, b) => b.progress.percentage - a.progress.percentage,
    remaining: (a, b) => remaining(a) - remaining(b),
    earned: (a, b) => b.progress.earned - a.progress.earned
  }[sort] || byName;
  return [...games].sort((a, b) => compare(a, b) || byName(a, b));
}
