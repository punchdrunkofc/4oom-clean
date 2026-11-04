// --- ЧАТ НА ГЛАВНОЙ (WebSocket) ---
if (document.getElementById('chatMessages')) {
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const onlineUsers = document.getElementById('onlineUsers');

  if (currentUser) {
    // Подключаемся к WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}`;
    
    let ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'chat') {
        // Добавляем сообщение в чат
        const msgDiv = document.createElement('div');
        msgDiv.style.marginBottom = '6px';
        msgDiv.style.fontSize = '12px';
        msgDiv.innerHTML = `
          <a href="/profile.html?user=${encodeURIComponent(data.user)}" style="font-weight: bold; color: #000080; text-decoration: none;">${escapeHtml(data.user)}:</a>
          <span style="font-family: 'Times New Roman', serif;">${escapeHtml(data.text)}</span>
        `;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }

      if (data.type === 'online') {
        // Обновляем список онлайна
        if (data.users.length > 0) {
          onlineUsers.innerHTML = '🟢 Online: ' + data.users.map(u => `<a href="/profile.html?user=${encodeURIComponent(u)}" style="color: inherit;">${escapeHtml(u)}</a>`).join(', ');
        } else {
          onlineUsers.innerHTML = '⚫ No one online';
        }
      }
    };

    ws.onclose = () => {
      // Если соединение упало, переподключаемся через 5 секунд
      setTimeout(() => { location.reload(); }, 5000);
    };

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
      
      chatInput.value = '';
      ws.send(JSON.stringify({ text: text }));
    });
  } else {
    // Если не залогинен, показываем заглушку
    chatMessages.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">Please login to chat.</div>';
    onlineUsers.innerHTML = '⚫ Login to see who is online';
    chatForm.style.display = 'none';
  }
}
