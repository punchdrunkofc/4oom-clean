// --- СТРАНИЦА НАСТРОЕК ---
if (document.getElementById('setNick')) {
  
  function updateLivePreview() {
    const nick = document.getElementById('setNick').value || 'YourNickname';
    const font = document.getElementById('setFont').value;
    const previewName = document.getElementById('previewName');
    if (previewName) { previewName.textContent = nick; previewName.style.fontFamily = font || 'var(--font-pixel)'; }

    const avatar = document.getElementById('setAvatar').value;
    const previewAvatar = document.getElementById('previewAvatar');
    if (previewAvatar) previewAvatar.src = avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23fff%22 stroke=%22%23808080%22 stroke-width=%222%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2230%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23808080%22%3E?\u003C/text%3E%3C/svg%3E';

    const banner = document.getElementById('setBanner').value;
    const previewBanner = document.getElementById('previewBanner');
    if (previewBanner) { if (banner) { previewBanner.src = banner; previewBanner.style.display = 'block'; } else { previewBanner.style.display = 'none'; } }

    const bio = document.getElementById('setBio').value;
    const previewBio = document.getElementById('previewBio');
    if (previewBio) previewBio.textContent = bio || 'This user has not written a bio yet.';

    if (currentUser) document.getElementById('previewRole').innerHTML = getRoleBadge(currentUser.role);
  }

  document.getElementById('setNick').addEventListener('input', updateLivePreview);
  document.getElementById('setBio').addEventListener('input', updateLivePreview);
  document.getElementById('setFont').addEventListener('change', updateLivePreview);

  // ====== ЛОГИКА ДЛЯ АВАТАРКИ ======
  let avatarCropper = null;
  const avatarFileInput = document.getElementById('avatarFile');
  const avatarCropperContainer = document.getElementById('avatarCropperContainer');
  const avatarCropperImage = document.getElementById('avatarCropperImage');
  const saveAvatarBtn = document.getElementById('saveAvatarBtn');

  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', function(e) {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(event) {
        avatarCropperImage.src = event.target.result; 
        avatarCropperContainer.style.display = 'block'; 
        saveAvatarBtn.style.display = 'inline-block';
        if (avatarCropper) avatarCropper.destroy();
        // Пропорции 1:1 (квадрат)
        avatarCropper = new Cropper(avatarCropperImage, { aspectRatio: 1, viewMode: 1, autoCropArea: 1 });
      };
      reader.readAsDataURL(file);
    });
  }

  window.applyAvatarCrop = function() {
    if (!avatarCropper) return;
    const canvas = avatarCropper.getCroppedCanvas({ width: 200, height: 200, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    const base64Image = canvas.toDataURL('image/jpeg', 0.85);
    document.getElementById('setAvatar').value = base64Image;
    avatarCropperContainer.style.display = 'none'; 
    saveAvatarBtn.style.display = 'none';
    if (avatarCropper) { avatarCropper.destroy(); avatarCropper = null; }
    updateLivePreview();
  };

  // ====== ЛОГИКА ДЛЯ БАННЕРА ======
  let bannerCropper = null;
  const bannerFileInput = document.getElementById('bannerFile');
  const bannerCropperContainer = document.getElementById('bannerCropperContainer');
  const bannerCropperImage = document.getElementById('bannerCropperImage');
  const saveBannerBtn = document.getElementById('saveBannerBtn');

  if (bannerFileInput) {
    bannerFileInput.addEventListener('change', function(e) {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(event) {
        bannerCropperImage.src = event.target.result; 
        bannerCropperContainer.style.display = 'block'; 
        saveBannerBtn.style.display = 'inline-block';
        if (bannerCropper) bannerCropper.destroy();
        // Пропорции 3:1 (широкий)
        bannerCropper = new Cropper(bannerCropperImage, { aspectRatio: 3, viewMode: 1, autoCropArea: 1 });
      };
      reader.readAsDataURL(file);
    });
  }

  window.applyBannerCrop = function() {
    if (!bannerCropper) return;
    const canvas = bannerCropper.getCroppedCanvas({ width: 1200, height: 400, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    const base64Image = canvas.toDataURL('image/jpeg', 0.85);
    document.getElementById('setBanner').value = base64Image;
    bannerCropperContainer.style.display = 'none'; 
    saveBannerBtn.style.display = 'none';
    if (bannerCropper) { bannerCropper.destroy(); bannerCropper = null; }
    updateLivePreview();
  };

  // Загрузка текущих данных
  if (currentUser) {
    document.getElementById('setNick').value = currentUser.login;
    fetch('/api/user?login=' + encodeURIComponent(currentUser.login)).then(r => r.json()).then(data => {
      if (data.user.banner_url) document.getElementById('setBanner').value = data.user.banner_url;
      if (data.user.avatar_url) document.getElementById('setAvatar').value = data.user.avatar_url;
      document.getElementById('setBio').value = data.user.bio || '';
      if(document.getElementById('setFont')) document.getElementById('setFont').value = data.user.font_family || '';
      updateLivePreview(); 
    });
  }

  window.saveSettings = async function() {
    if (!currentUser) return alert('Please login with GitHub first!');
    const nick = document.getElementById('setNick').value.trim();
    const avatar = document.getElementById('setAvatar').value; 
    const banner = document.getElementById('setBanner').value; 
    const bio = document.getElementById('setBio').value.trim();
    const font = document.getElementById('setFont') ? document.getElementById('setFont').value : '';
    
    if (!nick) return alert('Nickname cannot be empty');
    try {
      const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: currentUser.id, display_name: nick, avatar_url: avatar, banner_url: banner, bio: bio, font_family: font }) });
      if (!res.ok) throw new Error('Save error');
      
      currentUser.login = nick; 
      currentUser.avatar = avatar; 
      currentUser.font = font;
      localStorage.setItem('4oom_user', JSON.stringify(currentUser));
      alert('Settings saved!'); location.href = '/';
    } catch(e) { alert('Error: ' + e.message); }
  };
}
