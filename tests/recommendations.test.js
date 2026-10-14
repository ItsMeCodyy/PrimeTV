import test from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../src/recommendations.js";
const item = (id, genres, extra = {}) => ({
  id,
  media_type: "movie",
  title: `Movie ${id}`,
  genre_ids: genres,
  original_language: "en",
  vote_average: 7.5,
  vote_count: 1000,
  popularity: 100,
  ...extra,
});
const record = (i, extra = {}) => ({
  media_id: i.id,
  media_type: i.media_type,
  item: i,
  rating: 1,
  updated_at: new Date().toISOString(),
  ...extra,
});
test("likes change ranking toward the profile’s genres", () => {
  const candidates = [item(2, [28]), item(3, [10749]), item(4, [18])];
  assert.equal(recommend(candidates, [record(item(1, [10749]))])[0].id, 3);
  assert.equal(recommend(candidates, [record(item(1, [28]))])[0].id, 2);
});
test("excludes dislikes, completed titles, adults and deduplicates mixed pools", () => {
  const candidates = [
    item(1, [28]),
    item(2, [28]),
    item(3, [28]),
    item(4, [28], { adult: true }),
    item(3, [28]),
  ];
  assert.deepEqual(
    recommend(candidates, [
      record(candidates[0], { rating: -1 }),
      record(candidates[1], { completed: true }),
    ]).map((i) => i.id),
    [3],
  );
});
test("empty profile gets quality-based cold start with explanations", () => {
  const picks = recommend(
    [
      item(1, [28], { vote_count: 1, vote_average: 10 }),
      item(2, [18], { vote_average: 8.5 }),
    ],
    [],
  );
  assert.equal(picks[0].id, 2);
  assert.ok(picks.every((p) => p.reason));
});
test("movie and TV IDs remain separate and related seeds explain picks", () => {
  const tv = item(9, [18], { media_type: "tv" }),
    movie = item(9, [18]);
  const picks = recommend([movie, tv], [record(movie, { rating: -1 })], {
    related: [{ seed: item(7, [18], { title: "A favorite" }), items: [tv] }],
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].media_type, "tv");
  assert.equal(picks[0].reason, "Because you enjoyed A favorite");
});
test("watch completion informs taste; merely opening a title does not", () => {
  const candidates = [item(3, [18]), item(2, [28])],
    watched = item(1, [28]);
  assert.equal(
    recommend(candidates, [
      record(watched, { rating: 0, position: 850, duration: 1000 }),
    ])[0].id,
    2,
  );
  assert.equal(
    recommend(candidates, [
      record(watched, { rating: 0, position: 0, duration: 0 }),
    ])[0].id,
    3,
  );
});
