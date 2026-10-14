import { config } from "../config.js";
export const image = (path, size = "w500") =>
  path && /^\/[\w.\-]+$/.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : "";
export const keyOf = (item) =>
  `${item.media_type || item._t || (item.title ? "movie" : "tv")}:${item.id}`;
export function normalize(item, type) {
  return {
    ...item,
    media_type:
      type || item.media_type || item._t || (item.title ? "movie" : "tv"),
    genre_ids: item.genre_ids || item.genres?.map((g) => g.id) || [],
  };
}
const cache = new Map();
export async function api(path, params = {}, signal) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", config.tmdbKey);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);
  const response = await fetch(url, {
    signal: signal || AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error("The movie catalog is unavailable. Please try again.");
  const data = await response.json();
  cache.set(key, data);
  return data;
}
export const usable = (items) =>
  items.filter(
    (i) =>
      i.id &&
      !i.adult &&
      (i.media_type === "movie" || i.media_type === "tv" || !i.media_type) &&
      (i.poster_path || i.backdrop_path),
  );
export async function catalog(type = "home") {
  const requests =
    type === "home"
      ? [
          ["Trending this week", "/trending/all/week"],
          ["Movies for your evening", "/movie/popular", "movie"],
          ["One more episode", "/tv/popular", "tv"],
          ["Worth your time", "/movie/top_rated", "movie"],
        ]
      : [
          ["Popular right now", `/${type}/popular`, type],
          ["The crowd favorites", `/${type}/top_rated`, type],
          [
            type === "movie" ? "Now in theaters" : "On the air",
            `/${type}/${type === "movie" ? "now_playing" : "on_the_air"}`,
            type,
          ],
        ];
  const results = await Promise.allSettled(
    requests.map(async ([title, path, t]) => ({
      title,
      items: usable((await api(path)).results).map((i) => normalize(i, t)),
    })),
  );
  const rows = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  if (!rows.length) throw new Error("We couldn’t reach the movie catalog.");
  return rows;
}
export async function recommendationCandidates(records) {
  const seeds = records
    .filter(
      (r) =>
        r.rating === 1 || (r.duration > 0 && r.position / r.duration > 0.5),
    )
    .sort(
      (a, b) =>
        (b.rating === 1) - (a.rating === 1) ||
        Date.parse(b.updated_at) - Date.parse(a.updated_at),
    )
    .slice(0, 5);
  const results = await Promise.allSettled(
    seeds.map(async (r) => ({
      seed: r.item,
      items: usable(
        (await api(`/${r.media_type}/${r.media_id}/recommendations`)).results,
      ).map((i) => normalize(i, r.media_type)),
    })),
  );
  return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
}
