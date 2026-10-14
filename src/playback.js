export function parsePlayerEvent(event, frameWindow, origin) {
  if (event.source !== frameWindow || event.origin !== origin) return null;
  let data = event.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  if (
    [
      "cinesrc:ready",
      "cinesrc:close",
      "cinesrc:ended",
      "cinesrc:play",
      "cinesrc:pause",
      "cinesrc:loadedmetadata",
    ].includes(data.type)
  )
    return {
      type: data.type,
      duration: Number.isFinite(data.duration) ? data.duration : 0,
    };
  if (!["cinesrc:timeupdate", "cinesrc:seeked"].includes(data.type))
    return null;
  const { currentTime, duration } = data;
  if (
    typeof currentTime !== "number" ||
    typeof duration !== "number" ||
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    currentTime < 0 ||
    duration <= 0 ||
    duration > 604800 ||
    currentTime > duration + 5
  )
    return null;
  return {
    type: data.type,
    position: Math.min(currentTime, duration),
    duration,
  };
}
export function continueWatching(records) {
  return records
    .filter(
      (r) =>
        r.started_at &&
        !r.completed &&
        !(r.duration > 0 && r.position / r.duration >= 0.95),
    )
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}
