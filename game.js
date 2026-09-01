const BUILD_VERSION = 150;
const DEFAULTS_RESET_VERSION = 140;
const ASSET_CACHE_NAME = 'gta3-assets-v2';
const PRELOAD_CONCURRENCY = 32;
const ASSET_PREFIX = 'gta3-assets/local';
const DEPLOYMENT_PREFIX = "";
/* Asset base resolves relative to current page for 100% GitHub Pages / sub-path compatibility */
const ASSET_BASE = DEPLOYMENT_PREFIX.length > 0 ? DEPLOYMENT_PREFIX + ASSET_PREFIX + "/" : new URL(`${ASSET_PREFIX}/`, window.location.href).href;
const ASSET_BASES_WORKING = [ASSET_BASE];
const PRELOAD_URL = new URL('preload_files.list?v=' + Date.now(), window.location.href).href;
const STREAM_URL = new URL('stream_files.list?v=' + Date.now(), window.location.href).href;

/* Every audio stem on disk is exclusively .mp3 OR .wav (never both).
 * Requesting the wrong extension floods the console with 404s. */
const AUDIO_MP3_STEMS = new Set((
  'bet c1_tex d1_stog d2_kk d3_ado d4_gta d4_gta2 d5_es d6_sts d7_mld ' +
  'el_ph1 el_ph2 el_ph3 el_ph4 end hd_ph1 hd_ph2 hd_ph3 hd_ph4 hd_ph5 ' +
  'j0_dm2 j1_lfl j2_kcl j3_vh j4_eth j5_dst j6_tbj jb k1_kbo k2_gis k3_ds ' +
  'k4_shi k4_shi2 k5_sd l1_lg l2_dsb l3_dm l4_pap l5_tfb mt_ph1 mt_ph2 ' +
  'mt_ph3 mt_ph4 r0_pdr2 r1_sw r2_ap r3_ed r4_gf r5_pb r6_mm s0_mas s1_pf ' +
  's2_ctg s2_ctg2 s3_rtc s4_bdba s4_bdbb s4_bdbd s5_lrq s5_lrqb s5_lrqc ' +
  't1_tol t2_tpu t3_mas t4_tat t5_bf yd_ph1 yd_ph2 yd_ph3 yd_ph4'
).split(/\s+/));

function resolveAudioRel(rel) {
  const r = normalizeAssetRel(rel);
  /* Per-sample SFX stay as requested (.mp3 under sfx.raw/). */
  if (r.includes('/sfx') || r.startsWith('sfx')) return r;
  const m = r.match(/^audio\/([^/]+)\.(wav|mp3)$/i);
  if (!m) return r;
  const stem = m[1].toLowerCase();
  const want = AUDIO_MP3_STEMS.has(stem) ? 'mp3' : 'wav';
  return `audio/${stem}.${want}`;
}

function isWrongAudioFormat(rel) {
  const r = normalizeAssetRel(rel);
  if (r.includes('/sfx') || r.startsWith('sfx')) return false;
  const m = r.match(/^audio\/([^/]+)\.(wav|mp3)$/i);
  if (!m) return false;
  return resolveAudioRel(r) !== r;
}

const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const tapHintEl = document.getElementById('tap-hint');
const canvas = document.getElementById('canvas');

const defaultRe3Ini = `[VideoMode]
Width=1280
Height=720
Depth=32
Subsystem=0
Windowed=1

[Controller]
HeadBob1stPerson=0
HorizantalMouseSens=0.002500
InvertMouseVertically=1
DisableMouseSteering=1
Vibration=0
Method=0
InvertPad=0

[Audio]
SfxVolume=64
MusicVolume=64
MP3BoostVolume=0
Radio=0
SpeakerType=0
Provider=0
DynamicAcoustics=0

[Display]
Brightness=256
DrawDistance=1.200000
Subtitles=1
ShowHud=1
RadarMode=0
ShowLegends=0
PedDensity=1.000000
CarDensity=1.000000
CutsceneBorders=1

[Graphics]
AspectRatio=0
VSync=1
Trails=1
FrameLimiter=0
MultiSampling=0

[General]
SkinFile=$$""
Language=0
DrawVersionText=0
NoMovies=1
`;

function sanitizeRe3Ini(ini) {
  // Guard against a saved mute from earlier broken sessions.
  let out = ini || defaultRe3Ini;
  out = out.replace(/SfxVolume=\d+/i, 'SfxVolume=64');
  out = out.replace(/MusicVolume=\d+/i, 'MusicVolume=64');
  if (!/SfxVolume=/i.test(out)) out += '\nSfxVolume=64\n';
  if (!/MusicVolume=/i.test(out)) out += '\nMusicVolume=64\n';
  return out;
}
let re3Ini = sanitizeRe3Ini(localStorage.getItem('regta3dos.re3.ini') || defaultRe3Ini);

/* Язык из query-параметра (?lang=ru | en | fr | de | it | es | pl | ja,
 * либо число 0..7 — enum CMenuManager::LANGUAGE). Пока параметр присутствует
 * в URL, он сильнее сохранённых настроек: применяется поверх
 * userfiles/re3.ini на каждом буте (re3.ini переопределяет gta3.set,
 * см. LoadINISettings в src/core/Frontend.cpp). */
const LANGUAGE_CODES = {
  en: 0, american: 0, english: 0,
  fr: 1, french: 1,
  de: 2, german: 2,
  it: 3, italian: 3,
  es: 4, spanish: 4,
  pl: 5, polish: 5,
  ru: 6, russian: 6,
  ja: 7, japanese: 7,
};
const languageOverride = (() => {
  try {
    const raw = (new URLSearchParams(location.search).get('lang') || '').trim().toLowerCase();
    if (!raw) return 0; // Default to English (0)
    if (raw in LANGUAGE_CODES) return LANGUAGE_CODES[raw];
    const num = parseInt(raw, 10);
    if (Number.isInteger(num) && num >= 0 && num <= 7) return num;
    console.warn('[regta3] unknown lang query param:', raw);
    return 0;
  } catch (_) {
    return 0;
  }
})();

function applyLanguageOverride(ini) {
  const lang = (languageOverride === null) ? 0 : languageOverride;
  const line = 'Language=' + lang;
  if (/Language=\d+/i.test(ini)) return ini.replace(/Language=\d+/i, line);
  return ini + '\n[General]\n' + line + '\n';
}

/* [Controller] Method: 0 = CONTROL_STANDARD (мышиная камера, свободный
 * прицел), 1 = CONTROL_CLASSIC (консольная схема, захват цели). На тач
 * играбельна только вторая. C++ выставляет то же самое сам
 * (regta3_js_is_touch в glfw.cpp/Frontend.cpp) — здесь для того, чтобы
 * меню и сохранённый ini показывали правду. */
function applyTouchControlMethod(ini) {
  const want = isTouchDevice ? 1 : 0;
  if (/Method=\d+/i.test(ini)) return ini.replace(/Method=\d+/i, 'Method=' + want);
  return ini + '\n[Controller]\nMethod=' + want + '\n';
}
let bootStarted = false;
let audioUnlocked = false;
let worldLoadComplete = false;
let autoEnterDone = false;
let worldStreamStarted = false;
const trackedAudioContexts = new Set();
const asyncUrlCache = new Map();
const assetDataCache = new Map();
const assetNotFound = new Set();
const streamedPreloadLog = new Set();

function toPreloadListPath(path) {
  const normalized = normalizeAssetRel(path);
  const rel = normalized.replace(/^gta3-assets\/local\//i, '');
  return `${ASSET_PREFIX}/${rel}`;
}

function parsePreloadList(text) {
  const paths = [];
  const seen = new Set();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const path = toPreloadListPath(line);
    const key = normalizeAssetRel(path);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

function recordStreamedPreload(rel) {
  streamedPreloadLog.add(toPreloadListPath(rel));
}

function printStreamedPreloadLog() {
  const lines = ['# regta3dos streamed preload list', ...streamedPreloadLog];
  const text = lines.join('\n');
  console.log(text);
  streamedPreloadLog.clear();
  return text;
}

window.regta3PrintStreamedPreload = printStreamedPreloadLog;
window.regta3DumpStreamedPreload = printStreamedPreloadLog;

/** Track every AudioContext OpenAL creates (must run before createRe3Module). */
(function patchAudioContextTracking() {
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig || Orig.__regta3Patched) return;
  class PatchedAudioContext extends Orig {
    constructor(...args) {
      super(...args);
      trackedAudioContexts.add(this);
      // Browsers often start suspended; resume as soon as a gesture arrives.
      const kick = () => {
        if (this.state === 'suspended') {
          this.resume().catch(() => {});
        }
      };
      for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart']) {
        document.addEventListener(ev, kick, true);
      }
    }
  }
  PatchedAudioContext.__regta3Patched = true;
  window.AudioContext = PatchedAudioContext;
  if ('webkitAudioContext' in window) window.webkitAudioContext = PatchedAudioContext;
})();

