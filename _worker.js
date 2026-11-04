export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- СТАТИКА ---
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

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
        // ИСПРАВЛЕНИЕ: Добавлен JOIN с таблицей users, чтобы получить роль автора треда
        const { results } = await env.DB.prepare(`
          SELECT t.*, u.role AS author_role,
          (SELECT id FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1) AS first_post_id,
          (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count
          FROM threads t 
          LEFT JOIN users u ON t.author_name = u.display_name
          ORDER BY t.updated_at DESC LIMIT 100
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

    return new Response('Not found', { status: 404 });
  },
};
