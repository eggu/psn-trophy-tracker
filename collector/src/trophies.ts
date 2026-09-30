// Both PSN trophy endpoints paginate, including the "all" group (base + DLC).
export async function fetchAllTrophies<T extends { trophies: any[]; totalItemCount: number; trophySetVersion?: string }>(request: (offset: number) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let offset = 0;
  while (true) {
    const page = await request(offset);
    if ((page as any).error || !Array.isArray(page.trophies)) throw new Error("Invalid trophy API response");
    if (!result) result = { ...page, trophies: [...page.trophies] };
    else result.trophies.push(...page.trophies);
    offset += page.trophies.length;
    if (offset >= page.totalItemCount) return result;
    if (!page.trophies.length) throw new Error("Incomplete trophy API pagination");
  }
}
