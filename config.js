// Public browser configuration. Never put a service-role or secret key here.
export const config = Object.freeze({
  tmdbKey: "",
  supabaseUrl: "",
  supabasePublishableKey: "",
  playerOrigin: "https://cinesrc.st",
  // Optional direct, authorized video URLs keyed by "movie:123" or "tv:123:1:2".
  // Native videos support verified progress and exact resume.
  media: {},
});
