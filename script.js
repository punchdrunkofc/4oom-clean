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

function getSessionToken() {
  return localStorage.getItem('4oom_session') || '';
}
function authHeaders(extra) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const t = getSessionToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}
function wsAuthQuery() {
  const t = getSessionToken();
  return t ? '&token=' + encodeURIComponent(t) : '';
}
async function apiFetch(path, opts) {
  opts = opts || {};
  const headers = Object.assign({}, authHeaders(), opts.headers || {});
  const res = await fetch(path, Object.assign({}, opts, { headers, credentials: 'same-origin' }));
  if (res.status === 401) console.warn('Session expired (401). Please login via GitHub again.');
  return res;
}
(function sessionBootstrap() {
  if (!currentUser || getSessionToken()) return;
  const bar = document.createElement('div');
  bar.id = 'sessionWarnBar';
  bar.style.cssText = 'position:fixed;bottom:48px;left:10px;right:10px;z-index:10002;background:#ffffcc;border:2px solid #808080;padding:8px 12px;font-family:Tahoma,sans-serif;font-size:12px;box-shadow:2px 2px 0 #000;text-align:center;';
  bar.innerHTML = 'Session expired after security update. Please <a href="/api/auth/login" style="font-weight:bold;">login with GitHub</a> again.';
  const add = () => document.body && document.body.appendChild(bar);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();

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
      let lobbyWs = null;
      let lobbyReconnectTimer = null;
      let lobbyReconnectDelay = 2000;

      function connectLobbyChat() {
        if (lobbyWs && (lobbyWs.readyState === WebSocket.OPEN || lobbyWs.readyState === WebSocket.CONNECTING)) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        lobbyWs = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}${wsAuthQuery()}`);
        
        lobbyWs.onopen = () => {
          lobbyReconnectDelay = 2000;
          onlineUsers.innerHTML = '🟢 Connected...';
        };
        
        lobbyWs.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'history') {
            chatMsgs.innerHTML = '';
            if (!Array.isArray(data.messages) || data.messages.length === 0) {
              chatMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">No messages yet.</div>';
            } else {
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
        
        lobbyWs.onclose = () => {
          onlineUsers.innerHTML = '⚫ Reconnecting...';
          if (lobbyReconnectTimer) clearTimeout(lobbyReconnectTimer);
          lobbyReconnectTimer = setTimeout(() => {
            connectLobbyChat();
            lobbyReconnectDelay = Math.min(lobbyReconnectDelay * 1.5, 15000);
          }, lobbyReconnectDelay);
        };
        
        lobbyWs.onerror = () => { try { lobbyWs.close(); } catch(e) {} };
      }
      
      connectLobbyChat();
      
      chatForm.addEventListener('submit', e => {
        e.preventDefault(); const t = chatInput.value.trim();
        if (t && lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
          chatInput.value = '';
          lobbyWs.send(JSON.stringify({ text: t }));
        }
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
      let bugWs = null;
      let bugReconnectTimer = null;
      let bugReconnectDelay = 2000;

      function connectBugChat() {
        if (bugWs && (bugWs.readyState === WebSocket.OPEN || bugWs.readyState === WebSocket.CONNECTING)) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        bugWs = new WebSocket(`${protocol}//${window.location.host}/api/bugs/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}${wsAuthQuery()}`);
        
        bugWs.onopen = () => { bugReconnectDelay = 2000; };
        
        bugWs.onmessage = (event) => {
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
        
        bugWs.onclose = () => {
          if (bugReconnectTimer) clearTimeout(bugReconnectTimer);
          bugReconnectTimer = setTimeout(() => {
            connectBugChat();
            bugReconnectDelay = Math.min(bugReconnectDelay * 1.5, 15000);
          }, bugReconnectDelay);
        };
        
        bugWs.onerror = () => { try { bugWs.close(); } catch(e) {} };
      }
      
      connectBugChat();
      
      bugForm.addEventListener('submit', e => {
        e.preventDefault(); 
        const t = bugInput.value.trim();
        if (!t) return;
        
        const confirmed = confirm("⚠️ WARNING!\n\nThis chat is EXCLUSIVELY for reporting bugs and errors.\n\nIt is NOT for chatting, flooding, or off-topic discussions. Are you sure you want to send this message?");
        
        if (confirmed && bugWs && bugWs.readyState === WebSocket.OPEN) { 
          bugInput.value = ''; 
          bugWs.send(JSON.stringify({ text: t })); 
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
      pb.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(currentUser.login)}"><img src="${currentUser.avatar || '...'}" class="avatar"></a><p class="profile__name"><a href="/profile.html?user=${encodeURIComponent(currentUser.login)}" style="text-decoration:none; color:inherit;">${formatName(currentUser.login, currentUser.role, currentUser.font)}</a> ${getRoleBadge(currentUser.role)}</p><p class="profile__status">online</p><button class="neon-btn" onclick="location.href='/settings.html'">settings</button><button class="neon-btn" onclick="fetch('/api/auth/logout',{method:'POST'}).finally(()=>{localStorage.removeItem('4oom_user');localStorage.removeItem('4oom_session');localStorage.clear();location.href='/'})">logout</button>`;
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

// ================= 4. МЕССЕНДЖЕР (отдельная страница + старый modal) =================
if (document.getElementById('msgrFriendsList')) {
  const msgrBtn = document.getElementById('msgrBtn');
  const msgrModal = document.getElementById('msgrModal');
  const msgrFriendsList = document.getElementById('msgrFriendsList');
  const msgrChatHeader = document.getElementById('msgrChatHeader');
  const msgrChatHeaderText = document.getElementById('msgrChatHeaderText') || msgrChatHeader;
  const msgrChatStatus = document.getElementById('msgrChatStatus');
  const msgrChatBox = document.getElementById('msgrChatBox');
  const msgrInput = document.getElementById('msgrInput');
  const msgrSendBtn = document.getElementById('msgrSendBtn');
  const msgrForm = document.getElementById('msgrForm');
  const msgrEmojiBtn = document.getElementById('msgrEmojiBtn');
  const msgrEmojiPanel = document.getElementById('msgrEmojiPanel');
  
  let activeChatId = null;
  let activeChatName = null;
  let msgrInterval = null;
  let onlineNicks = new Set();

  // Кнопка на главной — переход на страницу сообщений
  if (msgrBtn) {
    msgrBtn.addEventListener('click', () => {
      if (!currentUser) return alert('Login to use messenger!');
      location.href = '/messages.html';
    });
  }

  if (msgrEmojiBtn) {
    msgrEmojiBtn.addEventListener('click', () => {
      msgrEmojiPanel.style.display = msgrEmojiPanel.style.display === 'none' ? 'flex' : 'none';
    });
  }

  window.insertEmoji = function(emoji) {
    if (!msgrInput) return;
    msgrInput.value += emoji;
    msgrInput.focus();
    if (msgrEmojiPanel) msgrEmojiPanel.style.display = 'none';
  };

  async function fetchOnlineUsers() {
    try {
      const res = await fetch('/api/online');
      const data = await res.json();
      onlineNicks = new Set(Array.isArray(data.users) ? data.users : []);
    } catch (e) {
      onlineNicks = new Set();
    }
  }

  function isOnline(nick) {
    return onlineNicks.has(nick);
  }

  function statusHtml(nick) {
    return isOnline(nick)
      ? '<span style="color: #008000; font-size: 11px;">● online</span>'
      : '<span style="color: #888; font-size: 11px;">○ offline</span>';
  }

  async function loadMsgrFriends() {
    if (!currentUser) {
      msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">Please login.</div>';
      return;
    }
    msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888;">Loading...</div>';
    try {
      await fetchOnlineUsers();
      const res = await fetch('/api/friends/list?user_id=' + currentUser.id);
      const friends = await res.json();
      if (!Array.isArray(friends) || friends.length === 0) {
        msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">No friends yet. Add someone on the main page.</div>';
        return;
      }
      msgrFriendsList.innerHTML = friends.map(f => {
        const safeName = escapeHtml(f.display_name).replace(/'/g, "\\'");
        return `
        <div style="padding: 6px; border-bottom: 1px dotted #ccc; cursor: pointer; display: flex; align-items: center; gap: 6px;" onclick="openMsgrChat(${f.id}, '${safeName}')">
          <img src="${f.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22%3E%3Crect width=%2220%22 height=%2220%22 fill=%22%23ccc%22/%3E%3C/svg%3E'}" style="width: 24px; height: 24px; border: 1px solid #808080; object-fit: cover;">
          <div style="flex-grow: 1; min-width: 0;">
            <div style="font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${formatName(f.display_name, f.role, null)}</div>
            <div>${statusHtml(f.display_name)}</div>
          </div>
        </div>`;
      }).join('');
    } catch(e) {
      msgrFriendsList.innerHTML = '<div style="color: red; text-align: center;">Error loading friends.</div>';
    }
  }

  window.openMsgrChat = async function(friendId, friendName) {
    activeChatId = friendId;
    activeChatName = friendName;
    
    if (msgrChatHeaderText) {
      msgrChatHeaderText.textContent = `Chat with ${friendName}`;
    } else if (msgrChatHeader) {
      msgrChatHeader.textContent = `Chat with ${friendName}`;
    }
    
    if (msgrChatStatus) {
      msgrChatStatus.innerHTML = statusHtml(friendName);
    }
    
    if (msgrInput) msgrInput.disabled = false;
    if (msgrSendBtn) msgrSendBtn.disabled = false;
    msgrChatBox.innerHTML = '<div style="color: #888; text-align: center;">Loading messages...</div>';
    
    if (msgrInterval) clearInterval(msgrInterval);
    await loadMsgrMessages();
    // Обновляем сообщения и статус каждые 4 секунды (чуть реже, чтобы не дёргать)
    msgrInterval = setInterval(async () => {
      await fetchOnlineUsers();
      if (msgrChatStatus && activeChatName) msgrChatStatus.innerHTML = statusHtml(activeChatName);
      // Обновляем статусы в списке друзей
      loadMsgrFriendsStatusOnly();
      loadMsgrMessages();
    }, 4000);
  };

  function loadMsgrFriendsStatusOnly() {
    // Лёгкое обновление только статусов без полной перерисовки списка (чтобы не сбрасывать scroll)
    const items = msgrFriendsList.querySelectorAll('[onclick^="openMsgrChat"]');
    items.forEach(el => {
      const onclick = el.getAttribute('onclick') || '';
      const match = onclick.match(/openMsgrChat\(\d+,\s*'([^']+)'\)/);
      if (match) {
        const nick = match[1];
        const statusEl = el.querySelector('div > div:last-child');
        if (statusEl) statusEl.innerHTML = statusHtml(nick);
      }
    });
  }

  async function loadMsgrMessages() {
    if (!activeChatId) return;
    try {
      const res = await fetch(`/api/messages?sender_id=${currentUser.id}&receiver_id=${activeChatId}`);
      const messages = await res.json();
      if (!Array.isArray(messages) || messages.length === 0) {
        msgrChatBox.innerHTML = '<div style="color: #888; text-align: center; margin-top: 10px;">No messages yet. Say hi!</div>';
      } else {
        const wasAtBottom = msgrChatBox.scrollHeight - msgrChatBox.scrollTop - msgrChatBox.clientHeight < 40;
        msgrChatBox.innerHTML = messages.map(m => {
          const isMe = m.sender_id === currentUser.id;
          return `<div style="margin-bottom: 6px; text-align: ${isMe ? 'right' : 'left'};">
            <span style="background: ${isMe ? '#c0c0c0' : '#e0e0e0'}; padding: 2px 6px; border: 1px solid #808080; border-radius: 4px; display: inline-block; max-width: 80%; word-wrap: break-word;">
              ${escapeHtml(m.body)}
            </span>
          </div>`;
        }).join('');
        if (wasAtBottom) msgrChatBox.scrollTop = msgrChatBox.scrollHeight;
      }
    } catch(e) { console.error(e); }
  }

  if (msgrForm) {
    msgrForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = msgrInput.value.trim();
      if (!text || !activeChatId) return;
      
      msgrInput.value = '';
      if (msgrEmojiPanel) msgrEmojiPanel.style.display = 'none';
      try {
        await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: currentUser.id, receiver_id: activeChatId, body: text }) });
        loadMsgrMessages();
      } catch(e) { alert('Error sending message'); }
    });
  }

  // Если мы на странице messages.html — сразу грузим друзей + держим presence
  if (/\/messages(\.html)?\/?$/i.test(window.location.pathname)) {
    if (!currentUser) {
      msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">Please <a href="/">login</a> to use messenger.</div>';
    } else {
      // Тихое подключение к лобби-чату только для статуса "в сети"
      (function keepPresence() {
        let pWs = null;
        let pDelay = 3000;
        function connectPresence() {
          if (pWs && (pWs.readyState === WebSocket.OPEN || pWs.readyState === WebSocket.CONNECTING)) return;
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          pWs = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}${wsAuthQuery()}`);
          pWs.onopen = () => { pDelay = 3000; };
          pWs.onmessage = (ev) => {
            try {
              const data = JSON.parse(ev.data);
              if (data.type === 'online' && Array.isArray(data.users)) {
                onlineNicks = new Set(data.users);
                loadMsgrFriendsStatusOnly();
                if (msgrChatStatus && activeChatName) msgrChatStatus.innerHTML = statusHtml(activeChatName);
              }
            } catch(e) {}
          };
          pWs.onclose = () => {
            setTimeout(() => { connectPresence(); pDelay = Math.min(pDelay * 1.5, 15000); }, pDelay);
          };
          pWs.onerror = () => { try { pWs.close(); } catch(e) {} };
        }
        connectPresence();
      })();

      loadMsgrFriends();
      setInterval(async () => {
        await fetchOnlineUsers();
        loadMsgrFriendsStatusOnly();
        if (msgrChatStatus && activeChatName) msgrChatStatus.innerHTML = statusHtml(activeChatName);
      }, 8000);
    }
  }
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
          }, 150);
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

// ================= ЗВУКИ + АЛЕРТЫ (Win95 volume bottom-left) =================
(function initSoundAndAlerts() {
  const MSG_SOUNDS = {
    message1: { file: 'message1.mp3', label: 'Pop' },
    message2: { file: 'message2.mp3', label: 'Cup' },
    message3: { file: 'message3.mp3', label: 'Clarinet' },
    message4: { file: 'message4.mp3', label: 'Piano' }
  };

  function getVol() {
    const v = parseFloat(localStorage.getItem('4oom_sound_vol'));
    return isNaN(v) ? 0.7 : Math.min(1, Math.max(0, v));
  }
  function isMuted() { return localStorage.getItem('4oom_sound_mute') === '1'; }
  function getMsgSoundKey() {
    const k = localStorage.getItem('4oom_msg_sound') || 'message1';
    return MSG_SOUNDS[k] ? k : 'message1';
  }

  function playSe(filename) {
    if (isMuted()) return;
    try {
      const a = new Audio('/audio/se/' + filename);
      a.volume = getVol();
      a.play().catch(function(){});
    } catch (e) {}
  }

  window.playSe = playSe;
  window.playMessageSound = function() { playSe(MSG_SOUNDS[getMsgSoundKey()].file); };
  window.playNotificationSound = function() { playSe('notification.mp3'); };
  window.playClickSound = function() { playSe('click.mp3'); };
  window.playSwitchSound = function() { playSe('switch.mp3'); };
  window.playAcceptSound = function() { playSe('accept.mp3'); };
  window.playSendSound = function() { playSe('send.mp3'); };

  let soundUnlocked = false;
  function unlockSound() {
    if (soundUnlocked) return;
    soundUnlocked = true;
    try { new Audio().play().catch(function(){}); } catch (e) {}
  }
  document.addEventListener('click', unlockSound, { once: true });
  document.addEventListener('keydown', unlockSound, { once: true });

  // Win95-style volume bar — bottom left
  if (!document.getElementById('globalSoundBar')) {
    var style = document.createElement('style');
    style.textContent = [
      '#globalSoundBar{position:fixed;left:10px;bottom:10px;z-index:10001;display:flex;align-items:center;gap:6px;',
      'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:4px 6px;',
      'font-family:Tahoma,sans-serif;font-size:11px;box-shadow:1px 1px 0 #000;}',
      '#globalSoundBar button{border:2px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0;',
      'padding:1px 6px;cursor:pointer;font-size:12px;line-height:1.2;}',
      '#globalSoundBar button:active{border-color:#808080 #fff #fff #808080;}',
      '#globalSoundBar select{border:2px solid;border-color:#808080 #fff #fff #808080;background:#fff;font-size:11px;max-width:88px;}',
      /* Classic Windows range thumb/track */
      '#soundVolSlider{-webkit-appearance:none;appearance:none;width:90px;height:18px;background:transparent;cursor:pointer;vertical-align:middle;}',
      '#soundVolSlider:focus{outline:1px dotted #000;outline-offset:1px;}',
      '#soundVolSlider::-webkit-slider-runnable-track{height:4px;background:#808080;border:1px solid;border-color:#404040 #dfdfdf #dfdfdf #404040;box-shadow:inset 1px 1px 0 #000;}',
      '#soundVolSlider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:20px;margin-top:-9px;',
      'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;box-shadow:1px 1px 0 #000;cursor:pointer;}',
      '#soundVolSlider::-moz-range-track{height:4px;background:#808080;border:1px solid;border-color:#404040 #dfdfdf #dfdfdf #404040;}',
      '#soundVolSlider::-moz-range-thumb{width:12px;height:18px;background:#c0c0c0;border:2px solid;',
      'border-color:#fff #808080 #808080 #fff;border-radius:0;cursor:pointer;}'
    ].join('');
    document.head.appendChild(style);

    var soundBar = document.createElement('div');
    soundBar.id = 'globalSoundBar';
    soundBar.innerHTML = [
      '<button type="button" id="soundMuteBtn" title="Mute/Unmute">🔊</button>',
      '<input type="range" id="soundVolSlider" min="0" max="100" value="' + Math.round(getVol()*100) + '" title="Volume">',
      '<select id="msgSoundSelect" title="Message sound">',
      '<option value="message1">Pop</option>',
      '<option value="message2">Cup</option>',
      '<option value="message3">Clarinet</option>',
      '<option value="message4">Piano</option>',
      '</select>'
    ].join('');
    var mount = function(){ document.body.appendChild(soundBar); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    setTimeout(function(){
      var muteBtn = document.getElementById('soundMuteBtn');
      var volSlider = document.getElementById('soundVolSlider');
      var msgSelect = document.getElementById('msgSoundSelect');
      if (!muteBtn) return;
      function syncMuteUi() {
        muteBtn.textContent = isMuted() ? '🔇' : '🔊';
        volSlider.disabled = isMuted();
      }
      syncMuteUi();
      msgSelect.value = getMsgSoundKey();
      muteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        localStorage.setItem('4oom_sound_mute', isMuted() ? '0' : '1');
        syncMuteUi();
        if (!isMuted()) playSe('click.mp3');
      });
      volSlider.addEventListener('input', function() {
        localStorage.setItem('4oom_sound_vol', String(volSlider.value / 100));
        localStorage.setItem('4oom_sound_mute', '0');
        syncMuteUi();
      });
      volSlider.addEventListener('change', function(){ playMessageSound(); });
      msgSelect.addEventListener('change', function() {
        localStorage.setItem('4oom_msg_sound', msgSelect.value);
        playMessageSound();
      });
    }, 0);
  }

  // UI click sounds
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button, input[type="submit"], .neon-btn, .win-btn, .delete-btn');
    if (!el) return;
    if (el.id === 'soundMuteBtn' || el.closest('#globalSoundBar')) return;
    var tag = el.tagName;
    var href = (el.getAttribute && el.getAttribute('href')) || '';
    var onclick = (el.getAttribute && el.getAttribute('onclick')) || '';
    var id = el.id || '';
    var text = (el.textContent || '').toLowerCase();
    var type = (el.getAttribute && el.getAttribute('type')) || '';
    var isNav = (tag === 'A' && href && href.charAt(0) !== '#' && href.indexOf('javascript:') !== 0)
      || /location\.href|location\.assign/.test(onclick)
      || id === 'msgrBtn';
    var isAccept = /acceptFriend|accept friend|apply|save/i.test(onclick + text + id) || id === 'saveBtn' || id.indexOf('save') === 0;
    var isSend = type === 'submit' || id === 'msgrSendBtn' || /send/i.test(text)
      || el.closest('#msgrForm, #chatForm, #bugForm, #replyForm, #dmForm');
    if (isNav) playSe('switch.mp3');
    else if (isAccept) playSe('accept.mp3');
    else if (isSend) playSe('send.mp3');
    else playSe('click.mp3');
  }, true);

  document.addEventListener('submit', function(e) {
    var id = e.target && e.target.id;
    if (id === 'msgrForm' || id === 'chatForm' || id === 'bugForm' || id === 'replyForm' || id === 'dmForm') playSe('send.mp3');
  }, true);

  if (!currentUser) return;

  var badge = document.getElementById('globalAlertsBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'globalAlertsBadge';
    badge.style.cssText = 'position:fixed;top:10px;right:10px;z-index:10000;display:none;flex-direction:column;gap:6px;font-family:Tahoma,sans-serif;font-size:12px;max-width:280px;';
    var mountB = function(){ document.body.appendChild(badge); };
    if (document.body) mountB(); else document.addEventListener('DOMContentLoaded', mountB);
  }

  var lastUnreadMsg = -1, lastFriendReq = -1, titleBlinkTimer = null;
  var baseTitle = document.title;

  function startTitleBlink(unreadMsg, friendReq) {
    stopTitleBlink();
    if (document.hasFocus() && !document.hidden) return;
    if (unreadMsg + friendReq <= 0) return;
    var on = false;
    var msg = unreadMsg > 0 ? ('(' + unreadMsg + ') New message!') : ('(' + friendReq + ') Friend request!');
    titleBlinkTimer = setInterval(function() {
      on = !on;
      document.title = on ? msg : baseTitle;
    }, 1000);
  }
  function stopTitleBlink() {
    if (titleBlinkTimer) { clearInterval(titleBlinkTimer); titleBlinkTimer = null; }
    document.title = baseTitle;
  }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) stopTitleBlink(); });
  window.addEventListener('focus', stopTitleBlink);

  function notifyBrowser(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        var n = new Notification(title, { body: body, icon: '/favicon.svg', tag: '4oom-alert' });
        setTimeout(function(){ n.close(); }, 5000);
      } else if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch (e) {}
  }

  function renderBadge(unreadMsg, friendReq) {
    var parts = [];
    if (unreadMsg > 0) {
      parts.push('<a href="/messages.html" style="display:block;background:#ffffcc;border:2px solid #808080;padding:6px 10px;text-decoration:none;color:#000;box-shadow:2px 2px 0 #000;">💬 New messages: <b>' + unreadMsg + '</b></a>');
    }
    if (friendReq > 0) {
      parts.push('<a href="/" style="display:block;background:#ccffcc;border:2px solid #808080;padding:6px 10px;text-decoration:none;color:#000;box-shadow:2px 2px 0 #000;">🔔 Friend requests: <b>' + friendReq + '</b></a>');
    }
    if (!parts.length) {
      badge.style.display = 'none';
      badge.innerHTML = '';
      stopTitleBlink();
    } else {
      badge.style.display = 'flex';
      badge.innerHTML = parts.join('');
      if (document.hidden || !document.hasFocus()) startTitleBlink(unreadMsg, friendReq);
    }
  }

  async function refreshAlertsBadge() {
    try {
      if (!getSessionToken()) return;
      var res = await apiFetch('/api/alerts');
      if (res.status === 401 || !res.ok) return;
      var data = await res.json();
      var unreadMsg = Number(data.unread_messages) || 0;
      var friendReq = Number(data.friend_requests) || 0;
      if (lastUnreadMsg >= 0 && unreadMsg > lastUnreadMsg) {
        playMessageSound();
        if (document.hidden) {
          notifyBrowser('4OOM', 'New private message');
          startTitleBlink(unreadMsg, friendReq);
        }
      }
      if (lastFriendReq >= 0 && friendReq > lastFriendReq) {
        playNotificationSound();
        if (document.hidden) {
          notifyBrowser('4OOM', 'New friend request');
          startTitleBlink(unreadMsg, friendReq);
        }
      }
      lastUnreadMsg = unreadMsg;
      lastFriendReq = friendReq;
      renderBadge(unreadMsg, friendReq);
    } catch (e) {}
  }

  window.refreshAlertsBadge = refreshAlertsBadge;
  refreshAlertsBadge();
  setInterval(refreshAlertsBadge, 10000);

  document.addEventListener('click', function() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch (e) {}
  }, { once: true });
})();
