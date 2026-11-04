export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ================= API =================
    if (url.pathname.startsWith('/api/')) {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

      try {
        if (!env.DB) return new Response(JSON.stringify({ error: 'Нет базы. Привяжи D1 в настройках!' }), { status: 500, headers: cors });

        if (url.pathname === '/api/threads' && request.method === 'GET') {
          const { results } = await env.DB.prepare(`
            SELECT t.*, (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count
            FROM threads t ORDER BY t.updated_at DESC LIMIT 100
          `).all();
          return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/threads' && request.method === 'POST') {
          const body = await request.json();
          const t = await env.DB.prepare(
            `INSERT INTO threads (section_slug, title, author_name) VALUES (?, ?, ?) RETURNING id`
          ).bind(body.section_slug || 'general', body.title, body.author_name || 'guest').first();
          await env.DB.prepare(
            `INSERT INTO posts (thread_id, author_name, body) VALUES (?, ?, ?)`
          ).bind(t.id, body.author_name || 'guest', body.body).run();
          return new Response(JSON.stringify({ id: t.id }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/posts' && request.method === 'GET') {
          const threadId = url.searchParams.get('thread');
          const thread = await env.DB.prepare(`SELECT * FROM threads WHERE id = ?`).bind(threadId).first();
          const { results } = await env.DB.prepare(`SELECT * FROM posts WHERE thread_id = ? ORDER BY created_at ASC`).bind(threadId).all();
          return new Response(JSON.stringify({ thread, posts: results }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/posts' && request.method === 'POST') {
          const body = await request.json();
          await env.DB.prepare(`INSERT INTO posts (thread_id, author_name, body) VALUES (?, ?, ?)`).bind(body.thread_id, body.author_name || 'guest', body.body).run();
          await env.DB.prepare(`UPDATE threads SET updated_at = unixepoch() WHERE id = ?`).bind(body.thread_id).run();
          return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }

    // ================= HTML =================
    const commonCSS = `
      :root { --win-bg: #c0c0c0; --win-dark: #808080; --win-light: #ffffff; --win-title: #000080; --win-title-text: #ffffff; --font-pixel: 'MS Sans Serif', 'Tahoma', 'Verdana', sans-serif; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: var(--font-pixel); font-size: 13px; background: #000; color: #000; min-height: 100vh; padding: 12px; }
      .window { background: var(--win-bg); border: 2px solid; border-color: var(--win-light) var(--win-dark) var(--win-dark) var(--win-light); box-shadow: 1px 1px 0 #000; margin-bottom: 12px; }
      .window__bar { background: linear-gradient(90deg, var(--win-title), #1084d0); color: var(--win-title-text); padding: 3px 6px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
      .win-btn { width: 18px; height: 16px; background: var(--win-bg); border: 1px solid; border-color: #fff #808080 #808080 #fff; font-size: 10px; cursor: pointer; padding: 0; line-height: 1; }
      .header__body { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; gap: 8px; }
      .logo { font-family: 'Impact', sans-serif; font-size: 36px; letter-spacing: 2px; color: var(--win-title); text-shadow: 1px 1px 0 #fff; }
      .tagline { font-size: 11px; color: #444; font-style: italic; }
      .marquee { margin-top: 4px; font-family: 'Times New Roman', serif; font-size: 12px; color: #800000; background: #ffffcc; border: 1px solid #808080; padding: 2px; }
      .nav { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 8px; background: #a0a0a0; border-top: 1px solid #fff; }
      .nav__link { padding: 3px 8px; font-size: 12px; text-decoration: none; color: #000080; }
      .nav__link:hover { background: #000080; color: #fff; }
      .layout { display: grid; grid-template-columns: 1fr 280px; gap: 12px; max-width: 1000px; margin: 0 auto; }
      .layout--single { grid-template-columns: 1fr; }
      .thread-list { list-style: none; padding: 6px; }
      .thread a { display: block; padding: 6px 8px; color: #000; text-decoration: none; border-bottom: 1px dotted #808080; }
      .thread a:hover { background: #ffffcc; }
      .thread__id { color: #000080; font-weight: bold; margin-right: 6px; }
      .thread__title { display: block; }
      .thread__meta { font-size: 11px; color: #444; }
      .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 6px; border-bottom: 1px solid #808080; }
      .neon-btn { display: inline-block; margin: 4px; padding: 6px 14px; background: var(--win-bg); color: #000; border: 2px solid; border-color: #fff #808080 #808080 #fff; font-family: var(--font-pixel); font-size: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase; }
      .neon-btn:hover { background: #d0d0d0; }
      .profile__body { padding: 12px; text-align: center; }
      .avatar { width: 80px; height: 80px; margin: 0 auto 8px; background: #fff; border: 2px solid #808080; display: grid; place-items: center; color: #808080; font-size: 40px; font-family: 'Times New Roman', serif; }
      .profile__name { color: var(--win-title); font-weight: bold; }
      .profile__status { font-size: 11px; color: #444; }
      .stats { padding: 8px 12px; font-size: 12px; }
      .footer { max-width: 1000px; margin: 16px auto 0; padding: 8px; text-align: center; font-size: 11px; color: #888; background: rgba(0,0,0,0.3); border: 1px solid #444; }
      .post { padding: 8px 12px; border-bottom: 1px solid #a0a0a0; }
      .post__head { display: flex; justify-content: space-between; font-size: 11px; color: #444; margin-bottom: 4px; }
      .post__author { color: var(--win-title); font-weight: bold; }
      .post__body { font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.4; }
      .reply-form { padding: 8px 12px; }
      .reply-form__textarea { width: 100%; font-family: 'Times New Roman', serif; font-size: 13px; padding: 4px; border: 2px solid; border-color: #808080 #fff #fff #808080; background: #fff; }
    `;

    // Главная страница
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>4OOM</title><style>${commonCSS}</style></head><body>
        <header class="header window">
          <div class="window__bar"><span>▣ 4OOM.exe</span><div class="window__buttons"><button class="win-btn" onclick="alert('Смена темы будет позже!')">◐</button><button class="win-btn" onclick="alert('Настройки в разработке')">⚙</button></div></div>
          <div class="header__body"><div class="header__center" style="text-align: center; flex: 1;"><h1 class="logo">4OOM</h1><p class="tagline">the room that never closed</p><marquee class="marquee" scrollamount="4">★ добро пожаловать в 4OOM ★</marquee></div></div>
          <nav class="nav"><a href="/" class="nav__link" style="font-weight: bold;">главная</a><a href="?section=general" class="nav__link">general</a></nav>
        </header>
        <main class="layout">
          <section class="window threads">
            <div class="window__bar"><span>📁 threads/</span></div>
            <div class="toolbar">
              <button class="neon-btn" onclick="document.getElementById('createForm').style.display='block'">+ НОВЫЙ ТРЕД</button>
              <span class="toolbar__info">сейчас играет: <em>Sunny Day Real Estate — Diary</em></span>
            </div>
            <ul class="thread-list" id="threadList"><li class="thread"><a href="#"><span class="thread__title">Загрузка...</span></a></li></ul>
            <div id="createForm" style="display:none; padding: 12px; background: #e0e0e0; border-top: 1px solid #808080;">
              <h3 style="margin-bottom: 8px;">Создать тред</h3>
              <input type="text" id="newTitle" placeholder="Заголовок" style="width: 100%; margin-bottom: 8px; padding: 4px;">
              <textarea id="newBody" placeholder="Текст поста" style="width: 100%; height: 80px; margin-bottom: 8px; padding: 4px;"></textarea>
              <button class="neon-btn" onclick="submitThread()">Создать</button>
              <button class="neon-btn" onclick="document.getElementById('createForm').style.display='none'">Отмена</button>
            </div>
          </section>
          <aside class="window profile">
            <div class="window__bar"><span>👤 guest</span></div>
            <div class="profile__body"><div class="avatar">?</div><p class="profile__name">guest_4oom</p><p class="profile__status">online · lurker</p><button class="neon-btn">войти</button></div>
          </aside>
        </main>
        <footer class="footer"><p>4OOM © 2024</p></footer>
        <script>
          function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
          async function loadThreads() {
            const list = document.getElementById('threadList');
            try {
              const r = await fetch('/api/threads');
              const threads = await r.json();
              if (!threads || threads.length === 0) { list.innerHTML = '<li class="thread"><a href="#"><span class="thread__title">Пока пусто — создай первый тред!</span></a></li>'; return; }
              list.innerHTML = threads.map(function(t) {
                return '<li class="thread"><a href="/thread?id=' + t.id + '"><span class="thread__id">#' + String(t.id).padStart(3, '0') + '</span><span class="thread__title">' + escapeHtml(t.title) + '</span><span class="thread__meta">' + t.reply_count + ' ответов</span></a></li>';
              }).join('');
            } catch(e) { list.innerHTML = '<li>Ошибка загрузки</li>'; }
          }
          async function submitThread() {
            const title = document.getElementById('newTitle').value;
            const body = document.getElementById('newBody').value;
            if (!title || !body) return alert('Заполни все поля');
            try {
              const res = await fetch('/api/threads', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, body, section_slug: 'general' }) });
              if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Ошибка сервера');
              }
              document.getElementById('createForm').style.display = 'none';
              document.getElementById('newTitle').value = '';
              document.getElementById('newBody').value = '';
              loadThreads();
            } catch(e) { alert('Ошибка при создании треда: ' + e.message); }
          }
          loadThreads();
        </script>
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Страница треда
    if (url.pathname === '/thread') {
      return new Response(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>4OOM — Тред</title><style>${commonCSS}</style></head><body>
        <header class="header window">
          <div class="window__bar"><span>▣ 4OOM.exe</span><div class="window__buttons"><button class="win-btn">◐</button><button class="win-btn">⚙</button></div></div>
          <nav class="nav"><a href="/" class="nav__link">← назад к тредам</a></nav>
        </header>
        <main class="layout layout--single">
          <section class="window">
            <div class="window__bar"><span>📄 Загрузка...</span></div>
            <div id="postList"></div>
            <div class="window__bar"><span>✍ ответить</span></div>
            <form class="reply-form" id="replyForm">
              <textarea class="reply-form__textarea" id="replyBody" placeholder="напиши что-нибудь..." rows="4"></textarea>
              <div class="reply-form__actions"><button type="submit" class="neon-btn">отправить</button></div>
            </form>
          </section>
        </main>
        <script>
          function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
          const threadId = new URLSearchParams(location.search).get('id');
          async function loadPosts() {
            if (!threadId) { location.href = '/'; return; }
            try {
              const r = await fetch('/api/posts?thread=' + threadId);
              const data = await r.json();
              document.querySelector('.window__bar span').textContent = '📄 #' + threadId + ' — ' + data.thread.title;
              document.getElementById('postList').innerHTML = data.posts.map(function(p) {
                return '<article class="post"><div class="post__head"><span class="post__author">' + escapeHtml(p.author_name) + '</span><span class="post__time">' + new Date(p.created_at * 1000).toLocaleString() + '</span></div><div class="post__body">' + escapeHtml(p.body) + '</div></article>';
              }).join('');
            } catch(e) { document.getElementById('postList').innerHTML = 'Ошибка загрузки треда'; }
          }
          document.getElementById('replyForm').addEventListener('submit', async e => {
            e.preventDefault();
            const body = document.getElementById('replyBody').value;
            if (!body) return;
            try {
              await fetch('/api/posts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ thread_id: threadId, body }) });
              document.getElementById('replyBody').value = '';
              loadPosts();
            } catch(e) { alert('Ошибка при отправке'); }
          });
          loadPosts();
        </script>
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
