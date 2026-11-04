// ================= УТИЛИТЫ =================
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function compressImage(file, maxWidth = 800) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload = e => {
      const i = new Image(); i.src = e.target.result;
      i.onload = () => {
        const c = document.createElement('canvas');
        let w = i.width, h = i.height;
        if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(i, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      i.onerror = rej;
    };
    r.onerror = rej;
  });
}

// ================= ГЛОБАЛЬНОЕ СОСТОЯНИЕ =================
let currentUser = null;
const userJson = localStorage.getItem('4oom_user');
if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) {} }

const urlParams = new URLSearchParams(window.location.search);
const currentSection = urlParams.get('section');
let dbSections = [];

// ================= UI ХЕЛПЕРЫ =================
function getRoleBadge(role) {
  if (!role || role === 'user') return '';
  if (role === 'creator') return `<span class="role-badge role-creator-glitter">CREATOR</span>`;
  const labels = { moderator: 'MODERATOR', editor: 'EDITOR' };
  return `<span class="role-badge role-${role}">${labels[role] || role.toUpperCase()}</span>`;
}

function formatName(name, role, font) {
  const f = font && font.trim() !== '' ? font : 'var(--font-pixel)';
  const s = `font-family: ${f};`;
  if (role === 'creator') return `<span class="creator-name" style="${s}">${escapeHtml(name)}</span>`;
  if (role === 'moderator') return `<span class="moderator-name" style="${s}">${escapeHtml(name)}</span>`;
  return `<span style="${s}">${escapeHtml(name)}</span>`;
}

function applyCustomBg(url) {
  const video = document.getElementById('bgVideo');
  if (!url) {
    if (video) { video.pause(); video.style.display = 'none'; video.src = ''; }
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = '';
    return;
  }
  if (url.endsWith('.mp4')) {
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = 'transparent';
    if (video) { video.src = url; video.style.display = 'block'; video.currentTime = 0; video.play().catch(e => console.log(e)); }
  } else {
    if (video) { video.pause(); video.style.display = 'none'; video.src = ''; }
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundRepeat = 'no-repeat';
  }
}

function resetVideoBg() { applyCustomBg(null); }

// ================= 1. ПРОФИЛЬ =================
if (document.getElementById('userName')) {
  const login = urlParams.get('user');
  if (!login) location.href = '/';
  else {
    fetch('/api/user?login=' + encodeURIComponent(login)).then(r => r.json()).then(data => {
      if (!data.user) { document.getElementById('userName').textContent = 'User not found'; return; }
      const { user, threads } = data;
      document.title = `4OOM — ${user.display_name}`;
      document.getElementById('userName').innerHTML = formatName(user.display_name, user.role, user.font_family);
      document.getElementById('userRole').innerHTML = getRoleBadge(user.role);
      
      if (user.display_name === 'PunchDrunk' || user.role === 'creator') applyCustomBg('/bg.mp4');
      else applyCustomBg(user.background_url);
      
      if (currentUser && currentUser.login === user.display_name) {
        const b = document.getElementById('editProfileBtn'); if (b) { b.style.display = 'inline-block'; b.href = '/settings.html'; }
      }
      document.getElementById('userAvatar').src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?%3C/text%3E%3C/svg%3E';
      
      if (user.banner_url) { 
        const b = document.getElementById('userBanner'); b.src = user.banner_url; b.style.display = 'block'; 
        const bc = document.getElementById('bannerContainer'); if (bc) bc.style.display = 'block';
      }
      document.getElementById('userBio').textContent = user.bio || 'This user has not written a bio yet.';
      
      const list = document.getElementById('userThreads');
      list.innerHTML = (threads && threads.length > 0) ? threads.map(t => `<li class="thread" style="text-align: left;"><a href="/thread.html?id=${t.id}"><span class="thread__title">[${t.section_slug}] ${escapeHtml(t.title)}</span><span class="thread__meta">${t.reply_count} replies</span></a></li>`).join('') : '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">No threads yet.</span></a></li>';

      if (currentUser && currentUser.login === user.display_name) {
        const fs = document.getElementById('friendsSection');
        if (fs) fs.style.display = 'block';
        fetch('/api/friends/list?user_id=' + user.id).then(res => res.json()).then(friends => {
          const list = document.getElementById('friendsList');
          if (!list) return;
          if (!Array.isArray(friends) || friends.length === 0) {
            list.innerHTML = '<div style="text-align: center; color: #888;">No friends yet. Add someone from the main page!</div>';
          } else {
            list.innerHTML = friends.map(f => `
              <div style="display: flex; align-items: center; gap: 8px; padding: 4px; border-bottom: 1px dotted #ccc;">
                <img src="${f.avatar_url || '...'}" style="width: 24px; height: 24px; border: 1px solid #808080;">
                <a href="/profile.html?user=${encodeURIComponent(f.display_name)}" style="text-decoration: none;">${formatName(f.display_name, f.role, null)}</a>
              </div>
            `).join('');
          }
        }).catch(e => console.error(e));
      }
    }).catch(e => console.error(e));
  }
}

