import { DurableObject } from 'cloudflare:workers';

// ================= DURABLE OBJECT (ЧАТ) =================
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.messages = []; 
    this.ctx.blockConcurrencyWhile(async () => {
      this.messages = (await this.ctx.storage.get('messages')) || [];
    });
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
    
    const url = new URL(request.url);
    const nick = url.searchParams.get('nick') || 'guest';
    const role = url.searchParams.get('role') || 'user';

    for (let [ws, session] of this.sessions.entries()) {
      if (session.nick === nick) {
        try { ws.close(1000, 'New session opened'); } catch (e) {}
        this.sessions.delete(ws);
      }
    }

    server.serializeAttachment({ nick, role });
    this.sessions.set(server, { nick, role });
    server.send(JSON.stringify({ type: 'history', messages: this.messages }));
    
    this.broadcastOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    const data = JSON.parse(message);
    const msgObj = { type: 'chat', user: session.nick, role: session.role, text: data.text, time: Date.now() };
    
    this.messages.push(msgObj);
    if (this.messages.length > 50) this.messages = this.messages.slice(-50);
    await this.ctx.storage.put('messages', this.messages); 

    const msgToSend = JSON.stringify(msgObj);
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

// ================= DURABLE OBJECT (БАГ-РЕПОРТЫ) =================
export class BugRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.messages = []; 
    this.ctx.blockConcurrencyWhile(async () => {
      this.messages = (await this.ctx.storage.get('bug_reports')) || [];
    });
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
    
    const url = new URL(request.url);
    const nick = url.searchParams.get('nick') || 'guest';
    const role = url.searchParams.get('role') || 'user';

    for (let [ws, session] of this.sessions.entries()) {
      if (session.nick === nick) {
        try { ws.close(1000, 'New session opened'); } catch (e) {}
        this.sessions.delete(ws);
      }
    }

    server.serializeAttachment({ nick, role });
    this.sessions.set(server, { nick, role });
    server.send(JSON.stringify({ type: 'history', messages: this.messages }));
    
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    const data = JSON.parse(message);
    const msgObj = { type: 'chat', user: session.nick, role: session.role, text: data.text, time: Date.now() };
    
    this.messages.push(msgObj);
    if (this.messages.length > 100) this.messages = this.messages.slice(-100); 
    await this.ctx.storage.put('bug_reports', this.messages); 

    const msgToSend = JSON.stringify(msgObj);
    this.ctx.getWebSockets().forEach((client) => { try { client.send(msgToSend); } catch (e) {} });
  }

  async webSocketClose(ws) {
    this.sessions.delete(ws);
  }
}

