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
    const url = new URL(request.url);
    
    // HTTP: список онлайн-пользователей
    if (url.pathname === '/online' || url.pathname.endsWith('/online')) {
      return this.getOnline();
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    
    const nick = url.searchParams.get('nick') || 'guest';
    const role = url.searchParams.get('role') || 'user';
    const userId = url.searchParams.get('uid') || '0';

    // Удаляем старую сессию этого же пользователя, чтобы не было дублей онлайна
    for (let [ws, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        try { ws.close(1000, 'New session opened'); } catch (e) {}
        this.sessions.delete(ws);
      }
    }

    server.serializeAttachment({ nick, role, userId });
    this.sessions.set(server, { nick, role, userId });
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
    const onlineUsers = [...new Set(Array.from(this.sessions.values()).map(s => s.nick))];
    const msg = JSON.stringify({ type: 'online', users: onlineUsers });
    this.ctx.getWebSockets().forEach((client) => { try { client.send(msg); } catch (e) {} });
  }

  // HTTP: текущий список онлайна (для статуса в личных сообщениях)
  async getOnline() {
    const onlineUsers = [...new Set(Array.from(this.sessions.values()).map(s => s.nick))];
    return new Response(JSON.stringify({ users: onlineUsers }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
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
    const userId = url.searchParams.get('uid') || '0';

    for (let [ws, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        try { ws.close(1000, 'New session opened'); } catch (e) {}
        this.sessions.delete(ws);
      }
    }

    server.serializeAttachment({ nick, role, userId });
    this.sessions.set(server, { nick, role, userId });
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

// ================= SECURITY HELPERS =================
const SESSION_DAYS = 30;
const MAX_BODY_BYTES = 2500000;
const rateBuckets = new Map();

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

function rateLimit(ip, action, limit, windowMs) {
  const key = ip + '|' + action;
  const now = Date.now();
  let arr = rateBuckets.get(key) || [];
  arr = arr.filter(t => now - t < windowMs);
  if (arr.length >= limit) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  if (rateBuckets.size > 20000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > 600000) rateBuckets.delete(k);
    }
  }
  return true;
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function sessionSecret(env) {
  return env.SESSION_SECRET || env.GH_CLIENT_SECRET || '4oom-dev-insecure-change-me';
}

async function createSessionToken(userId, env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  const sig = await hmacHex(sessionSecret(env), payload);
  return `${payload}.${sig}`;
}

async function verifySessionToken(token, env) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(exp)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const expect = await hmacHex(sessionSecret(env), `${uid}.${exp}`);
  if (expect.length !== sig.length) return null;
  let ok = 0;
  for (let i = 0; i < expect.length; i++) ok |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (ok !== 0) return null;
  return Number(uid);
}

function parseCookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const out = {};
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

async function getAuthUser(request, env) {
  const cookies = parseCookies(request);
  let token = cookies['4oom_session'];
  if (!token) {
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
  }
  if (!token) {
    try {
      const u = new URL(request.url);
      token = u.searchParams.get('token') || '';
    } catch (e) {}
  }
  if (!token) return null;
  const userId = await verifySessionToken(token, env);
  if (!userId) return null;
  const user = await env.DB.prepare(
    `SELECT id, display_name, avatar_url, role, font_family, github_login FROM users WHERE id = ?`
  ).bind(userId).first();
  return user || null;
}

function sessionCookieHeader(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `4oom_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

function json(data, status, cors, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// ================= MAIN WORKER =================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // --- СТАТИКА ---
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const cl = request.headers.get('Content-Length');
    if (cl && Number(cl) > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
    }

    const ip = clientIp(request);

    // --- WEBSOCKET: ник/роль только из сессии ---
    if (url.pathname === '/api/chat/ws' || url.pathname === '/api/bugs/ws') {
      if (!rateLimit(ip, 'ws', 30, 60000)) return new Response('Too many connections', { status: 429 });
      const auth = await getAuthUser(request, env);
      if (!auth) return new Response('Unauthorized', { status: 401 });
      const nick = auth.display_name;
      const role = auth.role || 'user';
      const uid = String(auth.id);
      if (url.pathname === '/api/chat/ws') {
        const id = env.CHAT_ROOM.idFromName('global');
        const stub = env.CHAT_ROOM.get(id);
        return stub.fetch(new Request(url.origin + `/ws?nick=${encodeURIComponent(nick)}&role=${encodeURIComponent(role)}&uid=${encodeURIComponent(uid)}`, request));
      }
      const id = env.BUG_ROOM.idFromName('global_bugs');
      const stub = env.BUG_ROOM.get(id);
      return stub.fetch(new Request(url.origin + `/ws?nick=${encodeURIComponent(nick)}&role=${encodeURIComponent(role)}&uid=${encodeURIComponent(uid)}`, request));
    }

    if (url.pathname === '/api/online' && request.method === 'GET') {
      const id = env.CHAT_ROOM.idFromName('global');
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(new Request(url.origin + '/online', { method: 'GET' }));
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
        const sessionToken = await createSessionToken(dbUser.id, env);
        const userJson = JSON.stringify({ id: dbUser.id, login: dbUser.display_name, avatar: dbUser.avatar_url, role: dbUser.role, font: dbUser.font_family });
        const tokenJs = JSON.stringify(sessionToken);
        return new Response(
          `<html><body><script>localStorage.setItem('4oom_user', JSON.stringify(${userJson}));localStorage.setItem('4oom_session', ${tokenJs});location.href='/';</script></body></html>`,
          { headers: { 'Content-Type': 'text/html', 'Set-Cookie': sessionCookieHeader(sessionToken, request) } }
        );
      } catch (e) { return new Response('Auth error: ' + e.message, { status: 500 }); }
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': '4oom_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
        }
      });
    }

    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': (origin && origin === url.origin) ? origin : url.origin,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    
    try {
      if (!env.DB) return new Response(JSON.stringify({ error: 'No DB bound' }), { status: 500, headers: cors });

      if (url.pathname === '/api/login' && request.method === 'POST') {
        return json({ error: 'Use GitHub login' }, 403, cors);
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ user: null }, 200, cors);
        // обновляем токен для localStorage (cookie HttpOnly клиент не читает)
        const session_token = await createSessionToken(auth.id, env);
        return json({
          user: { id: auth.id, login: auth.display_name, avatar: auth.avatar_url, role: auth.role, font: auth.font_family },
          session_token
        }, 200, cors, { 'Set-Cookie': sessionCookieHeader(session_token, request) });
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

      // --- ОБНОВЛЕНИЕ ПРОФИЛЯ (ОЧИСТКА СТАРЫХ ДАННЫХ) ---
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        if (!rateLimit(ip, 'profile', 20, 60000)) return json({ error: 'Rate limit' }, 429, cors);
        const b = await request.json();
        try {
          const name = String(b.display_name || auth.display_name).slice(0, 64);
          const bio = b.bio != null ? String(b.bio).slice(0, 2000) : null;
          await env.DB.prepare(`UPDATE users SET display_name = ?, bio = ?, font_family = ?, avatar_url = ?, banner_url = ?, background_url = ? WHERE id = ?`)
            .bind(name, bio, b.font_family || null, b.avatar_url || null, b.banner_url || null, b.background_url || null, auth.id).run();
          return json({ ok: true }, 200, cors);
        } catch (err) {
          return json({ error: 'DB Error: ' + err.message }, 500, cors);
        }
      }

      // --- ДРУЗЬЯ ---
      if (url.pathname === '/api/friends/all' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const { results } = await env.DB.prepare(`SELECT friend_id FROM friends WHERE user_id = ? UNION SELECT user_id FROM friends WHERE friend_id = ?`).bind(auth.id, auth.id).all();
        return json(results.map(r => r.friend_id || r.user_id), 200, cors);
      }
      if (url.pathname === '/api/friends/request' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        if (!rateLimit(ip, 'friend_req', 30, 60000)) return json({ error: 'Rate limit' }, 429, cors);
        const body = await request.json();
        const friendId = Number(body.friend_id);
        if (!friendId || friendId === auth.id) return json({ error: 'Invalid friend' }, 400, cors);
        const existing = await env.DB.prepare(`SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`).bind(auth.id, friendId).first();
        if (existing) return json({ error: 'Request already sent' }, 400, cors);
        await env.DB.prepare(`INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')`).bind(auth.id, friendId).run();
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/api/friends/incoming' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const { results } = await env.DB.prepare(`SELECT f.user_id AS id, u.display_name, u.avatar_url FROM friends f JOIN users u ON f.user_id = u.id WHERE f.friend_id = ? AND f.status = 'pending'`).bind(auth.id).all();
        return json(results, 200, cors);
      }
      // Статус дружбы между двумя пользователями
      if (url.pathname === '/api/friends/status' && request.method === 'GET') {
        const userId = Number(url.searchParams.get('user_id'));
        const otherId = Number(url.searchParams.get('other_id'));
        if (!userId || !otherId) return new Response(JSON.stringify({ error: 'Missing IDs' }), { status: 400, headers: cors });
        const out = await env.DB.prepare(`SELECT status FROM friends WHERE user_id = ? AND friend_id = ?`).bind(userId, otherId).first();
        const inn = await env.DB.prepare(`SELECT status FROM friends WHERE user_id = ? AND friend_id = ?`).bind(otherId, userId).first();
        let status = 'none';
        if ((out && out.status === 'accepted') || (inn && inn.status === 'accepted')) status = 'accepted';
        else if (out && out.status === 'pending') status = 'pending_out';
        else if (inn && inn.status === 'pending') status = 'pending_in';
        return new Response(JSON.stringify({ status }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/friends/accept' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const body = await request.json();
        const friendId = Number(body.friend_id); // кто отправил заявку
        if (!friendId) return json({ error: 'Missing data' }, 400, cors);
        await env.DB.prepare(`UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?`).bind(friendId, auth.id).run();
        const reverse = await env.DB.prepare(`SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`).bind(auth.id, friendId).first();
        if (!reverse) {
          await env.DB.prepare(`INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')`).bind(auth.id, friendId).run();
        } else {
          await env.DB.prepare(`UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?`).bind(auth.id, friendId).run();
        }
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/api/friends/list' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        // optional: allow only own list (session)
        const userId = auth.id;
        const { results } = await env.DB.prepare(`
          SELECT u.id, u.display_name, u.avatar_url, u.role FROM friends f
          JOIN users u ON u.id = f.friend_id
          WHERE f.user_id = ? AND f.status = 'accepted'
          UNION
          SELECT u.id, u.display_name, u.avatar_url, u.role FROM friends f
          JOIN users u ON u.id = f.user_id
          WHERE f.friend_id = ? AND f.status = 'accepted'
        `).bind(userId, userId).all();
        return json(results, 200, cors);
      }
      if (url.pathname === '/api/friends/remove' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const body = await request.json();
        const friendId = Number(body.friend_id);
        if (!friendId) return json({ error: 'Missing data' }, 400, cors);
        await env.DB.prepare(`DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`).bind(auth.id, friendId, friendId, auth.id).run();
        return json({ ok: true }, 200, cors);
      }

      // Контакты для мессенджера: друзья + те, с кем уже есть переписка
      if (url.pathname === '/api/messages/contacts' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const userId = auth.id;
        try {
          const friends = await env.DB.prepare(`
            SELECT u.id, u.display_name, u.avatar_url, u.role, 'friend' AS source FROM friends f
            JOIN users u ON u.id = f.friend_id
            WHERE f.user_id = ? AND f.status = 'accepted'
            UNION
            SELECT u.id, u.display_name, u.avatar_url, u.role, 'friend' AS source FROM friends f
            JOIN users u ON u.id = f.user_id
            WHERE f.friend_id = ? AND f.status = 'accepted'
          `).bind(userId, userId).all();

          let conv = { results: [] };
          try {
            conv = await env.DB.prepare(`
              SELECT u.id, u.display_name, u.avatar_url, u.role, 'chat' AS source FROM users u
              WHERE u.id IN (
                SELECT receiver_id FROM messages WHERE sender_id = ?
                UNION
                SELECT sender_id FROM messages WHERE receiver_id = ?
              ) AND u.id != ?
            `).bind(userId, userId, userId).all();
          } catch (e) { /* messages table may be empty */ }

          const map = new Map();
          for (const r of (friends.results || [])) map.set(r.id, r);
          for (const r of (conv.results || [])) {
            if (!map.has(r.id)) map.set(r.id, r);
          }
          return new Response(JSON.stringify([...map.values()]), { headers: { ...cors, 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ error: 'DB Error: ' + err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
      }

      // --- ЛС (СООБЩЕНИЯ) ---
      if (url.pathname === '/api/messages' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const senderId = url.searchParams.get('sender_id');
        const receiverId = url.searchParams.get('receiver_id');
        if (!senderId || !receiverId) return json({ error: 'Missing IDs' }, 400, cors);
        try {
          const sid = Number(senderId);
          const rid = Number(receiverId);
          // только участник диалога
          if (auth.id !== sid && auth.id !== rid) return json({ error: 'Forbidden' }, 403, cors);
          let results = [];
          try {
            const q = await env.DB.prepare(
              `SELECT id, sender_id, receiver_id, body, created_at, COALESCE(is_read, 0) AS is_read FROM messages
               WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
               ORDER BY created_at ASC, id ASC`
            ).bind(sid, rid, rid, sid).all();
            results = q.results || [];
          } catch (e) {
            const q = await env.DB.prepare(
              `SELECT id, sender_id, receiver_id, body, created_at FROM messages
               WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
               ORDER BY created_at ASC, id ASC`
            ).bind(sid, rid, rid, sid).all();
            results = (q.results || []).map(m => ({ ...m, is_read: 0 }));
          }
          return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ error: 'DB Error: ' + err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
      }
      if (url.pathname === '/api/messages/read' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const b = await request.json();
        const userId = auth.id;
        const peerId = Number(b.peer_id);
        if (!peerId) return json({ error: 'Missing IDs' }, 400, cors);
        try {
          await env.DB.prepare(
            `UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND COALESCE(is_read, 0) = 0`
          ).bind(userId, peerId).run();
          return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }
      }
      if (url.pathname === '/api/alerts' && request.method === 'GET') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        const userId = auth.id;
        let unread_messages = 0;
        let friend_requests = 0;
        try {
          const fr = await env.DB.prepare(
            `SELECT COUNT(*) AS c FROM friends WHERE friend_id = ? AND status = 'pending'`
          ).bind(userId).first();
          friend_requests = fr && fr.c ? Number(fr.c) : 0;
        } catch (e) {}
        try {
          const um = await env.DB.prepare(
            `SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND COALESCE(is_read, 0) = 0`
          ).bind(userId).first();
          unread_messages = um && um.c ? Number(um.c) : 0;
        } catch (e) {
          unread_messages = 0;
        }
        return new Response(JSON.stringify({ unread_messages, friend_requests }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/messages' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        if (!rateLimit(ip, 'msg', 60, 60000)) return json({ error: 'Rate limit' }, 429, cors);
        const b = await request.json();
        if (!b.receiver_id || !b.body) return json({ error: 'Missing data' }, 400, cors);
        const senderId = auth.id;
        const receiverId = Number(b.receiver_id);
        const body = String(b.body).trim().slice(0, 4000);
        if (!body) return json({ error: 'Empty message' }, 400, cors);
        if (!receiverId || receiverId === senderId) return json({ error: 'Invalid IDs' }, 400, cors);
        const now = Math.floor(Date.now() / 1000);
        try {
          await env.DB.prepare(
            `INSERT INTO messages (sender_id, receiver_id, body, created_at, is_read) VALUES (?, ?, ?, ?, 0)`
          ).bind(senderId, receiverId, body, now).run();
          return new Response(JSON.stringify({ ok: true, sender_id: senderId, receiver_id: receiverId, body, created_at: now, is_read: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        } catch (err) {
          try {
            await env.DB.prepare(
              `INSERT INTO messages (sender_id, receiver_id, body, created_at) VALUES (?, ?, ?, ?)`
            ).bind(senderId, receiverId, body, now).run();
            return new Response(JSON.stringify({ ok: true, sender_id: senderId, receiver_id: receiverId, body, created_at: now }), { headers: { ...cors, 'Content-Type': 'application/json' } });
          } catch (err2) {
            try {
              await env.DB.prepare(
                `INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)`
              ).bind(senderId, receiverId, body).run();
              return new Response(JSON.stringify({ ok: true, sender_id: senderId, receiver_id: receiverId, body }), { headers: { ...cors, 'Content-Type': 'application/json' } });
            } catch (err3) {
              return new Response(JSON.stringify({ error: 'DB Error: ' + err3.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
            }
          }
        }
      }

      // --- РАЗДЕЛЫ ---
      if (url.pathname === '/api/sections' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT DISTINCT section_slug FROM threads ORDER BY section_slug ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- УДАЛЕНИЕ ПОСТОВ / ТРЕДОВ (С ОЧИСТКОЙ КАРТИНОК) ---
      if (url.pathname === '/api/posts/delete' && request.method === 'POST') {
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        if (!rateLimit(ip, 'delete', 30, 60000)) return json({ error: 'Rate limit' }, 429, cors);
        const b = await request.json();
        
        const post = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(b.post_id).first();
        if (!post) return json({ error: 'Not found' }, 404, cors);
        
        const isStaff = ['creator', 'moderator', 'editor'].includes(auth.role);
        const isAuthor = post.author_id && Number(post.author_id) === Number(auth.id);
        if (!isStaff && !isAuthor) {
          return json({ error: 'No permission' }, 403, cors);
        }
        
        const first = await env.DB.prepare(`SELECT id FROM posts WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1`).bind(post.thread_id).first();
        
        if (first && first.id === post.id) {
          // УДАЛЯЕМ ВЕСЬ ТРЕД: сначала все посты (и их картинки), потом сам тред
          await env.DB.prepare(`DELETE FROM posts WHERE thread_id = ?`).bind(post.thread_id).run();
          await env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(post.thread_id).run();
        } else {
          // УДАЛЯЕМ ТОЛЬКО ОДИН ПОСТ
          await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(b.post_id).run();
        }
        
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
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        if (!rateLimit(ip, 'thread', 15, 60000)) return json({ error: 'Rate limit' }, 429, cors);
        const b = await request.json();
        const slug = String(b.section_slug || 'general').toLowerCase().replace(/\s+/g, '-').slice(0, 64);
        const title = String(b.title || '').slice(0, 200);
        const body = String(b.body || '').slice(0, 20000);
        if (!title || !body) return json({ error: 'Missing title/body' }, 400, cors);
        const authorId = auth.id;

        const t = await env.DB.prepare(`INSERT INTO threads (section_slug, title, author_id) VALUES (?, ?, ?) RETURNING id`).bind(slug, title, authorId).first();
        await env.DB.prepare(`INSERT INTO posts (thread_id, author_id, body, image_url, music_url) VALUES (?, ?, ?, ?, ?)`).bind(t.id, authorId, body, b.image_url || null, b.music_url || null).run();
        return json({ id: t.id }, 201, cors);
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
        const auth = await getAuthUser(request, env);
        if (!auth) return json({ error: 'Unauthorized' }, 401, cors);
        if (!rateLimit(ip, 'post', 40, 60000)) return json({ error: 'Rate limit' }, 429, cors);
        const b = await request.json();
        if (!b.thread_id || !b.body) return json({ error: 'Missing data' }, 400, cors);
        const body = String(b.body).slice(0, 20000);
        const authorId = auth.id;

        await env.DB.prepare(`INSERT INTO posts (thread_id, author_id, body, image_url, music_url) VALUES (?, ?, ?, ?, ?)`).bind(b.thread_id, authorId, body, b.image_url || null, b.music_url || null).run();
        await env.DB.prepare(`UPDATE threads SET updated_at = unixepoch() WHERE id = ?`).bind(b.thread_id).run();
        return json({ ok: true }, 201, cors);
      }

    } catch (e) { 
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    
    return new Response('Not found', { status: 404 });
  },
};