// ================= 2. ГЛАВНАЯ И ЧАТЫ =================
if (document.getElementById('threadList')) {
  resetVideoBg();
  
  // --- ОБЫЧНЫЙ ЧАТ (Lobby) ---
  if (document.getElementById('chatMessages')) {
    const chatMsgs = document.getElementById('chatMessages'), chatForm = document.getElementById('chatForm'), chatInput = document.getElementById('chatInput'), onlineUsers = document.getElementById('onlineUsers');
    if (currentUser) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}`);
      ws.onopen = () => { chatMsgs.innerHTML = ''; };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'history') {
          chatMsgs.innerHTML = '';
          if (!Array.isArray(data.messages) || data.messages.length === 0) { chatMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">No messages yet.</div>'; } 
          else {
            data.messages.forEach(m => {
              const div = document.createElement('div'); div.style.marginBottom = '6px'; div.style.fontSize = '12px';
              div.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(m.user)}" style="text-decoration: none;">${formatName(m.user, m.role, null)}:</a> <span style="font-family: 'Times New Roman', serif;">${escapeHtml(m.text)}</span>`;
              chatMsgs.appendChild(div);
            });
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
          }
        }
        if (data.type === 'chat') {
          const div = document.createElement('div'); div.style.marginBottom = '6px'; div.style.fontSize = '12px';
          div.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(data.user)}" style="text-decoration: none;">${formatName(data.user, data.role, null)}:</a> <span style="font-family: 'Times New Roman', serif;">${escapeHtml(data.text)}</span>`;
          chatMsgs.appendChild(div); chatMsgs.scrollTop = chatMsgs.scrollHeight;
        }
        if (data.type === 'online') {
          onlineUsers.innerHTML = data.users.length > 0 ? '🟢 Online: ' + data.users.map(u => `<a href="/profile.html?user=${encodeURIComponent(u)}" style="color: inherit;">${escapeHtml(u)}</a>`).join(', ') : '⚫ No one online';
        }
      };
      ws.onclose = () => { onlineUsers.innerHTML = '⚫ Disconnected'; setTimeout(() => location.reload(), 5000); };
      chatForm.addEventListener('submit', e => {
        e.preventDefault(); const t = chatInput.value.trim();
        if (t && ws.readyState === WebSocket.OPEN) { chatInput.value = ''; ws.send(JSON.stringify({ text: t })); }
      });
    } else {
      chatMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">Please login to chat.</div>';
      onlineUsers.innerHTML = '⚫ Login to see who is online';
      chatForm.style.display = 'none';
    }
  }

  // --- БАГ-ЧАТ (Bug Reports) ---
  if (document.getElementById('bugMessages')) {
    const bugMsgs = document.getElementById('bugMessages'), bugForm = document.getElementById('bugForm'), bugInput = document.getElementById('bugInput');
    
    if (currentUser) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsBug = new WebSocket(`${protocol}//${window.location.host}/api/bugs/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}`);
      
      wsBug.onopen = () => { bugMsgs.innerHTML = ''; };
      
      wsBug.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'history') {
          bugMsgs.innerHTML = '';
          if (!Array.isArray(data.messages) || data.messages.length === 0) { 
            bugMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">No reports yet.</div>'; 
          } else {
            data.messages.forEach(m => {
              const div = document.createElement('div'); 
              div.style.marginBottom = '6px'; 
              div.style.fontSize = '12px';
              div.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(m.user)}" style="text-decoration: none;">${formatName(m.user, m.role, null)}:</a> <span style="font-family: 'Times New Roman', serif; color: #800000;">${escapeHtml(m.text)}</span>`;
              bugMsgs.appendChild(div);
            });
            bugMsgs.scrollTop = bugMsgs.scrollHeight;
          }
        }
        
        if (data.type === 'chat') {
          const div = document.createElement('div'); 
          div.style.marginBottom = '6px'; 
          div.style.fontSize = '12px';
          div.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(data.user)}" style="text-decoration: none;">${formatName(data.user, data.role, null)}:</a> <span style="font-family: 'Times New Roman', serif; color: #800000;">${escapeHtml(data.text)}</span>`;
          bugMsgs.appendChild(div); 
          bugMsgs.scrollTop = bugMsgs.scrollHeight;
        }
      };
      
      wsBug.onclose = () => { bugMsgs.innerHTML = '⚫ Disconnected'; setTimeout(() => location.reload(), 5000); };
      
      bugForm.addEventListener('submit', e => {
        e.preventDefault(); 
        const t = bugInput.value.trim();
        if (!t) return;
        
        const confirmed = confirm("⚠️ WARNING!\n\nThis chat is EXCLUSIVELY for reporting bugs and errors.\n\nIt is NOT for chatting, flooding, or off-topic discussions. Are you sure you want to send this message?");
        
        if (confirmed && wsBug.readyState === WebSocket.OPEN) { 
          bugInput.value = ''; 
          wsBug.send(JSON.stringify({ text: t })); 
        }
      });
    } else {
      bugMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">Login to submit bug reports.</div>';
      bugForm.style.display = 'none';
    }
  }

  // --- СПИСОК ЮЗЕРОВ ---
  if (currentUser) {
    fetch('/api/friends/all?user_id=' + currentUser.id).then(r => r.json()).then(existingLinks => {
      fetch('/api/users').then(r => r.json()).then(users => {
        const list = document.getElementById('usersList');
        if (!list || !Array.isArray(users)) return;
        if (users.length === 0) { list.innerHTML = '<div style="text-align: center; color: #888;">No users found.</div>'; return; }
        list.innerHTML = users.map(u => {
          const isMe = currentUser.login === u.display_name;
          const hasLink = Array.isArray(existingLinks) && existingLinks.includes(u.id);
          const friendBtn = (!isMe && !hasLink) ? `<button class="neon-btn" style="padding: 2px 6px; font-size: 10px; margin-left: 8px;" onclick="sendFriendRequest(${u.id})">+ Add Friend</button>` : '';
          return `<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px; border-bottom: 1px dotted #ccc;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <img src="${u.avatar_url || '...'}" style="width: 24px; height: 24px; border: 1px solid #808080;">
              <a href="/profile.html?user=${encodeURIComponent(u.display_name)}" style="text-decoration: none;">${formatName(u.display_name, u.role, null)}</a>
              ${getRoleBadge(u.role)}
            </div>
            <div>${friendBtn}</div>
          </div>`;
        }).join('');
      });
    }).catch(e => console.error(e));
  } else {
    fetch('/api/users').then(r => r.json()).then(users => {
      const list = document.getElementById('usersList');
      if (list && Array.isArray(users)) list.innerHTML = users.map(u => `<div style="padding: 6px; border-bottom: 1px dotted #ccc;"><a href="/profile.html?user=${encodeURIComponent(u.display_name)}" style="text-decoration: none;">${formatName(u.display_name, u.role, null)}</a></div>`).join('');
    });
  }

  // --- СЕКЦИИ ---
  fetch('/api/sections').then(r => r.json()).then(s => { 
    if (!Array.isArray(s)) return;
    dbSections = s.map(x => x.section_slug); 
    const sel = document.getElementById('sectionSelect'); 
    if(sel){
      [...new Set([...(typeof customSuggestions !== 'undefined' ? customSuggestions : []), ...dbSections])].sort().forEach(sec => { 
        const o = document.createElement('option'); o.value = sec; o.textContent = sec; sel.appendChild(o); 
      }); 
      if (currentSection && currentSection !== 'my') sel.value = currentSection;
    } 
  });
  
  const sIn = document.getElementById('newSection'), sBox = document.getElementById('sectionSuggestions');
  if (sIn && sBox) {
    sIn.addEventListener('input', function() { 
      const v = this.value.toLowerCase().trim(); sBox.innerHTML = ''; 
      if (!v) { sBox.style.display = 'none'; return; } 
      const m = [...new Set([...(typeof customSuggestions !== 'undefined' ? customSuggestions : []), ...dbSections])].sort().filter(x => x.includes(v)); 
      if (m.length) { 
        m.forEach(x => { 
          const d = document.createElement('div'); d.textContent = x; 
          d.onclick = () => { sIn.value = x; sBox.style.display = 'none'; }; 
          sBox.appendChild(d); 
        }); 
        sBox.style.display = 'block'; 
      } else sBox.style.display = 'none'; 
    });
    document.addEventListener('click', e => { if (e.target !== sIn && e.target !== sBox) sBox.style.display = 'none'; });
  }
  
  if (!currentSection) { const nh = document.getElementById('nav-home'); if(nh) nh.style.fontWeight = 'bold'; }
  if (currentSection === 'my') { const nm = document.getElementById('nav-my'); if(nm) nm.style.fontWeight = 'bold'; }
  
  if (currentUser) {
    const pb = document.getElementById('profileBox');
    if(pb) {
      pb.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(currentUser.login)}"><img src="${currentUser.avatar || '...'}" class="avatar"></a><p class="profile__name"><a href="/profile.html?user=${encodeURIComponent(currentUser.login)}" style="text-decoration:none; color:inherit;">${formatName(currentUser.login, currentUser.role, currentUser.font)}</a> ${getRoleBadge(currentUser.role)}</p><p class="profile__status">online</p><button class="neon-btn" onclick="location.href='/settings.html'">settings</button><button class="neon-btn" onclick="localStorage.clear();location.reload()">logout</button>`;
    }
  }
  
  window.deleteThread = async (id) => { 
    if (!confirm('Delete thread?')) return; 
    try { 
      const r = await fetch('/api/posts/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ post_id: id, user_role: currentUser ? currentUser.role : 'guest', user_login: currentUser ? currentUser.login : 'guest' }) }); 
      if (!r.ok) throw new Error((await r.json()).error); 
      loadThreads(); 
    } catch(e) { alert(e.message); } 
  };
  
  window.loadThreads = async () => {
    const list = document.getElementById('threadList');
    try {
      let ep = '/api/threads'; 
      if (currentSection === 'my' && currentUser) ep = `/api/threads?my=${encodeURIComponent(currentUser.login)}`; 
      else if (currentSection) ep = `/api/threads?section=${currentSection}`;
      
      let threads = await (await fetch(ep)).json();
      if (!Array.isArray(threads)) { list.innerHTML = '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">Error loading threads</span></a></li>'; return; }
      if (!threads.length) { list.innerHTML = '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">Nothing here yet...</span></a></li>'; return; }
      if (!currentSection) threads = threads.sort((a, b) => b.reply_count - a.reply_count).slice(0, 5);
      
      list.innerHTML = threads.map(t => {
        const canDel = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || t.author_name === currentUser.login);
        return `<li class="thread" style="text-align: left; display: flex; justify-content: space-between; align-items: center;">
          <div style="flex-grow: 1;">
            <a href="/thread.html?id=${t.id}" style="text-decoration: none; color: inherit;">
              <span class="thread__title">${!currentSection || currentSection === 'my' ? `[${t.section_slug}] ` : ''}${escapeHtml(t.title)}</span>
              <span class="thread__meta">by ${formatName(t.author_name, t.author_role, t.author_font)} ${getRoleBadge(t.author_role)} · ${t.reply_count} replies</span>
            </a>
          </div>
          <div>${canDel ? `<button class="delete-btn" onclick="deleteThread(${t.first_post_id})">delete</button>` : ''}</div>
        </li>`;
      }).join('');
    } catch(e) { list.innerHTML = '<li>Error</li>'; }
  };
  
  window.submitThread = async () => {
    const title = document.getElementById('newTitle').value, body = document.getElementById('newBody').value, section = document.getElementById('newSection').value.trim().toLowerCase().replace(/\s+/g, '-'), img = document.getElementById('newImageFile').files[0], mus = document.getElementById('newMusicFile').files[0];
    if (!title || !body || !section) return alert('Fill all fields');
    try {
      let iu = null, mu = null;
      if (img) iu = await compressImage(img);
      if (mus) mu = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(mus); });
      
      const r = await fetch('/api/threads', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, body, image_url: iu, music_url: mu, section_slug: section, author_name: currentUser ? currentUser.login : 'guest' }) });
      if (!r.ok) throw new Error((await r.json()).error);
      location.href = `/?section=${section}`;
    } catch(e) { alert(e.message); }
  };
  loadThreads();
}

