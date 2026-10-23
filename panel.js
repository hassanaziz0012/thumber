const MAX_WIDTH = 1280; // YouTube's recommended thumbnail size; larger images get scaled down
const MAX_KEEP_BYTES = 1.5 * 1024 * 1024; // smaller files are stored as-is

const $ = (id) => document.getElementById(id);
const els = {
  enabled: $('enabled'),
  drop: $('drop'),
  file: $('file'),
  thumbImg: $('thumbImg'),
  placeholder: $('placeholder'),
  clearImg: $('clearImg'),
  title: $('title'),
  count: $('count'),
  previewTitle: $('previewTitle'),
  shuffle: $('shuffle'),
  reveal: $('reveal'),
  status: $('status'),
  statusText: $('statusText'),
  offsite: $('offsite'),
  openYouTube: $('openYouTube'),
};

const STATUS_POLL_MS = 2000; // the panel stays open, so keep the status line current
const YOUTUBE_URL = /^https:\/\/www\.youtube\.com\//;

let state = { enabled: true, title: '', image: '' };
let saveTimer = null;

// ---- Rendering ----

function renderImage() {
  const has = !!state.image;
  els.thumbImg.hidden = !has;
  els.placeholder.hidden = has;
  els.clearImg.hidden = !has;
  els.drop.classList.toggle('has-image', has);
  if (has) els.thumbImg.src = state.image;
  else els.thumbImg.removeAttribute('src');
}

function renderTitle() {
  const t = state.title.trim();
  els.previewTitle.textContent = t || 'Your video title';
  els.previewTitle.classList.toggle('empty', !t);
  els.count.textContent = `${state.title.length} / 100`;
  els.count.classList.toggle('warn', state.title.length > 70); // ~where YouTube starts truncating
}

function renderEnabled() {
  els.enabled.checked = state.enabled;
  document.body.classList.toggle('disabled', !state.enabled);
}

// ---- Tab communication ----

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(type, tab) {
  try {
    tab ??= await activeTab();
    return tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    return null; // not a YouTube tab (no content script listening)
  }
}

function renderOffsite(offsite) {
  els.offsite.hidden = !offsite;
  document.body.classList.toggle('offsite', offsite);
}

async function refreshStatus() {
  const tab = await activeTab();
  const res = await sendToTab('thumber:status', tab);
  // The YouTube content script grants host access, so tab.url is only readable on YouTube
  const url = tab?.url || tab?.pendingUrl || '';
  renderOffsite(!res && !YOUTUBE_URL.test(url));

  const hasContent = state.title.trim() || state.image;
  let text;
  let live = false;

  if (!res || !res.page) {
    text = 'Open the YouTube home page or a search to test';
  } else if (!state.enabled) {
    text = 'Paused — toggle on to swap a video';
  } else if (!hasContent) {
    text = 'Add a title or thumbnail to start';
  } else if (res.active) {
    live = true;
    text = res.page === 'home' ? 'Live on the home feed' : 'Live on search results';
  } else {
    text = 'Waiting for videos to load…';
  }

  els.statusText.textContent = text;
  els.status.classList.toggle('live', live);
  els.shuffle.disabled = els.reveal.disabled = !live;
}

// ---- Persistence ----

async function save(patch) {
  Object.assign(state, patch);
  try {
    await chrome.storage.local.set(patch);
  } catch (err) {
    els.statusText.textContent = `Couldn't save: ${err.message}`;
    return;
  }
  setTimeout(refreshStatus, 300);
}

// ---- Image handling ----

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);

  if (img.naturalWidth <= MAX_WIDTH && file.size <= MAX_KEEP_BYTES) {
    await save({ image: dataUrl });
  } else {
    const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    await save({ image: canvas.toDataURL('image/webp', 0.92) });
  }
  renderImage();
}

// ---- Events ----

els.title.addEventListener('input', () => {
  state.title = els.title.value.replace(/\n/g, ' ');
  if (state.title !== els.title.value) els.title.value = state.title;
  renderTitle();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save({ title: state.title }), 250);
});

els.enabled.addEventListener('change', () => {
  save({ enabled: els.enabled.checked });
  renderEnabled();
});

els.file.addEventListener('change', () => {
  handleFile(els.file.files[0]);
  els.file.value = '';
});

els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.file.click();
  }
});

for (const type of ['dragenter', 'dragover']) {
  els.drop.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.add('dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  els.drop.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.remove('dragover');
  });
}
els.drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

els.clearImg.addEventListener('click', (e) => {
  e.preventDefault(); // don't open the file picker from the surrounding label
  e.stopPropagation();
  save({ image: '' });
  renderImage();
});

els.shuffle.addEventListener('click', async () => {
  await sendToTab('thumber:shuffle');
  refreshStatus();
});

els.reveal.addEventListener('click', async () => {
  await sendToTab('thumber:reveal');
});

els.openYouTube.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.youtube.com/' });
});

// The panel outlives tab switches and navigations, so follow whichever tab is in front
chrome.tabs.onActivated.addListener(refreshStatus);
chrome.tabs.onUpdated.addListener((_id, _info, tab) => {
  if (tab.active) refreshStatus();
});
setInterval(() => {
  if (document.visibilityState === 'visible') refreshStatus();
}, STATUS_POLL_MS);

// ---- Init ----

chrome.storage.local.get(['enabled', 'title', 'image'], (data) => {
  state = { ...state, ...data };
  els.title.value = state.title;
  renderEnabled();
  renderTitle();
  renderImage();
  refreshStatus();
});
