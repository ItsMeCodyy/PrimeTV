/* ── CONFIG ──────────────────────────────────── */
const TMDB_KEY = 'd9f0568167a608d0700093444b0c2da7';
const TMDB     = 'https://api.themoviedb.org/3';
const IMG      = 'https://image.tmdb.org/t/p';
const CINESRC  = 'https://cinesrc.st/embed';

/* ── STATE ───────────────────────────────────── */
const S = {
  movieGenres: [], tvGenres: [],
  queue: [], qIdx: 0, loading: false,
  heroItems: [], hIdx: 0, hTimer: null, hRaf: null,
  sentinel: null, searchTimer: null,
  catalog: new Map(), discoverItems: [], discoverIndex: 0, dragX: 0,
};

function readStore(key, fallback = []) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
function itemKey(id, type) { return `${type}:${id}`; }
function rememberItem(item, type) {
  if (item?.id) S.catalog.set(itemKey(item.id, type), { ...item, _t: type });
}

/* ════════════════════════════════════════════════
   SMOOTH SCROLL  ── THE ONLY CORRECT WAY

   Root cause of old spazzing:
   When the cursor was over a .row-t element, isLocal() returned true
   and we skipped preventDefault(). The browser then scrolled the page
   natively, changing window.scrollY. But our `pos` and `dest` variables
   stayed at the old value. When the cursor left the row, our code
   kicked back in, smoothly animating from the OLD pos to OLD dest+delta,
   making the page visually jump back.

   Fix: At the start of every wheel event, if we're not mid-animation,
   sync cur = tgt = window.scrollY so we start from where the page
   actually is — not where our stale variables think it is.

   Also: removed .row-t from the native-scroll bypass — vertical scroll
   over rows should still smoothly scroll the page (rows use arrows).
════════════════════════════════════════════════ */
function initScroll() {
  let cur = 0;  // current animated position
  let tgt = 0;  // destination position
  let raf = 0;  // RAF handle (0 = idle)

  function loop() {
    cur += (tgt - cur) * 0.092;
    const settled = Math.abs(tgt - cur) < 0.5;
    if (settled) cur = tgt;
    window.scrollTo({ top: cur, behavior: 'instant' });
    raf = settled ? 0 : requestAnimationFrame(loop);
  }

  window.addEventListener('wheel', e => {
    /* let horizontal trackpad swipes pass through */
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

    /* let modal / overlay elements scroll natively */
    const el = e.target;
    if (el?.closest?.('.mbox, .soverlay, .epgrid, .cast-scroll')) return;

    e.preventDefault();

    /* ✅ SYNC FIX: if idle, always start from actual page position.
       Handles the case where the browser native-scrolled the page
       (e.g. while hovering over a row) and our cur/tgt went stale. */
    if (!raf) {
      cur = window.scrollY;
      tgt = window.scrollY;
    }

    const d = e.deltaMode === 1 ? e.deltaY * 32
            : e.deltaMode === 2 ? e.deltaY * 300
            : e.deltaY;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    tgt = Math.max(0, Math.min(tgt + d, maxY));
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: false });

  /* scroll event: UI only — NEVER touch cur or tgt */
  window.addEventListener('scroll', () => {
    const sy   = window.scrollY;
    const maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

    /* progress bar */
    const prog = document.getElementById('scroll-prog');
    if (prog) prog.style.width = (sy / maxY * 100) + '%';

    /* nav state */
    document.getElementById('nav')?.classList.toggle('scrolled', sy > 66);

    /* hero parallax */
    const slides = document.getElementById('hslides');
    if (slides && sy < window.innerHeight * 1.5)
      slides.style.transform = `translateY(${sy * 0.28}px)`;
  }, { passive: true });
}

/* ════════════════════════════════════════════════
   TMDB API
════════════════════════════════════════════════ */
async function api(path, params = {}) {
  const url = new URL(TMDB + path);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

async function fetchGenres() {
  const [m, t] = await Promise.all([api('/genre/movie/list'), api('/genre/tv/list')]);
  S.movieGenres = m.genres;
  S.tvGenres    = t.genres;
}

/* ════════════════════════════════════════════════
   HERO — Ken Burns, crossfade, progress ring
════════════════════════════════════════════════ */
const HERO_MS = 8000;

async function loadHero() {
  const d = await api('/trending/all/week');
  S.heroItems = d.results.filter(i => i.backdrop_path && i.overview).slice(0, 7);
  S.heroItems.forEach(i => rememberItem(i, i.media_type || (i.title ? 'movie' : 'tv')));
  if (!S.heroItems.length) return;

  const wrap = document.getElementById('hslides');
  S.heroItems.forEach(item => {
    const s = document.createElement('div');
    s.className = 'hslide';
    s.style.backgroundImage = `url(${IMG}/original${item.backdrop_path})`;
    wrap.appendChild(s);
  });

  buildHeroDots();
  goHero(0);
  startHeroTimer();
}

function buildHeroDots() {
  const el = document.getElementById('hdots');
  el.innerHTML = '';
  S.heroItems.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'hdot' + (i === 0 ? ' on' : '');
    d.onclick = () => { stopHeroTimer(); goHero(i); startHeroTimer(); };
    el.appendChild(d);
  });
}