// ================= 3. УВЕДОМЛЕНИЯ =================
if (document.getElementById('notifBtn')) {
  const notifBtn = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  const notifList = document.getElementById('notifList');
  const notifCount = document.getElementById('notifCount');

  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown.style.display = notifDropdown.style.display === 'none' ? 'block' : 'none';
    if (notifDropdown.style.display === 'block') loadNotifications();
  });
  document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && e.target !== notifBtn) notifDropdown.style.display = 'none';
  });

  async function loadNotifications() {
    if (!currentUser) {
      notifList.innerHTML = '<div style="color: #888; text-align: center;">Login to see notifications.</div>';
      notifCount.textContent = '';
      return;
    }
    try {
      const res = await fetch('/api/friends/incoming?user_id=' + currentUser.id);
      const requests = await res.json();
      if (!Array.isArray(requests) || requests.length === 0) {
        notifList.innerHTML = '<div style="color: #888; text-align: center;">No new notifications.</div>';
        notifCount.textContent = '';
        return;
      }
      notifCount.textContent = ` (${requests.length})`;
      notifList.innerHTML = requests.map(r => `
        <div style="padding: 6px; border-bottom: 1px dotted #ccc; display: flex; align-items: center; gap: 6px;">
          <img src="${r.avatar_url || '...'}" style="width: 20px; height: 20px;">
          <span><b>${escapeHtml(r.display_name)}</b> wants to be friends!</span>
          <button class="neon-btn" style="padding: 1px 4px; font-size: 10px; margin-left: auto;" onclick="acceptFriend(${r.id})">Accept</button>
        </div>
      `).join('');
    } catch(e) { notifList.innerHTML = '<div style="color: red;">Error loading notifications.</div>'; }
  }

  window.acceptFriend = async function(friendId) {
    if (!confirm('Accept friend request?')) return;
    try {
      const res = await fetch('/api/friends/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: currentUser.id, friend_id: friendId }) });
      if (!res.ok) throw new Error('Error');
      alert('Friend added!');
      loadNotifications();
    } catch(e) { alert(e.message); }
  };

  loadNotifications();
}

