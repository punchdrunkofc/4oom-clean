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
  
  if (role === 'creator') {
    return `<span class="creator-name" style="${s}">${escapeHtml(name)}</span>`;
  } 
  if (role === 'moderator') {
    return `<span class="moderator-name" style="${s}">${escapeHtml(name)}</span>`;
  }
  return `<span style="${s}">${escapeHtml(name)}</span>`;
}

// Универсальная функция для применения фона (картинка или видео)
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

// Сброс фона (вызывается на всех страницах, кроме профиля)
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
      
      // ЭФФЕКТ НЕОЖИДАННОСТИ: Если зашли на профиль создателя, включаем видео
      if (user.display_name === 'PunchDrunk' || user.role === 'creator') {
        applyCustomBg('/bg.mp4');
      } else {
        // Для остальных пользователей применяем картинку, если она есть
        if (user.background_url) {
          applyCustomBg(user.background_url);
        } else {
          resetVideoBg();
        }
      }
      
      if (currentUser && currentUser.login === user.display_name) {
        const b = document.getElementById('editProfileBtn'); if (b) { b.style.display = 'inline-block'; b.href = '/settings.html'; }
      }
      document.getElementById('userAvatar').src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';
      
      if (user.banner_url) { 
        const b = document.getElementById('userBanner'); b.src = user.banner_url; b.style.display = 'block'; 
        document.getElementById('bannerContainer').style.display = 'block';
      }
      document.getElementById('userBio').textContent = user.bio || 'This user has not written a bio yet.';
      
      const list = document.getElementById('userThreads');
      list.innerHTML = (threads && threads.length > 0) ? threads.map(t => `<li class="thread" style="text-align: left;"><a href="/thread.html?id=${t.id}"><span class="thread__title">[${t.section_slug}] ${escapeHtml(t.title)}</span><span class="thread__meta">${t.reply_count} replies</span></a></li>`).join('') : '<li class="thread" style="text-align: left;"><a href="#"><span class="thread__title">No threads yet.</span></a></li>';
    }).catch(e => {
      document.getElementById('userName').textContent = 'User not found';
      document.getElementById('userBio').textContent = '';
      document.getElementById('userThreads').innerHTML = '';
    });
  }
}