function goHero(idx) {
  S.hIdx = idx;
  const item = S.heroItems[idx];
  const type   = item.media_type || (item.title ? 'movie' : 'tv');
  const rating = item.vote_average?.toFixed(1) || '?';
  const year   = (item.release_date || item.first_air_date || '').slice(0, 4);

  document.querySelectorAll('.hslide').forEach((s, i) => {
    if (i === idx) { s.classList.remove('on'); void s.offsetWidth; s.classList.add('on'); }
    else s.classList.remove('on');
  });

  const titleEl = document.getElementById('htitle');
  const descEl  = document.getElementById('hdesc');
  titleEl.style.opacity = '0'; descEl.style.opacity = '0';
  setTimeout(() => {
    document.getElementById('hchips').innerHTML = `
      <div class="hchip">${type === 'tv' ? '📺 TV Show' : '🎬 Movie'}</div>
      ${year ? `<div class="hchip">${year}</div>` : ''}
      <div class="hchip gold">★ ${rating}</div>`;
    titleEl.textContent = item.title || item.name;
    descEl.textContent  = item.overview;
    titleEl.style.opacity = '1'; descEl.style.opacity = '1';
  }, 280);

  document.getElementById('hplay').onclick = () => openPlayer(item.id, type);
  document.getElementById('hinfo').onclick = () => openModal(item, type);
  document.querySelectorAll('.hdot').forEach((d, i) => d.classList.toggle('on', i === idx));
  resetHeroProgress();
}

function startHeroTimer() { stopHeroTimer(); S.hTimer = setInterval(() => goHero((S.hIdx + 1) % S.heroItems.length), HERO_MS); }
function stopHeroTimer()  { clearInterval(S.hTimer); cancelAnimationFrame(S.hRaf); S.hRaf = null; }

function resetHeroProgress() {
  const fill = document.getElementById('hpfill');
  fill.style.transition = 'none'; fill.style.width = '0%';
  cancelAnimationFrame(S.hRaf);
  const t0 = performance.now();
  const step = now => {
    fill.style.width = Math.min(100, (now - t0) / HERO_MS * 100) + '%';
    if (now - t0 < HERO_MS) S.hRaf = requestAnimationFrame(step);
  };
  S.hRaf = requestAnimationFrame(step);
}

/* ════════════════════════════════════════════════
   FEATURED 3-CARD GRID  (top of #main)
════════════════════════════════════════════════ */
async function loadFeatured() {
  try {
    const d = await api('/trending/all/week');
    const items = d.results
      .filter(i => i.backdrop_path && i.overview)
      .slice(1, 4)          /* skip [0] — that's already in the hero */
      .map(i => ({ ...i, _t: i.media_type || (i.title ? 'movie' : 'tv') }));
    if (items.length < 2) return;

    const sec = document.createElement('section');
    sec.className = 'feat-section rs';
    sec.innerHTML = `
      <div class="feat-head rs-head">
        <span class="rs-bar"></span>
        <h2 class="rs-title">Featured This Week</h2>
      </div>`;

    const grid = document.createElement('div');
    grid.className = 'feat-grid';

    items.forEach((item, i) => {
      rememberItem(item, item._t);
      const src  = `${IMG}/w1280${item.backdrop_path}`;
      const t    = item._t;
      const name = item.title || item.name || '';
      const rating = item.vote_average?.toFixed(1) || '?';
      const year   = (item.release_date || item.first_air_date || '').slice(0, 4);
      const rc     = ratingClass(item.vote_average);

      const card = document.createElement('div');
      card.className = 'feat-card' + (i === 0 ? ' main' : '');
      card.innerHTML = `
        <img src="${src}" alt="${esc(name)}" loading="lazy">
        <div class="feat-card-grad"></div>
        <div class="feat-card-body">
          <div class="feat-card-label">${t === 'tv' ? 'TV Show' : 'Movie'}</div>
          <div class="feat-card-title">${esc(name)}</div>
          <div class="feat-card-meta">
            <span class="${rc}">${rc === 'green' ? '★' : rc === 'gold-c' ? '★' : '★'} ${rating}</span>
            ${year ? `<span>${year}</span>` : ''}
          </div>
          ${i === 0 ? `
          <div class="feat-card-btns">
            <button class="btn-s fp-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Play</button>
            <button class="btn-o fi-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>Info</button>
          </div>` : ''}
        </div>`;

      card.addEventListener('click', () => openModal(item, t));
      card.querySelector?.('.fp-btn')?.addEventListener('click', e => { e.stopPropagation(); openPlayer(item.id, t); });
      card.querySelector?.('.fi-btn')?.addEventListener('click', e => { e.stopPropagation(); openModal(item, t); });
      grid.appendChild(card);
    });

    sec.appendChild(grid);
    const main = document.getElementById('main');
    main.insertBefore(sec, main.firstChild);
  } catch (e) { /* featured is optional */ }
}