// ================= 4. МЕССЕНДЖЕР (ICQ STYLE) =================
if (document.getElementById('msgrBtn')) {
  const msgrBtn = document.getElementById('msgrBtn');
  const msgrModal = document.getElementById('msgrModal');
  const msgrFriendsList = document.getElementById('msgrFriendsList');
  const msgrChatHeader = document.getElementById('msgrChatHeader');
  const msgrChatBox = document.getElementById('msgrChatBox');
  const msgrInput = document.getElementById('msgrInput');
  const msgrSendBtn = document.getElementById('msgrSendBtn');
  const msgrForm = document.getElementById('msgrForm');
  const msgrEmojiBtn = document.getElementById('msgrEmojiBtn');
  const msgrEmojiPanel = document.getElementById('msgrEmojiPanel');
  
  let activeChatId = null;
  let msgrInterval = null;

  msgrBtn.addEventListener('click', () => {
    if (!currentUser) return alert('Login to use messenger!');
    msgrModal.style.display = 'flex';
    loadMsgrFriends();
  });

  msgrEmojiBtn.addEventListener('click', () => {
    msgrEmojiPanel.style.display = msgrEmojiPanel.style.display === 'none' ? 'flex' : 'none';
  });

  window.insertEmoji = function(emoji) {
    msgrInput.value += emoji;
    msgrInput.focus();
    msgrEmojiPanel.style.display = 'none';
  };

  async function loadMsgrFriends() {
    msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888;">Loading...</div>';
    try {
      const res = await fetch('/api/friends/list?user_id=' + currentUser.id);
      const friends = await res.json();
      if (!Array.isArray(friends) || friends.length === 0) {
        msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">No friends yet. Add someone on the main page.</div>';
        return;
      }
      msgrFriendsList.innerHTML = friends.map(f => `
        <div style="padding: 6px; border-bottom: 1px dotted #ccc; cursor: pointer; display: flex; align-items: center; gap: 6px;" onclick="openMsgrChat(${f.id}, '${f.display_name}')">
          <img src="${f.avatar_url || '...'}" style="width: 20px; height: 20px; border: 1px solid #808080;">
          <span style="font-size: 12px;">${formatName(f.display_name, f.role, null)}</span>
        </div>
      `).join('');
    } catch(e) { msgrFriendsList.innerHTML = 'Error loading friends.'; }
  }

  window.openMsgrChat = async function(friendId, friendName) {
    activeChatId = friendId;
    msgrChatHeader.textContent = `Chat with ${friendName}`;
    msgrInput.disabled = false;
    msgrSendBtn.disabled = false;
    msgrChatBox.innerHTML = '<div style="color: #888; text-align: center;">Loading messages...</div>';
    
    if (msgrInterval) clearInterval(msgrInterval);
    await loadMsgrMessages();
    msgrInterval = setInterval(loadMsgrMessages, 3000);
  };

  async function loadMsgrMessages() {
    if (!activeChatId) return;
    try {
      const res = await fetch(`/api/messages?sender_id=${currentUser.id}&receiver_id=${activeChatId}`);
      const messages = await res.json();
      if (!Array.isArray(messages) || messages.length === 0) {
        msgrChatBox.innerHTML = '<div style="color: #888; text-align: center; margin-top: 10px;">No messages yet. Say hi!</div>';
      } else {
        msgrChatBox.innerHTML = messages.map(m => {
          const isMe = m.sender_id === currentUser.id;
          return `<div style="margin-bottom: 6px; text-align: ${isMe ? 'right' : 'left'};">
            <span style="background: ${isMe ? '#c0c0c0' : '#e0e0e0'}; padding: 2px 6px; border: 1px solid #808080; border-radius: 4px; display: inline-block; max-width: 80%; word-wrap: break-word;">
              ${escapeHtml(m.body)}
            </span>
          </div>`;
        }).join('');
        msgrChatBox.scrollTop = msgrChatBox.scrollHeight;
      }
    } catch(e) { console.error(e); }
  }

  msgrForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgrInput.value.trim();
    if (!text || !activeChatId) return;
    
    msgrInput.value = '';
    msgrEmojiPanel.style.display = 'none';
    try {
      await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: currentUser.id, receiver_id: activeChatId, body: text }) });
      loadMsgrMessages();
    } catch(e) { alert('Error sending message'); }
  });
}

