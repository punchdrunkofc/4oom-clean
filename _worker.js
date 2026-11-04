import { DurableObject } from 'cloudflare:workers';

// Класс для управления чатом и онлайном
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map(); // Здесь храним активные соединения
    
    // Восстанавливаем соединения после "сна" Cloudflare
    this.ctx.getWebSockets().forEach((ws) => {
      let attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, attachment);
      }
    });
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Принимаем соединение (важно для экономии ресурсов Cloudflare)
    this.ctx.acceptWebSocket(server);

    // Получаем ник из URL
    const url = new URL(request.url);
    const nick = url.searchParams.get('nick') || 'guest';

    // Сохраняем ник, чтобы он не потерялся, когда Cloudflare "усыпит" сервер
    server.serializeAttachment({ nick });
    this.sessions.set(server, { nick });

    // Отправляем всем обновленный список онлайна
    this.broadcastOnline();

    return new Response(null, { status: 101, webSocket: client });
  }

  // Когда приходит сообщение в чат
  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const data = JSON.parse(message);
    
    // Рассылаем сообщение всем подключенным
    const msgToSend = JSON.stringify({
      type: 'chat',
      user: session.nick,
      text: data.text,
      time: Date.now()
    });

    this.ctx.getWebSockets().forEach((client) => {
      try { client.send(msgToSend); } catch (e) {}
    });
  }

  // Когда кто-то закрывает вкладку
  async webSocketClose(ws, code, reason, wasClean) {
    this.sessions.delete(ws);
    this.broadcastOnline();
  }

  // Рассылаем список тех, кто сейчас онлайн
  broadcastOnline() {
    const onlineUsers = Array.from(this.sessions.values()).map(s => s.nick);
    const msg = JSON.stringify({ type: 'online', users: onlineUsers });

    this.ctx.getWebSockets().forEach((client) => {
      try { client.send(msg); } catch (e) {}
    });
  }
}

// ... твой основной export default { async fetch(...) { ... } } ...

// ВНУТРИ основного fetch (где у тебя API), добавь маршрут для WebSocket:
      // WebSocket для чата
      if (url.pathname === '/api/chat/ws') {
        const nick = url.searchParams.get('nick') || 'guest';
        // Всегда используем один и тот же экземпляр ChatRoom (id 'global')
        const id = env.CHAT_ROOM.idFromName('global'); 
        const stub = env.CHAT_ROOM.get(id);
        
        // Пересоздаем запрос с нужным URL для Durable Object
        return stub.fetch(new Request(url.origin + '/ws?nick=' + encodeURIComponent(nick), request));
      }
