import {
  api,
  catalog,
  image,
  keyOf,
  normalize,
  recommendationCandidates,
  usable,
} from "./src/catalog.js";
import { recommend } from "./src/recommendations.js";
import { LibraryStore, colors } from "./src/store.js";
import { parsePlayerEvent, continueWatching } from "./src/playback.js";
import { icon, esc } from "./src/icons.js";
import { config } from "./config.js";
const $ = (id) => document.getElementById(id);
const store = new LibraryStore();
const state = {
  page: "home",
  rows: [],
  items: new Map(),
  genre: 0,
  genres: [],
  hero: 0,
  request: 0,
  detailRequest: 0,
  detail: null,
  searchTimer: null,
  searchAbort: null,
  player: null,
  authMode: "signin",
  managing: false,
  profileEdit: null,
};
const title = (i) => i.title || i.name || "Untitled";
const year = (i) => (i.release_date || i.first_air_date || "").slice(0, 4);
const remember = (items) => items.forEach((i) => state.items.set(keyOf(i), i));
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("toasts").append(el);
  setTimeout(() => el.remove(), 4000);
}
function show(dialog) {
  if (!dialog.open) dialog.showModal();
}
function statusText() {
  return (
    {
      local: "Saved on this device",
      synced: "All changes saved",
      saving: "Saving…",
      loading: "Loading your profile…",
      offline: "Offline · saved on this device",
      error: "Sync paused · retry",
      "storage-error": "Device storage unavailable",
    }[store.status] || ""
  );
}
function updateAccount() {
  const name = store.profile?.name || "Choose profile";
  $("account-button").innerHTML =
    `${esc(store.user ? name : "Sign in")} <span class="avatar mini ${esc(store.profile?.color || "violet")}" aria-hidden="true">${esc(name.slice(0, 1))}</span>`;
  document
    .querySelectorAll("[data-sync]")
    .forEach((el) => (el.textContent = statusText()));
}
store.addEventListener("change", updateAccount);
store.addEventListener("account", () => {
  if ($("player-dialog").open) closePlayer();
  if (store.user) openProfiles();
  else {
    state.managing = false;
    renderPage();
  }
});
store.addEventListener("recovery", () => openAuth("recovery"));
function meta(item) {
  return `<span class="rating">★ ${Number(item.vote_average || 0).toFixed(1)}</span><span>${esc(year(item))}</span><span>${item.media_type === "tv" ? "Series" : "Movie"}</span>${item.runtime ? `<span>${Math.floor(item.runtime / 60)}h ${item.runtime % 60}m</span>` : ""}<span class="meta-tag">${esc((item.original_language || "en").toUpperCase())}</span>`;
}
function card(item, { wide = false, record = null, reason = false } = {}) {
  const key = keyOf(item),
    src = image(
      wide
        ? item.backdrop_path || item.poster_path
        : item.poster_path || item.backdrop_path,
      wide ? "w780" : "w342",
    );
  const progress =
    record?.duration > 0
      ? Math.min(100, (record.position / record.duration) * 100)
      : 0;
  const remaining =
    record?.duration > 0
      ? `${Math.ceil((record.duration - record.position) / 60)} min left`
      : "Recently started";
  return `<article class="title-card"><button class="poster-button" data-action="${wide ? "play" : "details"}" data-key="${key}" aria-label="${wide ? "Resume" : "Details for"} ${esc(title(item))}">${src ? `<img src="${src}" alt="" loading="lazy" decoding="async">` : ""}<span class="card-play">${icon("play")}</span>${wide ? "" : `<span class="card-rating">★ ${Number(item.vote_average || 0).toFixed(1)}</span>`}${progress ? `<span class="progress-track" role="progressbar" aria-label="Watch progress" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress}%"></span></span>` : ""}</button>${wide ? `<button class="remove-card" data-action="remove-continue" data-key="${key}" aria-label="Remove ${esc(title(item))} from Continue Watching">×</button>` : ""}<h3>${esc(title(item))}</h3><div class="card-subtitle"><span>${wide && item.media_type === "tv" ? `S${record?.season || 1} · E${record?.episode || 1}` : esc(year(item))}</span><span>${wide ? remaining : item.media_type === "tv" ? "TV show" : "Movie"}</span></div>${reason ? `<p class="card-reason" title="${esc(item.reason)}">${esc(item.reason)}</p>` : ""}</article>`;
}
function section(
  label,
  items,
  { wide = false, records = [], subtitle = "", reason = false } = {},
) {
  if (!items.length) return "";
  remember(items);
  return `<section class="movie-section"><div class="section-heading"><div><h2>${esc(label)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="section-actions"><button class="icon-button" data-action="row-left" aria-label="Scroll ${esc(label)} left">${icon("left")}</button><button class="icon-button" data-action="row-right" aria-label="Scroll ${esc(label)} right">${icon("right")}</button></div></div><div class="title-row ${wide ? "wide-row" : ""}">${items.map((item, i) => card(item, { wide, record: records[i], reason })).join("")}</div></section>`;
}
function heroMarkup() {
  const items =
    state.rows[0]?.items.filter((i) => i.backdrop_path).slice(0, 5) || [];
  const item = items[state.hero % items.length];
  if (!item) return "";
  return `<section class="hero" aria-label="Featured title"><img class="hero-image" src="${image(item.backdrop_path, "w1280")}" alt="" fetchpriority="high"><div class="hero-copy"><span class="hero-tag">${icon("spark")} THE SPOTLIGHT</span><h2>${esc(title(item))}</h2><div class="metadata">${meta(item)}</div><p class="hero-description">${esc(item.overview)}</p><div class="hero-actions"><button class="button primary" data-action="play" data-key="${keyOf(item)}">${icon("play")} Watch now</button><button class="button secondary" data-action="details" data-key="${keyOf(item)}">${icon("info")} More info</button></div></div><div class="hero-position"><span class="hero-caption">THIS WEEK’S PICKS</span>${items.map((i, n) => `<button class="hero-dot ${n === state.hero ? "active" : ""}" data-action="hero" data-index="${n}" aria-label="Feature ${esc(title(i))}" aria-pressed="${n === state.hero}"></button>`).join("")}</div></section>`;
}
function personalRows() {
  const records = continueWatching(store.records).filter(
    (r) => state.page === "home" || state.page === r.media_type,
  );
  return section(
    "Continue watching",
    records.map((r) => r.item),
    {
      wide: true,
      records,
      subtitle: store.profile
        ? `Pick up where you left off, ${store.profile.name}.`
        : "",
    },
  );
}
async function renderRecommendations(ticket) {
  const records = store.records.filter(
    (r) => state.page === "home" || r.media_type === state.page,
  );
  const related = await recommendationCandidates(records);
  if (ticket !== state.request || !$("recommendations")) return;
  const candidates = state.rows.flatMap((r) => r.items);
  const items = recommend(candidates, records, { related, limit: 18 });
  $("recommendations").innerHTML = section(
    records.some((r) => r.rating || r.position > 0)
      ? "Picked for you"
      : "Your next good watch",
    items,
    {
      reason: true,
      subtitle: records.some((r) => r.rating || r.position > 0)
        ? "A little more of what you love. A few new discoveries."
        : "Start watching or leave a like to make these picks yours.",
    },
  );
}
async function renderPage({ reload = false } = {}) {
  const ticket = ++state.request;
  document.querySelectorAll("[data-page]").forEach((el) => {
    const active = el.dataset.page === state.page;
    el.classList.toggle("active", active);
    active
      ? el.setAttribute("aria-current", "page")
      : el.removeAttribute("aria-current");
  });
  if (state.page === "list") {
    const items = store.records.filter((r) => r.in_list).map((r) => r.item);
    remember(items);
    $("page-content").innerHTML =
      `<div class="page-title"><p class="eyebrow">YOUR OWN LITTLE COLLECTION</p><h1>My list</h1><p>All the things you’re saving for a good evening.</p></div>${items.length ? `<div class="grid">${items.map((i) => card(i)).join("")}</div>` : empty("Make room for your favorites", "Tap the + on any title to keep it here for later.", "list")}`;
    return;
  }
  if (reload || !state.rows.length) {
    $("page-content").innerHTML =
      '<div class="loading-page"><span class="spinner"></span>Finding your next favorite…</div>';
    try {
      const rows = await catalog(state.page);
      if (ticket !== state.request) return;
      state.rows = rows;
      remember(rows.flatMap((r) => r.items));
    } catch (error) {
      if (ticket === state.request)
        $("page-content").innerHTML =
          empty("Let’s try that again", error.message, "info") +
          '<div style="text-align:center"><button class="button primary" data-action="retry">Try again</button></div>';
      return;
    }
  }
  if (ticket !== state.request) return;
  const isHome = state.page === "home";
  const chips = [
    { id: 0, name: "For you" },
    ...state.genres.filter((g) =>
      [28, 12, 35, 18, 10749, 878, 53, 16, 27].includes(g.id),
    ),
  ];
  $("page-content").innerHTML =
    `<div class="welcome"><div><div class="eyebrow">YOUR SOFA. YOUR CINEMA.</div><h1>${isHome ? "A good night starts here." : state.page === "movie" ? "Big stories. Little escapes." : "Find your next obsession."}</h1><p>${isHome ? "Settle in. We’ll help you find something you love." : state.page === "movie" ? "A whole world of movies, all in one place." : "One more episode? We thought so."}</p></div><button class="date-label" data-action="profiles">${icon("users")} ${esc(store.profile?.name || "Choose profile")} · Switch profile</button></div><div id="hero-slot">${heroMarkup()}</div>${isHome ? `<div class="category-strip" aria-label="Movie genres">${chips.map((g) => `<button class="category-chip ${state.genre === g.id ? "active" : ""}" data-action="genre" data-genre="${g.id}" aria-pressed="${state.genre === g.id}">${esc(g.name)}</button>`).join("")}</div>` : ""}<div id="genre-results"></div><div id="standard-rows"><div id="continue-rows">${personalRows()}</div>${section(state.rows[0].title, state.rows[0].items)}<div id="recommendations"></div>${state.rows
      .slice(1)
      .map((r) => section(r.title, r.items))
      .join(
        "",
      )}<aside class="discovery-note"><div class="note-icon">${icon("like")}</div><div><h3>Good taste deserves good recommendations.</h3><p>Like the things you love. Your picks get more personal with every watch.</p></div><button class="button ghost" data-action="${store.user ? "profiles" : "signup"}">${store.user ? "Your profiles" : "Make it yours"} ${icon("right")}</button></aside></div>`;
  renderRecommendations(ticket).catch(() => {});
  if (state.genre) loadGenre(state.genre);
}
function empty(heading, description, symbol) {
  return `<div class="empty-state">${icon(symbol)}<h2>${esc(heading)}</h2><p>${esc(description)}</p></div>`;
}
async function loadGenre(id) {
  state.genre = id;
  document.querySelectorAll("[data-genre]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.genre) === id);
    b.setAttribute("aria-pressed", Number(b.dataset.genre) === id);
  });
  if (!$("genre-results")) return;
  $("standard-rows").hidden = !!id;
  $("genre-results").hidden = !id;
  if (!id) return;
  const ticket = state.request;
  $("genre-results").innerHTML =
    '<div class="loading-page"><span class="spinner"></span>Finding movies…</div>';
  try {
    const data = await api("/discover/movie", {
      with_genres: id,
      include_adult: false,
      sort_by: "popularity.desc",
    });
    if (id !== state.genre || ticket !== state.request) return;
    const items = usable(data.results).map((i) => normalize(i, "movie"));
    remember(items);
    $("genre-results").innerHTML =
      `<section class="movie-section"><div class="grid">${items.map((i) => card(i)).join("")}</div></section>`;
  } catch (error) {
    if (id === state.genre && ticket === state.request)
      $("genre-results").innerHTML = empty(
        "Couldn’t load this genre",
        error.message,
        "info",
      );
  }
}
async function openDetails(item) {
  const ticket = ++state.detailRequest;
  state.detail = item;
  const dialog = $("details-dialog");
  dialog.innerHTML = `<button class="icon-button dialog-close" data-action="close-details" aria-label="Close details">${icon("close")}</button><div class="detail-visual"><img src="${image(item.backdrop_path || item.poster_path, "w1280")}" alt=""></div><div class="detail-body"><h2>${esc(title(item))}</h2><div class="metadata" id="detail-meta">${meta(item)}</div><div class="detail-actions" id="detail-actions"></div><p class="overview">${esc(item.overview || "A new story to discover.")}</p><div id="detail-extra"><p class="cast-line">Loading details…</p></div></div>`;
  detailActions();
  show(dialog);
  try {
    const data = await api(`/${item.media_type}/${item.id}`, {
      append_to_response: "credits",
    });
    if (ticket !== state.detailRequest) return;
    state.detail = normalize({ ...item, ...data }, item.media_type);
    remember([state.detail]);
    $("detail-meta").innerHTML = meta(state.detail);
    const cast = data.credits?.cast
      ?.slice(0, 6)
      .map((p) => p.name)
      .join(", ");
    $("detail-extra").innerHTML =
      `${cast ? `<p class="cast-line"><strong>Starring</strong> ${esc(cast)}</p>` : ""}${data.genres?.length ? `<p class="cast-line"><strong>Genres</strong> ${esc(data.genres.map((g) => g.name).join(", "))}</p>` : ""}${item.media_type === "tv" ? '<div class="episodes-heading"><h3>Episodes</h3><select id="season-select" aria-label="Select season"></select></div><div id="episodes"></div>' : ""}`;
    if (item.media_type === "tv") {
      const seasons = data.seasons?.filter((s) => s.season_number > 0) || [];
      $("season-select").innerHTML = seasons
        .map(
          (s) =>
            `<option value="${s.season_number}">Season ${s.season_number}</option>`,
        )
        .join("");
      const last = store.get(item)?.season;
      const first =
        seasons.find((s) => s.season_number === last)?.season_number ||
        seasons[0]?.season_number;
      if (first) {
        $("season-select").value = String(first);
        loadEpisodes(item, first, ticket);
      } else
        $("episodes").innerHTML =
          '<p class="cast-line">No episodes available yet.</p>';
      $("season-select").onchange = (e) =>
        loadEpisodes(item, Number(e.target.value), ticket);
    }
  } catch {
    if (ticket === state.detailRequest)
      $("detail-extra").innerHTML =
        '<p class="cast-line">Extra details couldn’t load. You can still watch this title.</p>';
  }
}
function detailActions() {
  const item = state.detail;
  if (!item || !$("detail-actions")) return;
  const r = store.get(item),
    key = keyOf(item);
  $("detail-actions").innerHTML =
    `<button class="button primary" data-action="play" data-key="${key}">${icon("play")} ${r?.position > 0 && !r.completed ? "Resume" : "Watch now"}</button><button class="icon-button ${r?.in_list ? "selected" : ""}" data-action="list" data-key="${key}" aria-label="${r?.in_list ? "Remove from" : "Add to"} My list" aria-pressed="${!!r?.in_list}">${icon(r?.in_list ? "check" : "plus")}</button><button class="icon-button ${r?.rating === 1 ? "selected" : ""}" data-action="like" data-key="${key}" aria-label="I like this" aria-pressed="${r?.rating === 1}">${icon("like")}</button><button class="icon-button ${r?.rating === -1 ? "selected" : ""}" data-action="dislike" data-key="${key}" aria-label="Not for me" aria-pressed="${r?.rating === -1}">${icon("dislike")}</button>`;
}
async function loadEpisodes(item, season, ticket) {
  const target = $("episodes");
  target.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api(`/tv/${item.id}/season/${season}`);
    if (
      ticket !== state.detailRequest ||
      Number($("season-select")?.value) !== season
    )
      return;
    target.innerHTML =
      (data.episodes || [])
        .map(
          (ep) =>
            `<button class="episode" data-action="episode" data-key="${keyOf(item)}" data-season="${season}" data-episode="${ep.episode_number}">${ep.still_path ? `<img src="${image(ep.still_path, "w300")}" loading="lazy" alt="">` : ""}<div class="episode-info"><h4>${ep.episode_number}. ${esc(ep.name)}</h4><p>${ep.runtime ? `${ep.runtime} min · ` : ""}${esc(ep.overview || "Watch this episode.")}</p></div>${icon("play")}</button>`,
        )
        .join("") || '<p class="cast-line">No episodes available.</p>';
  } catch {
    if (ticket === state.detailRequest && target.isConnected)
      target.innerHTML =
        '<p class="cast-line">Episodes couldn’t load. Choose the season again to retry.</p>';
  }
}
function requireProfile() {
  if (store.profile) return true;
  openProfiles();
  return false;
}
async function openPlayer(item, season, episode) {
  if (!requireProfile()) return;
  if (state.player) closePlayer();
  const old = store.get(item);
  const s = season || old?.season || 1,
    e = episode || old?.episode || 1;
  const same =
    !old ||
    item.media_type === "movie" ||
    (old.season === s && old.episode === e);
  const position = same && !old?.completed ? old?.position || 0 : 0;
  state.player = {
    item,
    season: s,
    episode: e,
    position,
    duration: same ? old?.duration || 0 : 0,
    saveAt: 0,
    resumed: !position,
    profileId: store.profile.id,
    received: false,
  };
  store.update(item, {
    season: s,
    episode: e,
    position,
    duration: state.player.duration,
    started_at: new Date().toISOString(),
    completed: false,
  });
  $("details-dialog").close();
  const url = new URL(
    `${config.playerOrigin}/embed/${item.media_type}/${item.id}`,
  );
  url.searchParams.set("back", "close");
  url.searchParams.set("autonext", "false");
  if (item.media_type === "tv") {
    url.searchParams.set("s", s);
    url.searchParams.set("e", e);
  }
  const direct =
    config.media[
      item.media_type === "tv" ? `${keyOf(item)}:${s}:${e}` : keyOf(item)
    ];
  const safeDirect =
    direct && (/^https:\/\//.test(direct) || direct.startsWith("./"));
  $("player-dialog").innerHTML =
    `<div class="player-bar"><button class="icon-button" data-action="close-player" aria-label="Close player">${icon("left")}</button><h2>${esc(title(item))}${item.media_type === "tv" ? ` · S${s} E${e}` : ""}</h2><span class="sync-status" data-sync>${statusText()}</span></div><div class="video-area">${safeDirect ? `<video id="native-video" src="${esc(direct)}" controls playsinline autoplay></video>` : `<iframe id="movie-frame" title="${esc(title(item))} player" src="${esc(url.href)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`}</div><div class="player-bottom"><span id="playback-status">${position ? `Resuming from ${Math.floor(position / 60)} min…` : "Waiting for playback…"}</span><button data-action="player-like">${icon("like")} I like this</button>${item.media_type === "tv" ? '<button data-action="next-episode">Next episode →</button>' : ""}</div>`;
  show($("player-dialog"));
  const video = $("native-video");
  if (video) {
    video.addEventListener("loadedmetadata", () => {
      if (position && Number.isFinite(video.duration))
        video.currentTime = Math.min(position, video.duration);
    });
    video.addEventListener("timeupdate", () =>
      recordProgress(video.currentTime, video.duration),
    );
    video.addEventListener("pause", () => savePlayback(true));
    video.addEventListener("ended", () => finishPlayback());
  }
}
function recordProgress(position, duration) {
  const p = state.player;
  if (
    !p ||
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    position < 0
  )
    return;
  p.position = Math.min(position, duration);
  p.duration = duration;
  p.received = true;
  if ($("playback-status"))
    $("playback-status").textContent =
      `${Math.floor(position / 60)} / ${Math.floor(duration / 60)} min`;
  savePlayback();
}
function savePlayback(force = false) {
  const p = state.player;
  if (!p || store.profile?.id !== p.profileId || !p.received) return;
  if (!force && Date.now() - p.saveAt < 10000) return;
  p.saveAt = Date.now();
  store.update(p.item, {
    position: p.position,
    duration: p.duration,
    season: p.season,
    episode: p.episode,
    completed: p.position / p.duration >= 0.95,
  });
}
function finishPlayback() {
  const p = state.player;
  if (!p) return;
  if (p.duration) {
    p.position = p.duration;
    p.received = true;
    savePlayback(true);
  } else store.update(p.item, { completed: true });
  if ($("playback-status"))
    $("playback-status").textContent = "Finished · saved to your watch history";
}
function closePlayer() {
  savePlayback(true);
  state.player = null;
  $("player-dialog").close();
  $("player-dialog").innerHTML = "";
  refreshPersonal();
}
function refreshPersonal() {
  if ($("continue-rows")) $("continue-rows").innerHTML = personalRows();
  if ($("recommendations"))
    renderRecommendations(state.request).catch(() => {});
  if (state.page === "list") renderPage();
}
window.addEventListener("message", (event) => {
  const frame = $("movie-frame"),
    p = state.player;
  if (!frame || !p) return;
  const message = parsePlayerEvent(
    event,
    frame.contentWindow,
    config.playerOrigin,
  );
  if (!message) return;
  if (message.type === "cinesrc:close") {
    closePlayer();
    return;
  }
  if (
    !p.resumed &&
    [
      "cinesrc:ready",
      "cinesrc:loadedmetadata",
      "cinesrc:timeupdate",
      "cinesrc:play",
    ].includes(message.type)
  ) {
    frame.contentWindow.postMessage(
      { type: "cinesrc:command", command: "seek", args: [p.position] },
      config.playerOrigin,
    );
    p.resumed = true;
    if (message.type === "cinesrc:timeupdate") return;
  }
  if (
    message.type === "cinesrc:timeupdate" ||
    message.type === "cinesrc:seeked"
  )
    recordProgress(message.position, message.duration);
  if (message.type === "cinesrc:pause") savePlayback(true);
  if (message.type === "cinesrc:ended") finishPlayback();
});
async function nextEpisode() {
  const p = state.player;
  if (!p) return;
  try {
    const season = await api(`/tv/${p.item.id}/season/${p.season}`);
    let next = season.episodes.find((e) => e.episode_number === p.episode + 1),
      s = p.season;
    if (!next) {
      const series = await api(`/tv/${p.item.id}`);
      if (!series.seasons?.some((x) => x.season_number === s + 1)) {
        toast("You’re all caught up.");
        return;
      }
      s++;
      next = (await api(`/tv/${p.item.id}/season/${s}`)).episodes?.[0];
    }
    if (
      next &&
      (!next.air_date || next.air_date <= new Date().toISOString().slice(0, 10))
    )
      openPlayer(p.item, s, next.episode_number);
    else toast("The next episode isn’t available yet.");
  } catch {
    toast("Couldn’t load the next episode. Try again.");
  }
}
function openAuth(mode = "signin") {
  state.authMode = mode;
  const signup = mode === "signup",
    reset = mode === "reset",
    recovery = mode === "recovery";
  $("auth-dialog").innerHTML =
    `<button class="icon-button dialog-close" data-action="close-auth" aria-label="Close sign in">${icon("close")}</button><a class="brand" href="#home">prime<span>tv</span><span class="brand-dot">.</span></a><h2 id="auth-title">${signup ? "Make yourself at home." : reset ? "Forgot your password?" : recovery ? "A fresh start." : "Welcome back."}</h2><p class="auth-subtitle">${signup ? "Your profiles, your favorites, your place in every story." : reset ? "We’ll send a link to help you get back in." : recovery ? "Choose a new password for your account." : "Your next great watch is waiting for you."}</p>${!store.client ? '<p class="setup-note">Account sync is being set up. You can browse now and keep separate profiles on this device.</p>' : ""}<form id="auth-form">${!recovery ? '<label class="field"><span>Email address</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254"></label>' : ""}${!reset ? `<label class="field"><span>Password</span><input name="password" type="password" autocomplete="${signup || recovery ? "new-password" : "current-password"}" placeholder="${signup || recovery ? "At least 8 characters" : "Your password"}" ${signup || recovery ? 'minlength="8"' : ""} required maxlength="128"></label>` : ""}${mode === "signin" ? '<button class="form-link" type="button" data-action="auth-reset">Forgot password?</button>' : ""}<p id="auth-message" class="form-message" role="status"></p><button class="button primary form-button" type="submit" ${!store.client ? "disabled" : ""}>${signup ? "Create account" : reset ? "Send reset link" : recovery ? "Update password" : "Sign in"} ${icon("right")}</button></form>${!recovery ? `<p class="auth-switch">${signup ? "Already have an account?" : "New to PrimeTV?"} <button data-action="${signup ? "signin" : "signup"}">${signup ? "Sign in" : "Create an account"}</button></p>` : ""}<button class="form-link" style="margin:18px auto 0" data-action="guest">Continue browsing</button>`;
  $("auth-form").onsubmit = submitAuth;
  show($("auth-dialog"));
}
async function submitAuth(event) {
  event.preventDefault();
  if (!store.client) return;
  const form = event.currentTarget,
    button = form.querySelector("[type=submit]"),
    values = new FormData(form),
    email = String(values.get("email") || "").trim(),
    password = String(values.get("password") || "");
  const mode = state.authMode;
  button.disabled = true;
  $("auth-message").textContent = "";
  const redirect = new URL("./", location.href).href;
  try {
    let result;
    if (mode === "signup")
      result = await store.client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirect },
      });
    else if (mode === "reset")
      result = await store.client.auth.resetPasswordForEmail(email, {
        redirectTo: redirect,
      });
    else if (mode === "recovery")
      result = await store.client.auth.updateUser({ password });
    else
      result = await store.client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (mode === "reset" || (mode === "signup" && !result.data.session)) {
      $("auth-message").classList.add("success");
      $("auth-message").textContent =
        mode === "reset"
          ? "If an account exists for that email, a reset link is on its way."
          : "Check your email to confirm your account, then sign in.";
    } else {
      $("auth-dialog").close();
      if (mode === "recovery") toast("Password updated.");
      if (result.data?.user) await store.account(result.data.user);
      openProfiles();
    }
  } catch (error) {
    $("auth-message").textContent =
      error.message || "That didn’t work. Please try again.";
  } finally {
    button.disabled = false;
  }
}
function openProfiles(managing = false) {
  state.managing = managing;
  state.profileEdit = null;
  const dialog = $("profiles-dialog");
  dialog.innerHTML = `${store.profile ? `<button class="icon-button dialog-close" data-action="close-profiles" aria-label="Close profiles">${icon("close")}</button>` : ""}<p class="eyebrow">A SPACE FOR EVERY TASTE</p><h2 id="profiles-title">${managing ? "Make it your own." : "Who’s watching?"}</h2><p class="auth-subtitle">${managing ? "Give everyone their own little corner." : "Different people. Different favorites."}</p><div class="profile-grid">${store.profiles.map((p) => `<button class="profile-tile ${p.id === store.profile?.id ? "active" : ""}" data-action="${managing ? "edit-profile" : "select-profile"}" data-profile="${p.id}"><span class="avatar face ${esc(p.color)}" aria-hidden="true">${esc(p.name.slice(0, 1))}</span><span>${esc(p.name)}${managing ? " ✎" : ""}</span></button>`).join("")}${store.profiles.length < 5 ? '<button class="profile-tile add" data-action="add-profile"><span class="avatar" aria-hidden="true">+</span><span>Add profile</span></button>' : ""}</div><p class="form-message" id="profile-message" role="status"></p><button class="button outline" data-action="manage-profiles">${managing ? "Done" : "Manage profiles"}</button><p class="profile-meta">${store.user ? "Your profiles sync across your devices." : "Guest profiles are saved on this device."}</p><div class="account-menu">${store.user ? '<button class="form-link" data-action="signout">Sign out</button>' : '<button class="form-link" data-action="profile-signin">Sign in to sync your profiles</button>'}<button class="form-link" data-action="sync" data-sync>${statusText()}</button></div>`;
  show(dialog);
}
function editProfile(profile) {
  state.profileEdit = profile || null;
  let color = profile?.color || colors[store.profiles.length % colors.length];
  $("profiles-dialog").innerHTML =
    `<button class="icon-button dialog-close" data-action="profiles" aria-label="Back to profiles">${icon("close")}</button><p class="eyebrow">YOUR OWN LITTLE CORNER</p><h2 id="profiles-title">${profile ? "Edit profile" : "Meet your profile."}</h2><form id="profile-form" class="profile-form"><label class="field"><span>Profile name</span><input name="name" placeholder="What should we call you?" value="${esc(profile?.name || "")}" maxlength="24" required autocomplete="off"></label><div class="color-options" role="group" aria-label="Avatar color">${colors.map((c) => `<button type="button" class="avatar color-swatch ${c} ${c === color ? "selected" : ""}" data-color="${c}" aria-label="${c}" aria-pressed="${c === color}">${icon("check")}</button>`).join("")}</div><p class="form-message" id="profile-message" role="status"></p><div class="profile-form-buttons"><button type="button" class="button outline" data-action="profiles">Cancel</button><button type="submit" class="button primary">Save profile</button></div>${profile && store.profiles.length > 1 ? '<button type="button" class="form-link danger" data-action="delete-profile" style="margin:20px auto 0">Delete profile</button>' : ""}</form>`;
  $("profile-form")
    .querySelectorAll("[data-color]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          color = b.dataset.color;
          document.querySelectorAll("[data-color]").forEach((el) => {
            el.classList.toggle("selected", el === b);
            el.setAttribute("aria-pressed", el === b);
          });
        }),
    );
  $("profile-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const p = await store.saveProfile(
        new FormData(event.currentTarget).get("name"),
        color,
        profile?.id,
      );
      if (!store.profile) await store.select(p);
      openProfiles();
    } catch (error) {
      $("profile-message").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function runSearch() {
  const query = $("search-input").value.trim();
  if (!query) {
    state.searchAbort?.abort();
    await renderPage();
    return;
  }
  const ticket = ++state.request;
  state.searchAbort?.abort();
  state.searchAbort = new AbortController();
  $("page-content").innerHTML =
    '<div class="loading-page"><span class="spinner"></span>Searching…</div>';
  try {
    const data = await api(
      "/search/multi",
      { query, include_adult: false },
      AbortSignal.any([state.searchAbort.signal, AbortSignal.timeout(12000)]),
    );
    if (ticket !== state.request) return;
    const items = usable(data.results).map((i) => normalize(i));
    remember(items);
    $("page-content").innerHTML =
      `<div class="page-title"><h1>Results for “${esc(query)}”</h1><p>${items.length} titles to explore</p></div>${items.length ? `<div class="grid">${items.map((i) => card(i)).join("")}</div>` : empty("Nothing here just yet", "Try a different title or check the spelling.", "search")}`;
  } catch (error) {
    if (ticket === state.request && error.name !== "AbortError")
      $("page-content").innerHTML = empty(
        "Search couldn’t load",
        "Please try your search again.",
        "search",
      );
  }
}
function closeSearch() {
  clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  $("search-input").value = "";
  $("search-bar").hidden = true;
  renderPage();
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action], [data-page]");
  if (!button) return;
  if (button.dataset.page) {
    state.page = button.dataset.page;
    state.genre = 0;
    state.hero = 0;
    state.rows = [];
    closeSearch();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const action = button.dataset.action,
    item = state.items.get(button.dataset.key);
  try {
    if (action === "details" && item) openDetails(item);
    else if (action === "play" && item) openPlayer(item);
    else if (action === "episode" && item)
      openPlayer(
        item,
        Number(button.dataset.season),
        Number(button.dataset.episode),
      );
    else if (action === "close-details") {
      $("details-dialog").close();
      state.detailRequest++;
    } else if (action === "close-player") closePlayer();
    else if (action === "next-episode") nextEpisode();
    else if (action === "hero") {
      state.hero = Number(button.dataset.index);
      $("hero-slot").innerHTML = heroMarkup();
    } else if (action === "genre") loadGenre(Number(button.dataset.genre));
    else if (action === "row-left" || action === "row-right") {
      const row = button.closest("section").querySelector(".title-row");
      row.scrollBy({
        left: row.clientWidth * 0.85 * (action === "row-left" ? -1 : 1),
        behavior: "smooth",
      });
    } else if (
      ["list", "like", "dislike", "remove-continue"].includes(action) &&
      item
    ) {
      if (!requireProfile()) return;
      const r = store.get(item);
      store.update(
        item,
        action === "list"
          ? { in_list: !r?.in_list }
          : action === "remove-continue"
            ? { started_at: null }
            : {
                rating:
                  r?.rating === (action === "like" ? 1 : -1)
                    ? 0
                    : action === "like"
                      ? 1
                      : -1,
              },
      );
      detailActions();
      refreshPersonal();
      toast(
        action === "list"
          ? r?.in_list
            ? "Removed from My list"
            : "Added to My list"
          : action === "remove-continue"
            ? "Removed from Continue Watching"
            : "Your picks are getting to know you.",
      );
    } else if (action === "player-like" && state.player) {
      const r = store.get(state.player.item);
      store.update(state.player.item, { rating: r?.rating === 1 ? 0 : 1 });
      toast(
        r?.rating === 1 ? "Like removed" : "More like this, coming your way.",
      );
    } else if (["signup", "signin"].includes(action)) openAuth(action);
    else if (action === "auth-reset") openAuth("reset");
    else if (action === "close-auth" || action === "guest")
      $("auth-dialog").close();
    else if (action === "profiles") openProfiles();
    else if (action === "profile-signin") {
      $("profiles-dialog").close();
      openAuth();
    } else if (action === "close-profiles") $("profiles-dialog").close();
    else if (action === "add-profile") editProfile();
    else if (action === "edit-profile")
      editProfile(store.profiles.find((p) => p.id === button.dataset.profile));
    else if (action === "manage-profiles") openProfiles(!state.managing);
    else if (action === "select-profile") {
      button.disabled = true;
      const profile = store.profiles.find(
        (p) => p.id === button.dataset.profile,
      );
      await store.select(profile);
      $("profiles-dialog").close();
      state.rows = [];
      renderPage();
      toast(`Enjoy the show, ${profile.name}.`);
    } else if (action === "delete-profile") {
      if (button.dataset.confirm !== "yes") {
        button.dataset.confirm = "yes";
        button.textContent =
          "Delete this profile and its history? Click to confirm.";
        return;
      }
      await store.deleteProfile(state.profileEdit.id);
      openProfiles(true);
      renderPage();
    } else if (action === "sync") {
      if (store.user && !store.profile) await store.account(store.user, true);
      else await store.flush();
      if (store.status === "error")
        toast("Still unable to sync. Your changes are saved on this device.");
    } else if (action === "signout") {
      await store.signOut();
      $("profiles-dialog").close();
      toast("Signed out.");
    } else if (action === "retry") renderPage({ reload: true });
  } catch (error) {
    toast(error.message || "Something went wrong. Please try again.");
    button.disabled = false;
  }
});
$("account-button").onclick = () => (store.user ? openProfiles() : openAuth());
$("search-toggle").innerHTML = icon("search");
$("search-toggle").onclick = () => {
  $("search-bar").hidden = false;
  $("search-input").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
};
$("search-close").onclick = closeSearch;
$("search-input").oninput = () => {
  clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  state.request++;
  state.searchTimer = setTimeout(runSearch, 300);
};
$("player-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closePlayer();
});
$("details-dialog").addEventListener("close", () => state.detailRequest++);
$("profiles-dialog").addEventListener("cancel", (event) => {
  if (!store.profile) event.preventDefault();
});
for (const id of ["auth-dialog", "details-dialog"])
  $(id).addEventListener("click", (event) => {
    const r = $(id).getBoundingClientRect();
    if (
      event.target === $(id) &&
      (event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom)
    )
      $(id).close();
  });
document.querySelectorAll(".brand").forEach((a) =>
  a.addEventListener("click", (event) => {
    event.preventDefault();
    state.page = "home";
    state.genre = 0;
    state.rows = [];
    state.hero = 0;
    closeSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) savePlayback(true);
});
window.addEventListener("pagehide", () => savePlayback(true));
window.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !document.querySelector("dialog[open]") &&
    !$("search-bar").hidden
  )
    closeSearch();
});
async function boot() {
  updateAccount();
  const genres = api("/genre/movie/list")
    .then((data) => (state.genres = data.genres))
    .catch(() => {});
  store.init().catch(() => {
    toast("Account sync couldn’t load. Please try again shortly.");
    if (store.user) openProfiles();
  });
  await genres;
  await renderPage({ reload: true });
}
boot();
