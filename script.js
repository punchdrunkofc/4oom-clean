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

function formatName(name, role) {
  if (role === 'creator') return `<span class="creator-name">${escapeHtml(name)}</span>`;
  return escapeHtml(name);
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
        document.getElementById('userName').innerHTML = formatName(user.display_name, user.role) + ' ' + getRoleBadge(user.role);
        document.getElementById('userAvatar').src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';
        
        if (user.banner_url) {
          document.getElementById('userBanner').src = user.banner_url;
          document.getElementById('userBanner').style.display = 'block';
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
  // ... (остальной код главной страницы без изменений) ...
}

// --- СТРАНИЦА НАСТРОЕК ---
if (document.getElementById('setNick')) {
  if (currentUser) {
    document.getElementById('setNick').value = currentUser.login;
    document.getElementById('setAvatar').value = currentUser.avatar || '';
    // Загружаем баннер и био
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(data => {
      document.getElementById('setBanner').value = data.user.banner_url || '';
      document.getElementById('setBio').value = data.user.bio || '';
    });
  }

  window.saveSettings = async function() {
    if (!currentUser) return alert('Please login with GitHub first!');
    const nick = document.getElementById('setNick').value.trim();
    const avatar = document.getElementById('setAvatar').value.trim();
    const banner = document.getElementById('setBanner').value.trim();
    const bio = document.getElementById('setBio').value.trim();
    
    if (!nick) return alert('Nickname cannot be empty');
    
    try {
      const res = await fetch('/api/profile', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user_id: currentUser.id, display_name: nick, avatar_url: avatar, banner_url: banner, bio: bio }) 
      });
      if (!res.ok) throw new Error('Save error');
      
      currentUser.login = nick; 
      currentUser.avatar = avatar; 
      localStorage.setItem('4oom_user', JSON.stringify(currentUser));
      
      alert('Settings saved!'); 
      location.href = '/';
    } catch(e) { alert('Error: ' + e.message); }
  };
}

// --- СТРАНИЦА ТРЕДА ---
if (document.getElementById('postList')) {
  // В функции loadPosts внутри script.js найди эту строку:
  // let avatarHtml = ...
  // И замени на кликабельные ссылки:
  
  // Внутри data.posts.map(function(p) { ... })
  // avatarHtml = `<a href="/profile.html?user=${encodeURIComponent(p.author_name)}"><img src="..." class="post__avatar"></a>`;
  // formatName(p.author_name, p.author_role) заменить на `<a href="/profile.html?user=${encodeURIComponent(p.author_name)}" style="text-decoration:none;">${formatName(p.author_name, p.author_role)}</a>`
  
  // ... (остальной код страницы треда)
}
