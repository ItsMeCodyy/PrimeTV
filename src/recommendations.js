import { keyOf } from "./catalog.js";
const ratio = (r) =>
  r.duration > 0 ? Math.min(1, r.position / r.duration) : 0;
// Content-based ranking: explicit feedback outweighs completion. Time decay adapts
// taste; Bayesian quality handles low vote counts; MMR adds genre diversity.
export function recommend(
  candidates,
  records,
  { limit = 20, now = Date.now(), related = [] } = {},
) {
  const genres = new Map(),
    languages = new Map(),
    types = new Map();
  const byKey = new Map(
    records.map((r) => [`${r.media_type}:${r.media_id}`, r]),
  );
  const add = (map, key, v) => map.set(key, (map.get(key) || 0) + v);
  for (const r of records) {
    const age = Math.max(
      0,
      (now - Date.parse(r.updated_at || new Date(now).toISOString())) /
        86400000,
    );
    const decay = Math.max(0.2, Math.exp(-age / 120));
    const weight =
      (r.rating === 1
        ? 5
        : r.rating === -1
          ? -7
          : ratio(r) >= 0.85
            ? 2.5
            : ratio(r) >= 0.4
              ? 1
              : 0) * decay;
    for (const genre of r.item?.genre_ids || [])
      add(genres, genre, weight / Math.sqrt(r.item.genre_ids.length));
    if (r.item?.original_language)
      add(languages, r.item.original_language, weight * 0.2);
    add(types, r.media_type, weight * 0.1);
  }
  const seedMatches = new Map();
  for (const { seed, items } of related)
    for (const i of items)
      if (!seedMatches.has(keyOf(i)))
        seedMatches.set(keyOf(i), seed.title || seed.name);
  const unique = new Map(
    [...related.flatMap((r) => r.items), ...candidates].map((i) => [
      keyOf(i),
      i,
    ]),
  );
  const personalized = genres.size > 0;
  const pool = [...unique.values()]
    .filter((i) => {
      const r = byKey.get(keyOf(i));
      return (
        !i.adult && r?.rating !== -1 && !r?.completed && ratio(r || {}) < 0.9
      );
    })
    .map((item) => {
      const affinity =
        (item.genre_ids || []).reduce((s, g) => s + (genres.get(g) || 0), 0) /
        Math.sqrt(Math.max(1, item.genre_ids?.length || 0));
      const votes = Math.max(0, item.vote_count || 0),
        quality =
          (votes * (item.vote_average || 0) + 200 * 6.5) / (votes + 200);
      const relatedTo = seedMatches.get(keyOf(item));
      const score =
        affinity +
        (languages.get(item.original_language) || 0) +
        (types.get(item.media_type) || 0) +
        quality * 0.3 +
        Math.log1p(Math.max(0, item.popularity || 0)) * 0.12 +
        (relatedTo ? 2 : 0);
      const reason = relatedTo
        ? `Because you enjoyed ${relatedTo}`
        : personalized && affinity > 0
          ? "A match for your taste"
          : votes > 500 && quality > 7
            ? "Loved by viewers"
            : "Something to discover";
      return { ...item, score, reason };
    });
  const selected = [];
  while (pool.length && selected.length < limit) {
    let best = 0,
      bestScore = -Infinity;
    pool.forEach((item, index) => {
      const similarity = Math.max(
        0,
        ...selected.slice(-5).map((other) => {
          const a = item.genre_ids || [],
            b = other.genre_ids || [];
          return (
            a.filter((g) => b.includes(g)).length /
            Math.max(1, new Set([...a, ...b]).size)
          );
        }),
      );
      const score = item.score - similarity * 1.5;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    selected.push(pool.splice(best, 1)[0]);
  }
  return selected;
}
