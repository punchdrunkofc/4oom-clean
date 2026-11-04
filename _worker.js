export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.messages = []; // Массив для истории
    
    // Загружаем историю из хранилища при старте
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
    
    const nick = new URL(request.url).searchParams.get('nick') || 'guest';

    // Удаляем старое соединение с таким же ником
    for (let [ws, session] of this.sessions.entries()) {
      if (session.nick === nick) {
        try { ws.close(1000, 'New session opened'); } catch (e) {}
        this.sessions.delete(ws);
      }
    }

    server.serializeAttachment({ nick });
    this.sessions.set(server, { nick });
    
    // Отправляем историю только что подключившемуся
    server.send(JSON.stringify({ type: 'history', messages: this.messages }));
    
    this.broadcastOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    const data = JSON.parse(message);
    const msgObj = { type: 'chat', user: session.nick, text: data.text, time: Date.now() };
    
    // Сохраняем сообщение в историю (максимум 50)
    this.messages.push(msgObj);
    if (this.messages.length > 50) this.messages = this.messages.slice(-50);
    await this.ctx.storage.put('messages', this.messages); // Сохраняем на диск

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