// ================= MAIN WORKER =================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // --- СТАТИКА ---
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // --- WEBSOCKET ---
    if (url.pathname === '/api/chat/ws') {
      const nick = url.searchParams.get('nick') || 'guest';
      const role = url.searchParams.get('role') || 'user';
      const id = env.CHAT_ROOM.idFromName('global');
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(new Request(url.origin + `/ws?nick=${encodeURIComponent(nick)}&role=${encodeURIComponent(role)}`, request));
    }
    
    if (url.pathname === '/api/bugs/ws') {
      const nick = url.searchParams.get('nick') || 'guest';
      const role = url.searchParams.get('role') || 'user';
      const id = env.BUG_ROOM.idFromName('global_bugs');
      const stub = env.BUG_ROOM.get(id);
      return stub.fetch(new Request(url.origin + `/ws?nick=${encodeURIComponent(nick)}&role=${encodeURIComponent(role)}`, request));
    }

    // --- AUTH (GITHUB) ---
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

    // --- CORS ---
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    
    try {
      if (!env.DB) return new Response(JSON.stringify({ error: 'No DB bound' }), { status: 500, headers: cors });

      // --- ЛОГИН (БЕЗ GITHUB) ---
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const b = await request.json();
        const user = await env.DB.prepare(`SELECT * FROM users WHERE display_name = ?`).bind(b.login).first();
        if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 401, headers: cors });
        return new Response(JSON.stringify({ user: { id: user.id, login: user.display_name, avatar: user.avatar_url, role: user.role, font: user.font_family } }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ПОЛЬЗОВАТЕЛИ ---
      if (url.pathname === '/api/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT id, display_name, avatar_url, role FROM users ORDER BY display_name ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/user' && request.method === 'GET') {
        const login = url.searchParams.get('login');
        let user = await env.DB.prepare(`SELECT * FROM users WHERE display_name = ?`).bind(login).first();
        if (!user) user = await env.DB.prepare(`SELECT * FROM users WHERE github_login = ?`).bind(login).first();
        if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: cors });
        const { results: threads } = await env.DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count FROM threads t WHERE t.author_id = ? ORDER BY t.updated_at DESC`).bind(user.id).all();
        return new Response(JSON.stringify({ user, threads }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ОБНОВЛЕНИЕ ПРОФИЛЯ ---
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const b = await request.json();
        if (!b.user_id) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        
        try {
          await env.DB.prepare(`UPDATE users SET display_name = ?, bio = ?, font_family = ?, avatar_url = ?, banner_url = ?, background_url = ? WHERE id = ?`)
            .bind(b.display_name, b.bio || null, b.font_family || null, b.avatar_url || null, b.banner_url || null, b.background_url || null, b.user_id).run();
          return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ error: 'DB Error: ' + err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
      }

      // --- ДРУЗЬЯ ---
      if (url.pathname === '/api/friends/all' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        const { results } = await env.DB.prepare(`SELECT friend_id FROM friends WHERE user_id = ? UNION SELECT user_id FROM friends WHERE friend_id = ?`).bind(userId, userId).all();
        return new Response(JSON.stringify(results.map(r => r.friend_id || r.user_id)), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/friends/request' && request.method === 'POST') {
        const body = await request.json();
        if (!body.user_id || !body.friend_id) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
        const existing = await env.DB.prepare(`SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`).bind(body.user_id, body.friend_id).first();
        if (existing) return new Response(JSON.stringify({ error: 'Request already sent' }), { status: 400, headers: cors });
        await env.DB.prepare(`INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')`).bind(body.user_id, body.friend_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/friends/incoming' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        const { results } = await env.DB.prepare(`SELECT f.user_id AS id, u.display_name, u.avatar_url FROM friends f JOIN users u ON f.user_id = u.id WHERE f.friend_id = ? AND f.status = 'pending'`).bind(userId).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/friends/accept' && request.method === 'POST') {
        const body = await request.json();
        if (!body.user_id || !body.friend_id) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
        await env.DB.prepare(`UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?`).bind(body.friend_id, body.user_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/friends/list' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        const { results } = await env.DB.prepare(`SELECT u.id, u.display_name, u.avatar_url, u.role FROM friends f JOIN users u ON f.friend_id = u.id WHERE f.user_id = ? AND f.status = 'accepted'`).bind(userId).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/friends/remove' && request.method === 'POST') {
        const body = await request.json();
        if (!body.user_id || !body.friend_id) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
        await env.DB.prepare(`DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`).bind(body.user_id, body.friend_id, body.friend_id, body.user_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ЛС (СООБЩЕНИЯ) ---
      if (url.pathname === '/api/messages' && request.method === 'GET') {
        const senderId = url.searchParams.get('sender_id');
        const receiverId = url.searchParams.get('receiver_id');
        if (!senderId || !receiverId) return new Response(JSON.stringify({ error: 'Missing IDs' }), { status: 400, headers: cors });
        const { results } = await env.DB.prepare(`SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC`).bind(senderId, receiverId, receiverId, senderId).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/messages' && request.method === 'POST') {
        const b = await request.json();
        if (!b.sender_id || !b.receiver_id || !b.body) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
        await env.DB.prepare(`INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)`).bind(b.sender_id, b.receiver_id, b.body).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- РАЗДЕЛЫ ---
      if (url.pathname === '/api/sections' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT DISTINCT section_slug FROM threads ORDER BY section_slug ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- УДАЛЕНИЕ ПОСТОВ / ТРЕДОВ ---
      if (url.pathname === '/api/posts/delete' && request.method === 'POST') {
        const b = await request.json();
        const post = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(b.post_id).first();
        if (!post) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
        const authorCheck = await env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(post.author_id).first();
        if (!['creator', 'moderator', 'editor'].includes(b.user_role) && (!authorCheck || authorCheck.display_name !== b.user_login)) {
          return new Response(JSON.stringify({ error: 'No permission' }), { status: 403, headers: cors });
        }
        const first = await env.DB.prepare(`SELECT id FROM posts WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1`).bind(post.thread_id).first();
        if (first && first.id === post.id) await env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(post.thread_id).run();
        else await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(b.post_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ТРЕДЫ ---
      if (url.pathname === '/api/threads' && request.method === 'GET') {
        const section = url.searchParams.get('section');
        const my = url.searchParams.get('my');
        
        let q = `SELECT t.id, t.section_slug, t.title, t.created_at, t.updated_at, 
                 u.display_name AS author_name, u.role AS author_role, u.font_family AS author_font,
                 (SELECT id FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1) AS first_post_id, 
                 (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count 
                 FROM threads t LEFT JOIN users u ON t.author_id = u.id`;
                 
        if (section) { 
          q += ` WHERE t.section_slug = ? ORDER BY t.updated_at DESC LIMIT 100`; 
          const { results } = await env.DB.prepare(q).bind(section).all(); 
          return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } }); 
        } else if (my) { 
          const user = await env.DB.prepare(`SELECT id FROM users WHERE display_name = ?`).bind(my).first();
          if (!user) return new Response(JSON.stringify([]), { headers: { ...cors, 'Content-Type': 'application/json' } });
          
          q += ` WHERE t.author_id = ? ORDER BY t.updated_at DESC LIMIT 100`; 
          const { results } = await env.DB.prepare(q).bind(user.id).all(); 
          return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } }); 
        } else { 
          q += ` ORDER BY t.updated_at DESC LIMIT 100`; 
          const { results } = await env.DB.prepare(q).all(); 
          return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } }); 
        }
      }
      if (url.pathname === '/api/threads' && request.method === 'POST') {
        const b = await request.json();
        const slug = (b.section_slug || 'general').toLowerCase().replace(/\s+/g, '-');
        
        let author = await env.DB.prepare(`SELECT id FROM users WHERE display_name = ?`).bind(b.author_name).first();
        const authorId = author ? author.id : null; 

        const t = await env.DB.prepare(`INSERT INTO threads (section_slug, title, author_id) VALUES (?, ?, ?) RETURNING id`).bind(slug, b.title, authorId).first();
        await env.DB.prepare(`INSERT INTO posts (thread_id, author_id, body, image_url, music_url) VALUES (?, ?, ?, ?, ?)`).bind(t.id, authorId, b.body, b.image_url || null, b.music_url || null).run();
        return new Response(JSON.stringify({ id: t.id }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ПОСТЫ ---
      if (url.pathname === '/api/posts' && request.method === 'GET') {
        const threadId = url.searchParams.get('thread');
        const thread = await env.DB.prepare(`SELECT * FROM threads WHERE id = ?`).bind(threadId).first();
        if (!thread) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
        
        const { results } = await env.DB.prepare(`SELECT p.id, p.body, p.image_url, p.music_url, p.created_at, 
          COALESCE(u.display_name, 'guest') AS author_name, 
          COALESCE(u.avatar_url, '') AS author_avatar, 
          COALESCE(u.role, 'user') AS author_role, 
          COALESCE(u.font_family, '') AS author_font 
          FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.thread_id = ? ORDER BY p.created_at ASC`).bind(threadId).all();
        return new Response(JSON.stringify({ thread, posts: results }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/posts' && request.method === 'POST') {
        const b = await request.json();
        
        let author = await env.DB.prepare(`SELECT id FROM users WHERE display_name = ?`).bind(b.author_name).first();
        const authorId = author ? author.id : null;

        await env.DB.prepare(`INSERT INTO posts (thread_id, author_id, body, image_url, music_url) VALUES (?, ?, ?, ?, ?)`).bind(b.thread_id, authorId, b.body, b.image_url || null, b.music_url || null).run();
        await env.DB.prepare(`UPDATE threads SET updated_at = unixepoch() WHERE id = ?`).bind(b.thread_id).run();
        return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

    } catch (e) { 
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    
    return new Response('Not found', { status: 404 });
  },
};