// Frame-level watchdog: detect hang inside CGame::Process on Frame 1
let frameEnterTime = 0;
let frameIndex = -1;
let frameFinished = true;
let syncCallCount = 0;
let syncCallLog = [];
let lastSlowEnsure = '';
let ensureBudgetUsedMs = 0;
let ensureBudgetWindowStart = 0;
const ENSURE_BUDGET_PER_FRAME_MS = 12;
/* Absolute ceiling even for "critical" paths — unlimited sync XHR hard-froze
 * free roam after ~30s when ped/SFX storms ignored the soft budget. */
const ENSURE_HARD_CAP_PER_FRAME_MS = 28;

function showDiagError(msg) {
  console.warn('[regta3] DIAGNOSTIC:', msg);
  setStatus('ERROR: ' + msg);
}

// Catch WASM traps / JS errors from the rAF callback
window.addEventListener('error', (ev) => {
  const err = ev.error || ev;
  const msg = (err && err.message) ? err.message : String(err);
  if (msg && (msg.includes('RuntimeError') || msg.includes('unreachable') || msg.includes('memory access') ||
      msg.includes('abort') || msg.includes('Aborted') || msg.includes('wasm'))) {
    showDiagError('WASM crash: ' + msg + '\n[sync calls in last frame: ' + syncCallCount + ']\n' + syncCallLog.slice(-10).join('\n'));
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  const msg = ev.reason ? String(ev.reason.message || ev.reason) : 'unknown';
  console.error('[regta3] Unhandled rejection:', msg);
});

function updateLoaderUI(done, total, statusText, fileDetail) {
  const loaderPercent = document.getElementById('loader-percent');
  const loaderProgressBar = document.getElementById('loader-progress-bar');
  const loaderStatusText = document.getElementById('loader-status-text');
  const loaderFileDetail = document.getElementById('loader-file-detail');

  if (loaderPercent && total > 0) {
    const pct = Math.min(100, Math.round((done / total) * 100));
    loaderPercent.textContent = pct + '%';
    if (loaderProgressBar) {
      loaderProgressBar.style.width = pct + '%';
    }
  }
  if (statusText && loaderStatusText) {
    loaderStatusText.textContent = statusText;
  }
  if (fileDetail && loaderFileDetail) {
    loaderFileDetail.textContent = fileDetail;
  }
}

function hideLoaderUI() {
  const loaderOverlay = document.getElementById('loader-overlay');
  if (loaderOverlay) {
    loaderOverlay.classList.add('hidden');
    setTimeout(() => {
      loaderOverlay.style.display = 'none';
    }, 600);
  }
}

function setStatus(text) {
  if (text) {
    console.log('[regta3] status:', text);
    const cleanText = text.replace(/^\[regta3\]\s*/i, '');
    updateLoaderUI(0, 0, cleanText, null);
  }
}

function setProgress(done, total) {
  if (!total) return;
  updateLoaderUI(done, total, null, null);
}

function hideTapHint() {
  if (tapHintEl) tapHintEl.hidden = true;
}

function markGameStarted() {
  worldLoadComplete = true;
  setProgress(0, 0);
  hideTapHint();
  hideLoaderUI();
  document.body.classList.add('game-started');
}

function simulateEnter(target) {
  const el = target || canvas || window;
  const opts = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
}

function maybeAutoEnter(line) {
  if (autoEnterDone) return;
  // Only auto-enter if explicitly requested via ?autostart=1 (for automated tests)
  const isAutoStart = (new URLSearchParams(location.search).get('autostart') === '1');
  if (!isAutoStart) return;
  if (!line.includes('[regta3] gGameState = GS_FRONTEND')) return;
  autoEnterDone = true;
  if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'AUTOSTART', 'Auto-starting new game via ?autostart=1');
  const target = canvas || window;
  let n = 0;
  const kick = () => {
    simulateEnter(target);
    n += 1;
    if (n < 3) setTimeout(kick, 700);
  };
  setTimeout(kick, 400);
}

/* Background prefetch of ALL remaining world DFF models from stream_files.list.
 * Called once when GS_FRONTEND is detected. Runs in background with low concurrency
 * so it doesn't starve the main game loop. Uses the same prefetchAssetAsync mechanism
 * which writes files to VFS and OPFS cache. */
let worldStreamDone = 0;
let worldStreamTotal = 0;
async function prefetchWorldModels() {
  if (worldStreamStarted) return;
  worldStreamStarted = true;
  let lines = [];
  try {
    const res = await fetch(STREAM_URL);
    if (res.ok) {
      const text = await res.text();
      lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    }
  } catch (err) {
    if (typeof window.remoteLog === 'function') window.remoteLog('WARN', 'STREAM', 'stream_files.list fetch failed: ' + (err && err.message ? err.message : err));
    return;
  }
  if (!lines.length) return;
  worldStreamTotal = lines.length;
  if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STREAM', 'Queuing ' + worldStreamTotal + ' world DFF models for background prefetch');
  /* Pump in small batches so the page stays responsive */
  let i = 0;
  const BATCH = 8;
  const pump = () => {
    for (let n = 0; n < BATCH && i < lines.length; n++, i++) {
      const rel = lines[i].replace(/^gta3-assets\/local\//i, '');
      prefetchAssetAsync(rel);
    }
    worldStreamDone = i;
    if (i < lines.length) {
      setTimeout(pump, 20);
    } else {
      if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STREAM', 'All ' + worldStreamTotal + ' world DFF models queued');
    }
  };
  setTimeout(pump, 500);
}

function updateStatusFromRegta3(line) {
  maybeAutoEnter(line);
  // Start world model background stream when menu is ready
  if (line.includes('gGameState = GS_FRONTEND')) {
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STATE', 'Game state: GS_FRONTEND (Main menu ready)');
    prefetchWorldModels();
    // Warm cutscene audio and first mission early
    prefetchAssetAsync('audio/bet.mp3');
    prefetchAssetAsync('audio/c1_tex.mp3');
    prefetchAssetAsync('audio/head.wav');
    prefetchAssetAsync('audio/police.wav');
  }
  // Kick off async prefetch for any TXD mentioned in log (e.g. "casepath couldn't find X.txd")
  const txdMatch = line.match(/full path was (models\/[^\s"]+\.txd)/i);
  if (txdMatch) {
    prefetchAssetAsync(txdMatch[1].toLowerCase());
  }
  if (line.includes('gGameState = GS_PLAYING_GAME') || line.includes('[regta3] gGameState = GS_PLAYING_GAME')) {
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STATE', 'Game state: GS_PLAYING_GAME');
    unlockWebAudio();
    prefetchAssetAsync('anim/cuts.img');
    prefetchAssetAsync('ANIM/CUTS.IMG');
    prefetchAssetAsync('audio/bet.mp3');
    prefetchAssetAsync('audio/c1_tex.mp3');
    prefetchAssetAsync('audio/head.wav');
    prefetchAssetAsync('audio/police.wav');
    prefetchAssetAsync('audio/sfx.sdt');
    return;
  }
  if (line.includes('SET_INTRO_IS_PLAYING 0') || line.includes('post-intro stream')) {
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'CUTSCENE', 'Intro cutscene finished! Starting first mission audio prefetch');
    prefetchFirstMissionAudio();
  }
  if (line.includes('per-sample MP3 bank')) {
    prefetchHotSfxAsync();
    prefetchRadioBedsAsync();
    prefetchFirstMissionAudio();
  }
  if (line.includes('OpenAL context created') || line.includes('per-sample MP3 bank') ||
      line.includes("LoadCutsceneData('") || line.includes('START_CUTSCENE') || line.includes('preload audio')) {
    unlockWebAudio();
    const cut = line.match(/LoadCutsceneData\('([^']+)'\)/i) || line.match(/START_CUTSCENE '([^']+)'/i) || line.match(/preload audio (\S+)/i);
    if (cut && cut[1]) {
      const name = String(cut[1]).toLowerCase();
      if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'CUTSCENE', 'Cutscene event: ' + name);
      /* One prefetch — resolveAudioRel picks mp3 vs wav; no dual 404 spam. */
      prefetchAssetAsync(resolveAudioRel(`audio/${name}.mp3`));
    }
  }
  if (line.includes('gGameState = GS_INIT_PLAYING_GAME')) {
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STATE', 'Game state: GS_INIT_PLAYING_GAME');
    unlockWebAudio();
    return;
  }
  if (!line.includes('[regta3]')) return;
  if (line.includes('Idle frame 0: after RenderScene')) {
    markGameStarted();
  }
}

function getOpenAlHandle() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.__regta3AL) return globalThis.__regta3AL;
    if (typeof Module !== 'undefined' && Module.AL) return Module.AL;
    if (typeof AL !== 'undefined') return AL;
  } catch (_) {}
  return null;
}

