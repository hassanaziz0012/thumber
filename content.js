// Thumber content script: swaps one random video tile on the YouTube home feed
// or search results with the user's own title + thumbnail.

const POOL_SIZE = { home: 12, search: 8 }; // pick among the first N tiles so it lands near the top
const MIN_WAIT_TICKS = 4; // ticks to wait for the feed to fill before picking anyway
const TICK_MS = 750;

const TITLE_TEXT_SELECTORS = [
  'yt-lockup-metadata-view-model h3 a span',
  '[class*="LockupMetadataViewModelTitle"] span',
  '[class*="lockup-metadata-view-model__title"] span',
  '#video-title yt-formatted-string',
  '#video-title',
];
const TITLE_ATTR_SELECTORS = [
  'yt-lockup-metadata-view-model h3',
  'yt-lockup-metadata-view-model h3 a',
  '#video-title',
  '#video-title yt-formatted-string',
];
const THUMB_IMG_SELECTORS = [
  'yt-thumbnail-view-model img',
  'a[class*="LockupViewModelContentImage"] img',
  'ytd-thumbnail img',
  '#thumbnail img',
];
const THUMB_HOST_SELECTORS = '[class*="ThumbnailViewModelImage"], yt-thumbnail-view-model, a#thumbnail';

let settings = { enabled: true, title: '', image: '' };
let swap = null; // { tile, href, titleEl, originalText, attrs, overlay }
let lastPick = -1;
let lastUrl = location.href;
let waitTicks = 0;

function pageType() {
  if (location.pathname === '/') return 'home';
  if (location.pathname === '/results') return 'search';
  return null;
}

function isVisible(el) {
  return el.getClientRects().length > 0;
}

function watchHref(tile) {
  const a = tile.querySelector('a[href*="/watch?v="]');
  return a ? a.getAttribute('href') : null;
}

function candidates(type) {
  let tiles = [];
  if (type === 'home') {
    // Direct grid children only: skips Shorts / news shelves nested in rich sections.
    tiles = [...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')];
  } else if (type === 'search') {
    tiles = [
      ...document.querySelectorAll('ytd-search ytd-item-section-renderer > #contents > ytd-video-renderer'),
      ...document.querySelectorAll('ytd-search ytd-item-section-renderer > #contents > yt-lockup-view-model'),
    ];
  }
  return tiles.filter(
    (t) =>
      isVisible(t) &&
      !t.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer') &&
      watchHref(t) &&
      firstMatch(t, TITLE_TEXT_SELECTORS) &&
      firstMatch(t, THUMB_IMG_SELECTORS)
  );
}

function firstMatch(root, selectors) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

function hasContent() {
  return settings.enabled && (settings.title.trim() || settings.image);
}

function restore() {
  if (!swap) return;
  const { tile, titleEl, originalText, attrs, overlay } = swap;
  overlay?.remove();
  // Only restore if YouTube hasn't already re-rendered the tile with new data.
  if (titleEl.isConnected && titleEl.textContent === swap.appliedTitle) titleEl.textContent = originalText;
  for (const { el, name, value } of attrs) el.setAttribute(name, value);
  tile.classList.remove('thumber-tile');
  tile.removeEventListener('pointerenter', onTileEnter);
  tile.removeEventListener('pointerleave', onTileLeave);
  onTileLeave();
  swap = null;
}

// Hovering a tile plays the real video's inline preview on top of it, which would
// give the swap away; hide the preview player while the pointer is over our tile.
function onTileEnter() {
  if (settings.image) document.documentElement.classList.add('thumber-hide-preview');
}

function onTileLeave() {
  document.documentElement.classList.remove('thumber-hide-preview');
}

function pick() {
  const type = pageType();
  if (!type || !hasContent()) return;
  const all = candidates(type);
  if (!all.length) return;
  if (all.length < POOL_SIZE[type] && waitTicks < MIN_WAIT_TICKS) return;

  const pool = all.slice(0, POOL_SIZE[type]);
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastPick) i = (i + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
  lastPick = i;

  const tile = pool[i];
  const titleEl = firstMatch(tile, TITLE_TEXT_SELECTORS);
  swap = {
    tile,
    href: watchHref(tile),
    titleEl,
    originalText: titleEl.textContent,
    appliedTitle: null,
    attrs: [],
    overlay: null,
  };
  for (const s of TITLE_ATTR_SELECTORS) {
    const el = tile.querySelector(s);
    if (!el) continue;
    for (const name of ['title', 'aria-label']) {
      if (el.hasAttribute(name)) swap.attrs.push({ el, name, value: el.getAttribute(name) });
    }
  }
  tile.classList.add('thumber-tile');
  tile.addEventListener('pointerenter', onTileEnter);
  tile.addEventListener('pointerleave', onTileLeave);
  apply();
}

function apply() {
  if (!swap) return;
  const { tile, titleEl, attrs } = swap;
  const title = settings.title.trim();

  if (title) {
    if (titleEl.textContent !== title) titleEl.textContent = title;
    swap.appliedTitle = title;
    for (const { el, name } of attrs) {
      if (el.getAttribute(name) !== title) el.setAttribute(name, title);
    }
  } else if (swap.appliedTitle) {
    titleEl.textContent = swap.originalText;
    for (const { el, name, value } of attrs) el.setAttribute(name, value);
    swap.appliedTitle = null;
  }

  if (settings.image) {
    if (!swap.overlay?.isConnected) {
      const img = firstMatch(tile, THUMB_IMG_SELECTORS);
      if (!img) return;
      // The img's own wrapper (e.g. yt-image) isn't always sized; anchor to the thumbnail box.
      const host = img.closest(THUMB_HOST_SELECTORS) || img.parentElement;
      let anchor = img;
      while (anchor.parentElement !== host) anchor = anchor.parentElement;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      swap.overlay = document.createElement('img');
      swap.overlay.className = 'thumber-overlay';
      swap.overlay.alt = '';
      // Insert right after the image so duration badges etc. still paint on top.
      anchor.after(swap.overlay);
    }
    if (swap.overlay.src !== settings.image) swap.overlay.src = settings.image;
  } else {
    swap.overlay?.remove();
    swap.overlay = null;
  }
}

function tick() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    restore();
    waitTicks = 0;
  }
  if (!pageType() || !hasContent()) {
    restore();
    return;
  }
  // YouTube recycles tile elements; if ours now shows a different video, start over.
  if (swap && (!swap.tile.isConnected || !isVisible(swap.tile) || watchHref(swap.tile) !== swap.href)) {
    restore();
  }
  if (swap) apply();
  else {
    waitTicks++;
    pick();
  }
}

function reveal() {
  if (!swap) return false;
  swap.tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
  swap.tile.classList.remove('thumber-reveal');
  void swap.tile.offsetWidth; // restart the animation
  swap.tile.classList.add('thumber-reveal');
  setTimeout(() => swap?.tile.classList.remove('thumber-reveal'), 2600);
  return true;
}

chrome.storage.local.get(['enabled', 'title', 'image'], (data) => {
  settings = { ...settings, ...data };
  tick();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in settings) settings[key] = newValue ?? (key === 'enabled' ? true : '');
  }
  tick();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'thumber:shuffle') {
    restore();
    waitTicks = MIN_WAIT_TICKS;
    pick();
    sendResponse({ ok: !!swap });
  } else if (msg.type === 'thumber:reveal') {
    sendResponse({ ok: reveal() });
  } else if (msg.type === 'thumber:status') {
    sendResponse({ page: pageType(), active: !!swap });
  }
});

document.addEventListener('yt-navigate-finish', tick);
setInterval(tick, TICK_MS);
