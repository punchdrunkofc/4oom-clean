export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ================= AUTH =================
    if (url.pathname === '/api/auth/login') {
      const ghUrl = `https://github.com/login/oauth/authorize?client_id=${env.GH_CLIENT_ID}&redirect_uri=${encodeURIComponent(url.origin + '/api/auth/callback')}&scope=read:user`;
      return Response.redirect(ghUrl, 302);
    }

    if (url.pathname === '/api/auth/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('No code provided', { status: 400 });

      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: env.GH_CLIENT_ID,
            client_secret: env.GH_CLIENT_SECRET,
            code: code,
            redirect_uri: url.origin + '/api/auth/callback'
          })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description);

        const userRes = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': '4OOM' }
        });
        const user = await userRes.json();

        let dbUser = await env.DB.prepare(`SELECT * FROM users WHERE github_id = ?`).bind(user.id).first();
        if (!dbUser) {
          await env.DB.prepare(
            `INSERT INTO users (github_id, github_login, display_name, avatar_url, role) VALUES (?, ?, ?, ?, 'user')`
          ).bind(user.id, user.login, user.login, user.avatar_url).run();
          dbUser = await env.DB.prepare(`SELECT * FROM users WHERE github_id = ?`).bind(user.id).first();
        }

        const userJson = JSON.stringify({ id: dbUser.id, login: dbUser.display_name, avatar: dbUser.avatar_url, role: dbUser.role });

        return new Response(`<!DOCTYPE html><html><body><script>
          localStorage.setItem('4oom_user', JSON.stringify(${userJson}));
          location.href = '/';
        </script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
      } catch (e) {
        return new Response('Auth error: ' + e.message, { status: 500 });
      }
    }

    // ================= API =================
    if (url.pathname.startsWith('/api/')) {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

      try {
        if (!env.DB) return new Response(JSON.stringify({ error: 'No database. Bind D1 in settings!' }), { status: 500, headers: cors });

        if (url.pathname === '/api/profile' && request.method === 'POST') {
          const body = await request.json();
          if (!body.user_id) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
          await env.DB.prepare(`UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?`).bind(body.display_name, body.avatar_url, body.user_id).run();
          return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/posts/delete' && request.method === 'POST') {
          const body = await request.json();
          if (!body.post_id || !body.user_role || !body.user_login) {
            return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
          }

          const post = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(body.post_id).first();
          if (!post) return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: cors });

          const isAdmin = ['creator', 'moderator', 'editor'].includes(body.user_role);
          const isOwner = post.author_name === body.user_login;

          if (!isAdmin && !isOwner) {
            return new Response(JSON.stringify({ error: 'No permission' }), { status: 403, headers: cors });
          }

          const firstPost = await env.DB.prepare(`SELECT id FROM posts WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1`).bind(post.thread_id).first();
          
          if (firstPost && firstPost.id === post.id) {
            await env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(post.thread_id).run();
          } else {
            await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(body.post_id).run();
          }

          return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/threads' && request.method === 'GET') {
          const { results } = await env.DB.prepare(`
            SELECT t.*, 
            (SELECT id FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1) AS first_post_id,
            (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count
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
            `INSERT INTO posts (thread_id, author_name, body, image_url) VALUES (?, ?, ?, ?)`
          ).bind(t.id, body.author_name || 'guest', body.body, body.image_url || null).run();
          return new Response(JSON.stringify({ id: t.id }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/posts' && request.method === 'GET') {
          const threadId = url.searchParams.get('thread');
          const thread = await env.DB.prepare(`SELECT * FROM threads WHERE id = ?`).bind(threadId).first();
          if (!thread) return new Response(JSON.stringify({ error: 'Thread not found' }), { status: 404, headers: cors });
          
          const { results } = await env.DB.prepare(`
            SELECT p.*, u.avatar_url AS author_avatar, u.role AS author_role
            FROM posts p LEFT JOIN users u ON p.author_name = u.display_name
            WHERE p.thread_id = ? ORDER BY p.created_at ASC
          `).bind(threadId).all();
          return new Response(JSON.stringify({ thread, posts: results }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/posts' && request.method === 'POST') {
          const body = await request.json();
          await env.DB.prepare(`INSERT INTO posts (thread_id, author_name, body, image_url) VALUES (?, ?, ?, ?)`).bind(body.thread_id, body.author_name || 'guest', body.body, body.image_url || null).run();
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
      body { font-family: var(--font-pixel); font-size: 13px; background-color: #000; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23000'/%3E%3Ccircle cx='10' cy='10' r='1' fill='%23fff'/%3E%3Ccircle cx='50' cy='50' r='1.5' fill='%23fff'/%3E%3Ccircle cx='80' cy='20' r='1' fill='%23fff'/%3E%3Ccircle cx='30' cy='80' r='1' fill='%23fff'/%3E%3Ccircle cx='90' cy='90' r='1.5' fill='%23fff'/%3E%3C/svg%3E"); background-repeat: repeat; color: #000; min-height: 100vh; padding: 12px; }
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
      .thread { border-bottom: 1px dotted #808080; padding: 6px 8px; display: flex; justify-content: space-between; align-items: center; }
      .thread a { text-decoration: none; color: #000; flex-grow: 1; }
      .thread a:hover { color: #000080; }
      .thread__title { display: block; font-weight: bold; }
      .thread__meta { font-size: 11px; color: #444; }
      
      .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 6px; border-bottom: 1px solid #808080; }
      .neon-btn { display: inline-block; margin: 4px; padding: 6px 14px; background: var(--win-bg); color: #000; border: 2px solid; border-color: #fff #808080 #808080 #fff; font-family: var(--font-pixel); font-size: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase; }
      .neon-btn:hover { background: #d0d0d0; }
      .profile__body { padding: 12px; text-align: center; }
      .avatar { width: 80px; height: 80px; margin: 0 auto 8px; background: #fff; border: 2px solid #808080; display: grid; place-items: center; color: #808080; font-size: 40px; font-family: 'Times New Roman', serif; object-fit: cover; }
      .profile__name { color: var(--win-title); font-weight: bold; }
      .profile__status { font-size: 11px; color: #444; }
      .stats { padding: 8px 12px; font-size: 12px; }
      .footer { max-width: 1000px; margin: 16px auto 0; padding: 8px; text-align: center; font-size: 11px; color: #888; background: rgba(0,0,0,0.3); border: 1px solid #444; }
      .post { padding: 8px 12px; border-bottom: 1px solid #a0a0a0; }
      .post__head { display: flex; justify-content: space-between; font-size: 11px; color: #444; margin-bottom: 4px; }
      .post__author { color: var(--win-title); font-weight: bold; display: flex; align-items: center; gap: 6px; }
      .post__avatar { width: 24px; height: 24px; border: 1px solid #808080; object-fit: cover; }
      .post__body { font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.4; margin-top: 4px; }
      .post__img { max-width: 100%; max-height: 400px; margin-top: 8px; border: 2px solid #808080; display: block; }
      .reply-form { padding: 8px 12px; }
      .reply-form__textarea { width: 100%; font-family: 'Times New Roman', serif; font-size: 13px; padding: 4px; border: 2px solid; border-color: #808080 #fff #fff #808080; background: #fff; margin-bottom: 4px; }
      .reply-form__input { width: 100%; padding: 4px; margin-bottom: 8px; border: 2px solid; border-color: #808080 #fff #fff #808080; }
      .settings-form { padding: 12px; }
      .settings-form label { display: block; margin-bottom: 4px; font-weight: bold; }
      .settings-form input { width: 100%; padding: 4px; margin-bottom: 12px; border: 2px solid; border-color: #808080 #fff #fff #808080; }
      
      .role-badge { display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: bold; color: #fff; border-radius: 2px; margin-left: 4px; }
      .role-moderator { background: #006400; }
      .role-editor { background: #000080; }

      /* --- ОБНОВЛЕННАЯ РАДУГА --- */
      .creator-name {
        font-weight: bold;
        /* Градиент строго слева направо (to right) */
        background: linear-gradient(to right, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3, #ff0000);
        background-size: 200% auto; /* Растягиваем фон */
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        /* Замедлили анимацию до 8 секунд */
        animation: rainbow-anim 8s linear infinite;
      }
      @keyframes rainbow-anim {
        0% { background-position: 0% center; }
        100% { background-position: 200% center; }
      }

      .role-creator-glitter {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        background: #ff69b4;
        border: 2px dashed #fff;
        box-shadow: 0 0 5px #ff69b4, 0 0 10px #ff69b4;
        animation: glitter-pulse 1.5s infinite alternate;
      }
      @keyframes glitter-pulse {
        0% { box-shadow: 0 0 5px #ff69b4, 0 0 10px #ff69b4; border-color: #fff; }
        100% { box-shadow: 0 0 15px #ff69b4, 0 0 20px #ffb6c1; border-color: #ffe4e1; }
      }

      .delete-btn { background: #ffcccc; border: 1px solid #800000; color: #800000; font-size: 10px; padding: 1px 4px; cursor: pointer; margin-left: 8px; white-space: nowrap; }
      .delete-btn:hover { background: #ff0000; color: #fff; }
    `;

    // Home page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>4OOM</title><style>${commonCSS}</style></head><body>
        <header class="header window">
          <div class="window__bar"><span>▣ 4OOM.exe</span><div class="window__buttons"><button class="win-btn" onclick="location.href='/settings'">⚙</button></div></div>
          <div class="header__body"><div class="header__center" style="text-align: center; flex: 1;"><h1 class="logo">4OOM</h1><p class="tagline">the room that never closed</p><marquee class="marquee" scrollamount="4">★ welcome to 4OOM ★ be nice ★ no spam ★ have fun ★</marquee></div></div>
          <nav class="nav"><a href="/" class="nav__link" style="font-weight: bold;">home</a><a href="?section=general" class="nav__link">general</a></nav>
        </header>
        <main class="layout">
          <section class="window threads">
            <div class="window__bar"><span>📁 threads/</span></div>
            <div class="toolbar">
              <button class="neon-btn" onclick="document.getElementById('createForm').style.display='block'">+ NEW THREAD</button>
            </div>
            <ul class="thread-list" id="threadList"><li class="thread"><a href="#"><span class="thread__title">Loading...</span></a></li></ul>
            <div id="createForm" style="display:none; padding: 12px; background: #e0e0e0; border-top: 1px solid #808080;">
              <h3 style="margin-bottom: 8px;">Create Thread</h3>
              <input type="text" id="newTitle" placeholder="Title" style="width: 100%; margin-bottom: 8px; padding: 4px;">
              <textarea id="newBody" placeholder="Post text" style="width: 100%; height: 80px; margin-bottom: 8px; padding: 4px;"></textarea>
              <input type="text" id="newImage" placeholder="Image URL (optional)" style="width: 100%; margin-bottom: 8px; padding: 4px;">
              <button class="neon-btn" onclick="submitThread()">Create</button>
              <button class="neon-btn" onclick="document.getElementById('createForm').style.display='none'">Cancel</button>
            </div>
          </section>
          <aside class="window profile">
            <div class="window__bar"><span>👤 profile</span></div>
            <div class="profile__body" id="profileBox">
              <div class="avatar">?</div>
              <p class="profile__name" id="profileName">guest_4oom</p>
              <p class="profile__status">online · lurker</p>
              <button class="neon-btn" onclick="location.href='/api/auth/login'">login with GitHub</button>
            </div>
          </aside>
        </main>
        <footer class="footer"><p>4OOM © 2024</p></footer>
        <script>
          function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
          
          const userJson = localStorage.getItem('4oom_user');
          let currentUser = null;
          if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) { localStorage.removeItem('4oom_user'); } }
          
          function getRoleBadge(role) {
            if (!role || role === 'user') return '';
            if (role === 'creator') return \`<span class="role-badge role-creator-glitter">CREATOR</span>\`;
            const labels = { moderator: 'MOD', editor: 'EDITOR' };
            return \`<span class="role-badge role-\${role}">\${labels[role]}</span>\`;
          }

          function formatName(name, role) {
            if (role === 'creator') return \`<span class="creator-name">\${escapeHtml(name)}</span>\`;
            return escapeHtml(name);
          }

          if (currentUser) {
            document.getElementById('profileName').textContent = currentUser.login;
            document.getElementById('profileBox').innerHTML = \`
              <img src="\${currentUser.avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2240%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E'}" class="avatar" alt="avatar">
              <p class="profile__name">\${formatName(currentUser.login, currentUser.role)} \${getRoleBadge(currentUser.role)}</p>
              <p class="profile__status">online · github user</p>
              <button class="neon-btn" onclick="location.href='/settings'">settings</button>
              <button class="neon-btn" onclick="localStorage.clear();location.reload()">logout</button>
            \`;
          }

          async function deleteThread(firstPostId) {
            if (!confirm('Delete this thread completely?')) return;
            try {
              const res = await fetch('/api/posts/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  post_id: firstPostId, 
                  user_role: currentUser ? currentUser.role : 'guest', 
                  user_login: currentUser ? currentUser.login : 'guest' 
                })
              });
              if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error);
              }
              loadThreads();
            } catch(e) { alert('Error: ' + e.message); }
          }

          async function loadThreads() {
            const list = document.getElementById('threadList');
            try {
              const r = await fetch('/api/threads');
              const threads = await r.json();
              if (!threads || threads.length === 0) { list.innerHTML = '<li class="thread"><a href="#"><span class="thread__title">Nothing here yet — create the first thread!</span></a></li>'; return; }
              
              list.innerHTML = threads.map(function(t) {
                const canDelete = currentUser && (
                  ['creator', 'moderator', 'editor'].includes(currentUser.role) || 
                  t.author_name === currentUser.login
                );
                const deleteBtn = canDelete ? \`<button class="delete-btn" onclick="event.preventDefault(); deleteThread(\${t.first_post_id})">delete</button>\` : '';
                
                return \`<li class="thread">
                  <a href="/thread?id=\${t.id}">
                    <span class="thread__title">\${escapeHtml(t.title)}</span>
                    <span class="thread__meta">by \${formatName(t.author_name, 'user')} · \${t.reply_count} replies</span>
                  </a>
                  \${deleteBtn}
                </li>\`;
              }).join('');
            } catch(e) { list.innerHTML = '<li>Load error</li>'; }
          }
          async function submitThread() {
            const title = document.getElementById('newTitle').value;
            const body = document.getElementById('newBody').value;
            const image_url = document.getElementById('newImage').value;
            if (!title || !body) return alert('Fill in title and text');
            try {
              const res = await fetch('/api/threads', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, body, image_url, section_slug: 'general', author_name: currentUser ? currentUser.login : 'guest' }) });
              if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Server error');
              }
              document.getElementById('createForm').style.display = 'none';
              document.getElementById('newTitle').value = '';
              document.getElementById('newBody').value = '';
              document.getElementById('newImage').value = '';
              loadThreads();
            } catch(e) { alert('Error creating thread: ' + e.message); }
          }
          loadThreads();
        </script>
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Settings page
    if (url.pathname === '/settings') {
      return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>4OOM — Settings</title><style>${commonCSS}</style></head><body>
        <header class="header window">
          <div class="window__bar"><span>▣ 4OOM.exe — Settings</span><div class="window__buttons"><button class="win-btn" onclick="location.href='/'">×</button></div></div>
          <nav class="nav"><a href="/" class="nav__link">← back to home</a></nav>
        </header>
        <main class="layout layout--single">
          <section class="window">
            <div class="window__bar"><span>🎨 Account Editor</span></div>
            <div class="settings-form">
              <label>Your nickname:</label>
              <input type="text" id="setNick" placeholder="Enter nickname">
              
              <label>Avatar URL:</label>
              <input type="text" id="setAvatar" placeholder="https://example.com/avatar.gif">
              
              <button class="neon-btn" onclick="saveSettings()">Save</button>
              <button class="neon-btn" onclick="location.href='/'">Cancel</button>
            </div>
          </section>
        </main>
        <script>
          const userJson = localStorage.getItem('4oom_user');
          let currentUser = null;
          if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) {} }

          if (currentUser) {
            document.getElementById('setNick').value = currentUser.login;
            document.getElementById('setAvatar').value = currentUser.avatar || '';
          }

          async function saveSettings() {
            if (!currentUser) return alert('Please login with GitHub first!');
            const nick = document.getElementById('setNick').value.trim();
            const avatar = document.getElementById('setAvatar').value.trim();
            
            if (!nick) return alert('Nickname cannot be empty');
            
            try {
              const res = await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.id, display_name: nick, avatar_url: avatar })
              });
              if (!res.ok) throw new Error('Save error');
              
              currentUser.login = nick;
              currentUser.avatar = avatar;
              localStorage.setItem('4oom_user', JSON.stringify(currentUser));
              
              alert('Settings saved!');
              location.href = '/';
            } catch(e) { alert('Error: ' + e.message); }
          }
        </script>
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Thread page
    if (url.pathname === '/thread') {
      return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>4OOM — Thread</title><style>${commonCSS}</style></head><body>
        <header class="header window">
          <div class="window__bar"><span>▣ 4OOM.exe</span><div class="window__buttons"><button class="win-btn" onclick="location.href='/settings'">⚙</button></div></div>
          <nav class="nav"><a href="/" class="nav__link">← back to threads</a></nav>
        </header>
        <main class="layout layout--single">
          <section class="window">
            <div class="window__bar"><span>📄 Loading...</span></div>
            <div id="postList"></div>
            <div class="window__bar"><span>✍ reply</span></div>
            <form class="reply-form" id="replyForm">
              <textarea class="reply-form__textarea" id="replyBody" placeholder="type something..." rows="4"></textarea>
              <input type="text" class="reply-form__input" id="replyImage" placeholder="Image URL (optional)">
              <div class="reply-form__actions"><button type="submit" class="neon-btn">send</button></div>
            </form>
          </section>
        </main>
        <script>
          function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
          
          const userJson = localStorage.getItem('4oom_user');
          let currentUser = null;
          if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) {} }
          const threadId = new URLSearchParams(location.search).get('id');
          
          function getRoleBadge(role) {
            if (!role || role === 'user') return '';
            if (role === 'creator') return \`<span class="role-badge role-creator-glitter">CREATOR</span>\`;
            const labels = { moderator: 'MOD', editor: 'EDITOR' };
            return \`<span class="role-badge role-\${role}">\${labels[role]}</span>\`;
          }

          function formatName(name, role) {
            if (role === 'creator') return \`<span class="creator-name">\${escapeHtml(name)}</span>\`;
            return escapeHtml(name);
          }

          async function deletePost(postId) {
            if (!confirm('Delete this post?')) return;
            try {
              const res = await fetch('/api/posts/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  post_id: postId, 
                  user_role: currentUser ? currentUser.role : 'guest', 
                  user_login: currentUser ? currentUser.login : 'guest' 
                })
              });
              if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error);
              }
              loadPosts();
            } catch(e) { alert('Error: ' + e.message); }
          }
          
          async function loadPosts() {
            if (!threadId) { location.href = '/'; return; }
            try {
              const r = await fetch('/api/posts?thread=' + threadId);
              if (!r.ok) { 
                if (r.status === 404) { alert('This thread has been deleted.'); location.href='/'; return; }
              }
              const data = await r.json();
              document.querySelector('.window__bar span').textContent = '📄 ' + data.thread.title;
              
              document.getElementById('postList').innerHTML = data.posts.map(function(p) {
                let avatarHtml = '';
                if (p.author_avatar) {
                  avatarHtml = '<img src="' + p.author_avatar + '" class="post__avatar" alt="avatar">';
                } else {
                  avatarHtml = '<div style="width:24px; height:24px; background:#ccc; border: 1px solid #808080; display:inline-block; vertical-align: middle;"></div>';
                }
                
                const canDelete = currentUser && (
                  ['creator', 'moderator', 'editor'].includes(currentUser.role) || 
                  p.author_name === currentUser.login
                );
                const deleteBtn = canDelete ? \`<button class="delete-btn" onclick="deletePost(\${p.id})">delete</button>\` : '';
                
                let imgHtml = p.image_url ? '<img src="' + p.image_url + '" class="post__img" alt="image" onerror="this.style.display=\\'none\\'">' : '';
                
                return '<article class="post"><div class="post__head"><span class="post__author">' + avatarHtml + formatName(p.author_name, p.author_role) + getRoleBadge(p.author_role) + deleteBtn + '</span><span class="post__time">' + new Date(p.created_at * 1000).toLocaleString() + '</span></div><div class="post__body">' + escapeHtml(p.body) + imgHtml + '</div></article>';
              }).join('');
            } catch(e) { document.getElementById('postList').innerHTML = 'Error loading thread'; }
          }
          
          document.getElementById('replyForm').addEventListener('submit', async e => {
            e.preventDefault();
            const body = document.getElementById('replyBody').value;
            const image_url = document.getElementById('replyImage').value;
            if (!body) return;
            try {
              await fetch('/api/posts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ thread_id: threadId, body, image_url, author_name: currentUser ? currentUser.login : 'guest' }) });
              document.getElementById('replyBody').value = '';
              document.getElementById('replyImage').value = '';
              loadPosts();
            } catch(e) { alert('Error sending'); }
          });
          loadPosts();
        </script>
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
