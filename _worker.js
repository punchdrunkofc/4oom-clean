import { DurableObject } from 'cloudflare:workers';

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.messages = []; 
    this.ctx.blockConcurrencyWhile(async () => { this.messages = (await this.ctx.storage.get('messages')) || []; });
    this.ctx.getWebSockets().forEach((ws) => { let a = ws.deserializeAttachment(); if (a) this.sessions.set(ws, a); });
  }
  async fetch(request) { /* ... без изменений ... */ }
  async webSocketMessage(ws, message) { /* ... без изменений ... */ }
  async webSocketClose(ws) { /* ... без изменений ... */ }
  broadcastOnline() { /* ... без изменений ... */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/chat/ws') { /* ... без изменений ... */ }
    if (url.pathname === '/api/auth/login') { /* ... без изменений ... */ }
    if (url.pathname === '/api/auth/callback') { /* ... без изменений ... */ }

    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    
    try {
      if (!env.DB) return new Response(JSON.stringify({ error: 'No DB bound' }), { status: 500, headers: cors });

      if (url.pathname === '/api/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT id, display_name, avatar_url, role FROM users ORDER BY display_name ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // НОВЫЙ МАРШРУТ ДЛЯ ПРОВЕРКИ СВЯЗЕЙ
      if (url.pathname === '/api/friends/all' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        const { results } = await env.DB.prepare(`
          SELECT friend_id FROM friends WHERE user_id = ? 
          UNION 
          SELECT user_id FROM friends WHERE friend_id = ?
        `).bind(userId, userId).all();
        const linkedIds = results.map(r => r.friend_id || r.user_id);
        return new Response(JSON.stringify(linkedIds), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ... (остальные API: friends/request, friends/incoming, friends/accept, friends/list, messages, user, profile, sections, posts, threads) остаются как были в прошлом рабочем коде ...
    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    return new Response('Not found', { status: 404 });
  },
};