// ================= 5. СТРАНИЦА ТРЕДА =================
if (document.getElementById('postList')) {
  resetVideoBg();
  const tid = urlParams.get('id');
  
  if (currentUser) {
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(d => { if (d.user && d.user.background_url) applyCustomBg(d.user.background_url); });
  }

  window.deletePost = async (id) => { 
    if (!confirm('Delete?')) return; 
    try { 
      const r = await fetch('/api/posts/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ post_id: id, user_role: currentUser ? currentUser.role : 'guest', user_login: currentUser ? currentUser.login : 'guest' }) }); 
      if (!r.ok) throw new Error((await r.json()).error); 
      loadPosts(); 
    } catch(e) { alert(e.message); } 
  };
  
  window.loadPosts = async () => {
    if (!tid) location.href = '/';
    try {
      const r = await fetch('/api/posts?thread=' + tid); 
      if (!r.ok) { if (r.status === 404) { alert('Thread deleted'); location.href = '/'; return; } }
      const data = await r.json(); 
      
      const titleEl = document.querySelector('.thread-title-bar');
      if (titleEl) titleEl.textContent = '📄 ' + data.thread.title;

      document.getElementById('postList').innerHTML = data.posts.map(p => {
        const url = `/profile.html?user=${encodeURIComponent(p.author_name)}`;
        const av = p.author_avatar ? `<a href="${url}"><img src="${p.author_avatar}" class="post__avatar"></a>` : `<a href="${url}"><div style="width:24px; height:24px; background:#ccc; border: 1px solid #808080; display:inline-block;"></div></a>`;
        const canDel = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || p.author_name === currentUser.login);
        return `<article class="post"><div class="post__head"><span class="post__author">${av}<a href="${url}" style="text-decoration:none; color:inherit;">${formatName(p.author_name, p.author_role, p.author_font)}</a>${getRoleBadge(p.author_role)}${canDel ? `<button class="delete-btn" onclick="deletePost(${p.id})">delete</button>` : ''}</span><span class="post__time">${new Date(p.created_at * 1000).toLocaleString()}</span></div><div class="post__body">${escapeHtml(p.body)}${p.image_url ? `<img src="${p.image_url}" class="post__img">` : ''}${p.music_url ? `<audio controls class="post__audio" src="${p.music_url}"></audio>` : ''}</div></article>`;
      }).join('');
    } catch(e) { document.getElementById('postList').innerHTML = 'Error loading posts'; }
  };
  
  document.getElementById('replyForm').addEventListener('submit', async e => {
    e.preventDefault(); 
    const b = document.getElementById('replyBody').value;
    const imgEl = document.getElementById('replyImageFile'); const img = imgEl ? imgEl.files[0] : null;
    const musEl = document.getElementById('replyMusicFile'); const mus = musEl ? musEl.files[0] : null;
    
    if (!b) return;
    try {
      let iu = null, mu = null;
      if (img) iu = await compressImage(img);
      if (mus) mu = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(mus); });
      
      await fetch('/api/posts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ thread_id: tid, body: b, image_url: iu, music_url: mu, author_name: currentUser ? currentUser.login : 'guest' }) });
      document.getElementById('replyBody').value = ''; if(imgEl) imgEl.value = ''; if(musEl) musEl.value = '';
      loadPosts();
    } catch(e) { alert(e.message); }
  });
  loadPosts();
}