// --- ЧАТ ---
if (document.getElementById('chatMessages')) {
  resetVideoBg();
  const chatMsgs = document.getElementById('chatMessages'), chatForm = document.getElementById('chatForm'), chatInput = document.getElementById('chatInput'), onlineUsers = document.getElementById('onlineUsers');
  
  if (currentUser) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws?nick=${encodeURIComponent(currentUser.login)}`);
    ws.onopen = () => { chatMsgs.innerHTML = ''; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'history') {
        chatMsgs.innerHTML = '';
        if (data.messages.length === 0) { chatMsgs.innerHTML = '<div style="color: #888; font-size: 11px; text-align: center;">No messages yet.</div>'; } 
        else {
          data.messages.forEach(m => {
            const div = document.createElement('div'); div.style.marginBottom = '6px'; div.style.fontSize = '12px';
            div.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(m.user)}" style="font-weight: bold; color: #000080; text-decoration: none;">${escapeHtml(m.user)}:</a> <span style="font-family: 'Times New Roman', serif;">${escapeHtml(m.text)}</span>`;
            chatMsgs.appendChild(div);
          });
          chatMsgs.scrollTop = chatMsgs.scrollHeight;
        }
      }
      if (data.type === 'chat') {
        const div = document.createElement('div'); div.style.marginBottom = '6px'; div.style.fontSize = '12px';
        div.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(data.user)}" style="font-weight: bold; color: #000080; text-decoration: none;">${escapeHtml(data.user)}:</a> <span style="font-family: 'Times New Roman', serif;">${escapeHtml(data.text)}</span>`;
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
  fetch('/api/sections').then(r => r.json()).then(s => { 
    dbSections = s.map(x => x.section_slug); 
    const sel = document.getElementById('sectionSelect'); 
    [...new Set([...(typeof customSuggestions !== 'undefined' ? customSuggestions : []), ...dbSections])].sort().forEach(sec => { 
      const o = document.createElement('option'); o.value = sec; o.textContent = sec; sel.appendChild(o); 
    }); 
    if (currentSection && currentSection !== 'my') sel.value = currentSection; 
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
  
  if (!currentSection) document.getElementById('nav-home').style.fontWeight = 'bold';
  if (currentSection === 'my') document.getElementById('nav-my').style.fontWeight = 'bold';
  
  if (currentUser) {
    document.getElementById('profileBox').innerHTML = `<a href="/profile.html?user=${encodeURIComponent(currentUser.login)}"><img src="${currentUser.avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2240%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E'}" class="avatar"></a><p class="profile__name"><a href="/profile.html?user=${encodeURIComponent(currentUser.login)}" style="text-decoration:none; color:inherit;">${formatName(currentUser.login, currentUser.role, currentUser.font)}</a> ${getRoleBadge(currentUser.role)}</p><p class="profile__status">online</p><button class="neon-btn" onclick="location.href='/settings.html'">settings</button><button class="neon-btn" onclick="localStorage.clear();location.reload()">logout</button>`;
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

// --- НАСТРОЙКИ ---
if (document.getElementById('setNick')) {
  resetVideoBg();
  let avC = null, bnC = null, bgC = null;
  
  function updatePreview() {
    const n = document.getElementById('setNick').value || 'YourNickname', f = document.getElementById('setFont').value;
    document.getElementById('previewName').textContent = n;
    document.getElementById('previewName').style.fontFamily = f || 'var(--font-pixel)';
    document.getElementById('previewAvatar').src = document.getElementById('setAvatar').value || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2230%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';
    const b = document.getElementById('setBanner').value;
    document.getElementById('previewBanner').style.display = b ? 'block' : 'none';
    if (b) document.getElementById('previewBanner').src = b;
    document.getElementById('previewBio').textContent = document.getElementById('setBio').value || 'This user has not written a bio yet.';
    document.getElementById('previewRole').innerHTML = getRoleBadge(currentUser ? currentUser.role : 'user');
  }
  
  ['setNick', 'setBio'].forEach(id => document.getElementById(id).addEventListener('input', updatePreview));
  document.getElementById('setFont').addEventListener('change', updatePreview);

  const setupCrop = (fileId, containerId, imgId, btnId, ratio) => {
    const f = document.getElementById(fileId), c = document.getElementById(containerId), i = document.getElementById(imgId), b = document.getElementById(btnId);
    if (f && typeof Cropper !== 'undefined') {
      f.addEventListener('change', e => { 
        const file = e.target.files[0]; if (!file) return; 
        const r = new FileReader(); 
        r.onload = ev => { 
          i.src = ev.target.result; c.style.display = 'block'; b.style.display = 'inline-block'; 
          if (window['crop' + fileId]) window['crop' + fileId].destroy(); 
          window['crop' + fileId] = new Cropper(i, { aspectRatio: ratio, viewMode: 1 }); 
        }; 
        r.readAsDataURL(file); 
      });
    }
  };
  
  setupCrop('avatarFile', 'avatarCropperContainer', 'avatarCropperImage', 'saveAvatarBtn', 1);
  setupCrop('bannerFile', 'bannerCropperContainer', 'bannerCropperImage', 'saveBannerBtn', 3);
  setupCrop('bgFile', 'bgCropperContainer', 'bgCropperImage', 'saveBgBtn', 16/9);

  window.applyAvatarCrop = () => { if (!window.cropavatarFile) return; document.getElementById('setAvatar').value = window.cropavatarFile.getCroppedCanvas({ width: 200, height: 200 }).toDataURL('image/jpeg', 0.85); document.getElementById('avatarCropperContainer').style.display = 'none'; document.getElementById('saveAvatarBtn').style.display = 'none'; updatePreview(); };
  window.applyBannerCrop = () => { if (!window.cropbannerFile) return; document.getElementById('setBanner').value = window.cropbannerFile.getCroppedCanvas({ width: 1200, height: 400 }).toDataURL('image/jpeg', 0.85); document.getElementById('bannerCropperContainer').style.display = 'none'; document.getElementById('saveBannerBtn').style.display = 'none'; updatePreview(); };
  
  window.applyBgCrop = () => {
    if (!window.cropbgFile) return;
    const b = window.cropbgFile.getCroppedCanvas({ width: 2560, height: 1440, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' }).toDataURL('image/jpeg', 0.9);
    document.getElementById('setBg').value = b;
    document.getElementById('bgCropperContainer').style.display = 'none'; 
    document.getElementById('saveBgBtn').style.display = 'none';
    applyCustomBg(b);
    if (window.cropbgFile) { window.cropbgFile.destroy(); window.cropbgFile = null; }
  };

  if (currentUser) {
    document.getElementById('setNick').value = currentUser.login;
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(d => { 
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
  
  window.saveSettings = async () => {
    if (!currentUser) return alert('Login first!');
    const n = document.getElementById('setNick').value.trim(), a = document.getElementById('setAvatar').value, b = document.getElementById('setBanner').value, bg = document.getElementById('setBg').value, bio = document.getElementById('setBio').value.trim(), f = document.getElementById('setFont').value;
    if (!n) return alert('Nickname empty');
    try {
      const r = await fetch('/api/profile', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ user_id: currentUser.id, display_name: n, avatar_url: a, banner_url: b, bio, font_family: f, background_url: bg }) });
      if (!r.ok) throw new Error('Save error');
      currentUser.login = n; currentUser.avatar = a; currentUser.font = f; localStorage.setItem('4oom_user', JSON.stringify(currentUser)); location.href = '/';
    } catch(e) { alert(e.message); }
  };
}

// --- ТРЕД ---
if (document.getElementById('postList')) {
  resetVideoBg();
  const tid = urlParams.get('id');
  
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
      if (!r.ok) { if (r.status === 404) { alert('Deleted'); location.href = '/'; return; } }
      const data = await r.json(); 
      document.querySelector('.window__bar span').textContent = '📄 ' + data.thread.title;

      document.getElementById('postList').innerHTML = data.posts.map(p => {
        const url = `/profile.html?user=${encodeURIComponent(p.author_name)}`;
        const av = p.author_avatar ? `<a href="${url}"><img src="${p.author_avatar}" class="post__avatar"></a>` : `<a href="${url}"><div style="width:24px; height:24px; background:#ccc; border: 1px solid #808080; display:inline-block;"></div></a>`;
        const canDel = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || p.author_name === currentUser.login);
        return `<article class="post"><div class="post__head"><span class="post__author">${av}<a href="${url}" style="text-decoration:none; color:inherit;">${formatName(p.author_name, p.author_role, p.author_font)}</a>${getRoleBadge(p.author_role)}${canDel ? `<button class="delete-btn" onclick="deletePost(${p.id})">delete</button>` : ''}</span><span class="post__time">${new Date(p.created_at * 1000).toLocaleString()}</span></div><div class="post__body">${escapeHtml(p.body)}${p.image_url ? `<img src="${p.image_url}" class="post__img">` : ''}${p.music_url ? `<audio controls class="post__audio" src="${p.music_url}"></audio>` : ''}</div></article>`;
      }).join('');
    } catch(e) { document.getElementById('postList').innerHTML = 'Error'; }
  };
  
  document.getElementById('replyForm').addEventListener('submit', async e => {
    e.preventDefault(); const b = document.getElementById('replyBody').value, img = document.getElementById('replyImageFile').files[0], mus = document.getElementById('replyMusicFile').files[0];
    if (!b) return;
    try {
      let iu = null, mu = null;
      if (img) iu = await compressImage(img);
      if (mus) mu = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(mus); });
      
      await fetch('/api/posts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ thread_id: tid, body: b, image_url: iu, music_url: mu, author_name: currentUser ? currentUser.login : 'guest' }) });
      document.getElementById('replyBody').value = ''; document.getElementById('replyImageFile').value = ''; document.getElementById('replyMusicFile').value = '';
      loadPosts();
    } catch(e) { alert(e.message); }
  });
  loadPosts();
}
