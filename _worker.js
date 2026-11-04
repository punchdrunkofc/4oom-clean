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

      // --- ПОЛЬЗОВАТЕЛИ И ДРУЗЬЯ ---
      if (url.pathname === '/api/users' && request.method === 'GET') { /* ... без изменений ... */ }
      if (url.pathname === '/api/friends/request' && request.method === 'POST') { /* ... без изменений ... */ }
      if (url.pathname === '/api/friends/incoming' && request.method === 'GET') { /* ... без изменений ... */ }
      if (url.pathname === '/api/friends/accept' && request.method === 'POST') { /* ... без изменений ... */ }

      // СПИСОК ДРУЗЕЙ
      if (url.pathname === '/api/friends/list' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        
        const { results } = await env.DB.prepare(`
          SELECT u.id, u.display_name, u.avatar_url, u.role 
          FROM friends f 
          JOIN users u ON f.friend_id = u.id 
          WHERE f.user_id = ? AND f.status = 'accepted'
        `).bind(userId).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ЛИЧНЫЕ СООБЩЕНИЯ ---
      
      // ПОЛУЧЕНИЕ ИСТОРИИ ЛС
      if (url.pathname === '/api/messages' && request.method === 'GET') {
        const senderId = url.searchParams.get('sender_id');
        const receiverId = url.searchParams.get('receiver_id');
        if (!senderId || !receiverId) return new Response(JSON.stringify({ error: 'Missing IDs' }), { status: 400, headers: cors });
        
        const { results } = await env.DB.prepare(`
          SELECT * FROM messages 
          WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
          ORDER BY created_at ASC
        `).bind(senderId, receiverId, receiverId, senderId).all();
        
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ОТПРАВКА ЛС
      if (url.pathname === '/api/messages' && request.method === 'POST') {
        const b = await request.json();
        if (!b.sender_id || !b.receiver_id || !b.body) return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400, headers: cors });
        
        await env.DB.prepare(`INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)`).bind(b.sender_id, b.receiver_id, b.body).run();
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ... ОСТАЛЬНОЙ КОД (профиль, треды, посты) без изменений ...
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
