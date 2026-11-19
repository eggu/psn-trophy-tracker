import { z } from 'zod';
import type { GameTitle } from '../../schemas/index.js';

const playedPage = z.object({ totalItemCount: z.number().int().nonnegative(), titles: z.array(z.object({ titleId: z.string(), lastPlayedDateTime: z.string().datetime().optional() })) });
const trophyTitles = z.object({ titles: z.array(z.object({ npTitleId: z.string(), trophyTitles: z.array(z.object({ npCommunicationId: z.string() })).optional().default([]) })) });

export async function collectPsnLastPlayed(
  games: GameTitle[],
  fetchPage: (offset: number) => Promise<unknown>,
  fetchTitles: (titleIds: string[]) => Promise<unknown>
) {
  const played = new Map<string, string>();
  let offset = 0;
  while (true) {
    const page = playedPage.parse(await fetchPage(offset));
    for (const title of page.titles) {
      if (title.lastPlayedDateTime && (!played.has(title.titleId) || Date.parse(title.lastPlayedDateTime) > Date.parse(played.get(title.titleId)!))) played.set(title.titleId, title.lastPlayedDateTime);
    }
    offset += page.titles.length;
    if (offset >= page.totalItemCount) break;
    if (!page.titles.length) throw new Error('Incomplete PSN played-games response');
  }
  const updates = new Map<string, string>();
  const ids = [...played.keys()];
  for (let index = 0; index < ids.length; index += 5) {
    const batch = ids.slice(index, index + 5);
    const response = trophyTitles.parse(await fetchTitles(batch));
    for (const title of response.titles) {
      if (!batch.includes(title.npTitleId)) throw new Error('Unexpected PSN title mapping');
      const time = played.get(title.npTitleId)!;
      for (const trophy of title.trophyTitles) {
        if (!updates.has(trophy.npCommunicationId) || Date.parse(time) > Date.parse(updates.get(trophy.npCommunicationId)!)) updates.set(trophy.npCommunicationId, time);
      }
    }
  }
  // Join official title IDs to trophy-set IDs; similar game names are not a reliable match.
  for (const game of games) if (updates.has(game.id)) game.lastPlayedAt = updates.get(game.id);
}
