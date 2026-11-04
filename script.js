function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let currentUser = null;
const userJson = localStorage.getItem('4oom_user');
if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) { localStorage.removeItem('4oom_user'); } }

const urlParams = new URLSearchParams(window.location.search);
const currentSection = urlParams.get('section');

let dbSections = [];

function getRoleBadge(role) {
  if (!role || role === 'user') return '';
  if (role === 'creator') return `<span class="role-badge role-creator-glitter">CREATOR</span>`;
  const labels = { moderator: 'MOD', editor: 'EDITOR' };
  return `<span class="role-badge role-${role}">${labels[role]}</span>`;
}

function formatName(name, role, font) {
  let style = font ? `font-family: ${font};` : "";
  if (role === 'creator') return `<span class="creator-name" style="${style}">${escapeHtml(name)}</span>`;
  return `<span style="${style}">${escapeHtml(name)}</span>`;
}

// Обновление предпросмотра шрифта в настройках
function updatePreview() {
  const nickInput = document.getElementById('setNick');
  const fontSelect = document.getElementById('setFont');
  const preview = document.getElementById('fontPreview');
  if (preview && nickInput && fontSelect) {
    preview.textContent = nickInput.value || 'YourNickname';
    preview.style.fontFamily = fontSelect.value || 'var(--font-pixel)';
  }
}

// --- СТРАНИЦА ПРОФИЛЯ ---
if (document.getElementById('userName')) {
  const profileLogin = urlParams.get('user');
  
  if (!profileLogin) {
    location.href = '/';
  } else {
    fetch('/api/user?login=' + encodeURIComponent(profileLogin))
      .then(r => {
        if (!r.ok) throw new Error('User not found');
        return r.json();
      })
      .then(data => {
        const { user, threads } = data;
        
        document.title = `4OOM — ${user.display_name}`;
        document.getElementById('userName').innerHTML = formatName(user.display_name, user.role, user.font_family) + ' ' + getRoleBadge(user.role);
        document.getElementById('userAvatar').src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';
        
        if (user.banner_url) {
          const banner = document.getElementById('userBanner');
          banner.src = user.banner_url;
          banner.style.display = 'block';
          banner.style.objectPosition = user.banner_position || 'center';
        }
        
        document.getElementById('userBio').textContent = user.bio || 'This user has not written a bio yet.';

        const list = document.getElementById('userThreads');
        if (!threads || threads.length === 0) {
          list.innerHTML = '<li class="thread"><a href="#"><span class="thread__title">No threads yet.</span></a></li>';
        } else {
          list.innerHTML = threads.map(t => {
            return `<li class="thread">
              <a href="/thread.html?id=${t.id}">
                <span class="thread__title">[${t.section_slug}] ${escapeHtml(t.title)}</span>
                <span class="thread__meta">${t.reply_count} replies</span>
              </a>
            </li>`;
          }).join('');
        }
      })
      .catch(e => {
        document.getElementById('userName').textContent = 'User not found';
        document.getElementById('userBio').textContent = '';
        document.getElementById('userThreads').innerHTML = '';
      });
  }
}

