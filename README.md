# trollrunner-videos

Pixel-nostalgic video wall for **videos.trollrunner.net** — Troll Runner drops
organized by topic, with add/delete tags and embeds for videos posted to
Google Drive, X, and TikTok.

Static GitHub Pages site. Video metadata lives in Supabase (same project as the
other Troll Runner sites). No build step.

## Files
- `index.html` — the page (Press Start 2P / VT323 retro UI, CRT scanlines).
- `assets/js/videos.js` — catalog: fetch/render by topic, tag filtering,
  add/delete (admin), and lazy Drive/X/TikTok embeds.
- `assets/js/admin-auth.js` — client-side admin password gate (shared pattern).
- `supabase/videos.sql` — one-time table + RLS setup.

## One-time setup
1. Open the Supabase project (`tjsyhfplxjtakdfkpdtg`) → SQL editor.
2. Paste and run `supabase/videos.sql`. This creates the `videos` table,
   enables public read + anon write (matching the existing site model), and
   seeds one sample Drive video.
3. Deploy (GitHub Pages serves `index.html`).

## Adding a video
1. Click **🔓 ADMIN**, enter the admin password.
2. Click **＋ ADD VIDEO**.
3. Paste a link — the source is auto-detected:
   - **Google Drive**: set the file to *Anyone with the link* first, then paste
     the share URL (`https://drive.google.com/file/d/<id>/view`).
   - **X**: paste the post URL (`https://x.com/<user>/status/<id>`).
   - **TikTok**: paste the video URL (`https://www.tiktok.com/@<user>/video/<id>`).
4. Set a title, a **topic** (videos group under topic headers), and optional
   tags (comma separated).

Tags can be added/removed per card while in admin mode (the `＋ tag` chip and
the ✕ on each tag). Topic + tag chips at the top filter the wall; the search
box matches title/topic/tags.

## Security note
The admin gate is client-side only (a password hash in `admin-auth.js`), so
Supabase writes go through the anon key — same as the other Troll Runner sites.
Good enough for a personal video wall; move to real Supabase auth if you ever
need hard server-side enforcement.
