import { DurableObject } from 'cloudflare:workers';

export class ChatRoom extends DurableObject {
  // ... (код класса ChatRoom остается без изменений) ...
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
  async fetch(request) { /* ... код без изменений ... */ }
  async webSocketMessage(ws, message) { /* ... код без изменений ... */ }
  async webSocketClose(ws) { /* ... код без изменений ... */ }
  broadcastOnline() { /* ... код без изменений ... */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // WEBSOCKET
    if (url.pathname === '/api/chat/ws') { /* ... без изменений ... */ }

    // AUTH
    if (url.pathname === '/api/auth/login') { /* ... без изменений ... */ }
    if (url.pathname === '/api/auth/callback') { /* ... без изменений ... */ }

    // API
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      if (!env.DB) return new Response(JSON.stringify({ error: 'No DB bound' }), { status: 500, headers: cors });

      // ПОЛУЧЕНИЕ СПИСКА ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
      if (url.pathname === '/api/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT id, display_name, avatar_url, role FROM users ORDER BY display_name ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ОТПРАВКА ЗАПРОСА В ДРУЗЬЯ
      if (url.pathname === '/api/friends/request' && request.method === 'POST') {
        const body = await request.json();
        if (!body.user_id || !body.friend_id) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
        
        // Проверяем, нет ли уже запроса
        const existing = await env.DB.prepare(`SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`).bind(body.user_id, body.friend_id).first();
        if (existing) return new Response(JSON.stringify({ error: 'Request already sent' }), { status: 400, headers: cors });

        await env.DB.prepare(`INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')`).bind(body.user_id, body.friend_id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ... остальной API (user, profile, sections, posts, threads) без изменений ...
      if (url.pathname === '/api/user' && request.method === 'GET') { /* ... */ }
      if (url.pathname === '/api/profile' && request.method === 'POST') { /* ... */ }
      if (url.pathname === '/api/sections' && request.method === 'GET') { /* ... */ }
      if (url.pathname === '/api/posts/delete' && request.method === 'POST') { /* ... */ }
      if (url.pathname === '/api/threads' && request.method === 'GET') { /* ... */ }
      if (url.pathname === '/api/threads' && request.method === 'POST') { /* ... */ }
      if (url.pathname === '/api/posts' && request.method === 'GET') { /* ... */ }
      if (url.pathname === '/api/posts' && request.method === 'POST') { /* ... */ }

    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    return new Response('Not found', { status: 404 });
  },
};
