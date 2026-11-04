function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let currentUser = null;
const userJson = localStorage.getItem('4oom_user');
if (userJson) { try { currentUser = JSON.parse(userJson); } catch(e) { localStorage.removeItem('4oom_user'); } }

const urlParams = new URLSearchParams(window.location.search);
const currentSection = urlParams.get('section');

let allSections = []; // Глобальная переменная для хранения разделов

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
  
  // Загружаем разделы
  fetch('/api/sections').then(r => r.json()).then(sections => {
    allSections = sections.map(s => s.section_slug);
    
    // Заполняем верхнее меню
    const select = document.getElementById('sectionSelect');
    allSections.forEach(sec => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      select.appendChild(opt);
    });
    if (currentSection && currentSection !== 'my') {
      select.value = currentSection;
    }
  });

  // Логика автодополнения для поля Board Name
  const sectionInput = document.getElementById('newSection');
  const suggestionsBox = document.getElementById('sectionSuggestions');

  if (sectionInput && suggestionsBox) {
    sectionInput.addEventListener('input', function() {
      const val = this.value.toLowerCase().trim();
      suggestionsBox.innerHTML = '';
      
      if (!val) {
        suggestionsBox.style.display = 'none';
        return;
      }

      // Ищем совпадения
      const matches = allSections.filter(s => s.includes(val));
      
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

    // Скрываем подсказки при клике вне поля
    document.addEventListener('click', function(e) {
      if (e.target !== sectionInput && e.target !== suggestionsBox) {
        suggestionsBox.style.display = 'none';
      }
    });
  }

  // Подсветка активной вкладки
  if (!currentSection) {
    document.getElementById('nav-home').style.fontWeight = 'bold';
  } else if (currentSection === 'my') {
    document.getElementById('nav-my').style.fontWeight = 'bold';
  }

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
      let endpoint = '/api/threads';
      if (currentSection === 'my' && currentUser) {
        endpoint = `/api/threads?my=${encodeURIComponent(currentUser.login)}`;
      } else if (currentSection) {
        endpoint = `/api/threads?section=${currentSection}`;
      }

      const r = await fetch(endpoint);
      let threads = await r.json();
      
      if (!threads || threads.length === 0) { 
        list.innerHTML = '<li class="thread"><a href="#"><span class="thread__title">Nothing here yet...</span></a></li>'; 
        return; 
      }

      if (!currentSection) {
        threads = threads.sort((a, b) => b.reply_count - a.reply_count).slice(0, 5);
      }
      
      list.innerHTML = threads.map(function(t) {
        const canDelete = currentUser && (['creator', 'moderator', 'editor'].includes(currentUser.role) || t.author_name === currentUser.login);
        const deleteBtn = canDelete ? `<button class="delete-btn" onclick="event.preventDefault(); deleteThread(${t.first_post_id})">delete</button>` : '';
        const sectionBadge = (!currentSection || currentSection === 'my') ? `<span style="font-size:10px; color:#000080; margin-right:4px;">[${t.section_slug}]</span>` : '';
        
        return `<li class="thread">
          <a href="/thread.html?id=${t.id}">
            <span class="thread__title">${sectionBadge}${escapeHtml(t.title)}</span>
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

// ... остальной код для настроек и треда (остается без изменений) ...