/* ════════════════════════════════════════════════
   RATING HELPERS
════════════════════════════════════════════════ */
function ratingClass(r) {
  if (!r) return '';
  if (r >= 7.5) return 'green';
  if (r >= 6)   return 'gold-c';
  return '';
}

function ratingColor(r) {
  if (!r) return 'var(--t2)';
  if (r >= 7.5) return 'var(--green)';
  if (r >= 6)   return 'var(--gold)';
  return 'var(--t2)';
}

/* ════════════════════════════════════════════════
   SECTION QUEUE
════════════════════════════════════════════════ */
function buildQueue() {
  const q = [];
  const add = (label, fn, wide = false) => q.push({ label, fn, wide });

  add('Trending This Week',  () => api('/trending/all/week')   .then(d => typed(d.results)),        true);
  add('Trending Movies',     () => api('/trending/movie/week') .then(d => typed(d.results,'movie')), true);
  add('Trending TV Shows',   () => api('/trending/tv/week')    .then(d => typed(d.results,'tv')),    true);
  add('Top Rated Movies',    () => api('/movie/top_rated')     .then(d => typed(d.results,'movie')));
  add('Top Rated TV Shows',  () => api('/tv/top_rated')        .then(d => typed(d.results,'tv')));
  add('Popular Movies',      () => api('/movie/popular')       .then(d => typed(d.results,'movie')));
  add('Popular TV Shows',    () => api('/tv/popular')          .then(d => typed(d.results,'tv')));
  add('Now Playing',         () => api('/movie/now_playing')   .then(d => typed(d.results,'movie')));
  add('Airing Today',        () => api('/tv/airing_today')     .then(d => typed(d.results,'tv')));
  add('On The Air',          () => api('/tv/on_the_air')       .then(d => typed(d.results,'tv')));
  add('Upcoming Movies',     () => api('/movie/upcoming')      .then(d => typed(d.results,'movie')));

  const max = Math.max(S.movieGenres.length, S.tvGenres.length);
  for (let i = 0; i < max; i++) {
    if (S.movieGenres[i]) {
      const g = S.movieGenres[i];
      add(g.name + ' Movies', () =>
        api('/discover/movie', { with_genres: g.id, sort_by: 'popularity.desc' }).then(d => typed(d.results,'movie')));
    }
    if (S.tvGenres[i]) {
      const g = S.tvGenres[i];
      add(g.name + ' Shows', () =>
        api('/discover/tv', { with_genres: g.id, sort_by: 'popularity.desc' }).then(d => typed(d.results,'tv')));
    }
  }
  S.queue = q;
}

function typed(items, type) {
  return items
    .filter(i => i.poster_path || i.backdrop_path)
    .map(i => ({ ...i, _t: type || i.media_type || (i.title ? 'movie' : 'tv') }));
}

/* ════════════════════════════════════════════════
   SECTION LOADING
════════════════════════════════════════════════ */
async function loadSections(n = 3) {
  if (S.loading || S.qIdx >= S.queue.length) return;
  S.loading = true;

  const main = document.getElementById('main');
  const sent = S.sentinel;
  const batch = [];

  for (let i = 0; i < n && S.qIdx < S.queue.length; i++, S.qIdx++) {
    const entry = S.queue[S.qIdx];
    const el    = makeSkel(entry.label, entry.wide);
    main.insertBefore(el, sent);
    batch.push({ entry, el });
  }

  batch.forEach(({ entry, el }) => {
    entry.fn()
      .then(items => fillRow(el, items.slice(0, 20), entry.wide))
      .catch(() => el.style.display = 'none');
  });

  await sleep(60);
  S.loading = false;
}

function makeSkel(label, wide = false) {
  const n    = wide ? 8 : 12;
  const skel = Array(n).fill(wide ? '<div class="skelw"></div>' : '<div class="skel"></div>').join('');
  const s    = document.createElement('div');
  s.className = 'rs';
  s.innerHTML = `
    <div class="rs-head">
      <span class="rs-bar"></span>
      <h2 class="rs-title">${esc(label)}</h2>
    </div>
    <div class="row-o"><div class="row-t">${skel}</div></div>`;
  return s;
}

function fillRow(sec, items, wide = false) {
  if (!items.length) { sec.style.display = 'none'; return; }
  const track = sec.querySelector('.row-t');
  track.innerHTML = '';
  items.forEach((item, idx) => {
    const card = wide ? makeBCard(item, item._t, idx) : makeCard(item, item._t, idx);
    track.appendChild(card);
  });
  sec.querySelector('.rs-head').innerHTML = `
    <span class="rs-bar"></span>
    <h2 class="rs-title">${esc(sec.querySelector('.rs-title')?.textContent || '')}</h2>
    <span class="rs-count">${items.length} titles</span>`;
  addArrows(sec.querySelector('.row-o'), track);
}

