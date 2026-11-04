// --- НАСТРОЙКИ (РЕДАКТОР ПРОФИЛЯ) — продолжение ---
if (document.getElementById('setNick')) {
  resetVideoBg();
  let avC = null, bnC = null, bgC = null;
  
  window.updatePreview = function() {
    const n = document.getElementById('setNick').value || 'YourNickname', f = document.getElementById('setFont').value;
    const pn = document.getElementById('previewName'); if(pn) { pn.textContent = n; pn.style.fontFamily = f || 'var(--font-pixel)'; }
    const pa = document.getElementById('previewAvatar'); if(pa) pa.src = document.getElementById('setAvatar').value || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2230%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';
    const b = document.getElementById('setBanner').value;
    const pb = document.getElementById('previewBanner'); if(pb) { pb.style.display = b ? 'block' : 'none'; if (b) pb.src = b; }
    const bio = document.getElementById('setBio').value;
    const pbio = document.getElementById('previewBio'); if(pbio) pbio.textContent = bio || 'This user has not written a bio yet.';
    const pr = document.getElementById('previewRole'); if(pr) pr.innerHTML = getRoleBadge(currentUser ? currentUser.role : 'user');
  }
  
  ['setNick', 'setBio'].forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('input', window.updatePreview); });
  const sf = document.getElementById('setFont'); if(sf) sf.addEventListener('change', window.updatePreview);

  const setupCrop = (fileId, containerId, imgId, btnId, ratio) => {
    const f = document.getElementById(fileId), c = document.getElementById(containerId), i = document.getElementById(imgId), b = document.getElementById(btnId);
    if (f && typeof Cropper !== 'undefined') {
      f.addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const r = new FileReader();
        r.onload = ev => {
          i.src = ev.target.result; c.style.display = 'block'; b.style.display = 'inline-block';
          if (window['crop' + fileId]) window['crop' + fileId].destroy();
          window['crop' + fileId] = new Cropper(i, {
            aspectRatio: ratio,
            viewMode: 1,
            background: false,
            autoCropArea: 1
          });
        };
        r.readAsDataURL(file);
      });
    }
  };

  setupCrop('avatarFile', 'avatarCropContainer', 'avatarCropImg', 'avatarCropBtn', 1);
  setupCrop('bannerFile', 'bannerCropContainer', 'bannerCropImg', 'bannerCropBtn', 3);

  const cropToData = (fileId) => {
    const crop = window['crop' + fileId];
    if (!crop) return null;
    const canvas = crop.getCroppedCanvas({ maxWidth: 800, maxHeight: 800 });
    return canvas ? canvas.toDataURL('image/jpeg', 0.85) : null;
  };

  const avBtn = document.getElementById('avatarCropBtn');
  if (avBtn) avBtn.addEventListener('click', () => {
    const d = cropToData('avatarFile');
    if (d) { avC = d; document.getElementById('setAvatar').value = d; updatePreview(); }
    document.getElementById('avatarCropContainer').style.display = 'none';
  });

  const bnBtn = document.getElementById('bannerCropBtn');
  if (bnBtn) bnBtn.addEventListener('click', () => {
    const d = cropToData('bannerFile');
    if (d) { bnC = d; document.getElementById('setBanner').value = d; updatePreview(); }
    document.getElementById('bannerCropContainer').style.display = 'none';
  });

  const bgFile = document.getElementById('bgFile');
  if (bgFile) {
    bgFile.addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = ev => {
        bgC = ev.target.result;
        const inp = document.getElementById('setBg'); if (inp) inp.value = bgC;
        applyCustomBg(bgC);
      };
      r.readAsDataURL(file);
    });
  }

  // Загружаем текущие данные пользователя
  if (currentUser) {
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(data => {
      if (!data.user) return;
      const u = data.user;
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
      setVal('setNick', u.display_name);
      setVal('setBio', u.bio);
      setVal('setFont', u.font_family);
      setVal('setAvatar', u.avatar_url);
      setVal('setBanner', u.banner_url);
      setVal('setBg', u.background_url);
      if (u.background_url) applyCustomBg(u.background_url);
      updatePreview();
    }).catch(e => console.error(e));
  }

  const saveForm = document.getElementById('settingsForm');
  if (saveForm) {
    saveForm.addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        login: currentUser ? currentUser.login : null,
        display_name: document.getElementById('setNick').value.trim(),
        bio: document.getElementById('setBio').value.trim(),
        font_family: document.getElementById('setFont').value,
        avatar_url: document.getElementById('setAvatar').value || null,
        banner_url: document.getElementById('setBanner').value || null,
        background_url: document.getElementById('setBg').value || null
      };
      try {
        const r = await fetch('/api/user/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
        const saved = await r.json();
        if (saved.user) {
          currentUser.login = saved.user.display_name;
          currentUser.role = saved.user.role;
          localStorage.setItem('4oom_user', JSON.stringify(currentUser));
        }
        alert('Profile saved!');
        location.reload();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Кнопка "сбросить фон"
  const resetBgBtn = document.getElementById('resetBgBtn');
  if (resetBgBtn) resetBgBtn.addEventListener('click', () => {
    bgC = null;
    const inp = document.getElementById('setBg'); if (inp) inp.value = '';
    resetVideoBg();
  });
}

// --- СТРАНИЦА ЛОГИНА / РЕГИСТРАЦИИ ---
if (document.getElementById('loginForm') || document.getElementById('registerForm')) {
  resetVideoBg();
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const login = document.getElementById('loginNick').value.trim();
      const pass = document.getElementById('loginPass').value;
      if (!login || !pass) return alert('Fill all fields');
      try {
        const r = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, password: pass })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Login failed');
        localStorage.setItem('4oom_user', JSON.stringify(data.user));
        location.href = '/';
      } catch (err) { alert(err.message); }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async e => {
      e.preventDefault();
      const login = document.getElementById('regNick').value.trim();
      const pass = document.getElementById('regPass').value;
      const pass2 = document.getElementById('regPass2').value;
      if (!login || !pass) return alert('Fill all fields');
      if (pass !== pass2) return alert('Passwords do not match');
      try {
        const r = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, password: pass })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Registration failed');
        localStorage.setItem('4oom_user', JSON.stringify(data.user));
        location.href = '/';
      } catch (err) { alert(err.message); }
    });
  }
}

// --- ФУНКЦИИ ДРУЗЕЙ (глобальные) ---
window.sendFriendRequest = async function(targetId) {
  if (!currentUser) return alert('Login first');
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

window.removeFriend = async function(friendId) {
  if (!currentUser) return;
  if (!confirm('Remove this friend?')) return;
  try {
    const r = await fetch('/api/friends/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, friend_id: friendId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    location.reload();
  } catch (e) { alert(e.message); }
};

// --- ИНИЦИАЛИЗАЦИЯ ОБЩИХ ЭЛЕМЕНТОВ (шапка, меню) ---
document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userBox = document.getElementById('headerUser');

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) {
      logoutBtn.style.display = 'inline-block';
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('4oom_user');
        location.href = '/';
      });
    }
    if (userBox) {
      userBox.innerHTML = `<a href="/profile.html?user=${encodeURIComponent(currentUser.login)}" style="text-decoration:none; color:inherit;">${formatName(currentUser.login, currentUser.role, currentUser.font)}</a> ${getRoleBadge(currentUser.role)}`;
    }
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
});