function beepOnContext(ctx) {
  if (!ctx) return;
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_) {}
}

function resumeAudioCtx(ctx) {
  if (!ctx) return Promise.resolve();
  try {
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        return p.then(() => beepOnContext(ctx)).catch(() => {});
      }
    } else if (ctx.state === 'running') {
      beepOnContext(ctx);
    }
  } catch (_) {}
  return Promise.resolve();
}

function collectAudioContexts() {
  const out = new Set(trackedAudioContexts);
  try {
    const al = getOpenAlHandle();
    if (al && al.contexts) {
      for (const id of Object.keys(al.contexts)) {
        const c = al.contexts[id];
        if (c && c.audioCtx) out.add(c.audioCtx);
      }
    }
    if (al && al.currentCtx && al.currentCtx.audioCtx) out.add(al.currentCtx.audioCtx);
  } catch (_) {}
  return [...out];
}

function resumeOpenAlContexts() {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis.__regta3ResumeOpenAl === 'function') {
      globalThis.__regta3ResumeOpenAl();
    }
    if (typeof Module !== 'undefined' && typeof Module.resumeRegta3Audio === 'function') {
      Module.resumeRegta3Audio();
    }
  } catch (_) {}
  return Promise.all(collectAudioContexts().map((ctx) => resumeAudioCtx(ctx)));
}

function anyAudioRunning() {
  return collectAudioContexts().some((ctx) => ctx && ctx.state === 'running');
}

function unlockWebAudio() {
  return resumeOpenAlContexts().then(() => {
    if (anyAudioRunning()) {
      audioUnlocked = true;
      hideTapHint();
    }
  });
}

function installGestureUnlock() {
  const unlock = () => {
    unlockWebAudio();
    try {
      if (canvas) canvas.focus({ preventScroll: true });
    } catch (_) {}
  };
  // Keep listening: OpenAL often creates its AudioContext after the first gesture.
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('mousedown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchstart', unlock, true);
}

function installPointerLockErrorSwallow() {
  // Do not gate requestPointerLock — that broke mouse look. Only swallow rejections.
  const patch = (proto) => {
    if (!proto || proto.__regta3LockSwallow) return;
    proto.__regta3LockSwallow = true;
    const orig = proto.requestPointerLock;
    if (typeof orig !== 'function') return;
    proto.requestPointerLock = function (...args) {
      try {
        const ret = orig.apply(this, args);
        if (ret && typeof ret.catch === 'function') return ret.catch(() => {});
        return ret;
      } catch (_) {
        return undefined;
      }
    };
  };
  patch(Element.prototype);
  if (canvas) patch(Object.getPrototypeOf(canvas));
}

async function loadPreloadList() {
  const res = await fetch(PRELOAD_URL);
  if (!res.ok) throw new Error(`preload list: HTTP ${res.status}`);
  const text = await res.text();
  return parsePreloadList(text);
}

function isBootDeferredAsset(rel) {
  const r = normalizeAssetRel(rel);
  /* Defer heavy background radio stations only; preload all models, cuts.img, sfx, and intro audio */
  if (r.startsWith('audio/') && !r.includes('sfx')) {
    if (/\b(bet|c1_tex|jb|end|head|police|l1_lg|l2_dsb|l3_dm|l4_pap|l5_tfb|lib_a|lib_a1|lib_a2|lib_b|lib_c|lib_d|ammu)\./i.test(r)) return false;
    if (/\.(wav|mp3)$/i.test(r)) return true;
  }
  return false;
}

function bootPreloadPriority(path) {
  const r = normalizeAssetRel(path.replace(/^gta3-assets\/local\//i, ''));
  if (/(?:^|\/)cuts\.img$/i.test(r) || /\.dir$/i.test(r) || /frontend|menu\.txd|fonts/i.test(r)) return 0;
  if (r.startsWith('data/') || r.startsWith('text/')) return 1;
  if (r.startsWith('models/coll') || r.startsWith('models/generic')) return 1;
  if (r.startsWith('models/gta3.img/')) return 2;
  if (r.startsWith('anim/') || r.startsWith('txd/')) return 2;
  return 3;
}

/* Персистентный кэш ассетов: OPFS через libopfs.js (Module.OPFS —
 * emscripten js-library, см. src/skel/emscripten/libopfs.js). Все операции
 * идут в Web Worker через createSyncAccessHandle — в отличие от
 * createWritable на main thread это работает на iOS/Safari с 15.2.
 * Файлы лежат под корнем ASSET_CACHE_NAME, зеркаля rel-путь ассета;
 * раскладка совместима с прежним main-thread бекендом. */
let opfsInitPromise = null;
function opfsInit() {
  if (opfsInitPromise) return opfsInitPromise;
  const M = window.Module;
  const api = (M && M.OPFS) ? M.OPFS : null;
  if (!api) return Promise.resolve(null); // до создания wasm-модуля кэша нет
  opfsInitPromise = (async () => {
    try {
      /* 'list' обязателен до read/write: он заводит корень в
       * rootDirectoryCache воркера (иначе getMeta/updateMeta бросают). */
      const entries = await api.opfsList(ASSET_CACHE_NAME);
      console.log('[regta3] OPFS cache (worker):', Object.keys(entries).length, 'entries');
      /* одноразовая уборка прежних бекендов: CacheStorage и старый
       * OPFS-корень main-thread реализации */
      if (navigator.storage && navigator.storage.getDirectory) {
        navigator.storage.getDirectory()
          .catch(() => {});
      }
      return api;
    } catch (e) {
      console.warn('[regta3] OPFS unavailable:', e && e.message ? e.message : e);
      return null;
    }
  })();
  return opfsInitPromise;
}

async function opfsReadAsset(rel) {
  return null;
}

async function opfsWriteAsset(rel, data) {
  // Direct local server serving; no OPFS worker IPC overhead needed
}

function cacheAssetData(rel, data) {
  assetDataCache.set(normalizeAssetRel(rel), data);
}

function getCachedAsset(rel) {
  return assetDataCache.get(normalizeAssetRel(rel));
}

async function readResponseBytes(res, onProgress) {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (onProgress) onProgress(buf.length, buf.length);
  return buf;
}

const ASSET_CACHE_KEY = 'gta3-assets-v2';
let cacheStoragePromise = null;
async function getCacheStorage() {
  if (cacheStoragePromise) return cacheStoragePromise;
  if (typeof caches === 'undefined') return null;
  cacheStoragePromise = caches.open(ASSET_CACHE_KEY).catch(() => null);
  return cacheStoragePromise;
}

async function fetchAsset(relPath, onProgress) {
  const cached = getCachedAsset(relPath);
  if (cached) {
    if (onProgress) onProgress(cached.length, cached.length);
    return cached;
  }
  const nKey = normalizeAssetRel(relPath);
  if (nKey === 'audio/sfx.raw' || nKey.endsWith('/sfx.raw')) {
    throw new Error(`asset ${relPath}: directory, not a file`);
  }
  const bases = ASSET_BASES_WORKING;
  const cache = await getCacheStorage();
  
  let lastErr;
  for (const base of bases) {
    const url = base + relPath;
    try {
      if (cache) {
        try {
          const cachedRes = await cache.match(url);
          if (cachedRes) {
            const data = new Uint8Array(await cachedRes.arrayBuffer());
            cacheAssetData(relPath, data);
            if (onProgress) onProgress(data.length, data.length);
            return data;
          }
        } catch (_) {}
      }
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`asset ${relPath}: HTTP ${res.status}`);
        continue;
      }
      const data = await readResponseBytes(res, onProgress);
      cacheAssetData(relPath, data);
      if (cache) {
        try {
          const respToCache = new Response(data.slice(0), {
            headers: { 'Content-Type': 'application/octet-stream' }
          });
          cache.put(url, respToCache).catch(() => {});
        } catch (_) {}
      }
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`asset ${relPath}: fetch failed`);
}

async function runPool(items, concurrency, workerFn) {
  let cursor = 0;
  const workers = [];
  const n = Math.min(concurrency, Math.max(1, items.length));
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await workerFn(items[i], i);
      }
    })());
  }
  await Promise.all(workers);
}