function addArrows(outer, track) {
  ['L','R'].forEach(dir => {
    const b = document.createElement('button');
    b.className = dir === 'R' ? 'rarr r' : 'rarr';
    b.innerHTML = dir === 'L' ? '&#8249;' : '&#8250;';
    b.setAttribute('aria-label', dir === 'L' ? 'Previous' : 'Next');
    b.onclick = () => track.scrollBy({ left: dir === 'L' ? -640 : 640, behavior: 'smooth' });
    dir === 'L' ? outer.insertBefore(b, outer.firstChild) : outer.appendChild(b);
  });
}

/* ════════════════════════════════════════════════
   PORTRAIT CARD  +  3D tilt  +  cursor shine
════════════════════════════════════════════════ */
function makeCard(item, type, idx = 0) {
  rememberItem(item, type);
  const title  = item.title || item.name || '';
  const year   = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.vote_average?.toFixed(1) || '';
  const rc     = ratingColor(item.vote_average);
  const isTop  = idx < 10;

  const c = document.createElement('div');
  c.className = 'card card-enter';
  c.style.animationDelay = Math.min(idx * 0.032, 0.5) + 's';
  c.innerHTML = `
    <img class="card-img" src="${IMG}/w342${item.poster_path || ''}" alt="${esc(title)}" loading="lazy">
    ${isTop ? `<div class="card-rank">${idx + 1}</div>` : ''}
    ${rating ? `<div class="card-badge" style="color:${rc}">★ ${rating}</div>` : ''}
    <div class="card-panel">
      <div class="cpr">
        <div class="cpt">${esc(title)}</div>
        <button class="cpb" aria-label="Play"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
      </div>
      <div class="cpm">
        ${rating ? `<span class="cps" style="color:${rc}">★ ${rating}</span>` : ''}
        ${year ? `<span>${year}</span>` : ''}
        <span class="cpty">${type === 'tv' ? 'TV' : 'Film'}</span>
      </div>
    </div>`;

  attachCardEvents(c, item, type);
  return c;
}

/* ════════════════════════════════════════════════
   BILLBOARD CARD (landscape 16:9)
════════════════════════════════════════════════ */
function makeBCard(item, type, idx = 0) {
  rememberItem(item, type);
  const title  = item.title || item.name || '';
  const year   = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.vote_average?.toFixed(1) || '';
  const rc     = ratingColor(item.vote_average);
  const src    = item.backdrop_path
    ? `${IMG}/w780${item.backdrop_path}`
    : `${IMG}/w342${item.poster_path}`;

  const c = document.createElement('div');
  c.className = 'bcard card-enter';
  c.style.animationDelay = Math.min(idx * 0.038, 0.55) + 's';
  c.innerHTML = `
    <img class="bcard-img" src="${src}" alt="${esc(title)}" loading="lazy">
    <div class="bcard-grad"></div>
    <div class="bcard-body">
      <div class="bcard-title">${esc(title)}</div>
      <div class="bcard-meta">
        ${rating ? `<span class="bcard-star" style="color:${rc}">★ ${rating}</span>` : ''}
        ${year ? `<span>${year}</span>` : ''}
        <span class="bcard-type">${type === 'tv' ? 'TV' : 'Film'}</span>
      </div>
    </div>
    <button class="bcard-play" aria-label="Play"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>`;

  c.querySelector('.bcard-play').addEventListener('click', e => { e.stopPropagation(); openPlayer(item.id, type); });
  c.addEventListener('click', () => openModal(item, type));
  c.addEventListener('mousemove', e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', ((e.clientX - r.left) / r.width  * 100) + '%');
    c.style.setProperty('--my', ((e.clientY - r.top)  / r.height * 100) + '%');
  });
  c.addEventListener('mouseenter', () => Popup.show(c, item, type));
  c.addEventListener('mouseleave', e => {
    if (!e.relatedTarget || !document.getElementById('cpop').contains(e.relatedTarget)) Popup.cancel();
  });
  return c;
}

