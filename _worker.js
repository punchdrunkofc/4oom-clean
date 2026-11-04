// 1. Сначала импорт и класс Durable Object
import { DurableObject } from 'cloudflare:workers';

export class ChatRoom extends DurableObject {
  // ... код класса ...
}

// 2. Затем основной экспорт с fetch
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- СТАТИКА ---
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // --- АВТОРИЗАЦИЯ ---
    // ... код auth ...

    // --- API (все маршруты внутри fetch) ---
    try {
      // ... другие API ...

      // Маршрут для WebSocket (тоже ВНУТРИ fetch!)
      if (url.pathname === '/api/chat/ws') {
        const nick = url.searchParams.get('nick') || 'guest';
        const id = env.CHAT_ROOM.idFromName('global');
        const stub = env.CHAT_ROOM.get(id);
        
        // Вот этот return должен быть внутри fetch
        return stub.fetch(new Request(url.origin + '/ws?nick=' + encodeURIComponent(nick), request));
      }

      // ... остальные API ...

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }

    return new Response('Not found', { status: 404 });
  },
};
