(function () {
  const SUPABASE_URL = 'https://tjsyhfplxjtakdfkpdtg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ';
  const SUPABASE_TABLE = 'site_updates';
  const SUPABASE_ROW_ID = 'main';
  // Where admin-auth.js (and, if needed, the supabase-js CDN build) get
  // lazy-loaded from — same cross-origin pattern as coming-soon.js's
  // ensureAdminAuth(), so every subdomain's own copy of THIS file can still
  // authenticate as admin without bundling admin-auth.js locally too.
  const ASSET_ORIGIN = 'https://mayurski-art.github.io';
  const SITE_LOCK_STORAGE_KEY = 'trollrunner_site_public_lock_v1';
  const SITE_LOCK_META_ID = '__trollrunner_site_lock_meta__';
  const SITE_LOCK_WARNING_MS = 10000;
  const SITE_LOCK_POLL_MS = 1500;
  const SITE_LOCK_BROADCAST_CHANNEL = 'trollrunner-site-lock';
  const isAdminPage = /\/admin\.html(?:$|\?)/.test(window.location.pathname);
  const isPublicPage = !isAdminPage;
  const hasBroadcastChannel = typeof window.BroadcastChannel !== 'undefined';
  let pollTimer = null;
  let renderTimer = null;
  let broadcastChannel = null;
  let overlayEl = null;
  let tickerEl = null;
  let statusEl = null;
  let countdownEl = null;

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function normalizeRecord(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const mode = String(input.mode || input.state || 'open').toLowerCase();
    const normalizedMode = mode === 'pending' || mode === 'locked' ? mode : 'open';
    const pendingUntil = Number(input.pendingUntil || input.lockedAt || input.unlockAt || 0) || 0;
    return {
      mode: normalizedMode,
      pendingUntil,
      updatedAt: String(input.updatedAt || input.createdAt || new Date().toISOString()),
    };
  }

  function getStoredRecord() {
    return normalizeRecord(safeParse(localStorage.getItem(SITE_LOCK_STORAGE_KEY), {}));
  }

  function getReadHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
  }

  // Writes go through the troll_admin_replace_site_row RPC (see
  // assets/supabase/troll_admin_lockdown.sql), which requires a real admin
  // session — the anon key alone is no longer enough to write site_updates.
  async function getAdminWriteHeaders() {
    const headers = getReadHeaders();
    try {
      const token = await window.TrollrunnerAdminAuth?.getAccessToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    return headers;
  }

  // Lazy-loads a <script> once, resolving immediately if it's already on
  // the page (copied verbatim from coming-soon.js's identical helper, kept
  // in sync intentionally).
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', reject);
        setTimeout(resolve, 0);
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(el);
    });
  }

  // Only the admin-unlock corner needs real Supabase auth (sign-in, not
  // just anon reads) — everything else in this file already works off the
  // anon key. Pulled in on demand from the hub origin so every subdomain's
  // own copy of this file doesn't need to bundle admin-auth.js too.
  async function ensureAdminAuth() {
    if (window.TrollrunnerAdminAuth) return window.TrollrunnerAdminAuth;
    if (!window.supabase?.createClient) {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    }
    await loadScript(`${ASSET_ORIGIN}/assets/js/admin-auth.js`);
    return window.TrollrunnerAdminAuth || null;
  }

  function setStoredRecord(record) {
    const normalized = normalizeRecord(record);
    localStorage.setItem(SITE_LOCK_STORAGE_KEY, JSON.stringify(normalized));
    if (isPublicPage && document.body) renderOverlay();
    return normalized;
  }

  function getComputedRecord(record = getStoredRecord(), now = Date.now()) {
    const normalized = normalizeRecord(record);
    if (normalized.mode === 'pending') {
      if (normalized.pendingUntil && now >= normalized.pendingUntil) {
        return {
          mode: 'locked',
          pendingUntil: normalized.pendingUntil,
          updatedAt: normalized.updatedAt,
        };
      }
      return normalized;
    }
    return normalized;
  }

  function getRemainingSeconds(record = getComputedRecord()) {
    if (record.mode !== 'pending' || !record.pendingUntil) return 0;
    return Math.max(0, Math.ceil((record.pendingUntil - Date.now()) / 1000));
  }

  function buildMetaItem(record) {
    const normalized = normalizeRecord(record);
    return {
      id: SITE_LOCK_META_ID,
      title: '__site_lock_meta__',
      body: '__site_lock_meta__',
      createdAt: normalized.updatedAt || new Date().toISOString(),
      archived: true,
      source: 'system',
      siteLock: normalized,
    };
  }

  function extractRecordFromPayload(payload) {
    const updates = Array.isArray(payload?.updates) ? payload.updates : [];
    const meta = updates.find(item => item && item.id === SITE_LOCK_META_ID);
    return normalizeRecord(meta?.siteLock || payload?.siteLock || payload?.site_lock || {});
  }

  function ensureOverlay() {
    if (!isPublicPage) return null;
    if (overlayEl) return overlayEl;

    const style = document.createElement('style');
    style.setAttribute('data-site-lock-style', '1');
    style.textContent = `
      .site-lock-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background:
          repeating-linear-gradient(0deg, rgba(255, 64, 88, 0.08) 0 2px, transparent 2px 9px),
          radial-gradient(circle at 50% 50%, rgba(255, 64, 88, 0.2), transparent 44%),
          rgba(0, 0, 0, 0.42);
        backdrop-filter: blur(1px);
        animation: trollrunner-site-lock-red-alert 720ms steps(2, end) infinite;
      }
      .site-lock-overlay.is-visible { display: flex; }
      .site-lock-overlay.is-locked {
        background:
          repeating-linear-gradient(0deg, rgba(255, 64, 88, 0.07) 0 2px, transparent 2px 9px),
          rgba(0, 0, 0, 0.68);
        animation: none;
        pointer-events: auto;
      }
      .site-lock-overlay-panel {
        width: min(100vw, 100%);
        padding: clamp(18px, 4vw, 32px) 0;
        overflow: hidden;
        text-align: center;
      }
      .site-lock-overlay-ticker {
        display: flex;
        gap: 1.5rem;
        width: max-content;
        min-width: 200%;
        white-space: nowrap;
        padding: 12px 0;
        color: #ff4058;
        text-transform: uppercase;
        font-weight: 900;
        letter-spacing: 0.28em;
        font-size: clamp(18px, 4.2vw, 58px);
        text-shadow: 0 0 16px rgba(255, 64, 88, 0.45), 0 0 36px rgba(255, 64, 88, 0.22);
        animation: trollrunner-site-lock-marquee 10s linear infinite;
      }
      .site-lock-overlay-ticker span {
        display: inline-block;
      }
      .site-lock-overlay-subtext {
        margin-top: 18px;
        color: rgba(255, 255, 255, 0.76);
        font-size: clamp(12px, 1.6vw, 16px);
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      @keyframes trollrunner-site-lock-marquee {
        from { transform: translateX(0); }
        to { transform: translateX(-50%); }
      }
      @keyframes trollrunner-site-lock-red-alert {
        0%, 100% { box-shadow: inset 0 0 0 0 rgba(255, 64, 88, 0.1), inset 0 0 120px rgba(255, 64, 88, 0.18); }
        50% { box-shadow: inset 0 0 0 999px rgba(255, 64, 88, 0.1), inset 0 0 180px rgba(255, 64, 88, 0.38); }
      }
      .site-lock-warning body,
      body.site-lock-warning {
        overflow-x: hidden;
      }
      .site-lock-admin-corner {
        position: absolute;
        right: 10px;
        bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        opacity: 0.28;
        transition: opacity 0.2s ease;
        pointer-events: auto;
      }
      .site-lock-admin-corner:hover,
      .site-lock-admin-corner:focus-within {
        opacity: 1;
      }
      .site-lock-admin-input {
        width: 100px;
        padding: 5px 8px;
        border-radius: 7px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        font-size: 12px;
      }
      .site-lock-admin-btn {
        padding: 5px 10px;
        border-radius: 7px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .site-lock-admin-status {
        position: absolute;
        right: 0;
        bottom: 32px;
        width: max-content;
        max-width: 220px;
        font-size: 11px;
        color: #ff9fae;
        text-align: right;
      }
    `;
    document.head.appendChild(style);

    overlayEl = document.createElement('div');
    overlayEl.id = 'site-lock-overlay';
    overlayEl.className = 'site-lock-overlay';
    overlayEl.innerHTML = `
      <div class="site-lock-overlay-panel" role="alert" aria-live="assertive">
        <div class="site-lock-overlay-ticker" aria-hidden="true">
          <span id="site-lock-ticker-a"></span>
          <span id="site-lock-ticker-b"></span>
        </div>
        <div id="site-lock-status" class="site-lock-overlay-subtext"></div>
      </div>
      <div class="site-lock-admin-corner">
        <input id="site-lock-admin-pass" class="site-lock-admin-input" type="password" placeholder="admin password" aria-label="Admin password" autocomplete="current-password">
        <button id="site-lock-admin-go" class="site-lock-admin-btn" type="button" aria-label="Admin unlock">Unlock</button>
        <div id="site-lock-admin-status" class="site-lock-admin-status" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    tickerEl = overlayEl.querySelector('#site-lock-ticker-a');
    statusEl = overlayEl.querySelector('#site-lock-status');
    countdownEl = overlayEl.querySelector('#site-lock-ticker-b');
    wireAdminCorner();
    return overlayEl;
  }

  // The corner box that lets an admin unlock the whole network from
  // wherever they actually land while locked — any subdomain, any browser
  // state, no need to separately find and navigate to admin.html first.
  // Wired once, right alongside the overlay it lives in.
  function wireAdminCorner() {
    const input = overlayEl.querySelector('#site-lock-admin-pass');
    const goBtn = overlayEl.querySelector('#site-lock-admin-go');
    const status = overlayEl.querySelector('#site-lock-admin-status');
    if (!input || !goBtn || !status) return;

    async function submit() {
      const password = String(input.value || '');
      if (!password) {
        input.focus();
        return;
      }
      goBtn.disabled = true;
      status.textContent = 'Checking...';
      try {
        const auth = await ensureAdminAuth();
        if (!auth?.signInWithAdminPassword) throw new Error('Admin login service failed to load.');
        await auth.signInWithAdminPassword(password, { silent: true });
        input.value = '';
        status.textContent = '';
        requestLockTransition(false);
      } catch (error) {
        status.textContent = error?.message ? String(error.message) : 'Wrong admin password.';
      } finally {
        goBtn.disabled = false;
      }
    }

    goBtn.addEventListener('click', submit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    });
  }

  // While truly locked (not just the pending countdown warning), nothing
  // on the page should be usable except the overlay itself -- covers
  // login/register, feedback, chat, games, and everything else, not just
  // the parts a click-through overlay happened to sit visually on top of.
  // `inert` blocks both pointer AND keyboard/AT interaction for the whole
  // subtree; admin.html is a separate document and is never affected.
  function setBackgroundInert(isLocked) {
    if (!document.body) return;
    // The "coming soon" gate (assets/js/coming-soon.js) also needs everything
    // behind it inert until an admin unlocks it. Both scripts run a render
    // loop that touches every body child's `inert` attribute, so without this
    // check they fight each other every ~250ms. Folding its state in here
    // keeps a single source of truth instead of each loop clobbering the other.
    const comingSoonGate = document.getElementById('coming-soon-gate');
    const comingSoonActive = Boolean(comingSoonGate) && !comingSoonGate.classList.contains('is-unlocked');
    const shouldInert = isLocked || comingSoonActive;
    Array.from(document.body.children).forEach(child => {
      if (child === overlayEl || child === comingSoonGate) return;
      if (shouldInert) child.setAttribute('inert', '');
      else child.removeAttribute('inert');
    });
  }

  function buildTickerText(state) {
    if (state.mode === 'pending') {
      const seconds = getRemainingSeconds(state);
      return `WARNING SITE LOCKS IN ${seconds}s WARNING SITE LOCKS IN ${seconds}s WARNING SITE LOCKS IN ${seconds}s`;
    }
    return 'SITE LOCKED SITE LOCKED SITE LOCKED SITE LOCKED SITE LOCKED SITE LOCKED';
  }

  function renderOverlay() {
    const state = getComputedRecord();
    const overlay = ensureOverlay();
    if (!overlay) return state;

    const visible = state.mode === 'pending' || state.mode === 'locked';
    overlay.classList.toggle('is-visible', visible);
    overlay.classList.toggle('is-locked', state.mode === 'locked');
    document.body.classList.toggle('site-lock-warning', state.mode === 'pending');
    document.body.classList.toggle('site-lock-locked', state.mode === 'locked');
    setBackgroundInert(state.mode === 'locked');

    if (tickerEl) tickerEl.textContent = buildTickerText(state);
    if (countdownEl) countdownEl.textContent = state.mode === 'pending' ? `${getRemainingSeconds(state)} SECOND WARNING` : 'ACCESS PAUSED';
    if (statusEl) {
      statusEl.textContent = state.mode === 'pending'
        ? 'Public access will lock shortly.'
        : (state.mode === 'locked' ? 'Public access is locked.' : '');
    }
    return state;
  }

  function broadcastState() {
    if (!broadcastChannel) return;
    try {
      broadcastChannel.postMessage({ type: 'site-lock-state' });
    } catch {}
  }

  async function syncStateToBackend(record) {
    const normalized = normalizeRecord(record);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
    try {
      const qs = new URLSearchParams({
        select: 'updates',
        id: `eq.${SUPABASE_ROW_ID}`,
        limit: '1',
      });
      const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${qs.toString()}`, { headers: getReadHeaders() });
      if (!existingResponse.ok) return false;
      const json = await existingResponse.json();
      const payload = Array.isArray(json) ? json[0] : json;
      const existingUpdates = Array.isArray(payload?.updates) ? payload.updates : [];
      const nextUpdates = existingUpdates.filter(item => item && item.id !== SITE_LOCK_META_ID);
      nextUpdates.push(buildMetaItem(normalized));
      const writeResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/troll_admin_replace_site_row`, {
        method: 'POST',
        headers: await getAdminWriteHeaders(),
        body: JSON.stringify({ p_updates: nextUpdates }),
      });
      return writeResponse.ok;
    } catch {
      return false;
    }
  }

  async function pollRemoteState() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      if (isPublicPage) renderOverlay();
      return;
    }
    try {
      const qs = new URLSearchParams({
        select: 'updates',
        id: `eq.${SUPABASE_ROW_ID}`,
        limit: '1',
      });
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${qs.toString()}`, {
        headers: getReadHeaders(),
      });
      if (!response.ok) return;
      const json = await response.json();
      const payload = Array.isArray(json) ? json[0] : json;
      const nextRecord = extractRecordFromPayload(payload);
      const currentRecord = getStoredRecord();
      if (JSON.stringify(nextRecord) !== JSON.stringify(currentRecord)) {
        setStoredRecord(nextRecord);
        broadcastState();
      }
      if (isPublicPage) {
        renderOverlay();
      }
    } catch {
      if (isPublicPage) renderOverlay();
    }
  }

  function requestLockTransition(shouldLock) {
    const nextRecord = shouldLock
      ? {
          mode: 'pending',
          pendingUntil: Date.now() + SITE_LOCK_WARNING_MS,
          updatedAt: new Date().toISOString(),
        }
      : {
          mode: 'open',
          pendingUntil: 0,
          updatedAt: new Date().toISOString(),
        };
    setStoredRecord(nextRecord);
    renderOverlay();
    broadcastState();
    void syncStateToBackend(nextRecord);
    return getComputedRecord(nextRecord);
  }

  function hydrate() {
    renderOverlay();
    if (pollTimer) window.clearInterval(pollTimer);
    if (renderTimer) window.clearInterval(renderTimer);
    pollTimer = window.setInterval(pollRemoteState, SITE_LOCK_POLL_MS);
    renderTimer = window.setInterval(renderOverlay, 250);
    if (hasBroadcastChannel && !broadcastChannel) {
      try {
        broadcastChannel = new BroadcastChannel(SITE_LOCK_BROADCAST_CHANNEL);
        broadcastChannel.onmessage = () => {
          const local = getStoredRecord();
          if (!isPublicPage) return;
          renderOverlay(local);
        };
      } catch {
        broadcastChannel = null;
      }
    }
    window.addEventListener('storage', event => {
      if (event.key !== SITE_LOCK_STORAGE_KEY) return;
      renderOverlay();
    });
    void pollRemoteState();
  }

  window.TrollrunnerSiteLock = {
    storageKey: SITE_LOCK_STORAGE_KEY,
    metaId: SITE_LOCK_META_ID,
    warningMs: SITE_LOCK_WARNING_MS,
    getStoredRecord,
    setStoredRecord,
    getComputedRecord,
    getRemainingSeconds,
    buildMetaItem,
    extractRecordFromPayload,
    requestLockTransition,
    syncStateToBackend,
    refresh: pollRemoteState,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate, { once: true });
  } else {
    hydrate();
  }
})();
