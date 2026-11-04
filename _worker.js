import { DurableObject } from 'cloudflare:workers';

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.messages = []; 
    this.ctx.blockConcurrencyWhile(async () => { this.messages = (await this.ctx.storage.get('messages')) || []; });
    this.ctx.getWebSockets().forEach((ws) => { let a = ws.deserializeAttachment(); if (a) this.sessions.set(ws, a); });
  }
  async fetch(request) { /* ... */ }
  async webSocketMessage(ws, message) { /* ... */ }
  async webSocketClose(ws) { /* ... */ }
  broadcastOnline() { /* ... */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // WEBSOCKET
    if (url.pathname === '/api/chat/ws') { /* ... */ }

    // AUTH
    if (url.pathname === '/api/auth/login') { /* ... */ }
    if (url.pathname === '/api/auth/callback') { /* ... */ }

    // API
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    
    try {
      if (!env.DB) return new Response(JSON.stringify({ error: 'No DB bound' }), { status: 500, headers: cors });

      // --- ПОЛЬЗОВАТЕЛИ ---
      if (url.pathname === '/api/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT id, display_name, avatar_url, role FROM users ORDER BY display_name ASC`).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ПРОФИЛЬ (ПОЛУЧЕНИЕ) ---
      if (url.pathname === '/api/user' && request.method === 'GET') {
        const login = url.searchParams.get('login');
        if (!login) return new Response(JSON.stringify({ error: 'No login' }), { status: 400, headers: cors });
        
        // Простой запрос без сложных COALESCE, чтобы не падал
        let user = await env.DB.prepare(`SELECT * FROM users WHERE display_name = ?`).bind(login).first();
        if (!user) user = await env.DB.prepare(`SELECT * FROM users WHERE github_login = ?`).bind(login).first();
        
        if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: cors });
        
        const { results: threads } = await env.DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count FROM threads t WHERE t.author_name = ? ORDER BY t.updated_at DESC`).bind(user.display_name).all();
        return new Response(JSON.stringify({ user, threads }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // --- ПРОФИЛЬ (СОХРАНЕНИЕ) ---
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const b = await request.json();
        if (!b.user_id) return new Response(JSON.stringify({ error: 'No user_id' }), { status: 400, headers: cors });
        
        // Сохраняем только то, что точно есть в базе
        await env.DB.prepare(`
          UPDATE users 
          SET display_name = ?, avatar_url = ?, bio = ?, font_family = ?, background_url = ? 
          WHERE id = ?
        `).bind(b.display_name, b.avatar_url, b.bio || null, b.font_family || null, b.background_url || null, b.user_id).run();
        
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ... ОСТАЛЬНОЙ КОД (друзья, ЛС, треды, посты) ...
      // (Оставь его без изменений, как в прошлом рабочем файле)

    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    return new Response('Not found', { status: 404 });
  },
};
