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
        if (video.source === 'x' && video.external_id) {
          const res = await fetch(`https://api.vxtwitter.com/Twitter/status/${video.external_id}`);
          if (!res.ok) return null;
          const j = await res.json();
          return (j.media_extended && j.media_extended[0] && j.media_extended[0].thumbnail_url)
            || (j.mediaURLs && j.mediaURLs[0])
            || null;
        }
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

    const portrait = video.source === 'tiktok';
    const media = el('div', `media ratio${portrait ? ' portrait' : ''}`);
    const poster = el('div', 'poster');
    poster.innerHTML = `<button class="play" type="button">▶ PLAY</button>`;
    poster.addEventListener('click', () => loadEmbed(media, video));
    media.appendChild(poster);
    card.appendChild(media);
    attachThumbnail(poster, video);

    const head = el('div', 'card-head');
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
    addTag.addEventListener('click', () => promptAddTag(video));
    tagWrap.appendChild(addTag);
    card.appendChild(tagWrap);

    // Footer
    const foot = el('div', 'card-foot');
    const open = el('a', 'open', 'OPEN ↗');
    open.href = video.url; open.target = '_blank'; open.rel = 'noopener';
    foot.appendChild(open);
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
  async function promptAddTag(video) {
    const input = window.prompt('Add tag(s), comma separated:');
    if (input == null) return;
    const added = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!added.length) return;
    const set = new Set([...(video.tags || []), ...added]);
    const next = Array.from(set);
    try {
      await patchVideo(video.id, { tags: next });
      video.tags = next;
      renderAll();
    } catch (e) { alert(e.message); }
  }

  async function onDelete(video) {
    if (!window.confirm(`Delete “${video.title || 'this video'}”?`)) return;
    try {
      await deleteVideo(video.id);
      VIDEOS = VIDEOS.filter((v) => v.id !== video.id);
      renderAll();
    } catch (e) { alert(e.message); }
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

    // Group by topic
    const groups = {};
    visible.forEach((v) => {
      const k = v.topic || 'Uncategorized';
      (groups[k] = groups[k] || []).push(v);
    });
    Object.keys(groups).sort().forEach((topic) => {
      const sec = el('div', 'topic-sec');
      const head = el('div', 'topic-head');
      head.appendChild(el('h2', null, escapeHtml(topic)));
      head.appendChild(el('div', 'rule'));
      head.appendChild(el('div', 'count', `${groups[topic].length} ▮`));
      sec.appendChild(head);
      const grid = el('div', 'grid');
      groups[topic].forEach((v) => grid.appendChild(buildCard(v)));
      sec.appendChild(grid);
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
    modal.url.focus();
  }
  function closeModal() { modal.back.classList.remove('open'); }
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

    modal.url.addEventListener('input', onUrlInput);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', onSave);
    modal.back.addEventListener('click', (e) => { if (e.target === modal.back) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    document.getElementById('add-video').addEventListener('click', openModal);

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
