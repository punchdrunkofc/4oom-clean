function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let currentUser = null;
const userJson = localStorage.getItem('4oom_user');
if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) { localStorage.removeItem('4oom_user'); } }

function getRoleBadge(role) {
  if (!role || role === 'user') return '';
  if (role === 'creator') return `<span class="role-badge role-creator-glitter">CREATOR</span>`;
  const labels = { moderator: 'MOD', editor: 'EDITOR' };
  return `<span class="role-badge role-${role}">${labels[role]}</span>`;
}

function formatName(name, role) {
  if (role === 'creator') return `<span class="creator-name">${escapeHtml(name)}</span>`;
  return escapeHtml(name);
}

// --- ГЛАВНАЯ СТРАНИЦА ---
if (document.getElementById('threadList')) {
  if (currentUser) {
    document.getElementById('profileName').textContent = currentUser.login;
    document.getElementById('profileBox').innerHTML = `
      <img src="${currentUser.avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2240%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E'}" class="avatar" alt="avatar">
      <p class="profile__name">${formatName(currentUser.login, currentUser.role)} ${getRoleBadge(currentUser.role)}</p>
      <p class="profile__status">online · github user</p>
      <button class="neon-btn" onclick="location.href='/settings.html'">settings</button>
      <button class="neon-btn" onclick="localStorage.clear();location.reload()">logout</button>
    `;
  }

  window.deleteThread = async function(firstPostId) {
    if (!confirm('Delete this thread completely?')) return;
    try {
      const res = await fetch('/api/posts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          post_id: firstPostId, 
          user_role: currentUser ? currentUser.role : 'guest', 
          user_login: currentUser ? currentUser.login : 'guest' 
        })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      loadThreads();
    } catch(e) { alert('Error: ' + e.message); }
  };

  window.loadThreads = async function() {
    const list = document.getElementById('threadList');
    try {
      const r = await fetch('/api/threads');
      const threads = await r.json();
      if (!threads || threads.length === 0) { list.innerHTML = '<li class="thread"><a href="#"><span class="thread__title">Nothing here yet — create the first thread!</span></a></li>'; return; }
      
      list.innerHTML = threads.map(function(t) {
        const canDelete = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || t.author_name === currentUser.login);
        const deleteBtn = canDelete ? `<button class="delete-btn" onclick="event.preventDefault(); deleteThread(${t.first_post_id})">delete</button>` : '';
        return `<li class="thread">
          <a href="/thread.html?id=${t.id}">
            <span class="thread__title">${escapeHtml(t.title)}</span>
            <span class="thread__meta">by ${formatName(t.author_name, t.author_role)} · ${t.reply_count} replies</span>
          </a>
          ${deleteBtn}
        </li>`;
      }).join('');
    } catch(e) { list.innerHTML = '<li>Load error</li>'; }
  };

  window.submitThread = async function() {
    const title = document.getElementById('newTitle').value;
    const body = document.getElementById('newBody').value;
    const image_url = document.getElementById('newImage').value;
    const music_url = document.getElementById('newMusic').value;
    if (!title || !body) return alert('Fill in title and text');
    try {
      const res = await fetch('/api/threads', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, body, image_url, music_url, section_slug: 'general', author_name: currentUser ? currentUser.login : 'guest' }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Server error'); }
      document.getElementById('createForm').style.display = 'none';
      document.getElementById('newTitle').value = ''; document.getElementById('newBody').value = ''; document.getElementById('newImage').value = ''; document.getElementById('newMusic').value = '';
      loadThreads();
    } catch(e) { alert('Error creating thread: ' + e.message); }
  };
  loadThreads();
}

// --- СТРАНИЦА НАСТРОЕК ---
if (document.getElementById('setNick')) {
  if (currentUser) {
    document.getElementById('setNick').value = currentUser.login;
    document.getElementById('setAvatar').value = currentUser.avatar || '';
  }

  window.saveSettings = async function() {
    if (!currentUser) return alert('Please login with GitHub first!');
    const nick = document.getElementById('setNick').value.trim();
    const avatar = document.getElementById('setAvatar').value.trim();
    if (!nick) return alert('Nickname cannot be empty');
    
    try {
      const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: currentUser.id, display_name: nick, avatar_url: avatar }) });
      if (!res.ok) throw new Error('Save error');
      currentUser.login = nick; currentUser.avatar = avatar; localStorage.setItem('4oom_user', JSON.stringify(currentUser));
      alert('Settings saved!'); location.href = '/';
    } catch(e) { alert('Error: ' + e.message); }
  };
}

// --- СТРАНИЦА ТРЕДА ---
if (document.getElementById('postList')) {
  const threadId = new URLSearchParams(location.search).get('id');
  
  window.deletePost = async function(postId) {
    if (!confirm('Delete this post?')) return;
    try {
      const res = await fetch('/api/posts/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, user_role: currentUser ? currentUser.role : 'guest', user_login: currentUser ? currentUser.login : 'guest' })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      loadPosts();
    } catch(e) { alert('Error: ' + e.message); }
  };

  window.loadPosts = async function() {
    if (!threadId) { location.href = '/'; return; }
    try {
      const r = await fetch('/api/posts?thread=' + threadId);
      if (!r.ok) { if (r.status === 404) { alert('This thread has been deleted.'); location.href='/'; return; } }
      const data = await r.json();
      document.querySelector('.window__bar span').textContent = '📄 ' + data.thread.title;
      
      document.getElementById('postList').innerHTML = data.posts.map(function(p) {
        let avatarHtml = p.author_avatar ? '<img src="' + p.author_avatar + '" class="post__avatar" alt="avatar">' : '<div style="width:24px; height:24px; background:#ccc; border: 1px solid #808080; display:inline-block; vertical-align: middle;"></div>';
        const canDelete = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || p.author_name === currentUser.login);
        const deleteBtn = canDelete ? `<button class="delete-btn" onclick="deletePost(${p.id})">delete</button>` : '';
        let imgHtml = p.image_url ? '<img src="' + p.image_url + '" class="post__img" alt="image" onerror="this.style.display=\'none\'">' : '';
        let audioHtml = p.music_url ? `<audio controls class="post__audio" src="${p.music_url}"></audio>` : '';
        return '<article class="post"><div class="post__head"><span class="post__author">' + avatarHtml + formatName(p.author_name, p.author_role) + getRoleBadge(p.author_role) + deleteBtn + '</span><span class="post__time">' + new Date(p.created_at * 1000).toLocaleString() + '</span></div><div class="post__body">' + escapeHtml(p.body) + imgHtml + audioHtml + '</div></article>';
      }).join('');
    } catch(e) { document.getElementById('postList').innerHTML = 'Error loading thread'; }
  };

  document.getElementById('replyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = document.getElementById('replyBody').value;
    const image_url = document.getElementById('replyImage').value;
    const music_url = document.getElementById('replyMusic').value;
    if (!body) return;
    try {
      await fetch('/api/posts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ thread_id: threadId, body, image_url, music_url, author_name: currentUser ? currentUser.login : 'guest' }) });
      document.getElementById('replyBody').value = ''; document.getElementById('replyImage').value = ''; document.getElementById('replyMusic').value = '';
      loadPosts();
    } catch(e) { alert('Error sending'); }
  });
  loadPosts();
}