// ================= 6. НАСТРОЙКИ (РЕДАКТОР ПРОФИЛЯ) =================
if (document.getElementById('setNick')) {
  resetVideoBg();
  
  function updatePreview() {
    const n = document.getElementById('setNick')?.value || 'YourNickname', f = document.getElementById('setFont')?.value;
    const pn = document.getElementById('previewName'); 
    if (pn) { pn.textContent = n; pn.style.fontFamily = f || 'var(--font-pixel)'; }
    
    const pa = document.getElementById('previewAvatar'); 
    if (pa) pa.src = document.getElementById('setAvatar')?.value || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2230%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?%3C/text%3E%3C/svg%3E';
    
    const b = document.getElementById('setBanner')?.value;
    const pb = document.getElementById('previewBanner'); 
    if (pb) { pb.style.display = b ? 'block' : 'none'; if (b) pb.src = b; }
    
    const bio = document.getElementById('setBio')?.value;
    const pbio = document.getElementById('previewBio'); 
    if (pbio) pbio.textContent = bio || 'This user has not written a bio yet.';
    
    const pr = document.getElementById('previewRole'); 
    if (pr) pr.innerHTML = getRoleBadge(currentUser ? currentUser.role : 'user');
  }
  
  ['setNick', 'setBio'].forEach(id => { 
    const el = document.getElementById(id); 
    if (el) el.addEventListener('input', updatePreview); 
  });
  const sf = document.getElementById('setFont'); 
  if (sf) sf.addEventListener('change', updatePreview);

  const setupCrop = (fileId, containerId, imgId, btnId, ratio) => {
    const f = document.getElementById(fileId), c = document.getElementById(containerId), i = document.getElementById(imgId), b = document.getElementById(btnId);
    if (!f || !c || !i || !b) return;
    
    f.addEventListener('change', e => { 
      const file = e.target.files[0]; if (!file) return; 
      const r = new FileReader(); 
      r.onload = ev => { 
        
        i.onload = () => {
          // 1. Делаем контейнер видимым (добавляем класс active)
          c.classList.add('active');
          b.style.display = 'inline-block'; 
          
          // 2. Даем браузеру 50мс на пересчет размеров
          console.log("пенис");
          setTimeout(() => {
            if (window['crop' + fileId]) {
              window['crop' + fileId].destroy(); 
            }
            
            if (typeof Cropper !== 'undefined') {
              window['crop' + fileId] = new Cropper(i, { 
                aspectRatio: ratio, 
                viewMode: 1, 
                background: false,
                autoCropArea: 1,
                responsive: true
              });
              console.log(window['crop' + fileId]);
              console.log(c.offsetWidth, c.offsetHeight);
            } else {
              console.warn('Cropper.js is not loaded.');
            }
          }, 50);
        };
        
        i.src = ev.target.result; 
      }; 
      r.readAsDataURL(file); 
    });
  };
  
  setupCrop('avatarFile', 'avatarCropperContainer', 'avatarCropperImage', 'saveAvatarBtn', 1);
  setupCrop('bannerFile', 'bannerCropperContainer', 'bannerCropperImage', 'saveBannerBtn', 3);
  setupCrop('bgFile', 'bgCropperContainer', 'bgCropperImage', 'saveBgBtn', 16/9);

  window.applyAvatarCrop = () => { 
    if (!window.cropavatarFile) return; 
    document.getElementById('setAvatar').value = window.cropavatarFile.getCroppedCanvas({ width: 200, height: 200 }).toDataURL('image/jpeg', 0.85); 
    document.getElementById('avatarCropperContainer').classList.remove('active'); 
    document.getElementById('saveAvatarBtn').style.display = 'none'; 
    updatePreview(); 
  };
  
  window.applyBannerCrop = () => { 
    if (!window.cropbannerFile) return; 
    document.getElementById('setBanner').value = window.cropbannerFile.getCroppedCanvas({ width: 1200, height: 400 }).toDataURL('image/jpeg', 0.85); 
    document.getElementById('bannerCropperContainer').classList.remove('active'); 
    document.getElementById('saveBannerBtn').style.display = 'none'; 
    updatePreview(); 
  };
  
  window.applyBgCrop = () => {
    if (!window.cropbgFile) return;
    const b = window.cropbgFile.getCroppedCanvas({ width: 2560, height: 1440, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' }).toDataURL('image/jpeg', 0.9);
    document.getElementById('setBg').value = b;
    document.getElementById('bgCropperContainer').classList.remove('active'); 
    document.getElementById('saveBgBtn').style.display = 'none';
    applyCustomBg(b);
    if (window.cropbgFile) { window.cropbgFile.destroy(); window.cropbgFile = null; }
  };

  if (currentUser) {
    document.getElementById('setNick').value = currentUser.login;
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(d => { 
      if (!d.user) return;
      if (d.user.avatar_url) document.getElementById('setAvatar').value = d.user.avatar_url; 
      if (d.user.banner_url) document.getElementById('setBanner').value = d.user.banner_url; 
      if (d.user.background_url) { 
        document.getElementById('setBg').value = d.user.background_url; 
        applyCustomBg(d.user.background_url);
      } 
      document.getElementById('setBio').value = d.user.bio || ''; 
      if (document.getElementById('setFont')) document.getElementById('setFont').value = d.user.font_family || ''; 
      updatePreview(); 
    });
  }
  
  document.getElementById('saveBtn')?.addEventListener('click', async () => {
    if (!currentUser) return alert('Please login first!');
    
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const n = document.getElementById('setNick').value.trim();
    const a = document.getElementById('setAvatar').value;
    const b = document.getElementById('setBanner').value;
    const bg = document.getElementById('setBg').value;
    const bio = document.getElementById('setBio').value.trim();
    const f = document.getElementById('setFont').value;

    if (!n) {
      btn.disabled = false;
      btn.textContent = 'SAVE';
      return alert('Nickname cannot be empty');
    }

    try {
      const r = await fetch('/api/profile', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ user_id: currentUser.id, display_name: n, avatar_url: a, banner_url: b, bio, font_family: f, background_url: bg }) 
      });
      
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || 'Save error');
      
      currentUser.login = n; 
      currentUser.avatar = a; 
      currentUser.font = f; 
      localStorage.setItem('4oom_user', JSON.stringify(currentUser)); 
      
      alert('Profile saved successfully!');
      location.href = '/profile.html?user=' + encodeURIComponent(n);
    } catch(e) { 
      alert('Error saving: ' + e.message); 
      btn.disabled = false;
      btn.textContent = 'SAVE';
    }
  });

  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    location.href = '/';
  });
}

// ================= 7. ГЛОБАЛЬНЫЕ ФУНКЦИИ ДРУЗЕЙ =================
window.sendFriendRequest = async function(targetId) {
  if (!currentUser) return alert('Please login first');
  try {
    const r = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, friend_id: targetId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    alert('Friend request sent!');
  } catch (e) { alert(e.message); }
};