// --- ГЛАВНАЯ СТРАНИЦА ---
if (document.getElementById('threadList')) {
  fetch('/api/sections').then(r => r.json()).then(sections => {
    dbSections = sections.map(s => s.section_slug);
    const select = document.getElementById('sectionSelect');
    const allMenuSections = [...new Set([...customSuggestions, ...dbSections])].sort();
    allMenuSections.forEach(sec => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      select.appendChild(opt);
    });
    if (currentSection && currentSection !== 'my') select.value = currentSection;
  });

  const sectionInput = document.getElementById('newSection');
  const suggestionsBox = document.getElementById('sectionSuggestions');
  if (sectionInput && suggestionsBox) {
    sectionInput.addEventListener('input', function() {
      const val = this.value.toLowerCase().trim();
      suggestionsBox.innerHTML = '';
      if (!val) { suggestionsBox.style.display = 'none'; return; }
      const allSuggestions = [...new Set([...customSuggestions, ...dbSections])].sort();
      const matches = allSuggestions.filter(s => s.includes(val));
      if (matches.length > 0) {
        matches.forEach(match => {
          const div = document.createElement('div');
          div.textContent = match;
          div.onclick = function() {
            sectionInput.value = match;
            suggestionsBox.style.display = 'none';
          };
          suggestionsBox.appendChild(div);
        });
        suggestionsBox.style.display = 'block';
      } else {
        suggestionsBox.style.display = 'none';
      }
    });
    document.addEventListener('click', function(e) {
      if (e.target !== sectionInput && e.target !== suggestionsBox) suggestionsBox.style.display = 'none';
    });
  }

  if (!currentSection) document.getElementById('nav-home').style.fontWeight = 'bold';
  if (currentSection === 'my') document.getElementById('nav-my').style.fontWeight = 'bold';

  if (currentUser) {
    document.getElementById('profileName').textContent = currentUser.login;
    document.getElementById('profileBox').innerHTML = `
      <a href="/profile.html?user=${encodeURIComponent(currentUser.login)}">
        <img src="${currentUser.avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2240%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E'}" class="avatar" alt="avatar">
      </a>
      <p class="profile__name"><a href="/profile.html?user=${encodeURIComponent(currentUser.login)}" style="text-decoration:none; color:inherit;">${formatName(currentUser.login, currentUser.role, currentUser.font)}</a> ${getRoleBadge(currentUser.role)}</p>
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
        body: JSON.stringify({ post_id: firstPostId, user_role: currentUser ? currentUser.role : 'guest', user_login: currentUser ? currentUser.login : 'guest' })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      loadThreads();
    } catch(e) { alert('Error: ' + e.message); }
  };

  window.loadThreads = async function() {
    const list = document.getElementById('threadList');
    try {
      let endpoint = '/api/threads';
      if (currentSection === 'my' && currentUser) {
        endpoint = `/api/threads?my=${encodeURIComponent(currentUser.login)}`;
      } else if (currentSection) {
        endpoint = `/api/threads?section=${currentSection}`;
      }
      const r = await fetch(endpoint);
      let threads = await r.json();
      if (!threads || threads.length === 0) { list.innerHTML = '<li class="thread"><a href="#"><span class="thread__title">Nothing here yet...</span></a></li>'; return; }
      if (!currentSection) threads = threads.sort((a, b) => b.reply_count - a.reply_count).slice(0, 5);
      
      list.innerHTML = threads.map(function(t) {
        const canDelete = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || t.author_name === currentUser.login);
        const deleteBtn = canDelete ? `<button class="delete-btn" onclick="event.preventDefault(); deleteThread(${t.first_post_id})">delete</button>` : '';
        const sectionBadge = (!currentSection || currentSection === 'my') ? `<span style="font-size:10px; color:#000080; margin-right:4px;">[${t.section_slug}]</span>` : '';
        return `<li class="thread">
          <a href="/thread.html?id=${t.id}">
            <span class="thread__title">${sectionBadge}${escapeHtml(t.title)}</span>
            <span class="thread__meta">by <a href="/profile.html?user=${encodeURIComponent(t.author_name)}" style="text-decoration:none; color:inherit;">${formatName(t.author_name, t.author_role, t.author_font)}</a> · ${t.reply_count} replies</span>
          </a>
          ${deleteBtn}
        </li>`;
      }).join('');
    } catch(e) { list.innerHTML = '<li>Load error</li>'; }
  };

  window.submitThread = async function() {
    const title = document.getElementById('newTitle').value;
    const body = document.getElementById('newBody').value;
    const section = document.getElementById('newSection').value.trim().toLowerCase().replace(/\s+/g, '-');
    const image_url = document.getElementById('newImage').value;
    const music_url = document.getElementById('newMusic').value;
    if (!title || !body || !section) return alert('Fill in title, text, and board name');
    try {
      const res = await fetch('/api/threads', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, body, image_url, music_url, section_slug: section, author_name: currentUser ? currentUser.login : 'guest' }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Server error'); }
      document.getElementById('createForm').style.display = 'none';
      document.getElementById('newTitle').value = ''; document.getElementById('newBody').value = ''; document.getElementById('newSection').value = ''; document.getElementById('newImage').value = ''; document.getElementById('newMusic').value = '';
      location.href = `/?section=${section}`;
    } catch(e) { alert('Error creating thread: ' + e.message); }
  };
  loadThreads();
}

// --- СТРАНИЦА НАСТРОЕК ---
if (document.getElementById('setNick')) {
  
  document.getElementById('setNick').addEventListener('input', updatePreview);
  document.getElementById('setFont').addEventListener('change', updatePreview);

  if (currentUser) {
    document.getElementById('setNick').value = currentUser.login;
    document.getElementById('setAvatar').value = currentUser.avatar || '';
    
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(data => {
      document.getElementById('setBanner').value = data.user.banner_url || '';
      document.getElementById('setBannerPos').value = data.user.banner_position || 'center';
      document.getElementById('setBio').value = data.user.bio || '';
      if(document.getElementById('setFont')) document.getElementById('setFont').value = data.user.font_family || '';
      updatePreview(); 
    });
  }

  window.saveSettings = async function() {
    if (!currentUser) return alert('Please login with GitHub first!');
    const nick = document.getElementById('setNick').value.trim();
    const avatar = document.getElementById('setAvatar').value.trim();
    const banner = document.getElementById('setBanner').value.trim();
    const bannerPos = document.getElementById('setBannerPos').value;
    const bio = document.getElementById('setBio').value.trim();
    const font = document.getElementById('setFont') ? document.getElementById('setFont').value : '';
    
    if (!nick) return alert('Nickname cannot be empty');
    try {
      const res = await fetch('/api/profile', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user_id: currentUser.id, display_name: nick, avatar_url: avatar, banner_url: banner, banner_position: bannerPos, bio: bio, font_family: font }) 
      });
      if (!res.ok) throw new Error('Save error');
      
      currentUser.login = nick; 
      currentUser.avatar = avatar;
      currentUser.font = font;
      localStorage.setItem('4oom_user', JSON.stringify(currentUser));
      
      alert('Settings saved!'); 
      location.href = '/';
    } catch(e) { alert('Error: ' + e.message); }
  };
}

// --- СТРАНИЦА ТРЕДА ---
if (document.getElementById('postList')) {
  const threadId = urlParams.get('id');
  
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
        const profileUrl = `/profile.html?user=${encodeURIComponent(p.author_name)}`;
        let avatarHtml = p.author_avatar 
            ? `<a href="${profileUrl}"><img src="${p.author_avatar}" class="post__avatar" alt="avatar"></a>` 
            : `<a href="${profileUrl}"><div style="width:24px; height:24px; background:#ccc; border: 1px solid #808080; display:inline-block; vertical-align: middle;"></div></a>`;
        
        const nameLink = `<a href="${profileUrl}" style="text-decoration:none; color:inherit;">${formatName(p.author_name, p.author_role, p.author_font)}</a>`;
        
        const canDelete = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || p.author_name === currentUser.login);
        const deleteBtn = canDelete ? `<button class="delete-btn" onclick="deletePost(${p.id})">delete</button>` : '';
        
        let imgHtml = p.image_url ? '<img src="' + p.image_url + '" class="post__img" alt="image" onerror="this.style.display=\'none\'">' : '';
        let audioHtml = p.music_url ? `<audio controls class="post__audio" src="${p.music_url}"></audio>` : '';
        
        return '<article class="post"><div class="post__head"><span class="post__author">' + avatarHtml + nameLink + getRoleBadge(p.author_role) + deleteBtn + '</span><span class="post__time">' + new Date(p.created_at * 1000).toLocaleString() + '</span></div><div class="post__body">' + escapeHtml(p.body) + imgHtml + audioHtml + '</div></article>';
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
      const res = await fetch('/api/posts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ thread_id: threadId, body, image_url, music_url, author_name: currentUser ? currentUser.login : 'guest' }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Server error'); }
      document.getElementById('replyBody').value = ''; document.getElementById('replyImage').value = ''; document.getElementById('replyMusic').value = '';
      loadPosts();
    } catch(e) { alert('Error sending: ' + e.message); }
  });
  loadPosts();
}