function normalizeAssetRel(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function isTextureProbe(rel) {
  const r = normalizeAssetRel(rel);
  if (!/\.(tga|bmp|png)$/i.test(r)) return false;
  // Internal texture raster names (from materials inside TXDs) are bare or oddly named like "xxx_128.tga", "$$".tga etc.
  // Real asset files that happen to end in .bmp (e.g. player.bmp) or under generic/ must still be loadable if listed.
  if (/\/(generic|misc)\//i.test(r) || /player\./i.test(r) || /fonts/i.test(r)) return false;
  if (/^[^/]+\.(tga|bmp|png)$/i.test(r)) return true; // bare name -> likely internal probe
  // Conservative: other .tga/.png under models/ that are not our known loose UI ones are probes
  return true;
}

function shouldAvoidNetworkForAsset(rel) {
  const r = normalizeAssetRel(rel);
  if (isTextureProbe(r)) return true;
  /* Монолитный SFX-банк (80МБ) сознательно не доставляем: без него sampman
   * включает пофайловый mp3-режим (_emscriptenMp3Sfx). */
  if (r === 'audio/sfxbank.raw') return true;
  // reVCDOS-style resources are extracted from IMG archives into directories
  // and can be loaded on demand as ordinary files.
  return false;
}

function toAssetPath(file) {
  let path = String(file).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!path.startsWith(`${ASSET_PREFIX}/`)) {
    path = `${ASSET_PREFIX}/${path.replace(/^\/+/, '')}`;
  }
  return path.toLowerCase();
}

function assetCandidates(rel) {
  const r0 = normalizeAssetRel(rel);
  /* Remap wrong audio extension before building the candidate list. */
  const r = (r0.startsWith('audio/') && !r0.includes('sfx')) ? resolveAudioRel(r0) : r0;
  const out = [];
  const add = (path) => {
    const n = normalizeAssetRel(path);
    if (!out.includes(n)) out.push(n);
  };

  // Prefer the requested path first; unpacked gta3.img/ is a fallback (reVCDOS layout).
  add(r);

  let m = r.match(/^models\/([^/]+\.(dff|txd|col|ifp))$/);
  if (m) add(`models/gta3.img/${m[1]}`);

  m = r.match(/^models\/([^/]+)\/([^/]+\.(dff|txd|col|ifp))$/);
  if (m && m[1] !== 'gta3.img' && m[1] !== 'coll' && m[1] !== 'generic') {
    add(`models/gta3.img/${m[2]}`);
  }

  m = r.match(/^([^/]+\.(txd|dff))$/);
  if (m) {
    add(`txd/${m[1]}`);
    add(`models/${m[1]}`);
  }

  if (r.endsWith('.dir')) {
    const base = r.slice(0, -4);
    if (base.endsWith('gta3_archive')) add('models/gta3.dir');
    if (base.endsWith('gta3')) add('models/gta3_archive.dir');
    if (base.endsWith('cuts')) add('anim/cuts.dir');
  }

  if (r.endsWith('cuts.img') || r.endsWith('cuts.IMG')) {
    add('anim/cuts.img');
    add('ANIM/CUTS.IMG');
  }

  /* Do NOT add alternate .wav/.mp3 — every stem has exactly one format on disk. */

  /* Intro convoy recordings: bare chaseN.dat after SetDir("data/paths"). */
  m = r.match(/^chase(\d+)\.dat$/i);
  if (m) add(`data/paths/chase${m[1]}.dat`);
  m = r.match(/^data\/paths\/chase(\d+)\.dat$/i);
  if (m) add(`chase${m[1]}.dat`);

  if (r === 'userfiles/gta3.set' || r.endsWith('/userfiles/gta3.set')) {
    add('gta3.set');
  }

  return out;
}

async function fetchFirstAvailable(candidates, onProgress) {
  let lastErr;
  for (const rel of candidates) {
    try {
      return { rel, data: await fetchAsset(rel, onProgress) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('no asset candidates');
}

function vfsPathExists(Module, vfsPath) {
  try {
    return Module.FS.analyzePath(vfsPath).exists;
  } catch (_) {
    return false;
  }
}

function writeAssetToFs(Module, path, data) {
  const vfsPath = '/' + path.replace(/^\/+/, '');
  const dir = vfsPath.substring(0, vfsPath.lastIndexOf('/'));
  Module.FS.mkdirTree(dir);
  Module.FS.writeFile(vfsPath, data);
}

function ensureGameDirs(Module) {
  const dirs = [
    `/${ASSET_PREFIX}/userfiles`,
    `/${ASSET_PREFIX}/skins`,
    `/${ASSET_PREFIX}/audio`,
    `/${ASSET_PREFIX}/audio/sfx.raw`,
    `/${ASSET_PREFIX}/data`,
    `/${ASSET_PREFIX}/data/paths`,
    `/${ASSET_PREFIX}/data/maps`,
    `/${ASSET_PREFIX}/models`,
    `/${ASSET_PREFIX}/models/coll`,
    `/${ASSET_PREFIX}/models/generic`,
    `/${ASSET_PREFIX}/models/gta3.img`,
    `/${ASSET_PREFIX}/anim`,
    `/${ASSET_PREFIX}/ANIM`,
    `/${ASSET_PREFIX}/txd`,
    `/${ASSET_PREFIX}/text`,
    '/userfiles',
    '/skins',
    '/audio',
    '/audio/sfx.raw',
    '/data',
    '/data/paths',
    '/data/maps',
    '/models',
    '/models/coll',
    '/models/generic',
    '/models/gta3.img',
    '/anim',
    '/ANIM',
    '/txd',
    '/text',
  ];
  for (const dir of dirs) {
    try { Module.FS.mkdirTree(dir); } catch (_) {}
  }
  installFsLogging(Module);
}

function installFsLogging(Module) {
  if (!Module || !Module.FS || Module.FS.__loggingInstalled) return;
  Module.FS.__loggingInstalled = true;
  const origOpen = Module.FS.open;
  if (origOpen) {
    Module.FS.open = function (path, flags, mode) {
      const p = String(path);
      try {
        const stream = origOpen.apply(this, arguments);
        if (p.endsWith('.dff') || p.endsWith('.txd') || p.endsWith('.col') || p.endsWith('.mp3') || p.endsWith('.wav') || p.endsWith('.dat') || p.endsWith('.ide') || p.endsWith('.ipl') || p.endsWith('.img') || p.endsWith('.dir')) {
          if (typeof window.remoteLog === 'function') window.remoteLog('DEBUG', 'VFS', 'open OK: ' + p);
        }
        return stream;
      } catch (err) {
        if (!isExpectedAssetMiss(p)) {
          if (typeof window.remoteLog === 'function') window.remoteLog('WARN', 'VFS', 'open FAIL: ' + p + ' (' + (err && err.message ? err.message : err) + ')');
        }
        throw err;
      }
    };
  }
}

function isExpectedAssetMiss(vfsPath) {
  const p = String(vfsPath || '').toLowerCase();
  return (
    p.includes('sound.cache') ||
    p.includes('sfxbank') ||
    p.includes('$$') ||
    p.endsWith('.tga') ||
    p.endsWith('.bmp') ||
    p.endsWith('.png') ||
    p.endsWith('.tif') ||
    isWrongAudioFormat(p.replace(/^\/gta3-assets\/local\//i, ''))
  );
}

/* Облачные сейвы (jsdos-cloud-sdk): userfiles живут в IDBFS, а CloudSDKUI
 * умеет целиком выгружать/восстанавливать IndexedDB-базу этого маунта
 * (имя базы у emscripten = точка монтирования). Порядок: pull ДО
 * FS.syncfs(true) — тогда populate уже видит облачные файлы; push — после
 * каждого успешного FS.syncfs(false). Дедупликация неизменённых пушей —
 * внутри SDK (fingerprint сериализованной базы). */
const CLOUD_SAVE_FILE = 'regta3dos.userfiles.idbfs';
const USERFILES_MOUNT = `/${ASSET_PREFIX}/userfiles`;
let cloudUiPromise = null;
let cloudPushInFlight = false;

function mountCloudUi() {
  if (cloudUiPromise) return cloudUiPromise;
  if (typeof CloudSDKUI === 'undefined') {
    cloudUiPromise = Promise.resolve(false);
    return cloudUiPromise;
  }
  /* mount() резолвится, когда виджет узнал состояние ключа (в т.ч. premium) —
   * до этого pullIDBFSStorage всегда бросает "not logged in". */
  cloudUiPromise = CloudSDKUI.mount().then(() => true).catch((err) => {
    console.warn('[regta3] cloud saves UI failed:', err && err.message ? err.message : err);
    return false;
  });
  return cloudUiPromise;
}

function maybeCloudPush() {
  if (typeof CloudSDKUI === 'undefined' || cloudPushInFlight) return;
  cloudPushInFlight = true;
  /* pushIDBFSStorage не бросает: true — облако, false — только локально
   * (нет ключа/подписки/сети); виджет показывает результат сам. */
  CloudSDKUI.pushIDBFSStorage(CLOUD_SAVE_FILE, USERFILES_MOUNT).then((saved) => {
    console.log('[regta3] cloud push:', saved ? 'saved in cloud' : 'saved locally');
  }).catch(() => {}).finally(() => {
    cloudPushInFlight = false;
  });
}

async function pullCloudSaves() {
  const uiOk = await mountCloudUi();
  if (!uiOk) return;
  try {
    const restored = await CloudSDKUI.pullIDBFSStorage(CLOUD_SAVE_FILE, USERFILES_MOUNT);
    console.log('[regta3] cloud pull:', restored ? 'restored from cloud' : 'nothing in cloud yet');
  } catch (err) {
    /* не залогинен / нет premium — остаёмся на локальных сейвах */
    console.log('[regta3] cloud pull skipped:', err && err.message ? err.message : err);
  }
}

async function mountUserfilesIdbfs(Module) {
  const mountPath = USERFILES_MOUNT;
  try { Module.FS.mkdirTree(mountPath); } catch (_) {}
  if (!Module.FS.filesystems || !Module.FS.filesystems.IDBFS) {
    console.warn('[regta3] IDBFS unavailable — saves will not persist across reload');
    return false;
  }
  try {
    Module.FS.mount(Module.FS.filesystems.IDBFS, {}, mountPath);
  } catch (err) {
    console.warn('[regta3] IDBFS mount failed:', err && err.message ? err.message : err);
    return false;
  }
  /* Сначала облако → IndexedDB, затем populate IndexedDB → MEMFS. */
  await pullCloudSaves();
  return new Promise((resolve) => {
    Module.FS.syncfs(true, (err) => {
      if (err) {
        console.warn('[regta3] IDBFS populate failed:', err);
        resolve(false);
        return;
      }
      console.log('[regta3] IDBFS userfiles ready');
      resolve(true);
    });
  });
}

function scheduleUserfilesPersist(Module) {
  if (!Module.FS.filesystems || !Module.FS.filesystems.IDBFS) return;
  let pending = false;
  /* Страховка от облачного pull: pullIDBFSStorage заменяет базу маунта
   * целиком, и снапшот без re3.ini (старая версия / другое устройство)
   * выкидывает настройки. Бэкап в localStorage — источник для повторного
   * сеяния (см. re3Ini выше) вместо голых дефолтов. */
  const backupRe3Ini = () => {
    try {
      const data = Module.FS.readFile(`${USERFILES_MOUNT}/re3.ini`, { encoding: 'utf8' });
      if (data && data.length > 0) localStorage.setItem('regta3dos.re3.ini', data);
    } catch (_) {}
  };
  const flush = () => {
    if (pending) return;
    pending = true;
    backupRe3Ini();
    try {
      Module.FS.syncfs(false, (err) => {
        pending = false;
        if (err) {
          console.warn('[regta3] IDBFS flush failed:', err);
          return;
        }
        maybeCloudPush();
      });
    } catch (err) {
      pending = false;
    }
  };
  setInterval(flush, 20000);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  Module.persistUserfiles = flush;
}

function scheduleRe3IniPersist(Module) {
  // Joypad bindings and the detected-joystick name are saved to re3.ini
  // (SaveINIControllerSettings), not to the IDBFS-backed gta3.set — so copy the
  // ini back to localStorage, otherwise controller setup dies on reload.
  const iniPath = `/${ASSET_PREFIX}/re3.ini`;
  const save = () => {
    try {
      if (!vfsPathExists(Module, iniPath)) return;
      const data = Module.FS.readFile(iniPath, { encoding: 'utf8' });
      if (data && data.length > 0) localStorage.setItem('regta3dos.re3.ini', data);
    } catch (err) {
      console.warn('[regta3] re3.ini persist failed:', err && err.message ? err.message : err);
    }
  };
  setInterval(save, 20000);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  Module.persistRe3Ini = save;
}

function looksLikeHtmlDirectoryListing(data) {
  if (!data || data.length < 15) return false;
  const head = String.fromCharCode(...data.subarray(0, Math.min(64, data.length))).toLowerCase();
  return head.includes('<!doctype') || head.includes('<html');
}

// Background async prefetch for assets we know will be needed
// (avoids sync XHR blocking the main thread on future frames)
const prefetchPending = new Set();
function prefetchAssetAsync(rel) {
  const resolved = (normalizeAssetRel(rel).startsWith('audio/') && !normalizeAssetRel(rel).includes('sfx'))
    ? resolveAudioRel(rel) : normalizeAssetRel(rel);
  const nKey = normalizeAssetRel(resolved);
  if (shouldAvoidNetworkForAsset(resolved) || assetNotFound.has(nKey) || assetDataCache.has(nKey) || prefetchPending.has(nKey)) return;
  /* Engine asked for wrong extension — do not hit the network for it. */
  if (isWrongAudioFormat(rel)) {
    assetNotFound.add(normalizeAssetRel(rel));
  }
  prefetchPending.add(nKey);
  fetchFirstAvailable(assetCandidates(resolved)).then(({ rel: usedRel, data }) => {
    cacheAssetData(usedRel, data);
    cacheAssetData(resolved, data);
    recordStreamedPreload(usedRel);
    const Module = window.Module;
    if (Module && Module.FS) {
      try { writeAssetToFs(Module, `${ASSET_PREFIX}/${usedRel}`, data); } catch (_) {}
      if (usedRel !== resolved) {
        try { writeAssetToFs(Module, `${ASSET_PREFIX}/${resolved}`, data); } catch (_) {}
      }
    }
  }).catch(() => {
    assetNotFound.add(nKey);
  });
}

/* Единственный канал доставки для C++ (regta3_js_prefetch_asset): OPFS →
 * сеть → OPFS-кэш → MEMFS, без блокировок. Итог фиксируется в
 * asyncFileStatus, чтобы C++ (regta3_wait_file) мог возобновиться сразу,
 * в т.ч. по 404. Дедуплицирует параллельные запросы по пути. */
const loadAsyncFilePending = new Map();
const asyncFileStatus = new Map(); // key -> 'pending' | 'ok' | 'notfound'
let reportLoadProgressLast = 0;
let reportLoadProgressShown = false;
function loadAsyncFile(vfsPath) {
  const key = String(vfsPath).toLowerCase();
  const inflight = loadAsyncFilePending.get(key);
  if (inflight) return inflight;
  asyncFileStatus.set(key, 'pending');
  const p = loadAsyncFileInner(vfsPath)
    .catch(() => false)
    .then((ok) => {
      asyncFileStatus.set(key, ok ? 'ok' : 'notfound');
      return ok;
    })
    .finally(() => loadAsyncFilePending.delete(key));
  loadAsyncFilePending.set(key, p);
  return p;
}

/* Синхронный статус для C++-опроса (regta3_js_file_status):
 * 0 = неизвестно/качается, 1 = есть, 2 = точно нет (404/проба). */
function getAsyncFileStatus(vfsPath) {
  const Module = window.Module;
  const key = String(vfsPath).toLowerCase();
  const normalized = '/' + key.replace(/^\/+/, '');
  if (Module && Module.FS && vfsPathExists(Module, normalized)) return 1;
  const rel = normalizeAssetRel(normalized.replace(/^\/gta3-assets\/local\//i, ''));
  const st = asyncFileStatus.get(key);
  if (st === 'ok') return 1;
  if (st === 'notfound') return 2;
  /* синхронно известные отказы — пробы текстур и кэшированные 404 */
  if (shouldAvoidNetworkForAsset(rel) || assetNotFound.has(rel)) return 2;
  return 0;
}

async function loadAsyncFileInner(vfsPath) {
  const Module = window.Module;
  if (!Module || !Module.FS) return false;
  const normalized = '/' + String(vfsPath).replace(/^\/+/, '').toLowerCase();
  if (vfsPathExists(Module, normalized)) return true;
  let rel = normalized.replace(/^\/gta3-assets\/local\//i, '');
  let aliasWrongExt = null;
  if (rel.startsWith('audio/') && !rel.includes('sfx')) {
    const fixed = resolveAudioRel(rel);
    if (fixed !== rel) {
      aliasWrongExt = normalizeAssetRel(rel);
      rel = fixed;
      const fixedVfs = `/${ASSET_PREFIX}/${fixed}`;
      if (vfsPathExists(Module, fixedVfs)) {
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasWrongExt}`, Module.FS.readFile(fixedVfs));
        } catch (_) {}
        return true;
      }
    }
  }
  if (shouldAvoidNetworkForAsset(rel)) return false;
  const candidates = assetCandidates(rel);
  for (const c of candidates) {
    if (c !== rel && vfsPathExists(Module, `/${ASSET_PREFIX}/${c}`)) {
      try {
        const data = Module.FS.readFile(`/${ASSET_PREFIX}/${c}`);
        writeAssetToFs(Module, `${ASSET_PREFIX}/${rel}`, data);
        if (aliasWrongExt) writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasWrongExt}`, data);
        return true;
      } catch (_) {}
    }
  }
  if (assetNotFound.has(normalizeAssetRel(rel)) &&
      candidates.every((c) => assetNotFound.has(normalizeAssetRel(c)))) {
    return false;
  }
  try {
    const { rel: usedRel, data } = await fetchFirstAvailable(candidates);
    cacheAssetData(usedRel, data);
    recordStreamedPreload(usedRel);
    writeAssetToFs(Module, `${ASSET_PREFIX}/${usedRel}`, data);
    if (usedRel !== rel) {
      try { writeAssetToFs(Module, `${ASSET_PREFIX}/${rel}`, data); } catch (_) {}
    }
    if (aliasWrongExt && aliasWrongExt !== usedRel) {
      try { writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasWrongExt}`, data); } catch (_) {}
    }
    return true;
  } catch (err) {
    assetNotFound.add(normalizeAssetRel(rel));
    console.warn('[regta3] loadAsyncFile miss:', rel, err && err.message ? err.message : err);
    return false;
  }
}

/* Common UI / footsteps / weapons / fire — first-play sync XHR hurts less if warm. */
const HOT_SFX_IDS = [
  10, 11, 15, 16, 18, 19, 21, 22, 29, 30, 32, 33, 34, 35, 36,
  103, 104, 105, 106, 107, 116, 117, 118, 119, 120,
  141, 142, 143, 144, 148, 157, 188,
  284, 285, 287, 288, 294, 295, 297, 298,
  338, 339, 343, 344, 357, 358, 359, 372, 373, 374, 375, 376, 377, 378, 379,
];
let hotSfxPrefetchStarted = false;
function prefetchHotSfxAsync() {
  if (hotSfxPrefetchStarted) return;
  hotSfxPrefetchStarted = true;
  let i = 0;
  const pump = () => {
    const batch = 6;
    for (let n = 0; n < batch && i < HOT_SFX_IDS.length; n++, i++) {
      prefetchAssetAsync(`audio/sfx.raw/${HOT_SFX_IDS[i]}.mp3`);
    }
    if (i < HOT_SFX_IDS.length) {
      setTimeout(pump, 40);
    } else {
      console.log(`[regta3] SFX prefetch queued: ${HOT_SFX_IDS.length} samples`);
    }
  };
  setTimeout(pump, 100);
}

/* 7–27MB radio beds — never sync-XHR; warm them in background after boot. */
const RADIO_BED_NAMES = [
  'head', 'class', 'kjah', 'rise', 'lips', 'game', 'msx', 'flash', 'chat',
  'police', 'city', 'water',
];
let radioBedPrefetchStarted = false;
function prefetchRadioBedsAsync() {
  if (radioBedPrefetchStarted) return;
  radioBedPrefetchStarted = true;
  for (const n of RADIO_BED_NAMES) {
    prefetchAssetAsync(`audio/${n}.wav`);
  }
  console.log('[regta3] radio beds prefetch started');
}

/* First story mission (Luigi's Girls) — warm cutscene bed + early dialogue
 * before the player reaches the club, while post-intro streaming is busy. */
const FIRST_MISSION_AUDIO = [
  'audio/l1_lg.mp3',
  'audio/lib_a.wav', 'audio/lib_a1.wav', 'audio/lib_a2.wav',
  'audio/lib_b.wav', 'audio/lib_c.wav', 'audio/lib_d.wav',
  'audio/l2_a.wav', 'audio/ammu_a.wav', 'audio/ammu_b.wav', 'audio/ammu_c.wav',
];
let firstMissionAudioPrefetchStarted = false;
function prefetchFirstMissionAudio() {
  if (firstMissionAudioPrefetchStarted) return;
  firstMissionAudioPrefetchStarted = true;
  for (const rel of FIRST_MISSION_AUDIO)
    prefetchAssetAsync(rel);
  console.log('[regta3] first-mission audio prefetch started');
}

/* ===================== Тач-управление =====================
 * Игра о существовании тача не знает ни одной строкой C++-кода. Оверлей
 * из DOM жмёт эмулированный «стандартный» геймпад (gamepad-emulator.js),
 * тот патчит navigator.getGamepads, emscripten_sample_gamepad_data
 * перечитывает её каждый семпл — и дальше это обычный джойстик:
 * Regta3Joy* → CapturePad → PCTempJoyState → штатные биндинги.
 * Обратно игра шлёт своё состояние (regta3_js_touch_state) в data-state-*
 * на <body>, а CSS перекрашивает и переставляет те же самые div'ы.
 * Подробности — touch-controls/TOUCH_CONTROLS.md. */

function wantsTouchControls() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch (_) {}
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

const isTouchDevice = wantsTouchControls();

/* Индексы кнопок — W3C Standard Gamepad, не GLFW: 6/7 это триггеры, а
 * Back/Start — 8/9. Перевод в порядок GLFW делает Regta3JoyRefresh
 * (src/skel/glfw/glfw.cpp), там же аналоговые триггеры становятся осями. */
const TOUCH_BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
};

/* selector → индекс(ы) кнопки пада. Массив = один тап жмёт несколько
 * кнопок: drive-by в III это «огонь» + «смотреть вбок», отдельного
 * действия у игры нет и заводить его не нужно. */
const TOUCH_BUTTONS = [
  ['.touch-control.run', TOUCH_BTN.A],          // спринт / газ / выбор в меню
  ['.touch-control.fist', TOUCH_BTN.B],         // огонь
  ['.touch-control.jump', TOUCH_BTN.X],         // прыжок / тормоз
  ['.touch-control.getIn', TOUCH_BTN.Y],        // сесть-выйти / назад в меню
  ['.touch-control.radio', TOUCH_BTN.LB],       // радиостанция
  ['.touch-control.drift', TOUCH_BTN.RB],       // ручник / захват цели
  ['.touch-control.weapon', TOUCH_BTN.RT],      // следующее оружие
  ['.touch-control.camera', TOUCH_BTN.BACK],    // вид камеры
  ['.touch-control.menu', TOUCH_BTN.START],     // пауза
  ['.touch-control.horn', TOUCH_BTN.L3],        // клаксон
  ['.touch-control.job', TOUCH_BTN.R3],         // субмиссия
  ['.touch-control.fireLeft', [TOUCH_BTN.B, TOUCH_BTN.LT]],
  ['.touch-control.fireRight', [TOUCH_BTN.B, TOUCH_BTN.RT]],
];

let touchEmulator = null;
let touchPadIndex = -1;
/* [{ el, buttonIndexes }] — для releaseHiddenTouchButtons. */
let touchBindings = [];

/* Кнопка, которую спрятали прямо во время удержания (сел в машину с
 * зажатым «огонь», открыл меню с зажатым газом), может не получить
 * pointerup: гарантий, что браузер пришлёт boundary-событие на
 * display:none, нет. Тогда пад так и останется с нажатой кнопкой.
 * Поэтому на каждой смене состояния отпускаем всё, что стало невидимым. */
function releaseHiddenTouchButtons() {
  if (!touchEmulator || touchPadIndex < 0) return;
  for (const { el, buttonIndexes } of touchBindings) {
    if (getComputedStyle(el).display !== 'none') continue;
    try {
      touchEmulator.PressButton(touchPadIndex, buttonIndexes, 0, false);
    } catch (_) {}
  }
}

function installTouchControls() {
  document.body.dataset.isTouch = isTouchDevice ? '1' : '0';
  if (!isTouchDevice) return;
  if (typeof GamepadEmulator !== 'function') {
    console.warn('[regta3] gamepad-emulator.js not loaded — touch unavailable');
    return;
  }
  if (touchEmulator) return; // конструктор бросает на второй экземпляр

  try {
    touchEmulator = new GamepadEmulator();
  } catch (err) {
    console.warn('[regta3] GamepadEmulator:', err && err.message ? err.message : err);
    return;
  }

  /* overlayMode=true: пад занимает индекс 0 и в patched getGamepads
   * сливается с настоящим геймпадом на том же индексе (кнопка = OR,
   * ось = большая по модулю). Поэтому реальный пад и тач работают
   * одновременно и joy1id не переезжает. */
  const pad = touchEmulator.AddEmulatedGamepad(null, true);
  if (!pad) {
    console.warn('[regta3] failed to create emulated gamepad');
    return;
  }

  const index = pad.index;

  /* Левая половина экрана — движение, правая — камера. Центр стика там,
   * где палец коснулся, поэтому рисовать нечего: вся половина и есть
   * стик. lockTargetWhilePressed → setPointerCapture, драг продолжает
   * отслеживаться, даже если палец ушёл на чужую половину. */
  const sticks = [
    ['touch-move', 0, 1],
    ['touch-look', 2, 3],
  ];
  for (const [id, xAxisIndex, yAxisIndex] of sticks) {
    const tapTarget = document.getElementById(id);
    if (!tapTarget) continue;
    touchEmulator.AddDisplayJoystickEventListeners(index, [{
      directions: { up: true, down: true, left: true, right: true },
      dragDistance: 100,
      tapTarget,
      lockTargetWhilePressed: true,
      xAxisIndex,
      yAxisIndex,
    }]);
  }

  /* type:'onOff' обязателен: без него AddButtonTouchEventListeners вешает
   * только pointerenter/leave, а pointerdown/up — нет. lockTargetWhilePressed
   * держим false, тогда enter/leave тоже живы и палец, съехавший на
   * соседнюю кнопку, её нажимает. */
  const configs = [];
  for (const [selector, buttonIndexes] of TOUCH_BUTTONS) {
    const tapTarget = document.querySelector(selector);
    if (!tapTarget) {
      console.warn('[regta3] нет элемента ' + selector);
      continue;
    }
    const indexes = Array.isArray(buttonIndexes) ? buttonIndexes : [buttonIndexes];
    configs.push({
      buttonIndexes: indexes,
      type: 'onOff',
      lockTargetWhilePressed: false,
      tapTarget,
    });
    touchBindings.push({ el: tapTarget, buttonIndexes: indexes });
  }
  touchEmulator.AddDisplayButtonEventListeners(index, configs);
  touchPadIndex = index;

  console.log('[regta3] touch controls enabled (emulated pad #' + index + ')');
}

/* Битовая маска из regta3_js_touch_state (REGTA3_TOUCH_* в crossplatform.h). */
const TOUCH_STATE_BITS = [
  [1 << 0, 'stateMenu'],
  [1 << 1, 'stateCutscene'],
  [1 << 2, 'stateCar'],
  [1 << 3, 'stateGun'],
  [1 << 4, 'stateCarGun'],
  [1 << 5, 'stateJob'],
  [1 << 6, 'stateVehGun'],
];

function setTouchState(flags) {
  const ds = document.body.dataset;
  let changed = false;
  for (const [bit, name] of TOUCH_STATE_BITS) {
    const want = (flags & bit) ? '1' : '0';
    if (ds[name] !== want) {
      ds[name] = want;
      changed = true;
    }
  }
  if (changed) releaseHiddenTouchButtons();
}

/* Пока идёт блокирующая докачка ассетов, оверлей прячем: тапать всё равно
 * нечего. Зовётся из reportLoadProgress, отдельного состояния в C++ нет. */
function setTouchDownloadState(on) {
  const want = on ? '1' : '0';
  if (document.body.dataset.stateDownload !== want) {
    document.body.dataset.stateDownload = want;
    releaseHiddenTouchButtons();
  }
}

async function resolveAsyncUrl(file) {
  const path = toAssetPath(file);
  if (asyncUrlCache.has(path)) {
    return asyncUrlCache.get(path);
  }
  const rel = path.replace(/^gta3-assets\/local\//i, '');
  const { rel: usedRel, data } = await fetchFirstAvailable(assetCandidates(rel));
  recordStreamedPreload(usedRel);
  const url = URL.createObjectURL(new Blob([data]));
  asyncUrlCache.set(path, url);
  return url;
}

const Module = {
  instantiateWasm: async (imports, callback) => {
    const binary = await (await fetch(`re3.wasm?v=${BUILD_VERSION}`)).arrayBuffer();
    const wasm = await WebAssembly.instantiate(binary, imports);
    if (window.agti) {
      window.agti(wasm.instance, () => callback(wasm.instance));
    } else {
      callback(wasm.instance);
    }
  },
  noInitialRun: true,
  noExitRuntime: true,
  canvas,
  /* Читается из wasm через regta3_js_language_override (regta3_em_lib.js):
   * -1 — параметра нет, иначе 0..7. При явном ?lang= C++ не форсит русский
   * поверх значения из re3.ini (см. CMenuManager::LoadSettings). */
  regta3LanguageOverride: languageOverride === null ? 0 : languageOverride,
  /* regta3_js_is_touch: на тач-устройстве C++ выбирает CONTROL_CLASSIC. */
  regta3IsTouch: isTouchDevice,
  /* regta3_js_touch_state: маска состояния игры → data-state-* на <body>. */
  setTouchState,
  locateFile(path) {
    if (path.endsWith('.wasm')) return `re3.wasm?v=${BUILD_VERSION}`;
    return path;
  },
  preRun: [],
  postRun: [],
  print(...args) {
    const line = args.join(' ');
    console.log(...args);
    updateStatusFromRegta3(line);
    // Track frame-level hang detection
    const enterM = line.match(/\[regta3\] Idle enter frame (\d+)/);
    if (enterM) {
      const fn = parseInt(enterM[1], 10);
      frameIndex = fn;
      frameEnterTime = Date.now();
      frameFinished = false;
      syncCallCount = 0;
      syncCallLog = [];
      if (fn === 1) {/* world init — silent */}
      // Watchdog: if frame doesn't finish within ~5s, show diagnostic (faster feedback for render hangs)
      const capturedFrame = fn;
      setTimeout(() => {
        if (!frameFinished && frameIndex === capturedFrame) {
          showDiagError(
            `Frame ${capturedFrame} зависло (5с+)\n` +
            `sync-вызовов (устар.): ${syncCallCount}\n` +
            `Последние вызовы:\n` + syncCallLog.slice(-15).join('\n')
          );
        }
      }, 5000);
    }
    const finishM = line.match(/\[regta3\] Idle finish frame/);
    if (finishM) {
      frameFinished = true;
    }
  },
  printErr(...args) {
    const msg = args.join(' ');
    if (msg.includes('emscripten_set_main_loop_timing') ||
        msg.includes('GLFW_CURSOR_HIDDEN') ||
        msg.includes('emscripten_sleep') ||
        msg.includes('alGetProcAddress') ||
        msg.includes('bad name in alGetProcAddress')) return;
    console.error(...args);
  },
  setStatus,
  async initFS() {
    const allPaths = await loadPreloadList();
    const paths = allPaths
      .filter((path) => !isBootDeferredAsset(path.replace(/^gta3-assets\/local\//i, '')))
      .sort((a, b) => bootPreloadPriority(a) - bootPreloadPriority(b));
    const deferred = allPaths.length - paths.length;
    console.log(`[regta3] boot preload ${paths.length}/${allPaths.length} files (deferred ${deferred}), concurrency=${PRELOAD_CONCURRENCY}`);
    setStatus(`Assets: 0/${paths.length} (loading...)`);
    setProgress(0, paths.length);

    let done = 0;
    let bytes = 0;
    const t0 = performance.now();
    const total = paths.length;

    const ingestLoaded = (path, rel, data) => {
      writeAssetToFs(Module, path, data);
      try { writeAssetToFs(Module, rel, data); } catch (_) {}
      bytes += data.length || 0;
      const imgMatch = rel.match(/^(models)\/gta3\.img\/([^/]+)$/i);
      if (imgMatch) {
        const aliasRel = `${imgMatch[1]}/${imgMatch[2]}`;
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasRel}`, data);
          writeAssetToFs(Module, aliasRel, data);
        } catch (_) {}
        assetNotFound.delete(normalizeAssetRel(aliasRel));
        cacheAssetData(aliasRel, data);
      }
      const cutsMatch = rel.match(/^anim\/(cuts\.(img|dir))$/i);
      if (cutsMatch) {
        const fname = cutsMatch[1].toUpperCase();
        const upperRel = `ANIM/${fname}`;
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${upperRel}`, data);
          writeAssetToFs(Module, upperRel, data);
        } catch (_) {}
        assetNotFound.delete(normalizeAssetRel(upperRel));
        cacheAssetData(upperRel, data);
        const lowerRel = `anim/${cutsMatch[1].toLowerCase()}`;
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${lowerRel}`, data);
          writeAssetToFs(Module, lowerRel, data);
        } catch (_) {}
        assetNotFound.delete(normalizeAssetRel(lowerRel));
        cacheAssetData(lowerRel, data);
      }
    };

    await runPool(paths, PRELOAD_CONCURRENCY, async (path) => {
      const rel = path.replace(/^gta3-assets\/local\//i, '');
      const shortRel = rel.length > 48 ? '…' + rel.slice(-47) : rel;
      try {
        const { data } = await fetchFirstAvailable(assetCandidates(rel), (recv, totalBytes) => {
          if (!totalBytes || totalBytes < 1024 * 1024) return;
          const mb = (recv / (1024 * 1024)).toFixed(1);
          const tmb = (totalBytes / (1024 * 1024)).toFixed(1);
          setStatus(`Assets: ${done + 1}/${total} — ${shortRel} (${mb}/${tmb} MB)`);
        });
        ingestLoaded(path, rel, data);
      } catch (err) {
        console.warn('preload skip:', path, err.message || err);
      }
      done += 1;
      setProgress(done, total);
      if (done % 5 === 0 || done === total) {
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        updateLoaderUI(done, total, `Loading Assets (${mb} MB / 72.6 MB)`, shortRel);
      }
      if (done % 250 === 0 || done === total) {
        const mb = (bytes / (1024 * 1024)).toFixed(0);
        if (typeof window.remoteLog === 'function') {
          window.remoteLog('INFO', 'PRELOAD', `Progress: ${done}/${total} files loaded (${mb} MB into VFS)`);
        }
      }
    });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[regta3] boot preload done in ${elapsed}s, ${(bytes / (1024 * 1024)).toFixed(1)} MB into VFS`);
    if (typeof window.remoteLog === 'function') {
      window.remoteLog('INFO', 'PRELOAD', `ALL ${total} ASSETS LOADED into VFS in ${elapsed}s! Starting game engine...`);
    }
    updateLoaderUI(total, total, 'Starting Game Engine...', 'Launching Grand Theft Auto III...');
    setTimeout(hideLoaderUI, 800);
    setProgress(0, 0);

    ensureGameDirs(Module);
    try {
      const resetKey = 'regta3dos.defaultsReset';
      const prev = parseInt(localStorage.getItem(resetKey) || '0', 10);
      if (prev < DEFAULTS_RESET_VERSION) {
        /* Drop stale gta3.set so Russian + full default binds apply once. */
        for (const p of [
          `/${ASSET_PREFIX}/userfiles/gta3.set`,
          `/${ASSET_PREFIX}/gta3.set`,
        ]) {
          try {
            if (Module.FS.analyzePath(p).exists) Module.FS.unlink(p);
          } catch (_) {}
        }
        localStorage.setItem(resetKey, String(DEFAULTS_RESET_VERSION));
        console.log('[regta3] reset gta3.set for defaults v' + DEFAULTS_RESET_VERSION);
      }
    } catch (_) {}
    const idbfsOk = await mountUserfilesIdbfs(Module);
    if (idbfsOk) scheduleUserfilesPersist(Module);

    /* Игра читает/пишет userfiles/re3.ini (IDBFS, персистентен между
     * перезагрузками — см. src/core/re3.cpp). Дефолты сеются только когда
     * в IDB ещё нет своего ini, иначе сохранённые настройки затирались бы
     * на каждом буте. */
    try {
      const userIni = `/${ASSET_PREFIX}/userfiles/re3.ini`;
      const hasUserIni = vfsPathExists(Module, userIni) &&
        (Module.FS.stat(userIni).size || 0) > 0;
      if (!hasUserIni) {
        Module.FS.writeFile(userIni, applyTouchControlMethod(applyLanguageOverride(re3Ini)));
        console.log('[regta3] seeded userfiles/re3.ini (' +
          (localStorage.getItem('regta3dos.re3.ini') ? 'localStorage backup' : 'defaults') + ')');
      } else {
        /* Query-параметр и тип устройства сильнее сохранённого ini:
         * правим только Language= / Method=. */
        const saved = Module.FS.readFile(userIni, { encoding: 'utf8' });
        const patched = applyTouchControlMethod(applyLanguageOverride(saved));
        if (patched !== saved) {
          Module.FS.writeFile(userIni, patched);
          console.log('[regta3] re3.ini patched (lang=' + languageOverride +
            ', touch=' + (isTouchDevice ? 1 : 0) + ')');
        }
      }
    } catch (_) {}
    try {
      const setPath = `/${ASSET_PREFIX}/gta3.set`;
      const userSet = `/${ASSET_PREFIX}/userfiles/gta3.set`;
      // Seed defaults only when IDB has no settings yet.
      const hasUserSet = vfsPathExists(Module, userSet) &&
        (Module.FS.stat(userSet).size || 0) > 0;
      if (!hasUserSet && vfsPathExists(Module, setPath)) {
        const setData = Module.FS.readFile(setPath);
        if (setData && setData.length > 0) {
          Module.FS.writeFile(userSet, setData);
        }
      }
      if (vfsPathExists(Module, userSet)) {
        const existing = Module.FS.readFile(userSet);
        if (!existing || existing.length === 0) {
          Module.FS.unlink(userSet);
        }
      }
    } catch (_) {}
    if (idbfsOk && typeof Module.persistUserfiles === 'function') {
      Module.persistUserfiles();
    }

    const critical = [
      'models/frontend.txd',
      'models/menu.txd',
      'models/fonts.txd',
      'models/fonts_r.txd',
      'data/gta3.dat',
      'text/american.gxt',
      'text/russian.gxt',
      'anim/cuts.dir',
      /* gta3_archive.img и cuts.img больше не в буте: модели читаются
       * пофайлово из models/gta3.img/* с асинхронной докачкой, cuts.img
       * префетчится фоном сразу после бута. */
      'models/gta3.dir',
      'models/gta3_archive.dir',
    ];
    const missing = critical.filter((rel) => !vfsPathExists(Module, `/${ASSET_PREFIX}/${rel}`));
    if (missing.length) {
      throw new Error(
        'Critical assets missing in VFS: ' + missing.join(', ') +
        '. Check gta3-assets directory.'
      );
    }
    // CUTS.IMG must be a real archive (~40MB+). A mistaken extract-dir deploy
    // used to leave a tiny file and freeze the intro flyby camera. The archive
    // itself is no longer preloaded — validate only when it's already in VFS.
    try {
      const cutsStat = Module.FS.stat(`/${ASSET_PREFIX}/anim/cuts.img`);
      if (cutsStat && cutsStat.size > 0 && cutsStat.size < 1_000_000) {
        throw new Error(
          `anim/cuts.img is too small (${cutsStat.size} bytes) — archive required.`
        );
      }
      if (cutsStat) console.log(`[regta3] cuts.img ok: ${cutsStat.size} bytes`);
    } catch (err) {
      if (String(err.message || err).includes('too small')) throw err;
      /* not in VFS yet — background prefetch delivers it */
    }
    // Тёплый старт для тяжёлых архивов: качаем cuts.img фоном, пока игрок в меню.
    prefetchAssetAsync('anim/cuts.img');
  },
  onAbort(what) {
    showDiagError('WASM abort: ' + what + '\n[frame: ' + frameIndex + ', sync calls: ' + syncCallCount + ']\n' + syncCallLog.slice(-10).join('\n'));
  },
  prefetchFirstMissionAudio,
  loadAsyncFile,
  getAsyncFileStatus,
  /* DOM-прогресс блокирующей LoadAllRequestedModels (regta3_js_load_progress).
   * current===total скрывает индикатор. Троттлинг ~100мс. */
  reportLoadProgress(current, total) {
    const now = performance.now();
    if (current >= total) {
      if (reportLoadProgressShown) {
        reportLoadProgressShown = false;
        setStatus('');
        setProgress(0, 0);
        setTouchDownloadState(false);
      }
      return;
    }
    if (now - reportLoadProgressLast < 100) return;
    reportLoadProgressLast = now;
    reportLoadProgressShown = true;
    setTouchDownloadState(true);
    setStatus(`Loading models: ${current}/${total}`);
    setProgress(current, total);
  },
  getAsyncUrl(file, onload, onerror) {
    const promise = resolveAsyncUrl(file);
    if (typeof onload === 'function') {
      promise.then(onload).catch((err) => {
        if (typeof onerror === 'function') onerror(err);
      });
      return;
    }
    return promise;
  },
  async mainCalled() {
    Module.FS.mkdirTree('/' + ASSET_PREFIX);
    unlockWebAudio();
    await Module.initFS();
    setStatus('Starting engine...');
    if (typeof Module.callMain === 'function') {
      Module.callMain();
    } else if (typeof Module._async_main === 'function') {
      Module._async_main();
    } else {
      throw new Error('callMain / _async_main not found in WASM');
    }
    if (!worldLoadComplete) {
      setStatus('Menu / loading...');
    }
  },
};

window.Module = Module;

/* Worker-based hang detector — rAF/setInterval die with the main thread. */
(function installHangWatchdog() {
  // Silent watchdog for diagnostics only
})();

async function bootGame() {
  if (bootStarted) return;
  bootStarted = true;
  mountCloudUi(); // параллельно с загрузкой ассетов; pull дождётся промиса
  installGestureUnlock();
  installPointerLockErrorSwallow();
  installTouchControls();

  try {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (typeof type === 'string' && type.indexOf('webgl') !== -1) {
        attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: false });
        /* If GLFW did not specify, prefer MSAA on for sharper edges. */
        if (attrs.antialias === undefined)
          attrs.antialias = true;
      }
      return origGetContext.call(this, type, attrs);
    };

    setStatus('Loading WASM...');
    if (typeof createRe3Module !== 'function') {
      throw new Error('createRe3Module not found');
    }
    await createRe3Module(Module);
    await Module.mainCalled();
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message);
    bootStarted = false;
  }
}

document.addEventListener('DOMContentLoaded', () => bootGame());
