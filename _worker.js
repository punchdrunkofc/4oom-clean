import { DurableObject } from 'cloudflare:workers';

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.ctx.getWebSockets().forEach((ws) => {
      let attachment = ws.deserializeAttachment();
      if (attachment) this.sessions.set(ws, attachment);
    });
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    
    const nick = new URL(request.url).searchParams.get('nick') || 'guest';

    // УДАЛЯЕМ СТАРОЕ СОЕДИНЕНИЕ С ТАКИМ ЖЕ НИКОМ
    for (let [ws, session] of this.sessions.entries()) {
      if (session.nick === nick) {
        try { ws.close(1000, 'New session opened'); } catch (e) {}
        this.sessions.delete(ws);
      }
    }

    server.serializeAttachment({ nick });
    this.sessions.set(server, { nick });
    this.broadcastOnline();
    
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    const data = JSON.parse(message);
    const msgToSend = JSON.stringify({ type: 'chat', user: session.nick, text: data.text, time: Date.now() });
    this.ctx.getWebSockets().forEach((client) => { try { client.send(msgToSend); } catch (e) {} });
  }

  async webSocketClose(ws) {
    this.sessions.delete(ws);
    this.broadcastOnline();
  }

  broadcastOnline() {
    const onlineUsers = Array.from(this.sessions.values()).map(s => s.nick);
    const msg = JSON.stringify({ type: 'online', users: onlineUsers });
    this.ctx.getWebSockets().forEach((client) => { try { client.send(msg); } catch (e) {} });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // WEBSOCKET
    if (url.pathname === '/api/chat/ws') {
      const nick = url.searchParams.get('nick') || 'guest';
      const id = env.CHAT_ROOM.idFromName('global');
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(new Request(url.origin + '/ws?nick=' + encodeURIComponent(nick), request));
    }

    // AUTH
    if (url.pathname === '/api/auth/login') {
      const ghUrl = `https://github.com/login/oauth/authorize?client_id=${env.GH_CLIENT_ID}&redirect_uri=${encodeURIComponent(url.origin + '/api/auth/callback')}&scope=read:user`;
      return Response.redirect(ghUrl, 302);
    }
    if (url.pathname === '/api/auth/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('No code provided', { status: 400 });
      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: env.GH_CLIENT_ID, client_secret: env.GH_CLIENT_SECRET, code, redirect_uri: url.origin + '/api/auth/callback' })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description);
        const userRes = await fetch('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': '4OOM' } });
        const user = await userRes.json();
        let dbUser = await env.DB.prepare(`SELECT * FROM users WHERE github_id = ?`).bind(user.id).first();
        if (!dbUser) {
          await env.DB.prepare(`INSERT INTO users (github_id, github_login, display_name, avatar_url, role) VALUES (?, ?, ?, ?, 'user')`).bind(user.id, user.login, user.login, user.avatar_url).run();
          dbUser = await env.DB.prepare(`SELECT * FROM users WHERE github_id = ?`).bind(user.id).first();
        }
        const userJson = JSON.stringify({ id: dbUser.id, login: dbUser.display_name, avatar: dbUser.avatar_url, role: dbUser.role, font: dbUser.font_family });
        return new Response(`<html><body><script>localStorage.setItem('4oom_user', JSON.stringify(${userJson}));location.href='/';</script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
      } catch (e) { return new Response('Auth error: ' + e.message, { status: 500 }); }
    }

    // API
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      if (!env.DB) return new Response(JSON.stringify({ error: 'No DB' }), { status: 500, headers: cors });

      if (url.pathname === '/api/user' && request.method === 'GET') {
        const login = url.searchParams.get('login');
        let user = await env.DB.prepare(`SELECT id, display_name, avatar_url, banner_url, banner_position, bio, role, font_family, background_url FROM users WHERE display_name = ?`).bind(login).first();
        if (!user) user = await env.DB.prepare(`SELECT id, display_name, avatar_url, banner_url, banner_position, bio, role, font_family, background_url FROM users WHERE github_login = ?`).bind(login).first();
        if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: cors });
        const { results: threads } = await env.DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count FROM threads t WHERE t.author_name = ? ORDER BY t.updated_at DESC`).bind(user.display_name).all();
        return new Response(JSON.stringify({ user, threads }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const b = await request.json();
        await env.DB.prepare(`UPDATE users SET display_name = ?, avatar_url = ?, banner_url = ?, banner_position = ?, bio = ?, font_family = ?, background_url = ? WHERE id = ?`).bind(b.display_name, b.avatar_url, b.banner_url||null, b.banner_position||'center', b.bio||null, b.font_family||null, b.background_url||null, b.user_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/sections' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT DISTINCT section_slug FROM threads ORDER BY section_slug ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/posts/delete' && request.method === 'POST') {
        const b = await request.json();
        const post = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(b.post_id).first();
        if (!post) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
        if (!['creator', 'moderator', 'editor'].includes(b.user_role) && post.author_name !== b.user_login) return new Response(JSON.stringify({ error: 'No permission' }), { status: 403, headers: cors });
        const first = await env.DB.prepare(`SELECT id FROM posts WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1`).bind(post.thread_id).first();
        if (first && first.id === post.id) await env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(post.thread_id).run();
        else await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(b.post_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/threads' && request.method === 'GET') {
        const section = url.searchParams.get('section');
        const my = url.searchParams.get('my');
        let q = `SELECT t.*, u.role AS author_role, u.font_family AS author_font, (SELECT id FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1) AS first_post_id, (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count FROM threads t LEFT JOIN users u ON t.author_name = u.display_name`;
        if (section) { q += ` WHERE t.section_slug = ? GROUP BY t.id HAVING reply_count > 0 ORDER BY t.updated_at DESC LIMIT 100`; const { results } = await env.DB.prepare(q).bind(section).all(); return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } }); }
        else if (my) { q += ` WHERE t.author_name = ? GROUP BY t.id HAVING reply_count > 0 ORDER BY t.updated_at DESC LIMIT 100`; const { results } = await env.DB.prepare(q).bind(my).all(); return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } }); }
        else { q += ` GROUP BY t.id HAVING reply_count > 0 ORDER BY t.updated_at DESC LIMIT 100`; const { results } = await env.DB.prepare(q).all(); return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } }); }
      }

      if (url.pathname === '/api/threads' && request.method === 'POST') {
        const b = await request.json();
        const slug = (b.section_slug || 'general').toLowerCase().replace(/\s+/g, '-');
        const t = await env.DB.prepare(`INSERT INTO threads (section_slug, title, author_name) VALUES (?, ?, ?) RETURNING id`).bind(slug, b.title, b.author_name || 'guest').first();
        await env.DB.prepare(`INSERT INTO posts (thread_id, author_name, body, image_url, music_url) VALUES (?, ?, ?, ?, ?)`).bind(t.id, b.author_name || 'guest', b.body, b.image_url || null, b.music_url || null).run();
        return new Response(JSON.stringify({ id: t.id }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/posts' && request.method === 'GET') {
        const threadId = url.searchParams.get('thread');
        const thread = await env.DB.prepare(`SELECT * FROM threads WHERE id = ?`).bind(threadId).first();
        if (!thread) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
        const { results } = await env.DB.prepare(`SELECT p.*, u.avatar_url AS author_avatar, u.role AS author_role, u.font_family AS author_font FROM posts p LEFT JOIN users u ON p.author_name = u.display_name WHERE p.thread_id = ? ORDER BY p.created_at ASC`).bind(threadId).all();
        return new Response(JSON.stringify({ thread, posts: results }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/posts' && request.method === 'POST') {
        const b = await request.json();
        await env.DB.prepare(`INSERT INTO posts (thread_id, author_name, body, image_url, music_url) VALUES (?, ?, ?, ?, ?)`).bind(b.thread_id, b.author_name || 'guest', b.body, b.image_url || null, b.music_url || null).run();
        await env.DB.prepare(`UPDATE threads SET updated_at = unixepoch() WHERE id = ?`).bind(b.thread_id).run();
        return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    return new Response('Not found', { status: 404 });
  },
};
