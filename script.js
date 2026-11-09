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
  return fetch(path, Object.assign({}, opts, { headers, credentials: 'same-origin' }));
}
(function sessionBootstrap() {
  function showWarn() {
    if (document.getElementById('sessionWarnBar')) return;
    const bar = document.createElement('div');
    bar.id = 'sessionWarnBar';
    bar.style.cssText = 'position:fixed;bottom:48px;left:10px;right:10px;z-index:10002;background:#ffffcc;border:2px solid #808080;padding:8px 12px;font-family:Tahoma,sans-serif;font-size:12px;box-shadow:2px 2px 0 #000;text-align:center;';
    bar.innerHTML = 'Please <a href="/api/auth/login" style="font-weight:bold;">login with GitHub</a> to use chat and messages.';
    (document.body ? document.body : document.documentElement).appendChild(bar);
  }
  function hideWarn() {
    const b = document.getElementById('sessionWarnBar');
    if (b) b.remove();
  }
  fetch('/api/me', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(data => {
      if (data && data.user) {
        currentUser = data.user;
        try {
          localStorage.setItem('4oom_user', JSON.stringify(data.user));
          if (data.session_token) localStorage.setItem('4oom_session', data.session_token);
        } catch (e) {}
        hideWarn();
      } else if (currentUser && !getSessionToken()) {
        showWarn();
      }
    })
    .catch(() => { if (currentUser && !getSessionToken()) showWarn(); });
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
      
      const isOwnProfile = currentUser && currentUser.login === user.display_name;
      if (isOwnProfile) {
        const b = document.getElementById('editProfileBtn'); if (b) { b.style.display = 'inline-block'; b.href = '/settings.html'; }
      }

      // Кнопки на чужом профиле: друзья + ЛС
      const actions = document.getElementById('profileActions');
      if (actions && currentUser && !isOwnProfile) {
        actions.style.display = 'flex';
        actions.innerHTML = '<span style="font-size:11px;color:#666;">Loading...</span>';
        (async () => {
          try {
            const stRes = await fetch(`/api/friends/status?user_id=${currentUser.id}&other_id=${user.id}`);
            const st = await stRes.json();
            const status = st.status || 'none';
            const safeName = String(user.display_name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            let html = '';
            if (status === 'accepted') {
              html += `<button class="neon-btn" style="padding:2px 8px;font-size:11px;background:#ffcccc;color:#800000;" onclick="removeFriend(${user.id}, '${safeName}')">Remove Friend</button>`;
            } else if (status === 'pending_out') {
              html += `<span style="font-size:11px;color:#666;">Friend request sent</span>`;
            } else if (status === 'pending_in') {
              html += `<button class="neon-btn" style="padding:2px 8px;font-size:11px;" onclick="acceptFriend(${user.id})">Accept Friend</button>`;
            } else {
              html += `<button class="neon-btn" style="padding:2px 8px;font-size:11px;" onclick="sendFriendRequest(${user.id})">+ Add Friend</button>`;
            }
            html += `<a class="neon-btn" style="padding:2px 8px;font-size:11px;text-decoration:none;display:inline-block;" href="/messages.html?to=${user.id}&name=${encodeURIComponent(user.display_name)}">💬 Message</a>`;
            actions.innerHTML = html;
          } catch (e) {
            actions.innerHTML = `<a class="neon-btn" style="padding:2px 8px;font-size:11px;text-decoration:none;" href="/messages.html?to=${user.id}&name=${encodeURIComponent(user.display_name)}">💬 Message</a>`;
          }
        })();
      }

      document.getElementById('userAvatar').src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?%3C/text%3E%3C/svg%3E';
      
      if (user.banner_url) { 
        const b = document.getElementById('userBanner'); b.src = user.banner_url; b.style.display = 'block'; 
        const bc = document.getElementById('bannerContainer'); if (bc) bc.style.display = 'block';
      }
      document.getElementById('userBio').textContent = user.bio || 'This user has not written a bio yet.';
      
      const list = document.getElementById('userThreads');
      list.innerHTML = (threads && threads.length > 0) ? threads.map(t => `<li class="thread" style="text-align: left;"><a href="/thread.html?id=${t.id}"><span class="thread__title">[${t.section_slug}] ${escapeHtml(t.title)}</span><span class="thread__meta">${t.reply_count} replies</span></a></li>`).join('') : '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">No threads yet.</span></a></li>';

      if (isOwnProfile) {
        const fs = document.getElementById('friendsSection');
        if (fs) fs.style.display = 'block';
        fetch('/api/friends/list?user_id=' + user.id).then(res => res.json()).then(friends => {
          const list = document.getElementById('friendsList');
          if (!list) return;
          if (!Array.isArray(friends) || friends.length === 0) {
            list.innerHTML = '<div style="text-align: center; color: #888;">No friends yet. Add someone from the main page or their profile!</div>';
          } else {
            list.innerHTML = friends.map(f => {
              const safeName = String(f.display_name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              return `
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px; border-bottom: 1px dotted #ccc;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                  <img src="${f.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect width=%2224%22 height=%2224%22 fill=%22%23ccc%22/%3E%3C/svg%3E'}" style="width: 24px; height: 24px; border: 1px solid #808080; object-fit: cover;">
                  <a href="/profile.html?user=${encodeURIComponent(f.display_name)}" style="text-decoration: none;">${formatName(f.display_name, f.role, null)}</a>
                </div>
                <button class="neon-btn" style="padding: 1px 6px; font-size: 10px; flex-shrink: 0; background: #ffcccc; color: #800000;" onclick="removeFriend(${f.id}, '${safeName}')">Remove</button>
              </div>`;
            }).join('');
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
      let lobbyManualClose = false;

      function scheduleLobbyReconnect() {
        if (lobbyManualClose || document.hidden) return;
        if (lobbyReconnectTimer) clearTimeout(lobbyReconnectTimer);
        lobbyReconnectTimer = setTimeout(() => {
          lobbyReconnectDelay = Math.min(lobbyReconnectDelay * 1.5, 15000);
          connectLobbyChat();
        }, lobbyReconnectDelay);
      }

      function connectLobbyChat() {
        if (document.hidden) return;
        if (lobbyWs && (lobbyWs.readyState === WebSocket.OPEN || lobbyWs.readyState === WebSocket.CONNECTING)) return;
        lobbyManualClose = false;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        try {
          lobbyWs = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}${wsAuthQuery()}`);
        } catch (e) {
          scheduleLobbyReconnect();
          return;
        }
        
        lobbyWs.onopen = () => {
          lobbyReconnectDelay = 2000;
          onlineUsers.innerHTML = '🟢 Connected...';
        };
        
        lobbyWs.onmessage = (event) => {
          try {
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
          } catch (e) {}
        };
        
        lobbyWs.onclose = () => {
          lobbyWs = null;
          if (!lobbyManualClose) {
            onlineUsers.innerHTML = '⚫ Reconnecting...';
            scheduleLobbyReconnect();
          }
        };
        
        lobbyWs.onerror = () => { try { if (lobbyWs) lobbyWs.close(); } catch(e) {} };
      }

      function closeLobbyChat() {
        lobbyManualClose = true;
        if (lobbyReconnectTimer) { clearTimeout(lobbyReconnectTimer); lobbyReconnectTimer = null; }
        if (lobbyWs) {
          try { lobbyWs.onclose = null; lobbyWs.close(); } catch(e) {}
          lobbyWs = null;
        }
      }
      
      connectLobbyChat();

      // bfcache / вкладка скрыта — не спамим reconnect
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) closeLobbyChat();
        else { lobbyReconnectDelay = 2000; connectLobbyChat(); }
      });
      window.addEventListener('pagehide', () => closeLobbyChat());
      window.addEventListener('pageshow', (ev) => {
        lobbyReconnectDelay = 2000;
        connectLobbyChat();
      });
      
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
      let bugManualClose = false;

      function scheduleBugReconnect() {
        if (bugManualClose || document.hidden) return;
        if (bugReconnectTimer) clearTimeout(bugReconnectTimer);
        bugReconnectTimer = setTimeout(() => {
          bugReconnectDelay = Math.min(bugReconnectDelay * 1.5, 15000);
          connectBugChat();
        }, bugReconnectDelay);
      }

      function connectBugChat() {
        if (document.hidden) return;
        if (bugWs && (bugWs.readyState === WebSocket.OPEN || bugWs.readyState === WebSocket.CONNECTING)) return;
        bugManualClose = false;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        try {
          bugWs = new WebSocket(`${protocol}//${window.location.host}/api/bugs/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}${wsAuthQuery()}`);
        } catch (e) {
          scheduleBugReconnect();
          return;
        }
        
        bugWs.onopen = () => { bugReconnectDelay = 2000; };
        
        bugWs.onmessage = (event) => {
          try {
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
          } catch (e) {}
        };
        
        bugWs.onclose = () => {
          bugWs = null;
          if (!bugManualClose) scheduleBugReconnect();
        };
        
        bugWs.onerror = () => { try { if (bugWs) bugWs.close(); } catch(e) {} };
      }

      function closeBugChat() {
        bugManualClose = true;
        if (bugReconnectTimer) { clearTimeout(bugReconnectTimer); bugReconnectTimer = null; }
        if (bugWs) {
          try { bugWs.onclose = null; bugWs.close(); } catch(e) {}
          bugWs = null;
        }
      }
      
      connectBugChat();

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) closeBugChat();
        else { bugReconnectDelay = 2000; connectBugChat(); }
      });
      window.addEventListener('pagehide', () => closeBugChat());
      window.addEventListener('pageshow', () => { bugReconnectDelay = 2000; connectBugChat(); });
      
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

  // --- СПИСОК ЮЗЕРОВ + ПОИСК ---
  let allUsersCache = [];
  let existingFriendLinks = [];

  function renderUsersList(filter) {
    const list = document.getElementById('usersList');
    if (!list) return;
    const q = (filter || '').toLowerCase().trim();
    let users = allUsersCache;
    if (q) {
      users = users.filter(u => (u.display_name || '').toLowerCase().includes(q));
    }
    if (users.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: #888;">' + (q ? 'No users match "' + escapeHtml(q) + '".' : 'No users found.') + '</div>';
      return;
    }
    if (currentUser) {
      list.innerHTML = users.map(u => {
        const isMe = currentUser.login === u.display_name;
        const hasLink = Array.isArray(existingFriendLinks) && existingFriendLinks.includes(u.id);
        const friendBtn = (!isMe && !hasLink) ? `<button class="neon-btn" style="padding: 2px 6px; font-size: 10px; margin-left: 8px;" onclick="sendFriendRequest(${u.id})">+ Add Friend</button>` : '';
        return `<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px; border-bottom: 1px dotted #ccc;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="${u.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect width=%2224%22 height=%2224%22 fill=%22%23ccc%22/%3E%3C/svg%3E'}" style="width: 24px; height: 24px; border: 1px solid #808080; object-fit: cover;">
            <a href="/profile.html?user=${encodeURIComponent(u.display_name)}" style="text-decoration: none;">${formatName(u.display_name, u.role, null)}</a>
            ${getRoleBadge(u.role)}
          </div>
          <div>${friendBtn}</div>
        </div>`;
      }).join('');
    } else {
      list.innerHTML = users.map(u => `<div style="padding: 6px; border-bottom: 1px dotted #ccc;"><a href="/profile.html?user=${encodeURIComponent(u.display_name)}" style="text-decoration: none;">${formatName(u.display_name, u.role, null)}</a></div>`).join('');
    }
  }

  (async function loadUsersList() {
    try {
      if (currentUser) {
        try {
          const r = await fetch('/api/friends/all?user_id=' + currentUser.id);
          existingFriendLinks = await r.json();
          if (!Array.isArray(existingFriendLinks)) existingFriendLinks = [];
        } catch(e) { existingFriendLinks = []; }
      }
      const res = await fetch('/api/users');
      allUsersCache = await res.json();
      if (!Array.isArray(allUsersCache)) allUsersCache = [];
      renderUsersList('');
    } catch(e) {
      const list = document.getElementById('usersList');
      if (list) list.innerHTML = '<div style="text-align: center; color: red;">Error loading users.</div>';
    }
  })();

  const userSearchInput = document.getElementById('userSearchInput');
  if (userSearchInput) {
    userSearchInput.addEventListener('input', function() {
      renderUsersList(this.value);
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
      pb.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(currentUser.login)}"><img src="${currentUser.avatar || '...'}" class="avatar"></a><p class="profile__name"><a href="/profile.html?user=${encodeURIComponent(currentUser.login)}" style="text-decoration:none; color:inherit;">${formatName(currentUser.login, currentUser.role, currentUser.font)}</a> ${getRoleBadge(currentUser.role)}</p><p class="profile__status">online</p><button class="neon-btn" onclick="location.href='/settings.html'">settings</button><button class="neon-btn" onclick="fetch('/api/auth/logout',{method:'POST'}).finally(()=>{localStorage.clear();location.href='/'})">logout</button>`;
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
  
  const THREADS_PER_PAGE = 6;
  let allThreadsCache = [];
  let threadsPage = 1;

  function renderThreadsPage(page) {
    const list = document.getElementById('threadList');
    const pager = document.getElementById('threadsPager');
    if (!list) return;

    const total = allThreadsCache.length;
    const totalPages = Math.max(1, Math.ceil(total / THREADS_PER_PAGE));
    threadsPage = Math.min(Math.max(1, page), totalPages);

    const start = (threadsPage - 1) * THREADS_PER_PAGE;
    const pageThreads = allThreadsCache.slice(start, start + THREADS_PER_PAGE);

    if (!pageThreads.length) {
      list.innerHTML = '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">Nothing here yet...</span></a></li>';
    } else {
      list.innerHTML = pageThreads.map(t => {
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
    }

    // Пагинация: показываем только если тредов больше 6
    if (pager) {
      if (total > THREADS_PER_PAGE) {
        pager.style.display = 'flex';
        let pagesHtml = '';
        for (let i = 1; i <= totalPages; i++) {
          const active = i === threadsPage;
          pagesHtml += `<button class="neon-btn" style="padding: 2px 8px; font-size: 11px; min-width: 28px; ${active ? 'font-weight:bold; background:#c0c0c0;' : ''}" onclick="goThreadsPage(${i})">${i}</button>`;
        }
        pager.innerHTML = `
          <button class="neon-btn" style="padding: 2px 8px; font-size: 11px;" onclick="goThreadsPage(${threadsPage - 1})" ${threadsPage <= 1 ? 'disabled' : ''}>◀</button>
          <span style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">${pagesHtml}</span>
          <button class="neon-btn" style="padding: 2px 8px; font-size: 11px;" onclick="goThreadsPage(${threadsPage + 1})" ${threadsPage >= totalPages ? 'disabled' : ''}>▶</button>
          <span style="font-size: 11px; color: #444; margin-left: 6px;">Page ${threadsPage} / ${totalPages}</span>
        `;
      } else {
        pager.style.display = 'none';
        pager.innerHTML = '';
      }
    }
  }

  window.goThreadsPage = function(page) {
    renderThreadsPage(page);
    const list = document.getElementById('threadList');
    if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.loadThreads = async () => {
    const list = document.getElementById('threadList');
    try {
      let ep = '/api/threads'; 
      if (currentSection === 'my' && currentUser) ep = `/api/threads?my=${encodeURIComponent(currentUser.login)}`; 
      else if (currentSection) ep = `/api/threads?section=${currentSection}`;
      
      let threads = await (await fetch(ep)).json();
      if (!Array.isArray(threads)) {
        list.innerHTML = '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">Error loading threads</span></a></li>';
        return;
      }
      // На главной (без секции) — топ по replies, но с пагинацией если > 6
      if (!currentSection) {
        threads = threads.sort((a, b) => b.reply_count - a.reply_count);
      }
      allThreadsCache = threads;
      threadsPage = 1;
      renderThreadsPage(1);
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

  let contactsCache = [];

  async function loadMsgrFriends(force) {
    if (!currentUser) {
      msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">Please login.</div>';
      return;
    }
    // не мигаем Loading, если уже есть список
    if (!force && contactsCache.length) {
      renderContactsList(contactsCache);
      return;
    }
    if (!contactsCache.length) {
      msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888;">Loading...</div>';
    }
    try {
      fetchOnlineUsers().catch(() => {});
      let contacts = [];
      try {
        const res = await apiFetch('/api/messages/contacts');
        if (res.ok) contacts = await res.json();
      } catch (e) { console.warn('contacts', e); }
      if (!Array.isArray(contacts) || contacts.length === 0) {
        try {
          const res2 = await apiFetch('/api/friends/list');
          if (res2.ok) contacts = await res2.json();
        } catch (e) { console.warn('friends', e); }
      }
      if (!Array.isArray(contacts)) contacts = [];

      const toId = Number(urlParams.get('to'));
      const toName = urlParams.get('name');
      if (toId && !contacts.some(c => Number(c.id) === toId)) {
        contacts.unshift({ id: toId, display_name: toName || ('User #' + toId), avatar_url: null, role: 'user', source: 'direct' });
      }

      const seen = new Set();
      contactsCache = contacts.filter(f => {
        const id = Number(f.id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      renderContactsList(contactsCache);
    } catch (e) {
      console.error('loadMsgrFriends', e);
      if (!contactsCache.length) {
        msgrFriendsList.innerHTML = '<div style="color: red; text-align: center; padding: 10px;">Error loading contacts.</div>';
      }
    }
  }

  function renderContactsList(list) {
    if (!list || !list.length) {
      msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">No contacts yet.<br><small>Open a profile → Message</small></div>';
      return;
    }
    msgrFriendsList.innerHTML = list.map(f => {
      const name = String(f.display_name || 'User');
      const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const av = f.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22%3E%3Crect width=%2220%22 height=%2220%22 fill=%22%23ccc%22/%3E%3C/svg%3E';
      const active = activeChatId && Number(activeChatId) === Number(f.id);
      return `<div class="msgr-contact" data-id="${f.id}" data-name="${escapeHtml(name)}" style="padding:10px 8px;border-bottom:1px dotted #ccc;cursor:pointer;display:flex;align-items:center;gap:10px;min-height:52px;${active ? 'background:#d0d0d0;' : ''}" onclick="openMsgrChat(${f.id}, '${safeName}')">
          <img src="${av}" style="width:40px;height:40px;border:1px solid #808080;object-fit:cover;flex-shrink:0;">
          <div style="flex-grow:1;min-width:0;">
            <div class="msgr-contact-name" style="font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</div>
            <div class="msgr-contact-status">${statusHtml(name)}</div>
          </div>
        </div>`;
    }).join('');
  }

  window.openMsgrChat = async function(friendId, friendName) {
    activeChatId = Number(friendId);
    activeChatName = friendName || ('User #' + friendId);

    if (msgrChatHeaderText) msgrChatHeaderText.textContent = 'Chat with ' + activeChatName;
    else if (msgrChatHeader) msgrChatHeader.textContent = 'Chat with ' + activeChatName;
    if (msgrChatStatus) msgrChatStatus.innerHTML = statusHtml(activeChatName);
    if (msgrInput) msgrInput.disabled = false;
    if (msgrSendBtn) msgrSendBtn.disabled = false;
    msgrChatBox.innerHTML = '<div style="color:#888;text-align:center;">Loading messages...</div>';

    document.querySelectorAll('.msgr-contact').forEach(el => {
      el.style.background = Number(el.getAttribute('data-id')) === activeChatId ? '#d0d0d0' : '';
    });

    if (msgrInterval) clearInterval(msgrInterval);
    await loadMsgrMessages();
    msgrInterval = setInterval(async () => {
      await fetchOnlineUsers();
      if (msgrChatStatus && activeChatName) msgrChatStatus.innerHTML = statusHtml(activeChatName);
      loadMsgrFriendsStatusOnly();
      loadMsgrMessages();
    }, 5000);
  };

  function loadMsgrFriendsStatusOnly() {
    document.querySelectorAll('.msgr-contact').forEach(el => {
      const name = el.getAttribute('data-name') || '';
      const statusEl = el.querySelector('.msgr-contact-status');
      if (statusEl) statusEl.innerHTML = statusHtml(name);
    });
  }

  function formatMsgTime(ts) {
    if (ts == null || ts === '') return '';
    let n = Number(ts);
    if (!n || isNaN(n)) {
      const d0 = new Date(ts);
      if (isNaN(d0.getTime())) return '';
      n = d0.getTime();
    }
    const d = new Date(n < 1e12 ? n * 1000 : n);
    if (isNaN(d.getTime())) return '';
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return t;
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + t;
  }

  async function markChatRead(peerId) {
    if (!currentUser || !peerId) return;
    try {
      await apiFetch('/api/messages/read', {
        method: 'POST',
        body: JSON.stringify({ peer_id: Number(peerId) })
      });
      if (typeof window.refreshAlertsBadge === 'function') window.refreshAlertsBadge();
    } catch (e) {}
  }

  async function loadMsgrMessages() {
    if (!activeChatId || !currentUser) return;
    try {
      const res = await apiFetch('/api/messages?sender_id=' + encodeURIComponent(currentUser.id) + '&receiver_id=' + encodeURIComponent(activeChatId));
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        msgrChatBox.innerHTML = '<div style="color:red;text-align:center;margin-top:10px;">Error: ' + escapeHtml((data && data.error) || res.status) + '</div>';
        return;
      }
      const messages = Array.isArray(data) ? data : [];
      markChatRead(activeChatId);
      if (msgrChatHeaderText && activeChatName) {
        msgrChatHeaderText.textContent = 'Chat with ' + activeChatName;
      }
      if (messages.length === 0) {
        msgrChatBox.innerHTML = '<div style="color:#888;text-align:center;margin-top:10px;">No messages yet. Say hi!</div>';
      } else {
        const myId = Number(currentUser.id);
        const wasAtBottom = msgrChatBox.scrollHeight - msgrChatBox.scrollTop - msgrChatBox.clientHeight < 80;
        msgrChatBox.innerHTML = messages.map(m => {
          const isMe = Number(m.sender_id) === myId;
          const timeStr = formatMsgTime(m.created_at);
          const readMark = isMe
            ? (Number(m.is_read) ? '<span style="color:#0066cc;margin-left:4px;" title="Read">✓✓</span>' : '<span style="color:#888;margin-left:4px;" title="Sent">✓</span>')
            : '';
          const meta = (timeStr || readMark)
            ? `<div style="font-size:10px;color:#666;margin-top:3px;font-family:Tahoma,sans-serif;">${timeStr}${readMark}</div>`
            : '';
          return `<div style="margin-bottom:8px;text-align:${isMe ? 'right' : 'left'};">
            <span style="background:${isMe ? '#c0c0c0' : '#e0e0e0'};padding:4px 8px;border:1px solid #808080;border-radius:4px;display:inline-block;max-width:80%;word-wrap:break-word;text-align:left;">
              ${escapeHtml(m.body)}${meta}
            </span>
          </div>`;
        }).join('');
        if (wasAtBottom) msgrChatBox.scrollTop = msgrChatBox.scrollHeight;
      }
    } catch (e) {
      console.error('loadMsgrMessages', e);
    }
  }

  if (msgrForm) {
    msgrForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = msgrInput.value.trim();
      if (!text || !activeChatId || !currentUser) return;
      
      msgrInput.value = '';
      if (msgrEmojiPanel) msgrEmojiPanel.style.display = 'none';

      // Оптимистично показываем своё сообщение сразу
      if (msgrChatBox.querySelector('[style*="color: #888"]')) {
        msgrChatBox.innerHTML = '';
      }
      const tempDiv = document.createElement('div');
      tempDiv.style.cssText = 'margin-bottom: 6px; text-align: right;';
      tempDiv.innerHTML = `<span style="background: #c0c0c0; padding: 2px 6px; border: 1px solid #808080; border-radius: 4px; display: inline-block; max-width: 80%; word-wrap: break-word;">${escapeHtml(text)}</span>`;
      msgrChatBox.appendChild(tempDiv);
      msgrChatBox.scrollTop = msgrChatBox.scrollHeight;

      try {
        const res = await apiFetch('/api/messages', {
          method: 'POST',
          body: JSON.stringify({
            receiver_id: Number(activeChatId),
            body: text
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          tempDiv.remove();
          alert('Error sending message: ' + (data.error || res.status));
          console.error('messages POST failed', data);
          return;
        }
        loadMsgrMessages();
      } catch(e) {
        tempDiv.remove();
        console.error(e);
        alert('Error sending message');
      }
    });
  }

  // Страница ЛС: /messages.html или /messages (у Cloudflare часто без .html)
  const isMessagesPage = /\/messages(\.html)?\/?$/i.test(window.location.pathname);
  if (isMessagesPage) {
    if (!currentUser) {
      msgrFriendsList.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">Please <a href="/">login</a> to use messenger.</div>';
    } else {
      // Тихое подключение к лобби-чату только для статуса "в сети"
      (function keepPresence() {
        let pWs = null;
        let pDelay = 3000;
        let pTimer = null;
        let pManual = false;

        function schedulePresence() {
          if (pManual || document.hidden) return;
          if (pTimer) clearTimeout(pTimer);
          pTimer = setTimeout(() => {
            pDelay = Math.min(pDelay * 1.5, 15000);
            connectPresence();
          }, pDelay);
        }

        function connectPresence() {
          if (document.hidden) return;
          if (pWs && (pWs.readyState === WebSocket.OPEN || pWs.readyState === WebSocket.CONNECTING)) return;
          pManual = false;
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          try {
            pWs = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}&uid=${currentUser.id}${wsAuthQuery()}`);
          } catch (e) {
            schedulePresence();
            return;
          }
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
            pWs = null;
            if (!pManual) schedulePresence();
          };
          pWs.onerror = () => { try { if (pWs) pWs.close(); } catch(e) {} };
        }

        function closePresence() {
          pManual = true;
          if (pTimer) { clearTimeout(pTimer); pTimer = null; }
          if (pWs) {
            try { pWs.onclose = null; pWs.close(); } catch(e) {}
            pWs = null;
          }
        }

        connectPresence();
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) closePresence();
          else { pDelay = 3000; connectPresence(); }
        });
        window.addEventListener('pagehide', () => closePresence());
        window.addEventListener('pageshow', () => { pDelay = 3000; connectPresence(); });
      })();

      loadMsgrFriends().then(() => {
        // Автооткрытие чата с профиля: /messages.html?to=ID&name=Nick
        const toId = Number(urlParams.get('to'));
        const toName = urlParams.get('name') || ('User #' + toId);
        if (toId) openMsgrChat(toId, toName);
      });
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
      const r = await apiFetch('/api/profile', { 
        method: 'POST', 
        body: JSON.stringify({ display_name: n, avatar_url: a, banner_url: b, bio, font_family: f, background_url: bg }) 
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
    const r = await apiFetch('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ friend_id: targetId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    alert('Friend request sent!');
  } catch (e) { alert(e.message); }
};

window.removeFriend = async function(friendId, friendName) {
  if (!currentUser) return alert('Please login first');
  const name = friendName || 'this user';
  if (!confirm('Remove ' + name + ' from friends?')) return;
  try {
    const r = await apiFetch('/api/friends/remove', {
      method: 'POST',
      body: JSON.stringify({ friend_id: friendId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    alert('Removed from friends.');
    // Обновляем список на странице профиля
    const list = document.getElementById('friendsList');
    if (list) {
      const res = await fetch('/api/friends/list?user_id=' + currentUser.id);
      const friends = await res.json();
      if (!Array.isArray(friends) || friends.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: #888;">No friends yet. Add someone from the main page!</div>';
      } else {
        list.innerHTML = friends.map(f => {
          const safeName = String(f.display_name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          return `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px; border-bottom: 1px dotted #ccc;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <img src="${f.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect width=%2224%22 height=%2224%22 fill=%22%23ccc%22/%3E%3C/svg%3E'}" style="width: 24px; height: 24px; border: 1px solid #808080; object-fit: cover;">
              <a href="/profile.html?user=${encodeURIComponent(f.display_name)}" style="text-decoration: none;">${formatName(f.display_name, f.role, null)}</a>
            </div>
            <button class="neon-btn" style="padding: 1px 6px; font-size: 10px; flex-shrink: 0; background: #ffcccc; color: #800000;" onclick="removeFriend(${f.id}, '${safeName}')">Remove</button>
          </div>`;
        }).join('');
      }
    }
  } catch (e) { alert(e.message); }
};


// ================= 8. ЗВУКИ + АЛЕРТЫ + ГРОМКОСТЬ =================
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
  function isMuted() {
    return localStorage.getItem('4oom_sound_mute') === '1';
  }
  function getMsgSoundKey() {
    const k = localStorage.getItem('4oom_msg_sound') || 'message1';
    return MSG_SOUNDS[k] ? k : 'message1';
  }

  function playSe(filename) {
    if (isMuted()) return;
    try {
      const a = new Audio('/audio/se/' + filename);
      a.volume = getVol();
      a.play().catch(() => {});
    } catch (e) {}
  }

  window.playSe = playSe;
  window.playMessageSound = function() {
    playSe(MSG_SOUNDS[getMsgSoundKey()].file);
  };
  window.playNotificationSound = function() {
    playSe('notification.mp3');
  };
  window.playClickSound = function() { playSe('click.mp3'); };
  window.playSwitchSound = function() { playSe('switch.mp3'); };
  window.playAcceptSound = function() { playSe('accept.mp3'); };
  window.playSendSound = function() { playSe('send.mp3'); };

  // Разблокировка автоплея
  let soundUnlocked = false;
  function unlockSound() {
    if (soundUnlocked) return;
    soundUnlocked = true;
    try { new Audio().play().catch(() => {}); } catch (e) {}
  }
  document.addEventListener('click', unlockSound, { once: true });
  document.addEventListener('keydown', unlockSound, { once: true });

  // --- Панель громкости (левый нижний угол, Win95 slider) ---
  let soundBar = document.getElementById('globalSoundBar');
  if (!soundBar) {
    if (!document.getElementById('win95-range-css')) {
      const st = document.createElement('style');
      st.id = 'win95-range-css';
      st.textContent = `
#globalSoundBar{position:fixed;left:10px;bottom:10px;z-index:10001;display:flex;align-items:center;gap:6px;
background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:4px 6px;
font-family:Tahoma,sans-serif;font-size:11px;box-shadow:1px 1px 0 #000;}
#globalSoundBar button{border:2px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0;padding:1px 6px;cursor:pointer;font-size:12px;}
#globalSoundBar button:active{border-color:#808080 #fff #fff #808080;}
#globalSoundBar select{border:2px solid;border-color:#808080 #fff #fff #808080;background:#fff;font-size:11px;max-width:88px;}
#soundVolSlider{-webkit-appearance:none;appearance:none;width:90px;height:18px;background:transparent;cursor:pointer;vertical-align:middle;}
#soundVolSlider::-webkit-slider-runnable-track{height:4px;background:#808080;border:1px solid;border-color:#404040 #dfdfdf #dfdfdf #404040;box-shadow:inset 1px 1px 0 #000;}
#soundVolSlider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:20px;margin-top:-9px;background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;box-shadow:1px 1px 0 #000;cursor:pointer;}
#soundVolSlider::-moz-range-track{height:4px;background:#808080;border:1px solid;border-color:#404040 #dfdfdf #dfdfdf #404040;}
#soundVolSlider::-moz-range-thumb{width:12px;height:18px;background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;cursor:pointer;}
`;
      document.head.appendChild(st);
    }
    soundBar = document.createElement('div');
    soundBar.id = 'globalSoundBar';
    soundBar.innerHTML = `
      <button type="button" id="soundMuteBtn" title="Mute/Unmute">🔊</button>
      <input type="range" id="soundVolSlider" min="0" max="100" value="${Math.round(getVol()*100)}" title="Volume">
      <select id="msgSoundSelect" title="Message sound">
        <option value="message1">Pop</option>
        <option value="message2">Cup</option>
        <option value="message3">Clarinet</option>
        <option value="message4">Piano</option>
      </select>
    `;
    document.body.appendChild(soundBar);

    const muteBtn = document.getElementById('soundMuteBtn');
    const volSlider = document.getElementById('soundVolSlider');
    const msgSelect = document.getElementById('msgSoundSelect');

    function syncMuteUi() {
      muteBtn.textContent = isMuted() ? '🔇' : '🔊';
      volSlider.disabled = isMuted();
    }
    syncMuteUi();
    msgSelect.value = getMsgSoundKey();

    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.setItem('4oom_sound_mute', isMuted() ? '0' : '1');
      syncMuteUi();
      if (!isMuted()) playSe('click.mp3');
    });
    volSlider.addEventListener('input', () => {
      localStorage.setItem('4oom_sound_vol', String(volSlider.value / 100));
      localStorage.setItem('4oom_sound_mute', '0');
      syncMuteUi();
    });
    volSlider.addEventListener('change', () => {
      playMessageSound();
    });
    msgSelect.addEventListener('change', () => {
      localStorage.setItem('4oom_msg_sound', msgSelect.value);
      playMessageSound();
    });
  }

  // --- Клики: switch / accept / send / click ---
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button, input[type="submit"], .neon-btn, .win-btn, .delete-btn');
    if (!el) return;
    if (el.id === 'soundMuteBtn' || el.closest('#globalSoundBar')) return;

    const tag = el.tagName;
    const href = (el.getAttribute && el.getAttribute('href')) || '';
    const onclick = (el.getAttribute && el.getAttribute('onclick')) || '';
    const id = el.id || '';
    const text = (el.textContent || '').toLowerCase();
    const type = (el.getAttribute && el.getAttribute('type')) || '';

    // Навигация на другую страницу
    const isNav = (tag === 'A' && href && !href.startsWith('#') && !href.startsWith('javascript:'))
      || /location\.href|location\.assign/.test(onclick)
      || id === 'msgrBtn'
      || (text.includes('settings') && tag === 'BUTTON');

    // Accept / apply / save
    const isAccept = /acceptFriend|accept friend|apply|save/i.test(onclick + text + id)
      || id === 'saveBtn'
      || id.startsWith('save');

    // Send message / form submit buttons
    const isSend = type === 'submit'
      || id === 'msgrSendBtn'
      || /send/i.test(text)
      || el.closest('#msgrForm, #chatForm, #bugForm, #replyForm, #dmForm');

    if (isNav) playSe('switch.mp3');
    else if (isAccept) playSe('accept.mp3');
    else if (isSend) playSe('send.mp3');
    else playSe('click.mp3');
  }, true);

  // Также send на submit форм
  document.addEventListener('submit', (e) => {
    const id = e.target && e.target.id;
    if (id === 'msgrForm' || id === 'chatForm' || id === 'bugForm' || id === 'replyForm' || id === 'dmForm') {
      playSe('send.mp3');
    }
  }, true);

  // --- Плашка алертов ---
  if (!currentUser) return;

  let badge = document.getElementById('globalAlertsBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'globalAlertsBadge';
    badge.style.cssText = [
      'position:fixed', 'top:42px', 'right:10px', 'z-index:10000',
      'display:none', 'flex-direction:column', 'gap:6px',
      'font-family:Tahoma,sans-serif', 'font-size:12px', 'max-width:280px'
    ].join(';');
    document.body.appendChild(badge);
  }

  let lastUnreadMsg = -1;
  let lastFriendReq = -1;
  let titleBlinkTimer = null;
  const baseTitle = document.title;

  function startTitleBlink(unreadMsg, friendReq) {
    stopTitleBlink();
    if (document.hasFocus() && !document.hidden) return;
    const total = unreadMsg + friendReq;
    if (total <= 0) return;
    let on = false;
    const msg = unreadMsg > 0
      ? `(${unreadMsg}) New message!`
      : `(${friendReq}) Friend request!`;
    titleBlinkTimer = setInterval(() => {
      on = !on;
      document.title = on ? msg : baseTitle;
    }, 1000);
  }
  function stopTitleBlink() {
    if (titleBlinkTimer) {
      clearInterval(titleBlinkTimer);
      titleBlinkTimer = null;
    }
    document.title = baseTitle;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stopTitleBlink();
  });
  window.addEventListener('focus', () => stopTitleBlink());

  function notifyBrowser(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        const n = new Notification(title, { body, icon: '/favicon.svg', tag: '4oom-alert' });
        setTimeout(() => n.close(), 5000);
      } else if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch (e) {}
  }

  function renderBadge(unreadMsg, friendReq) {
    const parts = [];
    if (unreadMsg > 0) {
      parts.push(`<a href="/messages.html" style="display:block;background:#ffffcc;border:2px solid #808080;padding:6px 10px;text-decoration:none;color:#000;box-shadow:2px 2px 0 #000;">💬 New messages: <b>${unreadMsg}</b></a>`);
    }
    if (friendReq > 0) {
      parts.push(`<a href="/" style="display:block;background:#ccffcc;border:2px solid #808080;padding:6px 10px;text-decoration:none;color:#000;box-shadow:2px 2px 0 #000;">🔔 Friend requests: <b>${friendReq}</b></a>`);
    }
    if (parts.length === 0) {
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
      if (!getSessionToken() && !document.cookie.includes('4oom_session')) return;
      const res = await apiFetch('/api/alerts');
      if (!res.ok) return;
      const data = await res.json();
      const unreadMsg = Number(data.unread_messages) || 0;
      const friendReq = Number(data.friend_requests) || 0;

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

  // Запрос разрешения на уведомления после первого клика
  document.addEventListener('click', () => {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch (e) {}
  }, { once: true });
})();

// ================= SECRET CODES =================
(function initSecretCodes() {
  const form = document.getElementById('secretCodeForm');
  const input = document.getElementById('secretCodeInput');
  const status = document.getElementById('secretCodeStatus');
  if (!form || !input) return;

  const CODES = {
    destructive: '/games/Destructive/'   // или '/games/Destructive/index.html'
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = (input.value || '').trim().toLowerCase();
    if (!code) return;

    if (CODES[code]) {
      if (status) status.textContent = 'Access granted...';
      if (typeof playSe === 'function') playSe('accept.mp3');
      location.href = CODES[code];
      return;
    }

    if (status) {
      status.style.color = '#800000';
      status.textContent = 'Unknown code.';
    }
    if (typeof playSe === 'function') playSe('click.mp3');
    input.value = '';
  });
})();


// ================= MOBILE SIDE MENU + PANEL NAV =================
(function initMobileNav() {
  const menuBtn = document.getElementById('menuBtn');
  const sideMenu = document.getElementById('sideMenu');
  const overlay = document.getElementById('sideOverlay');
  const closeBtn = document.getElementById('sideCloseBtn');
  const titleEl = document.getElementById('headerPanelTitle');
  if (!sideMenu || !menuBtn) return;

  const titles = {
    threads: '4OOM — Threads',
    lobby: '4OOM — Lobby Chat',
    bugs: '4OOM — Bugfix',
    users: '4OOM — Users',
    profile: '4OOM — Profile',
    rules: '4OOM — Rules',
    secrets: '4OOM — Secret Codes'
  };

  function openMenu() {
    sideMenu.classList.add('is-open');
    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }
  function closeMenu() {
    sideMenu.classList.remove('is-open');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function showPanel(name) {
    const panels = document.querySelectorAll('.panel-section');
    // On narrow screens: only one panel. On wide: keep all visible via CSS media query.
    const narrow = window.matchMedia('(max-width: 899px)').matches;
    panels.forEach(sec => {
      if (narrow) {
        sec.classList.toggle('is-active', sec.getAttribute('data-panel') === name);
      } else {
        sec.classList.add('is-active');
      }
    });
    document.querySelectorAll('.side-nav-btn[data-panel]').forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-panel') === name);
    });
    if (titleEl) titleEl.textContent = titles[name] || '4OOM';
    if (narrow) {
      const el = document.getElementById('panel-' + name) || document.querySelector('[data-panel="' + name + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }

  menuBtn.addEventListener('click', openMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (overlay) overlay.addEventListener('click', closeMenu);

  document.querySelectorAll('.side-nav-btn[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-panel');
      showPanel(name);
      closeMenu();
      if (typeof playSe === 'function') playSe('switch.mp3');
    });
  });

  // Initial panel from hash or default threads
  const hash = (location.hash || '').replace(/^#/, '');
  const start = titles[hash] ? hash : 'threads';
  showPanel(start);

  window.addEventListener('resize', () => {
    const active = document.querySelector('.side-nav-btn[data-panel].is-active');
    const name = active ? active.getAttribute('data-panel') : 'threads';
    showPanel(name);
  });
})();

// ================= MESSAGES: mobile list <-> chat =================
(function initMsgrMobileChrome() {
  const page = document.querySelector('.msgr-page');
  const backBtn = document.getElementById('msgrBackBtn');
  if (!page) return;

  function showList() {
    page.classList.remove('is-chat-open');
  }
  function showChat() {
    page.classList.add('is-chat-open');
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showList();
      if (typeof playSe === 'function') playSe('switch.mp3');
    });
  }

  // Patch openMsgrChat to open chat pane on mobile
  const prevOpen = window.openMsgrChat;
  if (typeof prevOpen === 'function') {
    window.openMsgrChat = async function(friendId, friendName) {
      await prevOpen(friendId, friendName);
      showChat();
    };
  } else {
    // if defined later, observe
    Object.defineProperty(window, 'openMsgrChat', {
      configurable: true,
      set: function(fn) {
        Object.defineProperty(window, 'openMsgrChat', {
          configurable: true,
          writable: true,
          value: async function(friendId, friendName) {
            await fn(friendId, friendName);
            showChat();
          }
        });
      }
    });
  }

  // If opened with ?to=, open chat pane after load
  const params = new URLSearchParams(window.location.search);
  if (params.get('to')) {
    setTimeout(showChat, 400);
  }
})();
