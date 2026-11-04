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

let currentUser = null;
const userJson = localStorage.getItem('4oom_user');
if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) {} }
const urlParams = new URLSearchParams(window.location.search);
const currentSection = urlParams.get('section');
let dbSections = [];

function getRoleBadge(role) {
  if (!role || role === 'user') return '';
  if (role === 'creator') return `<span class="role-badge role-creator-glitter">CREATOR</span>`;
  const labels = { moderator: 'MODERATOR', editor: 'EDITOR' };
  return `<span class="role-badge role-${role}">${labels[role]}</span>`;
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
    if (video) video.style.display = 'none';
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = '#000';
    return;
  }
  if (url.endsWith('.mp4')) {
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = 'transparent';
    if (video) { video.src = url; video.style.display = 'block'; video.currentTime = 0; video.play().catch(e => console.log(e)); }
  } else {
    if (video) video.style.display = 'none';
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundRepeat = 'no-repeat';
  }
}

function resetVideoBg() {
  const video = document.getElementById('bgVideo');
  if (video) { video.pause(); video.style.display = 'none'; video.src = ''; }
  document.body.style.backgroundImage = '';
  document.body.style.backgroundColor = '#000';
}

// --- ПРОФИЛЬ ---
if (document.getElementById('userName')) {
  const login = urlParams.get('user');
  if (!login) location.href = '/';
  else {
    fetch('/api/user?login=' + encodeURIComponent(login)).then(r => r.json()).then(data => {
      const { user, threads } = data;
      document.title = `4OOM — ${user.display_name}`;
      document.getElementById('userName').innerHTML = formatName(user.display_name, user.role, user.font_family);
      document.getElementById('userRole').innerHTML = getRoleBadge(user.role);
      
      if (user.display_name === 'PunchDrunk' || user.role === 'creator') {
        applyCustomBg('/bg.mp4');
      } else {
        if (user.background_url) applyCustomBg(user.background_url);
        else resetVideoBg();
      }
      
      if (currentUser && currentUser.login === user.display_name) {
        const b = document.getElementById('editProfileBtn'); if (b) { b.style.display = 'inline-block'; b.href = '/settings.html'; }
      }
      document.getElementById('userAvatar').src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';
      
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
          if (!friends || friends.length === 0) {
            list.innerHTML = '<div style="text-align: center; color: #888;">No friends yet. Add someone from the main page!</div>';
          } else {
            list.innerHTML = friends.map(f => `
              <div style="display: flex; align-items: center; gap: 8px; padding: 4px; border-bottom: 1px dotted #ccc;">
                <img src="${f.avatar_url || '...'}" style="width: 24px; height: 24px; border: 1px solid #808080;">
                <a href="/profile.html?user=${encodeURIComponent(f.display_name)}" style="text-decoration: none;">${formatName(f.display_name, f.role, null)}</a>
              </div>
            `).join('');
          }
        }).catch(e => console.error('Friends load error', e));
      }

    }).catch(e => {
      document.getElementById('userName').textContent = 'User not found';
      document.getElementById('userBio').textContent = '';
      document.getElementById('userThreads').innerHTML = '';
    });
  }
}

// --- ЧАТ НА ГЛАВНОЙ ---
if (document.getElementById('chatMessages')) {
  resetVideoBg();
  const chatMsgs = document.getElementById('chatMessages'), chatForm = document.getElementById('chatForm'), chatInput = document.getElementById('chatInput'), onlineUsers = document.getElementById('onlineUsers');
  
  if (currentUser) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}&role=${encodeURIComponent(currentUser.role)}`);
    ws.onopen = () => { chatMsgs.innerHTML = ''; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'history') {
        chatMsgs.innerHTML = '';
        if (data.messages.length === 0) { chatMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">No messages yet.</div>'; } 
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

// --- ГЛАВНАЯ ---
if (document.getElementById('threadList')) {
  resetVideoBg();
  
  if (currentUser) {
    fetch('/api/friends/all?user_id=' + currentUser.id).then(r => r.json()).then(existingLinks => {
      fetch('/api/users').then(r => r.json()).then(users => {
        const list = document.getElementById('usersList');
        if (!list) return;
        if (!users || users.length === 0) {
          list.innerHTML = '<div style="text-align: center; color: #888;">No users found.</div>';
          return;
        }
        list.innerHTML = users.map(u => {
          const isMe = currentUser.login === u.display_name;
          const hasLink = existingLinks.includes(u.id);
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
      if (list) list.innerHTML = users.map(u => `<div style="padding: 6px; border-bottom: 1px dotted #ccc;"><a href="/profile.html?user=${encodeURIComponent(u.display_name)}" style="text-decoration: none;">${formatName(u.display_name, u.role, null)}</a></div>`).join('');
    });
  }

  fetch('/api/sections').then(r => r.json()).then(s => { 
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
          <div>${canDel ? `<button class="delete-btn" onclick="deleteThread(${t.first_post_id})">
