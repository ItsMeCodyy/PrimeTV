import test from "node:test";
import assert from "node:assert/strict";
import { parsePlayerEvent, continueWatching } from "../src/playback.js";
const frame = {},
  origin = "https://cinesrc.st";
const event = (data) => ({ source: frame, origin, data });
test("accepts only the current frame at the exact player origin", () => {
  const data = { type: "cinesrc:timeupdate", currentTime: 50, duration: 500 };
  assert.equal(parsePlayerEvent(event(data), frame, origin).position, 50);
  assert.equal(
    parsePlayerEvent(
      { ...event(data), origin: "https://evil.example" },
      frame,
      origin,
    ),
    null,
  );
  assert.equal(
    parsePlayerEvent({ ...event(data), source: {} }, frame, origin),
    null,
  );
});
test("rejects invalid and forged progress values", () => {
  for (const currentTime of [-1, Infinity, NaN, "99", 10000])
    assert.equal(
      parsePlayerEvent(
        event({ type: "cinesrc:timeupdate", currentTime, duration: 500 }),
        frame,
        origin,
      ),
      null,
    );
  assert.equal(parsePlayerEvent(event("{bad json"), frame, origin), null);
  assert.equal(
    parsePlayerEvent(
      event({ type: "other", currentTime: 20, duration: 500 }),
      frame,
      origin,
    ),
    null,
  );
});
test("recognizes ready, seek and completion events", () => {
  assert.equal(
    parsePlayerEvent(event({ type: "cinesrc:ready" }), frame, origin).type,
    "cinesrc:ready",
  );
  assert.equal(
    parsePlayerEvent(event({ type: "cinesrc:ended" }), frame, origin).type,
    "cinesrc:ended",
  );
  assert.equal(
    parsePlayerEvent(
      event({ type: "cinesrc:seeked", currentTime: 100, duration: 500 }),
      frame,
      origin,
    ).position,
    100,
  );
});
test("continue watching contains only unfinished started titles, latest first", () => {
  const r = (id, patch = {}) => ({
    media_id: id,
    started_at: "2026-01-01",
    updated_at: "2026-01-01",
    position: 50,
    duration: 1000,
    ...patch,
  });
  assert.deepEqual(
    continueWatching([
      r(1),
      r(2, { completed: true }),
      r(3, { position: 980 }),
      r(4, { started_at: null }),
      r(5, { updated_at: "2026-01-02" }),
    ]).map((x) => x.media_id),
    [5, 1],
  );
});