/* shared portrait card interactions */
function attachCardEvents(card, item, type) {
  const badge = card.querySelector('.card-badge');
  const panel = card.querySelector('.card-panel');
  const img   = card.querySelector('.card-img');

  card.querySelector('.cpb').addEventListener('click', e => { e.stopPropagation(); openPlayer(item.id, type); });
  card.addEventListener('click', () => openModal(item, type));

  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', ((e.clientX - r.left) / r.width  * 100) + '%');
    card.style.setProperty('--my', ((e.clientY - r.top)  / r.height * 100) + '%');
    const nx = (e.clientX - r.left) / r.width  - 0.5;
    const ny = (e.clientY - r.top)  / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateX(${-ny * 10}deg) rotateY(${nx * 10}deg) scale(1.07) translateZ(10px)`;
  });

  card.addEventListener('mouseenter', () => {
    if (badge) badge.style.opacity = '1';
    if (panel) panel.style.transform = 'translateY(0)';
    if (img)   img.style.filter     = 'brightness(0.68) contrast(1.05)';
    card.style.boxShadow   = '0 32px 88px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.1)';
    card.style.borderColor = 'rgba(255,255,255,0.12)';
    card.style.zIndex      = '10';
    Popup.show(card, item, type);
  });

  card.addEventListener('mouseleave', e => {
    if (e.relatedTarget && document.getElementById('cpop').contains(e.relatedTarget)) return;
    if (badge) badge.style.opacity   = '0';
    if (panel) panel.style.transform = 'translateY(100%)';
    if (img)   img.style.filter      = '';
    card.style.transform   = '';
    card.style.boxShadow   = '';
    card.style.borderColor = '';
    card.style.zIndex      = '';
    Popup.cancel();
  });
}

/* ════════════════════════════════════════════════
   CARD POPUP  —  portal element, no z-index clip
════════════════════════════════════════════════ */
const Popup = (() => {
  const el   = document.getElementById('cpop');
  let showT  = null;
  let hideT  = null;

  el.addEventListener('mouseenter', () => clearTimeout(hideT));
  el.addEventListener('mouseleave', () => schedHide());

  function show(card, item, type) { clearTimeout(hideT); clearTimeout(showT); showT = setTimeout(() => render(card, item, type), 360); }
  function cancel() { clearTimeout(showT); schedHide(); }
  function schedHide() { hideT = setTimeout(hide, 230); }
  function hide() { el.classList.remove('on'); }

  function render(card, item, type) {
    const W    = 302;
    const rect = card.getBoundingClientRect();
    let left   = rect.left + rect.width / 2 - W / 2;
    let top    = rect.bottom + window.scrollY + 12;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    if (rect.bottom + 360 > window.innerHeight) top = rect.top + window.scrollY - 370 - 8;

    el.style.left = left + 'px';
    el.style.top  = top  + 'px';

    const title  = item.title || item.name || '';
    const rating = item.vote_average?.toFixed(1) || '';
    const year   = (item.release_date || item.first_air_date || '').slice(0, 4);
    const imgSrc = item.backdrop_path ? `${IMG}/w500${item.backdrop_path}` : `${IMG}/w342${item.poster_path}`;
    const rc     = item.vote_average >= 7.5 ? 'g' : item.vote_average >= 6 ? 'gold' : '';

    document.getElementById('cpop-img').src = imgSrc;
    document.getElementById('cpop-title').textContent = title;
    document.getElementById('cpop-desc').textContent  = (item.overview || '').slice(0, 120) + ((item.overview?.length || 0) > 120 ? '…' : '');
    document.getElementById('cpop-tags').innerHTML = `
      ${rating ? `<span class="ctag ${rc}">★ ${rating}</span>` : ''}
      ${year ? `<span class="ctag">${year}</span>` : ''}
      <span class="ctag">${type === 'tv' ? 'TV Show' : 'Movie'}</span>`;

    document.getElementById('cpop-play').onclick = () => { hide(); openPlayer(item.id, type); };
    document.getElementById('cpop-info').onclick = () => { hide(); openModal(item, type); };
    el.classList.add('on');
  }

  return { show, cancel, hide };
})();

/* ════════════════════════════════════════════════
   INFINITE SCROLL
════════════════════════════════════════════════ */
function initInfiniteScroll() {
  const main = document.getElementById('main');
  const sent = document.createElement('div');
  sent.className = 'sentinel';
  main.appendChild(sent);
  S.sentinel = sent;

  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadSections(3);
  }, { rootMargin: '800px' }).observe(sent);
}

/* ════════════════════════════════════════════════
   MODAL
════════════════════════════════════════════════ */
async function openModal(item, type) {
  Popup.hide();
  const title  = item.title || item.name || '';
  const year   = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.vote_average?.toFixed(1) || '';
  const rc     = item.vote_average >= 7.5 ? 'g' : '';
  const imgSrc = item.backdrop_path ? `${IMG}/w1280${item.backdrop_path}` : `${IMG}/w500${item.poster_path}`;

  document.getElementById('mimg').src = imgSrc;
  document.getElementById('mtitle').textContent    = title;
  document.getElementById('moverview').textContent = item.overview || 'No description available.';
  document.getElementById('mtags').innerHTML = `
    ${rating ? `<span class="mtag s ${rc}" style="${rc ? 'background:rgba(74,222,128,0.08);border-color:rgba(74,222,128,0.22);color:var(--green)' : ''}">★ ${rating}</span>` : ''}
    ${year ? `<span class="mtag">${year}</span>` : ''}
    <span class="mtag">${type === 'tv' ? 'TV Show' : 'Movie'}</span>`;

  document.getElementById('mplay').onclick = () => { closeModal(); openPlayer(item.id, type); };

  const castEl = document.getElementById('mcast');
  castEl.style.display = 'none'; castEl.innerHTML = '';

  const meps = document.getElementById('meps');
  if (type === 'tv') {
    meps.style.display = 'block';
    document.getElementById('stabs').innerHTML  = '<div class="spin"></div>';
    document.getElementById('epgrid').innerHTML = '';
    loadSeasons(item.id);
  } else {
    meps.style.display = 'none';
  }

  document.getElementById('moverlay').classList.add('on');
  document.getElementById('mbox').scrollTop = 0;
  document.body.style.overflow = 'hidden';

  /* load cast in background */
  try {
    const credits = await api(`/${type}/${item.id}/credits`);
    const cast    = (credits.cast || []).filter(c => c.profile_path).slice(0, 12);
    if (cast.length) {
      castEl.style.display = 'block';
      castEl.innerHTML = `
        <p class="sec-label">Cast</p>
        <div class="cast-scroll">
          ${cast.map(c => `
            <div class="cast-item">
              <img src="${IMG}/w92${c.profile_path}" alt="${esc(c.name)}" loading="lazy">
              <span>${esc(c.name)}</span>
            </div>`).join('')}
        </div>`;
    }
  } catch { /* optional */ }
}

function closeModal() {
  document.getElementById('moverlay').classList.remove('on');
  document.body.style.overflow = '';
}
document.getElementById('moverlay').addEventListener('click', e => { if (e.target === document.getElementById('moverlay')) closeModal(); });
document.getElementById('mclose').addEventListener('click', closeModal);

/* ════════════════════════════════════════════════
   TV SEASONS + EPISODES
════════════════════════════════════════════════ */
async function loadSeasons(id) {
  try {
    const d = await api(`/tv/${id}`);
    const seasons = d.seasons.filter(s => s.season_number > 0);
    const tabs = document.getElementById('stabs');
    tabs.innerHTML = '';
    seasons.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'stab' + (i === 0 ? ' on' : '');
      btn.textContent = `S${s.season_number}`;
      btn.onclick = () => {
        tabs.querySelectorAll('.stab').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        loadEps(id, s.season_number);
      };
      tabs.appendChild(btn);
    });
    if (seasons.length) loadEps(id, seasons[0].season_number);
  } catch {
    document.getElementById('stabs').innerHTML = '<p style="color:var(--t3);font-size:13px">Failed to load seasons</p>';
  }
}

async function loadEps(tvId, season) {
  const grid = document.getElementById('epgrid');
  grid.innerHTML = '<div class="spin"></div>';
  try {
    const d = await api(`/tv/${tvId}/season/${season}`);
    grid.innerHTML = '';
    d.episodes.forEach(ep => {
      const c = document.createElement('div');
      c.className = 'epc';
      c.innerHTML = `
        <div class="epn">${ep.episode_number}</div>
        <div class="epi">
          <h5>${esc(ep.name || `Episode ${ep.episode_number}`)}</h5>
          <span>${ep.runtime ? ep.runtime + ' min' : `S${season} · E${ep.episode_number}`}</span>
        </div>`;
      c.onclick = () => { closeModal(); openPlayer(tvId, 'tv', season, ep.episode_number); };
      grid.appendChild(c);
    });
  } catch {
    grid.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:8px">Failed to load</p>';
  }
}

/* ════════════════════════════════════════════════
   PLAYER
════════════════════════════════════════════════ */
function openPlayer(id, type, season = 1, ep = 1) {
  Popup.hide();
  const known = S.catalog.get(itemKey(id, type));
  if (known) {
    const history = readStore('primetv:continue');
    const entry = { ...known, _t: type, season, episode: ep, watchedAt: Date.now(), progress: 8 };
    writeStore('primetv:continue', [entry, ...history.filter(x => !(x.id === id && x._t === type))].slice(0, 20));
    refreshPersonalRows();
  }
  const src = type === 'tv'
    ? `${CINESRC}/tv/${id}?s=${season}&e=${ep}&back=close&autonext=true`
    : `${CINESRC}/movie/${id}?back=close`;
  document.getElementById('piframe').src = src;
  document.getElementById('pwrap').classList.add('on');
  document.body.style.overflow = 'hidden';
  toast('Loading player…');
}
function closePlayer() {
  document.getElementById('pwrap').classList.remove('on');
  document.getElementById('piframe').src = '';
  document.body.style.overflow = '';
}
document.getElementById('pclose').addEventListener('click', closePlayer);
window.addEventListener('message', e => {
  if (e.origin !== 'https://cinesrc.st') return;
  if (e.data?.type === 'cinesrc:close') closePlayer();
});

/* Personalized discovery, favorites, continue watching, and random picks */
function refreshPersonalRows() {
  document.querySelectorAll('.personal-row').forEach(el => el.remove());
  const main = document.getElementById('main');
  const rows = [
    ['Continue Watching', readStore('primetv:continue')],
    ['My Favorites', readStore('primetv:favorites')],
  ];
  let anchor = main.firstChild;
  rows.reverse().forEach(([label, items]) => {
    if (!items.length) return;
    const sec = makeSkel(label, true);
    sec.classList.add('personal-row');
    main.insertBefore(sec, anchor);
    fillRow(sec, typed(items), true);
    if (label === 'Continue Watching') {
      [...sec.querySelectorAll('.bcard')].forEach((card, i) => {
        const line = document.createElement('div');
        line.className = 'progress-line';
        line.innerHTML = `<span style="width:${Math.max(6, Math.min(92, items[i]?.progress || 8))}%"></span>`;
        card.appendChild(line);
      });
    }
    anchor = sec;
  });
}

function preferenceData() {
  return readStore('primetv:preferences', { liked: [], disliked: [], genres: {} });
}

async function loadDiscoverMovies() {
  const prefs = preferenceData();
  const best = Object.entries(prefs.genres || {}).filter(([,score]) => score > 0).sort((a,b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const params = { sort_by: best.length ? 'vote_average.desc' : 'popularity.desc', 'vote_count.gte': 120, include_adult: false, page: 1 + Math.floor(Math.random() * 10) };
  if (best.length) params.with_genres = best.join('|');
  const d = await api('/discover/movie', params);
  const seen = new Set([...(prefs.liked || []), ...(prefs.disliked || [])].map(String));
  S.discoverItems.push(...d.results.filter(x => x.poster_path && !seen.has(String(x.id))).sort(() => Math.random() - .5));
  renderSwipeCard();
}

function renderSwipeCard() {
  const stage = document.getElementById('swipe-stage');
  const item = S.discoverItems[S.discoverIndex];
  if (!item) { stage.innerHTML = '<div class="spin"></div>'; loadDiscoverMovies().catch(() => stage.innerHTML = '<p>Could not load picks.</p>'); return; }
  rememberItem(item, 'movie');
  const title = item.title || 'Untitled';
  stage.innerHTML = `<article class="swipe-card">
    <img src="${IMG}/w500${item.poster_path}" alt="${esc(title)}">
    <div class="swipe-shade"></div><div class="swipe-stamp yes">FAVORITE</div><div class="swipe-stamp no">PASS</div>
    <div class="swipe-copy"><span class="swipe-meta">★ ${item.vote_average?.toFixed(1) || '?'} · ${(item.release_date || '').slice(0,4)}</span><h3>${esc(title)}</h3><p>${esc(item.overview || 'No description available.')}</p></div>
  </article>`;
  const card = stage.querySelector('.swipe-card');
  let start = 0;
  card.addEventListener('pointerdown', e => { start = e.clientX; S.dragX = 0; card.classList.add('dragging'); card.setPointerCapture(e.pointerId); });
  card.addEventListener('pointermove', e => { if (!card.classList.contains('dragging')) return; S.dragX = Math.max(-240, Math.min(240, e.clientX - start)); card.style.setProperty('--drag-x', `${S.dragX}px`); card.style.setProperty('--drag-r', `${S.dragX / 18}deg`); card.querySelector('.yes').style.opacity = Math.max(0, S.dragX / 90); card.querySelector('.no').style.opacity = Math.max(0, -S.dragX / 90); });
  card.addEventListener('pointerup', () => { card.classList.remove('dragging'); Math.abs(S.dragX) > 90 ? rateSwipe(S.dragX > 0) : resetSwipe(card); });
  updateSwipeStats();
}

function resetSwipe(card) { S.dragX = 0; card.style.setProperty('--drag-x','0px'); card.style.setProperty('--drag-r','0deg'); card.querySelectorAll('.swipe-stamp').forEach(x => x.style.opacity = 0); }

function rateSwipe(liked) {
  const item = S.discoverItems[S.discoverIndex]; if (!item) return;
  const prefs = preferenceData();
  prefs.liked = (prefs.liked || []).filter(id => id !== item.id); prefs.disliked = (prefs.disliked || []).filter(id => id !== item.id);
  (liked ? prefs.liked : prefs.disliked).push(item.id);
  (item.genre_ids || []).forEach(id => prefs.genres[id] = (prefs.genres[id] || 0) + (liked ? 2 : -1));
  writeStore('primetv:preferences', prefs);
  let favorites = readStore('primetv:favorites');
  favorites = liked ? [{ ...item, _t:'movie' }, ...favorites.filter(x => x.id !== item.id)].slice(0, 30) : favorites.filter(x => x.id !== item.id);
  writeStore('primetv:favorites', favorites);
  toast(liked ? 'Added to My Favorites' : 'Marked not interested');
  S.discoverIndex++; S.dragX = 0; renderSwipeCard(); refreshPersonalRows();
  if (S.discoverItems.length - S.discoverIndex < 4) loadDiscoverMovies().catch(() => {});
}

function updateSwipeStats() { const p = preferenceData(); document.getElementById('swipe-stats').textContent = `${p.liked?.length || 0} favorites · ${p.disliked?.length || 0} passes`; }
function openDiscover() { const view = document.getElementById('discover'); view.classList.add('on'); view.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; if (!S.discoverItems[S.discoverIndex]) renderSwipeCard(); }
function closeDiscover() { const view = document.getElementById('discover'); view.classList.remove('on'); view.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }

async function randomMovie() {
  try {
    const prefs = preferenceData(); const best = Object.entries(prefs.genres || {}).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0,3).map(([id]) => id);
    const params = { sort_by:'popularity.desc', 'vote_count.gte':100, include_adult:false, page:1 + Math.floor(Math.random()*25) }; if (best.length) params.with_genres = best.join('|');
    const d = await api('/discover/movie', params); const choices = d.results.filter(x => x.poster_path); const item = choices[Math.floor(Math.random()*choices.length)];
    if (item) { rememberItem(item,'movie'); openModal(item,'movie'); toast('Your random PrimeTV pick'); }
  } catch { toast('Could not pick a movie. Try again.'); }
}

/* ════════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════════ */
function initSearch() {
  const inp = document.getElementById('si');
  const ov  = document.getElementById('soverlay');
  const gr  = document.getElementById('sgrid');

  inp.addEventListener('input', () => {
    clearTimeout(S.searchTimer);
    const q = inp.value.trim();
    if (q.length < 2) { ov.classList.remove('on'); return; }
    document.getElementById('sq-label').textContent = `Results for "${q}"`;
    S.searchTimer = setTimeout(() => doSearch(q, gr, ov), 370);
  });
  inp.addEventListener('focus', () => { if (inp.value.trim().length >= 2) ov.classList.add('on'); });
  document.addEventListener('click', e => {
    if (!e.target.closest?.('.sb') && !e.target.closest?.('.soverlay')) ov.classList.remove('on');
  });
}

async function doSearch(q, gr, ov) {
  ov.classList.add('on');
  gr.innerHTML = '<div class="spin"></div>';
  try {
    const d = await api('/search/multi', { query: q, include_adult: false });
    const items = d.results.filter(i => (i.media_type === 'movie' || i.media_type === 'tv') && (i.poster_path || i.backdrop_path));
    gr.innerHTML = '';
    if (!items.length) { gr.innerHTML = '<p style="color:var(--t3)">No results found</p>'; return; }
    items.slice(0, 28).forEach((item, idx) => gr.appendChild(makeCard(item, item.media_type, idx)));
  } catch { gr.innerHTML = '<p style="color:var(--t3)">Search failed. Try again.</p>'; }
}

/* ════════════════════════════════════════════════
   NAV
════════════════════════════════════════════════ */
function initNav() {
  document.querySelectorAll('.nl').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.f === 'discover') { openDiscover(); return; }
      document.querySelectorAll('.nl').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.f === 'all') window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/* ════════════════════════════════════════════════
   MAGNETIC BUTTONS
════════════════════════════════════════════════ */
function initMagnetic() {
  document.querySelectorAll('.btn-s, .btn-o').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const r = btn.getBoundingClientRect();
      btn.style.transform = `translate(${(e.clientX - r.left - r.width/2) * 0.16}px,${(e.clientY - r.top - r.height/2) * 0.16}px) scale(1.04)`;
    });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  });
}

/* ════════════════════════════════════════════════
   KEYBOARD
════════════════════════════════════════════════ */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('discover').classList.contains('on')) closeDiscover();
    else if (document.getElementById('pwrap').classList.contains('on'))        closePlayer();
    else if (document.getElementById('moverlay').classList.contains('on')) closeModal();
    else if (document.getElementById('soverlay').classList.contains('on')) {
      document.getElementById('soverlay').classList.remove('on');
      document.getElementById('si').blur();
    }
  });
}

/* ════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════ */
function toast(msg, dur = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, dur);
}

/* ════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════ */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */
async function boot() {
  initScroll();
  initNav();
  initSearch();
  initKeyboard();

  try { await fetchGenres(); } catch { /* optional */ }
  buildQueue();
  refreshPersonalRows();

  document.getElementById('discover-close').addEventListener('click', closeDiscover);
  document.getElementById('swipe-pass').addEventListener('click', () => rateSwipe(false));
  document.getElementById('swipe-like').addEventListener('click', () => rateSwipe(true));
  document.getElementById('swipe-info').addEventListener('click', () => { const item = S.discoverItems[S.discoverIndex]; if (item) { closeDiscover(); openModal(item, 'movie'); } });
  document.getElementById('hrandom').addEventListener('click', randomMovie);

  await Promise.all([
    loadHero(),
    loadFeatured(),
    loadSections(5),
  ]);

  initInfiniteScroll();
  initMagnetic();

  await sleep(280);
  document.getElementById('splash').classList.add('out');
}

document.addEventListener('DOMContentLoaded', boot);
