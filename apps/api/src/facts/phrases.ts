/** 同一客户的已付款标题里，一个说法至少出现在两行商品上，才提议为偏好。 */
export function repeatedTitlePhrases(titles: string[]) {
  const counts = new Map<string, { count: number; display: string }>();
  for (const title of titles) {
    const seen = new Set<string>();
    for (const token of title.split(/\s+/)) {
      const display = token.trim();
      const key = display.toLowerCase();
      if (key.length < 4 || seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { count: 1, display });
    }
  }
  return [...counts.values()].filter((item) => item.count >= 2).map((item) => item.display);
}
