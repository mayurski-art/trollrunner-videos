(function () {
  'use strict';

  // ── Supabase (same project as the other Troll Runner sites) ──
  const SUPABASE_URL = 'https://tjsyhfplxjtakdfkpdtg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ';
  const TABLE = 'videos';
  const REST = `${SUPABASE_URL}/rest/v1/${TABLE}`;

  function headers(extra) {
    return Object.assign({
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    }, extra || {});
  }

  // Writes now require a real admin session -- see supabase/videos.sql,
  // which gates insert/update/delete on troll_is_admin() (shared with the
  // main site's assets/supabase/troll_admin_lockdown.sql, same project).
  async function adminHeaders(extra) {
    const base = headers(extra);
    try {
      const token = await window.TrollrunnerAdminAuth?.getAccessToken?.();
      if (token) base.Authorization = `Bearer ${token}`;
    } catch {}
    return base;
  }

  // ── State ──
  let VIDEOS = [];
  const state = { topic: 'all', tag: null, search: '' };

  // ── Source detection ──
  // Returns { source, externalId } or null if unrecognized.
  function detectSource(rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!url) return null;
    let m;
    if (/drive\.google\.com/i.test(url)) {
      m = url.match(/\/d\/([-\w]{10,})/) || url.match(/[?&]id=([-\w]{10,})/);
      return { source: 'drive', externalId: m ? m[1] : null };
    }
    if (/tiktok\.com/i.test(url)) {
      m = url.match(/\/video\/(\d+)/) || url.match(/[?&]item_id=(\d+)/);
      return { source: 'tiktok', externalId: m ? m[1] : null };
    }
    if (/(?:twitter|x)\.com/i.test(url)) {
      m = url.match(/status(?:es)?\/(\d+)/);
      return { source: 'x', externalId: m ? m[1] : null };
    }
    return null;
  }

  const SRC_META = {
    drive:  { label: 'DRIVE',  emoji: '🟢' },
    x:      { label: 'X',      emoji: '✖' },
    tiktok: { label: 'TIKTOK', emoji: '🎵' },
  };

  // ── Data ──
  async function fetchVideos() {
    const qs = 'select=*&order=topic.asc,position.asc,created_at.asc';
    const res = await fetch(`${REST}?${qs}`, { headers: headers() });
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    return res.json();
  }

  async function insertVideo(row) {
    const res = await fetch(REST, {
      method: 'POST',
      headers: await adminHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify([row]),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status}) — ${await res.text()}`);
    return (await res.json())[0];
  }

  async function patchVideo(id, patch) {
    const res = await fetch(`${REST}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: await adminHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Update failed (${res.status})`);
    return (await res.json())[0];
  }

  async function deleteVideo(id) {
    const res = await fetch(`${REST}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await adminHeaders(),
    });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
  }

  // ── Admin ──
  function isAdmin() { return document.body.classList.contains('is-admin'); }
  async function syncAdmin() {
    const helper = window.TrollrunnerAdminAuth;
    const authed = helper && helper.hasAdminSession ? await helper.hasAdminSession() : false;
    document.body.classList.toggle('is-admin', !!authed);
    const btn = document.getElementById('admin-toggle');
    if (btn) btn.textContent = authed ? '🔒 ADMIN ON' : '🔓 ADMIN';
    return authed;
  }

  // ── Embeds (lazy, click-to-load) ──
  function loadScriptOnce(id, src) {
    return new Promise((resolve) => {
      let s = document.getElementById(id);
      if (s && s.dataset.loaded === '1') return resolve();
      if (!s) {
        s = document.createElement('script');
        s.id = id; s.src = src; s.async = true;
        s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
        s.addEventListener('error', () => resolve());
        document.body.appendChild(s);
      } else {
        s.addEventListener('load', () => resolve(), { once: true });
      }
    });
  }

  function loadEmbed(media, video) {
    media.querySelector('.poster')?.remove();
    if (video.source === 'drive') {
      const id = video.external_id || (detectSource(video.url) || {}).externalId;
      const iframe = document.createElement('iframe');
      iframe.src = `https://drive.google.com/file/d/${id}/preview`;
      iframe.allow = 'autoplay; fullscreen';
      iframe.allowFullscreen = true;
      iframe.loading = 'lazy';
      media.classList.add('ratio');
      media.appendChild(iframe);
      return;
    }
    if (video.source === 'x') {
      media.classList.remove('ratio', 'portrait');
      media.classList.add('embed');

      const skeleton = el('div', 'tweet-skeleton');
      skeleton.innerHTML =
        `<div class="top"><div class="row avatar"></div>` +
        `<div class="col"><div class="row w60"></div><div class="row w90"></div></div></div>` +
        `<div class="row full"></div>`;
      media.appendChild(skeleton);

      const bq = document.createElement('blockquote');
      bq.className = 'twitter-tweet';
      bq.setAttribute('data-theme', 'dark');
      bq.setAttribute('data-dnt', 'true');
      bq.innerHTML = `<a href="${video.url}"></a>`;
      media.appendChild(bq);

      const clearSkeleton = () => skeleton.remove();
      loadScriptOnce('twitter-wjs', 'https://platform.twitter.com/widgets.js').then(() => {
        if (window.twttr && window.twttr.widgets) {
          window.twttr.widgets.load(media).then(clearSkeleton).catch(clearSkeleton);
        } else {
          clearSkeleton();
        }
      });
      return;
    }
    if (video.source === 'tiktok') {
      media.classList.remove('ratio', 'portrait');
      media.classList.add('embed');
      const id = video.external_id || (detectSource(video.url) || {}).externalId;
      const bq = document.createElement('blockquote');
      bq.className = 'tiktok-embed';
      bq.setAttribute('cite', video.url);
      if (id) bq.setAttribute('data-video-id', id);
      bq.style.maxWidth = '605px';
      bq.style.minWidth = '288px';
      bq.innerHTML = `<a href="${video.url}"></a>`;
      media.appendChild(bq);
      // TikTok's embed.js processes blockquotes on (re)load.
      const old = document.getElementById('tiktok-wjs');
      if (old) old.remove();
      const s = document.createElement('script');
      s.id = 'tiktok-wjs'; s.async = true;
      s.src = 'https://www.tiktok.com/embed.js';
      document.body.appendChild(s);
    }
  }

  // ── Thumbnails (lazy, cached) ──
  const thumbCache = new Map();
  async function fetchThumb(video) {
    const key = `${video.source}:${video.external_id || video.url}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const p = (async () => {
      try {
        if (video.source === 'drive' && video.external_id) {
          return `https://drive.google.com/thumbnail?id=${video.external_id}&sz=w640`;
        }
        if (video.source === 'tiktok') {
          const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(video.url)}`);
          if (!res.ok) return null;
          const j = await res.json();
          return j.thumbnail_url || null;
        }
        // X/Twitter has no reliable first-party oEmbed thumbnail endpoint
        // that allows CORS from a browser, so X cards just show the plain
        // play poster until clicked — no third-party proxy dependency.
      } catch { /* thumbnail is a nice-to-have, never block on it */ }
      return null;
    })();
    thumbCache.set(key, p);
    return p;
  }
  function attachThumbnail(poster, video) {
    fetchThumb(video).then((url) => {
      if (!url || !poster.isConnected) return;
      poster.style.backgroundImage = `url("${url}")`;
      poster.classList.add('has-thumb');
    });
  }

  // ── Drag-to-reorder (admin only, within a topic) ──
  let dragState = { id: null, topic: null };

  function setupDragHandle(card, video) {
    card.addEventListener('dragstart', (e) => {
      if (!isAdmin()) { e.preventDefault(); return; }
      dragState = { id: video.id, topic: video.topic || 'Uncategorized' };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', video.id); } catch {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      const topic = dragState.topic;
      dragState = { id: null, topic: null };
      if (!topic) return;
      const grid = card.closest('.grid');
      if (!grid) return;
      const orderedIds = Array.from(grid.querySelectorAll('.card')).map((c) => c.dataset.id);
      persistReorder(topic, orderedIds);
    });
    card.addEventListener('dragover', (e) => {
      if (!dragState.id || dragState.id === video.id) return;
      if ((video.topic || 'Uncategorized') !== dragState.topic) return;
      e.preventDefault();
      const grid = card.closest('.grid');
      const draggingEl = grid && grid.querySelector('.card.dragging');
      if (!draggingEl || draggingEl === card) return;
      const rect = card.getBoundingClientRect();
      const insertBefore = e.clientX < rect.left + rect.width / 2;
      grid.insertBefore(draggingEl, insertBefore ? card : card.nextSibling);
    });
    card.addEventListener('drop', (e) => e.preventDefault());
  }

  function persistReorder(topic, orderedIds) {
    const byId = new Map(VIDEOS.map((v) => [v.id, v]));
    const groupVideos = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    const updates = [];
    groupVideos.forEach((v, i) => {
      if (v.position !== i) {
        v.position = i;
        updates.push(patchVideo(v.id, { position: i }).catch(() => {}));
      }
    });
    const firstIdx = VIDEOS.findIndex((v) => (v.topic || 'Uncategorized') === topic);
    const rest = VIDEOS.filter((v) => (v.topic || 'Uncategorized') !== topic);
    const insertAt = Math.min(firstIdx === -1 ? rest.length : firstIdx, rest.length);
    VIDEOS = [...rest.slice(0, insertAt), ...groupVideos, ...rest.slice(insertAt)];
    return Promise.all(updates);
  }

  // ── Card ──
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildCard(video) {
    const meta = SRC_META[video.source] || SRC_META.drive;
    const card = el('div', 'card pixel-box');
    card.dataset.id = video.id;
    setupDragHandle(card, video);

    const portrait = video.source === 'tiktok';
    const media = el('div', `media ratio${portrait ? ' portrait' : ''}`);
    const poster = el('div', 'poster');
    poster.innerHTML = `<button class="play" type="button">▶ PLAY</button>`;
    poster.addEventListener('click', () => loadEmbed(media, video));
    media.appendChild(poster);
    card.appendChild(media);
    attachThumbnail(poster, video);

    const head = el('div', 'card-head');
    const handle = el('span', 'drag-handle admin-only', '⠿');
    handle.title = 'Drag to reorder within this topic';
    handle.setAttribute('draggable', 'true');
    head.appendChild(handle);
    head.appendChild(el('div', `badge ${video.source}`, meta.label));
    const titleEl = el('div', 'title', escapeHtml(video.title || 'Untitled'));
    titleEl.title = video.title || 'Untitled';
    head.appendChild(titleEl);
    card.appendChild(head);

    // Tags
    const tagWrap = el('div', 'card-tags');
    (video.tags || []).forEach((t) => {
      const tag = el('span', 'tag');
      tag.innerHTML = `#${escapeHtml(t)}<span class="rm admin-only" title="remove tag">✕</span>`;
      tag.addEventListener('click', (e) => {
        if (e.target.classList.contains('rm')) {
          e.stopPropagation();
          removeTag(video, t);
        } else {
          state.tag = state.tag === t ? null : t;
          renderAll();
        }
      });
      tagWrap.appendChild(tag);
    });
    const addTag = el('span', 'tag add admin-only', '＋ tag');
    addTag.addEventListener('click', () => openEditModal(video));
    tagWrap.appendChild(addTag);
    card.appendChild(tagWrap);

    // Footer
    const foot = el('div', 'card-foot');
    const open = el('a', 'open', 'OPEN ↗');
    open.href = video.url; open.target = '_blank'; open.rel = 'noopener';
    foot.appendChild(open);
    const editTopic = el('button', 'icon-btn admin-only', '✎ EDIT');
    editTopic.addEventListener('click', () => openEditModal(video));
    foot.appendChild(editTopic);
    const del = el('button', 'icon-btn danger admin-only', '🗑 DELETE');
    del.addEventListener('click', () => onDelete(video));
    foot.appendChild(del);
    card.appendChild(foot);

    return card;
  }

  // ── Tag editing ──
  async function removeTag(video, tag) {
    const next = (video.tags || []).filter((t) => t !== tag);
    try {
      await patchVideo(video.id, { tags: next });
      video.tags = next;
      renderAll();
    } catch (e) { alert(e.message); }
  }
  // ── Edit modal (topic + tags, replaces the old prompt()-based flow) ──
  const editModal = { back: null, video: null, topic: null, tags: null, status: null };
  function openEditModal(video) {
    editModal.video = video;
    editModal.topic.value = video.topic || 'Uncategorized';
    editModal.tags.value = (video.tags || []).join(', ');
    setEditStatus('');
    editModal.back.classList.add('open');
    editModal.lastFocus = document.activeElement;
    editModal.topic.focus();
  }
  function closeEditModal() {
    editModal.back.classList.remove('open');
    editModal.video = null;
    editModal.lastFocus?.focus?.();
  }
  function setEditStatus(msg, kind) {
    editModal.status.textContent = msg || '';
    editModal.status.className = 'status' + (kind ? ' ' + kind : '');
  }
  async function onEditSave() {
    const video = editModal.video;
    if (!video) return;
    const topic = editModal.topic.value.trim() || 'Uncategorized';
    const tags = editModal.tags.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    setEditStatus('Saving…');
    try {
      await patchVideo(video.id, { topic, tags });
      video.topic = topic;
      video.tags = tags;
      closeEditModal();
      renderAll();
    } catch (e) { setEditStatus(e.message, 'error'); }
  }

  // Delete is optimistic + undoable for ~6s instead of a blocking confirm()
  // dialog — cheap insurance against fat-fingering the delete button.
  let pendingDelete = null; // { video, idx, timer }
  const toast = { root: null, msg: null, btn: null };

  function showUndoToast(video) {
    if (!toast.root) return;
    toast.msg.textContent = `Deleted "${video.title || 'video'}".`;
    toast.root.classList.add('show');
  }
  function hideUndoToast() {
    if (toast.root) toast.root.classList.remove('show');
  }

  function commitPendingDelete() {
    if (!pendingDelete) return;
    const { video } = pendingDelete;
    pendingDelete = null;
    hideUndoToast();
    deleteVideo(video.id).catch((e) => { console.error('Delete failed:', e); });
  }

  function undoPendingDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    const { video, idx } = pendingDelete;
    pendingDelete = null;
    VIDEOS.splice(Math.min(idx, VIDEOS.length), 0, video);
    hideUndoToast();
    renderAll();
  }

  function onDelete(video) {
    commitPendingDelete(); // any earlier pending delete is now final
    const idx = VIDEOS.findIndex((v) => v.id === video.id);
    if (idx === -1) return;
    VIDEOS.splice(idx, 1);
    renderAll();
    const timer = setTimeout(commitPendingDelete, 6000);
    pendingDelete = { video, idx, timer };
    showUndoToast(video);
  }

  // ── Filters + render ──
  function allTopics() {
    return Array.from(new Set(VIDEOS.map((v) => v.topic || 'Uncategorized'))).sort();
  }
  function allTags() {
    const s = new Set();
    VIDEOS.forEach((v) => (v.tags || []).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }

  function matches(v) {
    if (state.topic !== 'all' && (v.topic || 'Uncategorized') !== state.topic) return false;
    if (state.tag && !(v.tags || []).includes(state.tag)) return false;
    if (state.search) {
      const hay = `${v.title} ${v.topic} ${(v.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  }

  function renderFilters() {
    // Topics
    const tf = document.getElementById('topic-filters');
    tf.querySelectorAll('.chip').forEach((c) => c.remove());
    const mkTopic = (label, value) => {
      const c = el('span', `chip topic${state.topic === value ? ' active' : ''}`, escapeHtml(label));
      c.tabIndex = 0;
      c.addEventListener('click', () => { state.topic = value; renderAll(); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.topic = value; renderAll(); } });
      tf.appendChild(c);
    };
    mkTopic('ALL', 'all');
    allTopics().forEach((t) => mkTopic(t, t));

    // Tags
    const gf = document.getElementById('tag-filters');
    gf.querySelectorAll('.chip').forEach((c) => c.remove());
    const tags = allTags();
    gf.style.display = tags.length ? 'flex' : 'none';
    tags.forEach((t) => {
      const c = el('span', `chip${state.tag === t ? ' active' : ''}`, `#${escapeHtml(t)}`);
      c.tabIndex = 0;
      c.addEventListener('click', () => { state.tag = state.tag === t ? null : t; renderAll(); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.tag = state.tag === t ? null : t; renderAll(); } });
      gf.appendChild(c);
    });

    // Topic datalist (for add modal)
    const dl = document.getElementById('topic-list');
    if (dl) dl.innerHTML = allTopics().map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');
  }

  // Cards are only built PAGE_SIZE at a time per topic (each card fires
  // network requests for a thumbnail) — "load more" reveals the rest.
  // Progress resets whenever the active filters actually change.
  const PAGE_SIZE = 12;
  let revealed = {};
  let lastFilterSig = '';
  function filterSig() { return `${state.topic} ${state.tag} ${state.search}`; }

  function renderCatalog() {
    const root = document.getElementById('catalog');
    root.innerHTML = '';
    const visible = VIDEOS.filter(matches);

    if (!visible.length) {
      root.appendChild(el('div', 'empty pixel-box',
        VIDEOS.length
          ? '<span class="big">NO MATCHES</span>Try another topic or tag.'
          : '<span class="big">NO VIDEOS YET</span>Hit 🔓 ADMIN then ＋ ADD VIDEO to drop your first tape.'));
      return;
    }

    const sig = filterSig();
    if (sig !== lastFilterSig) { revealed = {}; lastFilterSig = sig; }

    // Group by topic
    const groups = {};
    visible.forEach((v) => {
      const k = v.topic || 'Uncategorized';
      (groups[k] = groups[k] || []).push(v);
    });
    Object.keys(groups).sort().forEach((topic) => {
      const all = groups[topic];
      if (!(topic in revealed)) revealed[topic] = Math.min(PAGE_SIZE, all.length);
      const shown = all.slice(0, revealed[topic]);

      const sec = el('div', 'topic-sec');
      const head = el('div', 'topic-head');
      head.appendChild(el('h2', null, escapeHtml(topic)));
      head.appendChild(el('div', 'rule'));
      head.appendChild(el('div', 'count', `${all.length} ▮`));
      sec.appendChild(head);
      const grid = el('div', 'grid');
      shown.forEach((v) => grid.appendChild(buildCard(v)));
      sec.appendChild(grid);

      if (revealed[topic] < all.length) {
        const more = el('button', 'btn load-more', `▼ LOAD MORE (${all.length - revealed[topic]})`);
        more.type = 'button';
        more.addEventListener('click', () => {
          revealed[topic] = Math.min(revealed[topic] + PAGE_SIZE, all.length);
          renderCatalog();
        });
        sec.appendChild(more);
      }

      root.appendChild(sec);
    });
  }

  function renderAll() {
    renderFilters();
    renderCatalog();
  }

  // ── Add modal ──
  const modal = {
    back: null, url: null, title: null, topic: null, tags: null, detected: null, status: null,
  };
  function openModal() {
    modal.url.value = '';
    modal.title.value = '';
    modal.topic.value = state.topic !== 'all' ? state.topic : '';
    modal.tags.value = '';
    modal.detected.textContent = '';
    setStatus('');
    modal.back.classList.add('open');
    modal.lastFocus = document.activeElement;
    modal.url.focus();
  }
  function closeModal() {
    modal.back.classList.remove('open');
    modal.lastFocus?.focus?.();
  }

  // ── Focus trap (shared by both modals) ──
  function getFocusable(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((n) => n.offsetParent !== null);
  }
  function trapFocus(e, container) {
    if (e.key !== 'Tab') return;
    const focusables = getFocusable(container);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function setStatus(msg, kind) {
    modal.status.textContent = msg || '';
    modal.status.className = 'status' + (kind ? ' ' + kind : '');
  }
  function onUrlInput() {
    const d = detectSource(modal.url.value);
    if (!d) { modal.detected.textContent = ''; return; }
    const m = SRC_META[d.source];
    modal.detected.style.color = d.externalId ? 'var(--green)' : 'var(--magenta)';
    modal.detected.textContent = d.externalId
      ? `${m.emoji} ${m.label} detected ✓`
      : `${m.emoji} ${m.label} — couldn't read the ID from that link`;
  }
  async function onSave() {
    const url = modal.url.value.trim();
    const d = detectSource(url);
    if (!d) return setStatus('Unrecognized link. Use a Drive, X, or TikTok URL.', 'error');
    if (!d.externalId) return setStatus('Could not parse the video ID from that link.', 'error');
    const dupe = VIDEOS.find((v) => v.source === d.source && v.external_id === d.externalId);
    if (dupe) return setStatus(`Already on the wall as "${dupe.title || 'Untitled'}" (${dupe.topic || 'Uncategorized'}).`, 'error');
    const row = {
      title: modal.title.value.trim() || 'Untitled',
      topic: modal.topic.value.trim() || 'Uncategorized',
      source: d.source,
      url,
      external_id: d.externalId,
      tags: modal.tags.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      position: VIDEOS.length,
    };
    setStatus('Saving…');
    try {
      const saved = await insertVideo(row);
      VIDEOS.push(saved);
      closeModal();
      renderAll();
    } catch (e) { setStatus(e.message, 'error'); }
  }

  // ── Util ──
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Boot ──
  async function boot() {
    modal.back = document.getElementById('modal-back');
    modal.url = document.getElementById('f-url');
    modal.title = document.getElementById('f-title');
    modal.topic = document.getElementById('f-topic');
    modal.tags = document.getElementById('f-tags');
    modal.detected = document.getElementById('f-detected');
    modal.status = document.getElementById('modal-status');

    editModal.back = document.getElementById('edit-modal-back');
    editModal.topic = document.getElementById('e-topic');
    editModal.tags = document.getElementById('e-tags');
    editModal.status = document.getElementById('edit-modal-status');
    document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-save').addEventListener('click', onEditSave);
    editModal.back.addEventListener('click', (e) => { if (e.target === editModal.back) closeEditModal(); });
    editModal.back.addEventListener('keydown', (e) => trapFocus(e, editModal.back));

    toast.root = document.getElementById('undo-toast');
    toast.msg = document.getElementById('undo-toast-msg');
    toast.btn = document.getElementById('undo-toast-btn');
    toast.btn?.addEventListener('click', undoPendingDelete);

    modal.url.addEventListener('input', onUrlInput);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', onSave);
    modal.back.addEventListener('click', (e) => { if (e.target === modal.back) closeModal(); });
    modal.back.addEventListener('keydown', (e) => trapFocus(e, modal.back));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (editModal.back?.classList.contains('open')) closeEditModal();
      else closeModal();
    });

    document.getElementById('add-video').addEventListener('click', openModal);
    window.addEventListener('beforeunload', commitPendingDelete);

    const search = document.getElementById('search');
    search.addEventListener('input', () => { state.search = search.value.trim().toLowerCase(); renderCatalog(); });

    document.getElementById('admin-toggle').addEventListener('click', async () => {
      const authed = await syncAdmin();
      const helper = window.TrollrunnerAdminAuth;
      if (!authed && helper && helper.requestAdminLink) {
        const ok = await helper.requestAdminLink();
        if (ok) { await syncAdmin(); renderAll(); }
      } else if (authed && helper && helper.signOut) {
        await helper.signOut();
        await syncAdmin();
        renderAll();
      }
    });
    window.addEventListener('storage', (e) => {
      if (e.key === (window.TrollrunnerAdminAuth && window.TrollrunnerAdminAuth.adminAuthKey)) {
        syncAdmin().then(renderAll);
      }
    });

    await syncAdmin();

    try {
      VIDEOS = await fetchVideos();
    } catch (e) {
      document.getElementById('catalog').innerHTML =
        `<div class="empty pixel-box"><span class="big">CONNECT ERROR</span>${escapeHtml(e.message)}<br>Run supabase/videos.sql in your Supabase project, then reload.</div>`;
      renderFilters();
      return;
    }
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
