/**
 * PIUFOTO - Realtime SLR OTG Auto-Uploader to Google Drive
 * Features:
 * 1. In-App Non-blocking Deletion for Sessions and Photos
 * 2. Realtime Live Frame Preview Canvas
 * 3. Instant Custom PNG Upload & Persistence
 */

const AppState = {
  folders: [],
  activeFolder: 'Sesi_01',
  activeFolderDisplayName: 'Sesi 01',
  activeFolderDriveUrl: '',
  publicBaseUrl: localStorage.getItem('piufoto_public_base_url') || 'https://foto.berkisahkita.web.id',
  qrTarget: localStorage.getItem('piufoto_qr_target') || 'all', // 'all' | 'gallery' | 'gdrive'
  photos: [],
  
  // Pending delete target
  pendingDeletePhotoName: '',
  
  // Anti-Flicker Fingerprints
  lastRenderedPhotosFingerprint: '',
  lastRenderedFoldersFingerprint: '',
  
  // Ingestion settings
  isWatchingFolder: false,
  directoryHandle: null,
  watchInterval: null,
  processedFileNames: new Set(),
  
  // Frame Template Settings
  selectedFrame: 'romantic_blossom', // 'romantic_blossom' | 'golden_elegance' | 'vintage_polaroid' | 'custom_png' | 'none'
  frameTitle: 'Together Forever',
  frameSubtitle: 'Sarah & Dimas • 2026',
  cropMode: (localStorage.getItem('piufoto_crop_mode') === 'clean_crop' ? 'original' : (localStorage.getItem('piufoto_crop_mode') || 'original')), // 'original' | 'fill_cover' | 'clean_crop'
  cameraRotation: parseInt(localStorage.getItem('piufoto_camera_rotation') || '0', 10), // 0, 90, 180, 270
  customPngDataUrl: '',
  customPngImageObj: null,
  
  // Compression & Photo Quality Settings
  photoQuality: localStorage.getItem('piufoto_photo_quality') || 'compact_300k', // 'compact_300k' | 'standard_800k' | 'original_hd'
  
  // Sample Image for Live Frame Preview
  samplePreviewImg: null,
  
  // Google Drive & Studio Config
  studioName: 'BERKISAHKITA',
  googleDriveWebhook: '',
  googleDriveRootFolder: '',
  googleDriveParentFolderId: '',
  
  // Audio
  audioCtx: null
};

// ==========================================
// 1. AUDIO SYNTHESIZER
// ==========================================
function playChime(freq = 880, duration = 0.15) {
  try {
    if (!AppState.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) AppState.audioCtx = new AudioCtx();
    }
    if (AppState.audioCtx && AppState.audioCtx.state === 'suspended') {
      AppState.audioCtx.resume();
    }
    if (!AppState.audioCtx) return;
    
    const osc = AppState.audioCtx.createOscillator();
    const gain = AppState.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, AppState.audioCtx.currentTime);
    gain.gain.setValueAtTime(0.2, AppState.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, AppState.audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(AppState.audioCtx.destination);
    osc.start();
    osc.stop(AppState.audioCtx.currentTime + duration);
  } catch(e){}
}

function playUploadSuccessSound() {
  playChime(523.25, 0.08);
  setTimeout(() => playChime(659.25, 0.08), 70);
  setTimeout(() => playChime(783.99, 0.16), 140);
}

// ==========================================
// 2. FOLDERS / SESSIONS MANAGEMENT
// ==========================================
async function fetchFolders() {
  try {
    const res = await fetch('/api/folders');
    const data = await res.json();
    let folderList = null;
    if (data && Array.isArray(data.folders)) {
      folderList = data.folders;
    } else if (Array.isArray(data)) {
      folderList = data;
    }
    if (folderList) {
      AppState.folders = folderList;
      if (!AppState.folders.some(f => f.name === AppState.activeFolder) && AppState.folders.length > 0) {
        AppState.activeFolder = AppState.folders[0].name;
      }
      
      const currentFingerprint = AppState.folders.map(f => `${f.name}_${f.photoCount || f.count || 0}_${f.name === AppState.activeFolder}`).join('|');
      if (currentFingerprint !== AppState.lastRenderedFoldersFingerprint) {
        AppState.lastRenderedFoldersFingerprint = currentFingerprint;
        renderFolderTabs();
        updateActiveFolderUI();
      }
    }
  } catch (err) {
    console.warn("Gagal fetch folders:", err);
  }
}

function renderFolderTabs() {
  const container = document.getElementById('folders-scroll-list');
  container.innerHTML = '';
  
  AppState.folders.forEach(folder => {
    const tab = document.createElement('div');
    const isActive = folder.name === AppState.activeFolder;
    tab.className = `folder-tab-item ${isActive ? 'active' : ''}`;
    tab.innerHTML = `
      <span>📁 ${folder.displayName}</span>
      <span class="folder-tab-badge">${folder.photoCount}</span>
    `;
    tab.onclick = () => switchActiveFolder(folder.name);
    container.appendChild(tab);
  });
}

async function switchActiveFolder(folderName) {
  if (AppState.activeFolder === folderName) return;
  
  AppState.activeFolder = folderName;
  AppState.lastRenderedPhotosFingerprint = '';
  
  const current = AppState.folders.find(f => f.name === folderName);
  AppState.activeFolderDisplayName = current ? current.displayName : folderName.replace(/_/g, ' ');
  
  AppState.lastRenderedFoldersFingerprint = '';
  renderFolderTabs();
  updateActiveFolderUI();
  await fetchPhotosForActiveFolder();

  // Beritahu server folder sesi yang aktif agar foto kamera langsung masuk ke sini
  try {
    fetch('/api/active-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderName })
    }).catch(() => {});
  } catch (e) {}
}

async function updateActiveFolderUI() {
  const displayTitle = AppState.activeFolderDisplayName;
  
  document.getElementById('sidebar-active-folder-name').innerText = displayTitle;
  document.getElementById('current-session-title').innerText = displayTitle;
  document.getElementById('standee-folder-name').innerText = displayTitle;
  document.getElementById('otg-target-folder-badge').innerText = displayTitle;
  document.getElementById('delete-session-name-display').innerText = displayTitle;
  const vfSession = document.getElementById('viewfinder-session-name');
  if (vfSession) vfSession.innerText = displayTitle;
  
  updateActiveFolderQR();
}

function updateActiveFolderQR() {
  const tabAll = document.getElementById('tab-qr-all');
  const tabGallery = document.getElementById('tab-qr-gallery');
  const tabGDrive = document.getElementById('tab-qr-gdrive');
  const labelBtn = document.getElementById('btn-open-gdrive-label');
  const descText = document.getElementById('qr-desc-text');
  const folderBadge = document.getElementById('sidebar-active-folder-name');
  
  const currentTarget = AppState.qrTarget || 'all';
  
  if (tabAll) {
    tabAll.style.background = currentTarget === 'all' ? 'var(--accent)' : 'transparent';
    tabAll.style.color = currentTarget === 'all' ? 'white' : 'var(--text-muted)';
  }
  if (tabGallery) {
    tabGallery.style.background = currentTarget === 'gallery' ? 'var(--accent)' : 'transparent';
    tabGallery.style.color = currentTarget === 'gallery' ? 'white' : 'var(--text-muted)';
  }
  if (tabGDrive) {
    tabGDrive.style.background = currentTarget === 'gdrive' ? 'var(--accent)' : 'transparent';
    tabGDrive.style.color = currentTarget === 'gdrive' ? 'white' : 'var(--text-muted)';
  }

  const savedPublicUrl = localStorage.getItem('piufoto_public_base_url');
  const originUrl = (AppState.publicBaseUrl && !AppState.publicBaseUrl.includes('localhost'))
    ? AppState.publicBaseUrl
    : (savedPublicUrl && !savedPublicUrl.includes('localhost') ? savedPublicUrl : 'https://foto.berkisahkita.web.id');

  let targetUrl = '';
  if (currentTarget === 'all') {
    // QR Code PERMANEN & STATIS: Menuju portal galeri tanpa parameter folder
    targetUrl = `${originUrl}/gallery.html`;
    if (folderBadge) folderBadge.innerText = '🌐 Semua Sesi (Pilihan Tamu)';
    if (labelBtn) labelBtn.innerText = '📱 Buka Galeri Tamu ↗';
    if (descText) descText.innerHTML = '⭐ <strong>QR Code Online untuk Tamu!</strong> Tamu yang menscan menggunakan <strong>kuota internet ponsel</strong> akan langsung terhubung ke galeri online dan dapat memilih sesi foto.';
  } else if (currentTarget === 'gallery') {
    let themeParam = 'wedding';
    if (AppState.selectedFrame === 'golden_elegance') themeParam = 'gold';
    if (AppState.selectedFrame === 'vintage_polaroid') themeParam = 'vintage';
    if (AppState.selectedFrame === 'none') themeParam = 'modern';

    const currentFolderObj = AppState.folders.find(f => f.name === AppState.activeFolder);
    const token = currentFolderObj ? currentFolderObj.accessToken : '';

    if (token) {
      targetUrl = `${originUrl}/gallery.html?access=${encodeURIComponent(token)}`;
    } else {
      targetUrl = `${originUrl}/gallery.html?folder=${encodeURIComponent(AppState.activeFolder)}&theme=${encodeURIComponent(themeParam)}`;
    }
    if (folderBadge) folderBadge.innerText = AppState.activeFolderDisplayName;
    if (labelBtn) labelBtn.innerText = `📱 Buka Galeri ${AppState.activeFolderDisplayName} ↗`;
    if (descText) descText.innerHTML = `Tamu scan QR ini dengan kuota internet untuk membuka <strong>${AppState.activeFolderDisplayName}</strong> secara online.`;
  } else {
    const cachedUrl = localStorage.getItem(`gdrive_url_${AppState.activeFolder}`) || AppState.activeFolderDriveUrl;
    targetUrl = cachedUrl || `${originUrl}/gallery.html?folder=${encodeURIComponent(AppState.activeFolder)}`;
    if (folderBadge) folderBadge.innerText = `${AppState.activeFolderDisplayName} (Google Drive)`;
    if (labelBtn) labelBtn.innerText = '☁️ Buka Folder di Google Drive ↗';
    if (descText) descText.innerHTML = 'Klien scan QR code ini untuk membuka folder Google Drive dan mengunduh foto yang tersimpan di cloud.';
  }

  const urlEl = document.getElementById('qr-client-url');
  if (urlEl) urlEl.innerText = targetUrl;
  const btnEl = document.getElementById('btn-open-gdrive-folder');
  if (btnEl) {
    btnEl.href = targetUrl;
    btnEl.onclick = (e) => {
      e.preventDefault();
      // Buka galeri lokal dalam aplikasi tablet
      window.location.href = `gallery.html?folder=${encodeURIComponent(AppState.activeFolder)}`;
    };
  }

  renderActiveFolderQRCode(targetUrl);
}

async function fetchServerInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (data && data.publicBaseUrl && !data.publicBaseUrl.includes('localhost')) {
      if (AppState.publicBaseUrl !== data.publicBaseUrl) {
        AppState.publicBaseUrl = data.publicBaseUrl;
        updateActiveFolderQR();
      }
    }
  } catch(e) {}
}

async function fetchFolderUrlFromGoogleDrive(folderName) {
  if (!AppState.googleDriveWebhook || !AppState.googleDriveWebhook.startsWith('http')) {
    updateDriveStatusBadge();
    return;
  }
  
  try {
    const targetFolder = folderName || AppState.activeFolder;
    const res = await fetch('/api/test-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: AppState.googleDriveWebhook,
        folderName: targetFolder,
        rootFolderName: AppState.googleDriveRootFolder || '',
        parentFolderId: AppState.googleDriveParentFolderId || ''
      })
    });
    const result = await res.json();
    if (result.ok && result.folderUrl) {
      AppState.activeFolderDriveUrl = result.folderUrl;
      localStorage.setItem(`gdrive_url_${folderName}`, result.folderUrl);
      
      if (AppState.activeFolder === folderName) {
        document.getElementById('qr-client-url').innerText = result.folderUrl;
        document.getElementById('btn-open-gdrive-folder').href = result.folderUrl;
        renderActiveFolderQRCode(result.folderUrl);
      }
      updateDriveStatusBadge(true);
    } else {
      console.warn("Google Drive belum aktif:", result.message);
      updateDriveStatusBadge(false, result.message);
    }
  } catch (err) {
    console.warn("Gagal mendapatkan link Google Drive:", err);
    updateDriveStatusBadge(false);
  }
}

async function createNewFolder() {
  const defaultNextIndex = AppState.folders.length + 1;
  const folderInput = prompt(
    "Masukkan Nama Folder / Sesi Google Drive Baru:\n(contoh: Sesi 02, Prewedding Budi, Wedding Sarah & Dimas)", 
    `Sesi ${defaultNextIndex < 10 ? '0' + defaultNextIndex : defaultNextIndex}`
  );
  if (!folderInput || !folderInput.trim()) return;
  
  try {
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderInput.trim() })
    });
    const result = await res.json();
    if (result.status === 'success') {
      AppState.lastRenderedFoldersFingerprint = '';
      await fetchFolders();
      await switchActiveFolder(result.folder);
      fetchFolderUrlFromGoogleDrive(result.folder);
    }
  } catch (err) {
    alert("Gagal membuat folder: " + err.message);
  }
}

// ==========================================
// 3. IN-APP SESSION RENAME & DELETION MODALS (100% RELIABLE)
// ==========================================
let openModalDepth = 0;

function pushModalState(modalId) {
  openModalDepth++;
  try {
    history.pushState({ isModal: true, modalId: modalId, depth: openModalDepth }, '');
  } catch (e) {}
}

function dismissModal(modalEl) {
  if (typeof modalEl === 'string') modalEl = document.getElementById(modalEl);
  if (modalEl && modalEl.classList.contains('active')) {
    modalEl.classList.remove('active');
    if (openModalDepth > 0) {
      openModalDepth--;
      try { history.back(); } catch (e) {}
    }
  }
}

window.addEventListener('popstate', (e) => {
  const activeOverlays = document.querySelectorAll('.modal-overlay.active');
  if (activeOverlays.length > 0) {
    activeOverlays.forEach(overlay => overlay.classList.remove('active'));
    AppState.pendingDeletePhotoName = '';
    if (openModalDepth > 0) openModalDepth--;
  }
});

function openRenameSessionModal() {
  const currentDisplayName = AppState.activeFolderDisplayName || AppState.activeFolder;
  const oldDisplayEl = document.getElementById('rename-old-name-display');
  if (oldDisplayEl) oldDisplayEl.innerText = currentDisplayName;
  
  const inputEl = document.getElementById('input-new-session-name');
  if (inputEl) {
    inputEl.value = currentDisplayName;
    setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 120);
  }
  
  const modal = document.getElementById('modal-rename-session');
  if (modal) modal.classList.add('active');
  pushModalState('modal-rename-session');
}

function closeRenameSessionModal() {
  dismissModal('modal-rename-session');
}

async function executeRenameSession() {
  const inputEl = document.getElementById('input-new-session-name');
  const rawNewName = inputEl ? inputEl.value.trim() : '';
  if (!rawNewName) {
    alert("Silakan masukkan nama sesi yang valid.");
    return;
  }

  const oldFolder = AppState.activeFolder;
  closeRenameSessionModal();

  try {
    const res = await fetch('/api/folders/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldName: oldFolder,
        newName: rawNewName
      })
    });

    const result = await res.json();
    if (result.status === 'success') {
      const newFolder = result.folder;
      
      // Migrate cached Google Drive link
      const oldDriveUrl = localStorage.getItem(`gdrive_url_${oldFolder}`);
      if (oldDriveUrl) {
        localStorage.setItem(`gdrive_url_${newFolder}`, oldDriveUrl);
        localStorage.removeItem(`gdrive_url_${oldFolder}`);
      }

      AppState.activeFolder = newFolder;
      AppState.activeFolderDisplayName = result.displayName;
      AppState.lastRenderedFoldersFingerprint = '';
      AppState.lastRenderedPhotosFingerprint = '';

      await fetchFolders();
      await updateActiveFolderUI();
      await fetchPhotosForActiveFolder();

      playChime(650, 0.08);
      const actEl = document.getElementById('upload-activity-status');
      if (actEl) actEl.innerText = `✓ Sesi berhasil diubah namanya menjadi "${result.displayName}"!`;

      if (AppState.googleDriveWebhook && AppState.googleDriveWebhook.startsWith('http')) {
        fetchFolderUrlFromGoogleDrive(newFolder);
      }
    } else {
      alert("Gagal mengubah nama sesi: " + (result.error || 'Terjadi kesalahan'));
    }
  } catch(err) {
    console.warn("Gagal rename sesi:", err);
    alert("Gagal mengubah nama sesi: " + err.message);
  }
}

function openDeleteSessionModal() {
  document.getElementById('delete-session-name-display').innerText = AppState.activeFolderDisplayName;
  const modal = document.getElementById('modal-delete-session-confirm');
  if (modal) modal.classList.add('active');
  pushModalState('modal-delete-session-confirm');
}

function closeDeleteSessionModal() {
  dismissModal('modal-delete-session-confirm');
}

async function executeDeleteSession() {
  const folderName = AppState.activeFolder;
  closeDeleteSessionModal();

  // Optimistic real-time UI removal (0ms delay)
  AppState.folders = AppState.folders.filter(f => f.name !== folderName);
  AppState.lastRenderedFoldersFingerprint = '';
  renderFolderTabs();

  if (AppState.folders.length > 0) {
    switchActiveFolder(AppState.folders[0].name);
  } else {
    AppState.photos = [];
    AppState.lastRenderedPhotosFingerprint = '';
    renderDashboardGrid();
  }

  playChime(350, 0.08);

  try {
    const res = await fetch(`/api/folders/${encodeURIComponent(folderName)}`, {
      method: 'DELETE'
    });
    localStorage.removeItem(`gdrive_url_${folderName}`);
    await fetchFolders();
  } catch (err) {
    console.warn("Gagal menghapus sesi:", err);
    await fetchFolders();
  }
}

// In-App Real-time Photo Deletion (Reliable, Non-Blocking, 0ms Delay)
function openDeletePhotoModal(e, filename) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  if (!filename) return;

  // Shift+Click shortcut: instant deletion without confirmation modal
  if (e && e.shiftKey) {
    performDeleteSinglePhoto(AppState.activeFolder, filename);
    return;
  }

  AppState.pendingDeletePhotoName = filename;
  const nameEl = document.getElementById('delete-photo-name-display');
  if (nameEl) nameEl.innerText = filename;
  const modal = document.getElementById('modal-delete-photo-confirm');
  if (modal) modal.classList.add('active');
  pushModalState('modal-delete-photo-confirm');
}

function closeDeletePhotoModal() {
  dismissModal('modal-delete-photo-confirm');
  AppState.pendingDeletePhotoName = '';
}

async function executeDeletePhoto() {
  const filename = AppState.pendingDeletePhotoName;
  closeDeletePhotoModal();
  if (filename) {
    await performDeleteSinglePhoto(AppState.activeFolder, filename);
  }
}

async function performDeleteSinglePhoto(folder, filename) {
  if (!filename) return;
  const targetFolder = folder || AppState.activeFolder;

  // 1. Optimistic Real-time DOM removal (0ms delay)
  const escapedName = (window.CSS && CSS.escape) ? CSS.escape(filename) : filename.replace(/"/g, '\\"');
  let card = document.querySelector(`.dashboard-photo-card[data-photoname="${escapedName}"]`);
  if (!card) {
    card = Array.from(document.querySelectorAll('.dashboard-photo-card')).find(c => c.dataset.photoname === filename);
  }
  
  if (card) {
    card.style.transition = 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)';
    card.style.transform = 'scale(0.7) translateY(-15px)';
    card.style.opacity = '0';
    setTimeout(() => {
      if (card && card.parentNode) card.remove();
    }, 220);
  }

  // 2. Optimistic State update
  AppState.photos = AppState.photos.filter(p => p.name !== filename);
  AppState.lastRenderedPhotosFingerprint = AppState.photos.map(p => `${p.id}_${p.timestamp}`).join('|');
  
  // 3. Immediately update counters
  const totalCountEl = document.getElementById('stat-total-photos');
  const countTagEl = document.getElementById('gallery-photo-count');
  if (totalCountEl) totalCountEl.innerText = AppState.photos.length;
  if (countTagEl) countTagEl.innerText = `${AppState.photos.length} Foto`;

  // 4. Update empty state if 0 photos
  if (AppState.photos.length === 0) {
    const emptyState = document.getElementById('empty-gallery-state');
    if (emptyState) emptyState.style.display = 'block';
  }

  // 5. Sound feedback
  playChime(440, 0.08);

  // 6. Close viewer if currently viewing this photo
  const viewerModal = document.getElementById('viewer-modal');
  if (viewerModal && viewerModal.classList.contains('active')) {
    const viewerTitle = document.getElementById('viewer-title');
    if (viewerTitle && viewerTitle.innerText === filename) {
      closePhotoViewer();
    }
  }

  // 7. Background delete call to server
  try {
    const res = await fetch(`/api/photos?folder=${encodeURIComponent(targetFolder)}&file=${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    const result = await res.json();
    console.log(`[HAPUS FOTO] Foto [${filename}] berhasil dihapus:`, result);
    await fetchFolders();
  } catch(err) {
    console.warn("Gagal hapus foto di server:", err);
    await fetchPhotosForActiveFolder();
  }
}

// Global alias for compatibility
function deleteSinglePhoto(e, folder, filename) {
  openDeletePhotoModal(e, filename);
}

// Helper to escape strings for HTML attributes
function escapeJsAttr(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Attach globally for inline onclick
window.deleteSinglePhoto = deleteSinglePhoto;
window.openDeletePhotoModal = openDeletePhotoModal;
window.closeDeletePhotoModal = closeDeletePhotoModal;
window.executeDeletePhoto = executeDeletePhoto;
window.performDeleteSinglePhoto = performDeleteSinglePhoto;
window.deleteCurrentFolder = openDeleteSessionModal;

// ==========================================
// 4. FRAME TEMPLATE & REALTIME PREVIEW ENGINE
// ==========================================
function initSamplePreviewImage() {
  // Create a clean sample romantic portrait canvas if none loaded
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 600;
  sampleCanvas.height = 800;
  const sCtx = sampleCanvas.getContext('2d');
  
  // Aesthetic portrait gradient backdrop
  const grad = sCtx.createLinearGradient(0, 0, 600, 800);
  grad.addColorStop(0, '#3b203a');
  grad.addColorStop(0.5, '#70335e');
  grad.addColorStop(1, '#1b1122');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 600, 800);
  
  // Couple Silhouette / Graphic
  sCtx.fillStyle = '#ffb3c6';
  sCtx.font = 'bold 80px "Outfit", serif';
  sCtx.textAlign = 'center';
  sCtx.fillText('♡', 300, 360);
  
  sCtx.font = '600 32px "Plus Jakarta Sans", sans-serif';
  sCtx.fillStyle = '#f8fafc';
  sCtx.fillText('Contoh Foto SLR', 300, 440);
  
  sCtx.font = '400 20px "Plus Jakarta Sans", sans-serif';
  sCtx.fillStyle = '#e2e8f0';
  sCtx.fillText('(Portrait Preview)', 300, 480);
  
  const img = new Image();
  img.onload = () => {
    AppState.samplePreviewImg = img;
    renderLiveFramePreview();
  };
  img.src = sampleCanvas.toDataURL('image/jpeg', 0.9);
}

function getCropRect(sourceW, sourceH, targetW, targetH, cropMode = 'original') {
  let sx = 0;
  let sy = 0;
  let sw = sourceW;
  let sh = sourceH;

  // Clean HDMI OSD crop: ONLY when user explicitly chooses 'clean_crop' AND input is wide video >= 1.70 (16:9)
  // Never crop on 3:2 (1.50) or 4:3 (1.33) camera photos!
  if (cropMode === 'clean_crop' && (sourceW / sourceH) >= 1.70) {
    sy = Math.round(sourceH * 0.125);
    sh = Math.round(sourceH * 0.75);
    sx = Math.round(sourceW * 0.02);
    sw = Math.round(sourceW * 0.96);
  }

  // Calculate scale:
  // If 'original': fit without cutting any parts of the image (Math.min)
  // If targetW/targetH matches sw/sh (e.g. custom_png or full frame), scale is 1:1 exact
  let scale;
  if (cropMode === 'original') {
    scale = Math.min(targetW / sw, targetH / sh);
  } else {
    // fill_cover or clean_crop: cover the target area
    scale = Math.max(targetW / sw, targetH / sh);
  }

  const renderW = sw * scale;
  const renderH = sh * scale;
  const offsetX = (targetW - renderW) / 2;
  const offsetY = (targetH - renderH) / 2;

  return { sx, sy, sw, sh, offsetX, offsetY, renderW, renderH };
}

function drawSourceToPhotoBox(ctx, source, srcW, srcH, photoX, photoY, photoW, photoH, rotation = 0, isMirrored = false, cropMode = 'original') {
  ctx.save();
  ctx.beginPath();
  ctx.rect(photoX, photoY, photoW, photoH);
  ctx.clip();

  const cx = photoX + (photoW / 2);
  const cy = photoY + (photoH / 2);

  ctx.translate(cx, cy);

  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180);
  }

  if (isMirrored) {
    ctx.scale(-1, 1);
  }

  const isRotatedSideways = (rotation === 90 || rotation === 270);
  const destW = isRotatedSideways ? photoH : photoW;
  const destH = isRotatedSideways ? photoW : photoH;

  const crop = getCropRect(srcW, srcH, destW, destH, cropMode);
  
  ctx.drawImage(
    source,
    crop.sx, crop.sy, crop.sw, crop.sh,
    -destW / 2 + crop.offsetX,
    -destH / 2 + crop.offsetY,
    crop.renderW, crop.renderH
  );

  ctx.restore();
}

function renderFramedPhotoToContext(ctx, canvas, source, srcW, srcH, rotation = 0, isMirrored = false, cropMode = 'original', maxDimension = null) {
  const isPortrait = (rotation === 90 || rotation === 270);
  const orientedW = isPortrait ? srcH : srcW;
  const orientedH = isPortrait ? srcW : srcH;

  // Preserve exact original image aspect ratio and resolution
  let targetW = orientedW || (isPortrait ? 1200 : 1600);
  let targetH = orientedH || (isPortrait ? 1600 : 1200);

  // If maxDimension is set (e.g. 1800px for ~300KB mode), downscale proportionally preserving 3:2 ratio
  if (maxDimension && (targetW > maxDimension || targetH > maxDimension)) {
    const scale = maxDimension / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  if (AppState.selectedFrame === 'none') {
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    drawSourceToPhotoBox(ctx, source, srcW, srcH, 0, 0, targetW, targetH, rotation, isMirrored, 'original');
    return;
  }

  if (AppState.selectedFrame === 'custom_png') {
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.clearRect(0, 0, targetW, targetH);
    // Draw photo at 100% full original dimensions with zero crop
    drawSourceToPhotoBox(ctx, source, srcW, srcH, 0, 0, targetW, targetH, rotation, isMirrored, cropMode);
    if (AppState.customPngImageObj) {
      ctx.drawImage(AppState.customPngImageObj, 0, 0, targetW, targetH);
    }
    return;
  }

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const scaleFactor = targetW / (isPortrait ? 1200 : 1600);

  if (AppState.selectedFrame === 'romantic_blossom') {
    const hasTitle = Boolean(AppState.frameTitle && AppState.frameTitle.trim());
    const hasSubtitle = Boolean(AppState.frameSubtitle && AppState.frameSubtitle.trim());
    const hasAnyText = hasTitle || hasSubtitle;

    const bTop = Math.round(targetH * (isPortrait ? 0.05 : 0.05));
    const bSide = Math.round(targetW * (isPortrait ? 0.06 : 0.05));
    const bBottom = hasAnyText ? Math.round(targetH * (isPortrait ? 0.12 : 0.14)) : bTop;

    const photoX = bSide;
    const photoY = bTop;
    const photoW = targetW - (bSide * 2);
    const photoH = targetH - bTop - bBottom;

    const grad = ctx.createLinearGradient(0, 0, targetW, targetH);
    grad.addColorStop(0, '#fff5f7');
    grad.addColorStop(1, '#ffebf0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, targetW, targetH);

    ctx.strokeStyle = '#e0a8b4';
    ctx.lineWidth = Math.max(1, Math.round(4 * scaleFactor));
    ctx.strokeRect(bSide * 0.4, bTop * 0.4, targetW - bSide * 0.8, targetH - bTop * 0.8);

    drawSourceToPhotoBox(ctx, source, srcW, srcH, photoX, photoY, photoW, photoH, rotation, isMirrored, cropMode);

    ctx.strokeStyle = '#f8bbd0';
    ctx.lineWidth = Math.max(1, Math.round(2 * scaleFactor));
    ctx.strokeRect(photoX, photoY, photoW, photoH);

    if (hasAnyText) {
      const textY = photoY + photoH + (bBottom * (isPortrait ? 0.42 : 0.45));
      if (hasTitle) {
        ctx.fillStyle = '#a8325a';
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(targetW * (isPortrait ? 0.04 : 0.032))}px "Outfit", serif`;
        ctx.letterSpacing = '3px';
        ctx.fillText(AppState.frameTitle.trim(), targetW / 2, textY);
      }

      if (hasTitle && hasSubtitle) {
        ctx.font = `${Math.round(targetW * (isPortrait ? 0.024 : 0.02))}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = '#ff6b95';
        ctx.fillText('♡  •  ♡', targetW / 2, textY + Math.round(targetW * (isPortrait ? 0.028 : 0.022)));
      }

      if (hasSubtitle) {
        ctx.font = `500 ${Math.round(targetW * (isPortrait ? 0.022 : 0.018))}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = '#7a525d';
        const subY = hasTitle 
          ? (textY + Math.round(targetW * (isPortrait ? 0.058 : 0.048)))
          : textY;
        ctx.fillText(AppState.frameSubtitle.trim(), targetW / 2, subY);
      }
    }
    return;
  }

  if (AppState.selectedFrame === 'golden_elegance') {
    const hasTitle = Boolean(AppState.frameTitle && AppState.frameTitle.trim());
    const hasSubtitle = Boolean(AppState.frameSubtitle && AppState.frameSubtitle.trim());
    const hasAnyText = hasTitle || hasSubtitle;

    const border = Math.round(targetW * (isPortrait ? 0.06 : 0.05));
    const bottomH = hasAnyText ? Math.round(targetH * (isPortrait ? 0.11 : 0.13)) : 0;

    const photoX = border;
    const photoY = border;
    const photoW = targetW - (border * 2);
    const photoH = targetH - (border * 2) - bottomH;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, targetW, targetH);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = Math.max(1, Math.round(4 * scaleFactor));
    ctx.strokeRect(border * 0.4, border * 0.4, targetW - border * 0.8, targetH - border * 0.8);

    drawSourceToPhotoBox(ctx, source, srcW, srcH, photoX, photoY, photoW, photoH, rotation, isMirrored, cropMode);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = Math.max(1, Math.round(2 * scaleFactor));
    ctx.strokeRect(photoX, photoY, photoW, photoH);

    if (hasAnyText) {
      const textY = photoY + photoH + (bottomH * (isPortrait ? 0.50 : 0.52));
      if (hasTitle) {
        ctx.fillStyle = '#d4af37';
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(targetW * (isPortrait ? 0.038 : 0.03))}px "Outfit", serif`;
        ctx.letterSpacing = '5px';
        ctx.fillText(AppState.frameTitle.trim().toUpperCase(), targetW / 2, textY);
      }

      if (hasSubtitle) {
        ctx.font = `500 ${Math.round(targetW * (isPortrait ? 0.022 : 0.018))}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = '#9e894f';
        ctx.letterSpacing = '2px';
        const subY = hasTitle 
          ? (textY + Math.round(targetW * (isPortrait ? 0.042 : 0.035)))
          : textY;
        ctx.fillText(AppState.frameSubtitle.trim(), targetW / 2, subY);
      }
    }
    return;
  }

  if (AppState.selectedFrame === 'vintage_polaroid') {
    const hasTitle = Boolean(AppState.frameTitle && AppState.frameTitle.trim());
    const hasSubtitle = Boolean(AppState.frameSubtitle && AppState.frameSubtitle.trim());
    const hasAnyText = hasTitle || hasSubtitle;

    const bSide = Math.round(targetW * (isPortrait ? 0.06 : 0.05));
    const bTop = Math.round(targetH * (isPortrait ? 0.05 : 0.05));
    const bBottom = Math.round(targetH * (isPortrait ? 0.13 : 0.16));

    const photoX = bSide;
    const photoY = bTop;
    const photoW = targetW - (bSide * 2);
    const photoH = targetH - bTop - bBottom;

    ctx.fillStyle = '#faf8f5';
    ctx.fillRect(0, 0, targetW, targetH);

    drawSourceToPhotoBox(ctx, source, srcW, srcH, photoX, photoY, photoW, photoH, rotation, isMirrored, cropMode);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = Math.max(1, Math.round(1 * scaleFactor));
    ctx.strokeRect(photoX, photoY, photoW, photoH);

    if (hasAnyText) {
      const textY = photoY + photoH + (bBottom * (isPortrait ? 0.50 : 0.55));
      if (hasTitle) {
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.font = `600 ${Math.round(targetW * (isPortrait ? 0.036 : 0.03))}px "Outfit", cursive`;
        ctx.fillText(AppState.frameTitle.trim(), targetW / 2, textY);
      }

      if (hasSubtitle) {
        ctx.font = `400 ${Math.round(targetW * (isPortrait ? 0.022 : 0.018))}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = '#64748b';
        const subY = hasTitle 
          ? (textY + Math.round(targetW * (isPortrait ? 0.042 : 0.035)))
          : textY;
        ctx.fillText(AppState.frameSubtitle.trim(), targetW / 2, subY);
      }
    }
    return;
  }
}

function renderLiveFramePreview() {
  const canvas = document.getElementById('live-frame-preview-canvas');
  if (!canvas || !AppState.samplePreviewImg) return;
  const ctx = canvas.getContext('2d');
  
  const rawImg = AppState.samplePreviewImg;
  const imgW = rawImg.width;
  const imgH = rawImg.height;

  // Update badge title
  const badge = document.getElementById('badge-active-frame-name');
  const infoText = document.getElementById('preview-text-info');
  
  let labelName = 'Romantis Blossom';
  if (AppState.selectedFrame === 'golden_elegance') labelName = 'Golden Luxury';
  if (AppState.selectedFrame === 'vintage_polaroid') labelName = 'Vintage Polaroid';
  if (AppState.selectedFrame === 'custom_png') labelName = 'Custom PNG Admin';
  if (AppState.selectedFrame === 'none') labelName = 'Tanpa Frame (Polos)';
  
  if (badge) badge.innerText = labelName;
  if (infoText) {
    infoText.innerText = (AppState.frameTitle && AppState.frameTitle.trim()) ? `"${AppState.frameTitle}"` : '(Tanpa Teks)';
  }
  
  const hudFrame = document.getElementById('hud-frame-label');
  if (hudFrame) hudFrame.innerText = labelName;

  renderFramedPhotoToContext(ctx, canvas, rawImg, imgW, imgH, AppState.cameraRotation, false, AppState.cropMode);
}

async function applyFrameTemplate(source, customQualityMode = null) {
  let rawImg;

  if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
    rawImg = source;
  } else {
    rawImg = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = reader.result;
      };
      reader.readAsDataURL(source);
    });
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const imgW = rawImg.naturalWidth || rawImg.width;
  const imgH = rawImg.naturalHeight || rawImg.height;

  const qualityMode = customQualityMode || AppState.photoQuality || 'compact_300k';

  let maxDim = null;
  let targetKb = 0;
  let baseQuality = 0.94;

  if (qualityMode === 'compact_300k') {
    maxDim = 1800; // max 1800px on long edge (1800x1200 untuk rasio asli 3:2 tanpa crop)
    targetKb = 300; // Target ~300 KB (250 KB - 350 KB)
    baseQuality = 0.80;
  } else if (qualityMode === 'standard_800k') {
    maxDim = 2400;
    targetKb = 850;
    baseQuality = 0.88;
  } else {
    maxDim = null;
    targetKb = 0;
    baseQuality = 0.94;
  }

  renderFramedPhotoToContext(ctx, canvas, rawImg, imgW, imgH, AppState.cameraRotation, false, AppState.cropMode, maxDim);

  if (targetKb <= 0) {
    return canvas.toDataURL('image/jpeg', baseQuality);
  }

  // Adaptive quality tuning to land within ~250 KB - 350 KB
  let curQuality = baseQuality;
  let dataUrl = canvas.toDataURL('image/jpeg', curQuality);
  let approxKb = Math.round((dataUrl.length * 3 / 4) / 1024);

  if (approxKb > targetKb + 40) {
    curQuality = Math.max(0.62, Math.min(baseQuality, (targetKb / approxKb) * curQuality));
    dataUrl = canvas.toDataURL('image/jpeg', curQuality);
  } else if (approxKb < targetKb - 80 && curQuality < 0.88) {
    curQuality = Math.min(0.88, curQuality * 1.1);
    dataUrl = canvas.toDataURL('image/jpeg', curQuality);
  }

  return dataUrl;
}

// ==========================================
// 5. PHOTO MANAGEMENT PER FOLDER (ANTI-FLICKER)
// ==========================================
async function fetchPhotosForActiveFolder() {
  try {
    const res = await fetch(`/api/photos?folder=${encodeURIComponent(AppState.activeFolder)}`);
    const data = await res.json();
    let photoList = null;
    if (data && Array.isArray(data.photos)) {
      photoList = data.photos;
    } else if (Array.isArray(data)) {
      photoList = data;
    }

    if (photoList) {
      AppState.photos = photoList;
      
      const statTotal = document.getElementById('stat-total-photos');
      if (statTotal) statTotal.innerText = AppState.photos.length;
      const galleryCount = document.getElementById('gallery-photo-count');
      if (galleryCount) galleryCount.innerText = `${AppState.photos.length} Foto`;
      
      const currentFingerprint = AppState.photos.map(p => `${p.name || p.id}_${p.timestamp || p.size || 0}`).join('|');
      if (currentFingerprint === AppState.lastRenderedPhotosFingerprint && AppState.photos.length > 0) {
        return;
      }
      
      AppState.lastRenderedPhotosFingerprint = currentFingerprint;
      renderDashboardGrid();
    }
  } catch (err) {
    console.warn("Gagal fetch photos:", err);
  }
}

// Realtime cross-tab storage sync
window.addEventListener('storage', (e) => {
  if (e.key === 'piufoto_photo_added_event' || e.key === 'piufoto_active_folder') {
    AppState.lastRenderedPhotosFingerprint = '';
    AppState.lastRenderedFoldersFingerprint = '';
    fetchFolders();
    fetchPhotosForActiveFolder();
  }
});

const processedAutoFrameSet = new Set();
let isAutoFramingRunning = false;

// Dinonaktifkan: Foto sudah dibingkai langsung saat ingest/upload dengan nama asli (tanpa suffix _framed)
async function autoFrameRawIncomingPhotos() {
  return;
  if (AppState.selectedFrame === 'none' || isAutoFramingRunning) return;
  if (!AppState.photos || AppState.photos.length === 0) return;

  for (const photo of AppState.photos) {
    // Foto jepretan kamera Fujifilm (misal: DSCF0001.JPG) yang belum dibingkai
    const isRaw = /^(DSCF|IMG_|_DSC|FUJI)/i.test(photo.name) && !photo.name.includes('_framed');
    if (isRaw && !processedAutoFrameSet.has(photo.name)) {
      processedAutoFrameSet.add(photo.name);
      isAutoFramingRunning = true;

      try {
        const actEl = document.getElementById('upload-activity-status');
        if (actEl) actEl.innerText = `🎨 [AUTO-FRAME] Memasang template bingkai untuk ${photo.name}...`;

        const imgRes = await fetch(photo.url);
        const blob = await imgRes.blob();
        const framedBase64 = await applyFrameTemplate(blob);
        const framedName = photo.name.replace(/\.(jpe?g|png|webp)$/i, '_framed.jpg');

        // Unggah foto yang sudah berbingkai ke server & Google Drive
        await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: framedBase64,
            filename: framedName,
            folder: AppState.activeFolder,
            googleDriveWebhook: AppState.googleDriveWebhook,
            rootFolderName: AppState.googleDriveRootFolder || '',
            parentFolderId: AppState.googleDriveParentFolderId || '',
            ext: 'jpg'
          })
        });

        // Hapus file mentah agar di galeri hanya tampil foto berbingkai
        await fetch(`/api/photos?folder=${encodeURIComponent(AppState.activeFolder)}&file=${encodeURIComponent(photo.name)}`, {
          method: 'DELETE'
        });

        playUploadSuccessSound();
        if (actEl) actEl.innerText = `✓ ${framedName} berhasil dibingkai & siap diunduh tamu!`;
        AppState.lastRenderedPhotosFingerprint = '';
        await fetchPhotosForActiveFolder();
      } catch (err) {
        console.warn("Auto-frame error:", err);
      } finally {
        isAutoFramingRunning = false;
      }
      break;
    }
  }
}

function renderDashboardGrid() {
  const grid = document.getElementById('photographer-grid');
  const emptyState = document.getElementById('empty-gallery-state');
  
  if (!AppState.photos || AppState.photos.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  grid.innerHTML = '';
  
  AppState.photos.forEach((photo) => {
    const card = document.createElement('div');
    card.className = 'dashboard-photo-card';
    card.dataset.photoname = photo.name;
    
    let frameLabel = '🌸 Romantis';
    if (AppState.selectedFrame === 'golden_elegance') frameLabel = '✨ Gold';
    if (AppState.selectedFrame === 'vintage_polaroid') frameLabel = '🎞️ Vintage';
    if (AppState.selectedFrame === 'custom_png') frameLabel = '🖼️ PNG';
    if (AppState.selectedFrame === 'none') frameLabel = 'Polos';

    const safeName = escapeJsAttr(photo.name);

    card.innerHTML = `
      <div class="card-gdrive-badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L4.5 15h15z"/>
        </svg>
        Drive
      </div>
      <div class="card-frame-badge">${frameLabel}</div>
      <img src="${photo.url}" alt="${photo.name}" loading="lazy" onclick="openPhotoViewer('${photo.url}', '${safeName}')">
      <div class="card-overlay-actions">
        <span class="card-time" title="${photo.name}">${photo.name}</span>
        <div class="card-action-icons">
          <button class="card-btn-icon" onclick="downloadSinglePhoto(event, '${photo.url}', '${safeName}')" title="Download">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button class="card-btn-icon delete-photo-btn" onclick="openDeletePhotoModal(event, '${safeName}')" title="Hapus Foto">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ==========================================
// 6. OTG TETHERING: AUTO-FRAME & UPLOAD TO GOOGLE DRIVE
// ==========================================
async function startFolderWatcher() {
  const actEl = document.getElementById('upload-activity-status');

  // 1. Jika di PC / Browser yang mendukung File System Access API
  if ('showDirectoryPicker' in window) {
    try {
      AppState.directoryHandle = await window.showDirectoryPicker();
      AppState.isWatchingFolder = true;
      
      const statusEl = document.getElementById('otg-tether-status');
      if (statusEl) {
        statusEl.classList.add('active');
        statusEl.innerHTML = '<span>●</span> OTG Memantau & Auto-Upload';
      }
      const btnEl = document.getElementById('btn-pick-folder');
      if (btnEl) btnEl.innerText = '✓ Folder Kamera Terhubung';
      
      await scanFolderForNewImages(true);
      
      if (AppState.watchInterval) clearInterval(AppState.watchInterval);
      AppState.watchInterval = setInterval(() => {
        scanFolderForNewImages(false);
      }, 700);
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert("Gagal memilih folder: " + err.message);
      }
      return;
    }
  }

  // 2. Jika di Android APK (Capacitor Native) - Gunakan Photo / File Picker Sistem Android
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
    try {
      if (actEl) actEl.innerText = '📁 Membuka galeri / penyimpanan OTG kamera...';
      const Camera = window.Capacitor.Plugins.Camera;
      const result = await Camera.pickImages({
        quality: 100,
        limit: 0
      });

      if (result && result.photos && result.photos.length > 0) {
        if (actEl) actEl.innerText = `⏳ Memproses ${result.photos.length} foto dari kamera...`;
        for (let i = 0; i < result.photos.length; i++) {
          const photo = result.photos[i];
          if (actEl) actEl.innerText = `⏳ Memasang bingkai (${i + 1}/${result.photos.length})...`;
          const res = await fetch(photo.webPath);
          const blob = await res.blob();
          const filename = `DSC_OTG_${Date.now()}_${i + 1}.JPG`;
          blob.name = filename;
          await uploadPhotoWithFrameToGoogleDrive(blob);
        }
        if (actEl) actEl.innerText = `✓ Selesai memproses ${result.photos.length} foto!`;
        return;
      }
    } catch (e) {
      console.warn("Capacitor pickImages note:", e);
      if (e.message && e.message.includes('User cancelled')) {
        if (actEl) actEl.innerText = '';
        return;
      }
    }
  }

  // 3. Fallback: Input file HTML standar
  const manualInput = document.getElementById('manual-file-input');
  if (manualInput) {
    if (actEl) actEl.innerText = '📁 Membuka penyimpanan OTG kamera... Silakan pilih foto jepretan.';
    manualInput.click();
  }
}

async function scanFolderForNewImages(isInitialScan = false) {
  if (!AppState.directoryHandle) return;
  
  try {
    for await (const entry of AppState.directoryHandle.values()) {
      if (entry.kind === 'file') {
        const name = entry.name;
        if (/\.(jpe?g|png|webp)$/i.test(name)) {
          if (!AppState.processedFileNames.has(name)) {
            AppState.processedFileNames.add(name);
            
            if (!isInitialScan) {
              const file = await entry.getFile();
              await uploadPhotoWithFrameToGoogleDrive(file);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("Error scan folder:", err);
  }
}

async function uploadPhotoWithFrameToGoogleDrive(file) {
  try {
    document.getElementById('upload-activity-status').innerText = `⏳ Memasang frame & upload ${file.name}...`;

    const framedBase64 = await applyFrameTemplate(file);

    // Instant optimistic render (0ms delay) so photo appears on screen IMMEDIATELY
    const newPhotoItem = {
      id: (AppState.activeFolder || 'Sesi_01') + '/' + file.name,
      name: file.name,
      url: framedBase64,
      size: Math.round(framedBase64.length * 0.75),
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };
    AppState.photos = [newPhotoItem, ...AppState.photos.filter(p => p.name !== file.name)];
    AppState.lastRenderedPhotosFingerprint = '';
    renderDashboardGrid();

    const statTotalEl = document.getElementById('stat-total-photos');
    if (statTotalEl) statTotalEl.innerText = AppState.photos.length;
    const galleryCountEl = document.getElementById('gallery-photo-count');
    if (galleryCountEl) galleryCountEl.innerText = `${AppState.photos.length} Foto`;

    // Forward upload directly to server.js which also uploads to Google Drive with full redirect & CORS immunity
    const uploadRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: framedBase64,
        filename: file.name,
        folder: AppState.activeFolder,
        googleDriveWebhook: AppState.googleDriveWebhook,
        rootFolderName: AppState.googleDriveRootFolder || '',
        parentFolderId: AppState.googleDriveParentFolderId || '',
        ext: 'jpg'
      })
    });

    const uploadData = await uploadRes.json();
    playUploadSuccessSound();

    if (uploadData.gdrive) {
      if (uploadData.gdrive.ok) {
        document.getElementById('upload-activity-status').innerText = `✓ ${file.name} berbingkai tersimpan di Google Drive!`;
        if (uploadData.gdrive.folderUrl) {
          AppState.activeFolderDriveUrl = uploadData.gdrive.folderUrl;
          localStorage.setItem(`gdrive_url_${AppState.activeFolder}`, uploadData.gdrive.folderUrl);
          document.getElementById('qr-client-url').innerText = uploadData.gdrive.folderUrl;
          document.getElementById('btn-open-gdrive-folder').href = uploadData.gdrive.folderUrl;
          renderActiveFolderQRCode(uploadData.gdrive.folderUrl);
        }
        updateDriveStatusBadge(true);
      } else if (uploadData.gdrive.status === 'uploading') {
        document.getElementById('upload-activity-status').innerText = `✓ ${file.name} tersimpan! (Sinkronisasi Drive di latar belakang...)`;
      } else {
        document.getElementById('upload-activity-status').innerText = `⚠ ${file.name} tersimpan di tablet, tapi gagal ke Google Drive!`;
        console.warn("Google Drive upload error:", uploadData.gdrive);
        if (uploadData.gdrive.status === 404) {
          alert(`Foto "${file.name}" berhasil disimpan di galeri lokal, tetapi GAGAL terkirim ke Google Drive!\n\nAlasan: Google Apps Script mengembalikan 404 (Halaman Tidak Ditemukan).\n\nSolusi Perbaikan:\n1. Buka https://script.google.com\n2. Klik "Deploy" -> "Manage deployments"\n3. Klik icon pensil edit pada deployment aktif\n4. Pastikan opsi "Who has access" disetel ke: "Anyone" (Siapa saja), BUKAN "Only myself"\n5. Klik "Deploy" dan simpan.`);
        }
        updateDriveStatusBadge(false, uploadData.gdrive.message);
      }
    } else {
      document.getElementById('upload-activity-status').innerText = `✓ ${file.name} tersimpan di galeri lokal!`;
    }

    // Dual-sync latar belakang: kirim foto ke server online publik agar tamu dengan kuota data internet langsung dapat melihat foto
    if (AppState.publicBaseUrl && !AppState.publicBaseUrl.includes('localhost')) {
      const publicUploadUrl = `${AppState.publicBaseUrl.replace(/\/+$/, '')}/api/upload`;
      fetch(publicUploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: framedBase64,
          filename: file.name,
          folder: AppState.activeFolder,
          ext: 'jpg'
        })
      }).then(r => r.json()).then(res => {
        console.log(`🌐 [ONLINE SYNC] Foto ${file.name} berhasil tersinkron ke ${publicUploadUrl}:`, res);
      }).catch(err => {
        console.warn(`🌐 [ONLINE SYNC] Catatan background upload: ${err.message}`);
      });
    }

    AppState.lastRenderedPhotosFingerprint = '';
    AppState.lastRenderedFoldersFingerprint = '';
    await fetchFolders();
    await fetchPhotosForActiveFolder();
  } catch (err) {
    console.warn("Gagal proses & upload:", err);
    document.getElementById('upload-activity-status').innerText = `⚠ Gagal upload ${file.name}: ${err.message}`;
  }
}

window.uploadPhotoWithFrameToGoogleDrive = uploadPhotoWithFrameToGoogleDrive;

// Re-apply active frame to all existing photos in this folder
async function reframeAllPhotosInActiveFolder() {
  if (AppState.photos.length === 0) {
    alert("Belum ada foto di sesi ini untuk dibingkai ulang.");
    return;
  }
  
  const confirmReframe = confirm(`Terapkan template "${AppState.selectedFrame}" ke seluruh foto di ${AppState.activeFolderDisplayName}?`);
  if (!confirmReframe) return;
  
  document.getElementById('upload-activity-status').innerText = `🎨 Membingkai ulang foto di sesi ini...`;
  
  for (const photo of AppState.photos) {
    try {
      const imgRes = await fetch(photo.url);
      const blob = await imgRes.blob();
      const framedBase64 = await applyFrameTemplate(blob);
      
      await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: framedBase64,
          filename: photo.name,
          folder: AppState.activeFolder,
          ext: 'jpg'
        })
      });
    } catch(e){}
  }
  
  AppState.lastRenderedPhotosFingerprint = '';
  await fetchPhotosForActiveFolder();
  document.getElementById('upload-activity-status').innerText = `✓ Selesai membingkai ulang foto sesi ini!`;
  alert("Seluruh foto di sesi ini berhasil diperbarui dengan bingkai baru!");
}

// Compress and optimize all existing photos in active folder to ~300 KB
async function optimizeAllPhotosInActiveFolder() {
  if (!AppState.photos || AppState.photos.length === 0) {
    alert("Belum ada foto di sesi ini untuk dioptimasi.");
    return;
  }
  
  const total = AppState.photos.length;
  const confirmOpt = confirm(
    `⚡ OPTIMASI UKURAN FOTO (~300 KB)\n\n` +
    `Optimalkan ${total} foto di "${AppState.activeFolderDisplayName}" menjadi ~300 KB?\n\n` +
    `• Rasio asli kamera 3:2 tetap terjaga utuh murni tanpa crop\n` +
    `• Resolusi tajam standar 4R / Full HD (1800x1200 px)\n` +
    `• Galeri tamu akan terbuka kilat tanpa loading lama di HP!\n` +
    `• Hemat kuota internet & kapasitas Google Drive.`
  );
  if (!confirmOpt) return;
  
  const actEl = document.getElementById('upload-activity-status');
  let successCount = 0;
  
  for (let i = 0; i < total; i++) {
    const photo = AppState.photos[i];
    if (actEl) actEl.innerText = `⚡ Mengoptimasi foto ${i + 1}/${total} (${photo.name}) ke ~300KB...`;
    
    try {
      const imgRes = await fetch(photo.url);
      const blob = await imgRes.blob();
      const optimizedBase64 = await applyFrameTemplate(blob, 'compact_300k');
      
      await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: optimizedBase64,
          filename: photo.name,
          folder: AppState.activeFolder,
          googleDriveWebhook: AppState.googleDriveWebhook,
          rootFolderName: AppState.googleDriveRootFolder || '',
          parentFolderId: AppState.googleDriveParentFolderId || '',
          ext: 'jpg'
        })
      });
      successCount++;
    } catch(err) {
      console.warn("Gagal optimasi foto:", photo.name, err);
    }
  }
  
  if (actEl) actEl.innerText = `✓ Sukses mengoptimalkan ${successCount} foto menjadi ~300KB!`;
  playUploadSuccessSound();
  AppState.lastRenderedPhotosFingerprint = '';
  await fetchPhotosForActiveFolder();
  alert(`✓ Selesai! Sebanyak ${successCount} foto di "${AppState.activeFolderDisplayName}" berhasil dioptimasi ke ukuran ~300 KB.`);
}

// ==========================================
// 7. QR CODE PER FOLDER GENERATION
// ==========================================
function renderActiveFolderQRCode(url) {
  const container = document.getElementById('kiosk-qrcode-container');
  const modalContainer = document.getElementById('modal-qrcode-container');
  const standeeContainer = document.getElementById('standee-qrcode-container');
  
  [container, modalContainer, standeeContainer].forEach(el => {
    if (el) {
      el.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        new QRCode(el, {
          text: url,
          width: el === standeeContainer ? 240 : 180,
          height: el === standeeContainer ? 240 : 180,
          colorDark: "#090d16",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }
  });
}

function openQRModal() {
  const titleEl = document.getElementById('modal-folder-title');
  if (titleEl) {
    titleEl.innerText = AppState.qrTarget === 'all' ? 'Galeri Tamu (Semua Sesi)' : AppState.activeFolderDisplayName;
  }
  const modal = document.getElementById('qr-modal');
  if (modal) modal.classList.add('active');
  pushModalState('qr-modal');
}

function closeQRModal() {
  dismissModal('qr-modal');
}

function openStandeeModal() {
  closeQRModal();
  const folderNameEl = document.getElementById('standee-folder-name');
  const folderDescEl = document.getElementById('standee-folder-desc');
  
  if (AppState.qrTarget === 'all') {
    if (folderNameEl) folderNameEl.innerText = 'GALERI FOTO TAMU';
    if (folderDescEl) folderDescEl.innerText = 'Scan QR Code ini untuk membuka galeri foto dan bebas memilih sesi foto Anda!';
  } else {
    if (folderNameEl) folderNameEl.innerText = AppState.activeFolderDisplayName;
    if (folderDescEl) folderDescEl.innerText = `Scan QR Code dengan kamera HP Anda untuk membuka foto ${AppState.activeFolderDisplayName}!`;
  }
  const modal = document.getElementById('standee-modal');
  if (modal) modal.classList.add('active');
  pushModalState('standee-modal');
}

function closeStandeeModal() {
  dismissModal('standee-modal');
}

function printStandee() {
  window.print();
}

function copyDriveLink() {
  const url = document.getElementById('qr-client-url').innerText;
  navigator.clipboard.writeText(url);
  alert("Link Google Drive berhasil disalin ke clipboard!");
}

function editSessionDriveLink() {
  const currentUrl = AppState.activeFolderDriveUrl || localStorage.getItem(`gdrive_url_${AppState.activeFolder}`) || '';
  const inputUrl = prompt(
    `Atur Tujuan Link Folder Google Drive untuk ${AppState.activeFolderDisplayName}:\n\n` +
    `Paste Link atau URL Folder Google Drive yang ingin dijadikan tujuan sesi ini:\n` +
    `(Kosongkan jika ingin kembali ke auto-generate link)`,
    currentUrl.startsWith('http') ? currentUrl : ''
  );
  
  if (inputUrl === null) return;
  
  const trimmed = inputUrl.trim();
  if (trimmed) {
    AppState.activeFolderDriveUrl = trimmed;
    localStorage.setItem(`gdrive_url_${AppState.activeFolder}`, trimmed);
    document.getElementById('qr-client-url').innerText = trimmed;
    document.getElementById('btn-open-gdrive-folder').href = trimmed;
    renderActiveFolderQRCode(trimmed);
    alert(`Link Google Drive untuk ${AppState.activeFolderDisplayName} berhasil diperbarui! QR code langsung disesuaikan.`);
  } else {
    localStorage.removeItem(`gdrive_url_${AppState.activeFolder}`);
    AppState.activeFolderDriveUrl = '';
    updateActiveFolderUI();
  }
}

// ==========================================
// 8. PHOTO VIEWER MODAL
// ==========================================
function openPhotoViewer(url, name) {
  document.getElementById('viewer-img').src = url;
  document.getElementById('viewer-title').innerText = name;
  const dl = document.getElementById('viewer-download-link');
  dl.href = url;
  dl.setAttribute('download', name);
  const modal = document.getElementById('viewer-modal');
  if (modal) modal.classList.add('active');
  pushModalState('viewer-modal');
}

function closePhotoViewer() {
  dismissModal('viewer-modal');
}

async function rotateCurrentViewerPhoto(degrees = 90) {
  const viewerTitle = document.getElementById('viewer-title');
  const filename = viewerTitle ? viewerTitle.innerText.trim() : '';
  const viewerImg = document.getElementById('viewer-img');
  if (!filename || !viewerImg || !viewerImg.src) return;

  const rotateBtn = document.getElementById('btn-rotate-viewer-photo');
  if (rotateBtn) {
    rotateBtn.disabled = true;
    rotateBtn.innerHTML = '⏳ Memutar...';
  }

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = viewerImg.src;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight || img.height;
    canvas.height = img.naturalWidth || img.width;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

    const rotatedBase64 = canvas.toDataURL('image/jpeg', 0.95);

    // Save back to server
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: rotatedBase64,
        filename: filename,
        folder: AppState.activeFolder,
        googleDriveWebhook: AppState.googleDriveWebhook,
        rootFolderName: AppState.googleDriveRootFolder || '',
        parentFolderId: AppState.googleDriveParentFolderId || '',
        ext: 'jpg'
      })
    });

    const data = await res.json();
    if (data.status === 'success') {
      const newUrl = `${viewerImg.src.split('?')[0]}?v=${Date.now()}`;
      viewerImg.src = newUrl;
      const downloadLink = document.getElementById('viewer-download-link');
      if (downloadLink) downloadLink.href = newUrl;

      // Update photo entry in state
      const p = AppState.photos.find(item => item.name === filename);
      if (p) {
        p.url = newUrl;
        p.timestamp = Date.now();
      }
      AppState.lastRenderedPhotosFingerprint = '';
      renderDashboardGrid();
      playChime(650, 0.08);
    }
  } catch (err) {
    console.warn("Gagal memutar foto:", err);
    alert("Gagal memutar foto: " + err.message);
  } finally {
    if (rotateBtn) {
      rotateBtn.disabled = false;
      rotateBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
        Putar 90°
      `;
    }
  }
}


function downloadSinglePhoto(e, url, name) {
  e.stopPropagation();
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}

// ==========================================
// 9. SETTINGS & FRAME MANAGEMENT
// ==========================================
async function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('piufoto_settings');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.studioName) AppState.studioName = data.studioName;
      if (data.googleDriveWebhook) AppState.googleDriveWebhook = data.googleDriveWebhook;
      if (data.googleDriveRootFolder !== undefined) {
        AppState.googleDriveRootFolder = (data.googleDriveRootFolder === 'Piufoto_Galeri_Klien') ? '' : data.googleDriveRootFolder;
      }
      if (data.googleDriveParentFolderId) AppState.googleDriveParentFolderId = data.googleDriveParentFolderId;
      if (data.selectedFrame) AppState.selectedFrame = data.selectedFrame;
      if (data.frameTitle !== undefined) AppState.frameTitle = data.frameTitle;
      if (data.frameSubtitle !== undefined) AppState.frameSubtitle = data.frameSubtitle;
      if (data.photoQuality) AppState.photoQuality = data.photoQuality;
      if (data.customPngDataUrl) {
        AppState.customPngDataUrl = data.customPngDataUrl;
        loadCustomPngImage(data.customPngDataUrl);
      }
    }
    
    // Check server if custom frame already exists on disk
    try {
      const frameCheck = await fetch('/api/frame');
      const frameData = await frameCheck.json();
      if (frameData.hasCustomFrame && frameData.frameUrl) {
        loadCustomPngImage(frameData.frameUrl);
      }
    } catch(e){}
    
  } catch(e){}
  
  document.getElementById('setting-studio-name').value = AppState.studioName;
  document.getElementById('setting-webhook').value = AppState.googleDriveWebhook || '';
  const rootInput = document.getElementById('setting-root-folder');
  if (rootInput) rootInput.value = AppState.googleDriveRootFolder || '';
  const parentInput = document.getElementById('setting-parent-folder-id');
  if (parentInput) parentInput.value = AppState.googleDriveParentFolderId || '';

  const qualitySelect = document.getElementById('setting-photo-quality');
  if (qualitySelect) qualitySelect.value = AppState.photoQuality || 'compact_300k';

  const publicDomainInput = document.getElementById('setting-public-domain');
  if (publicDomainInput) {
    publicDomainInput.value = AppState.publicBaseUrl || localStorage.getItem('piufoto_public_base_url') || 'https://foto.berkisahkita.web.id';
  }

  document.getElementById('input-frame-title-live').value = AppState.frameTitle;
  document.getElementById('input-frame-subtitle-live').value = AppState.frameSubtitle;
  document.getElementById('standee-studio-name').innerText = AppState.studioName;
  
  updateFrameUI();
  updateDriveStatusBadge();
}

function updateFrameUI() {
  document.querySelectorAll('.frame-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.frame === AppState.selectedFrame);
  });
  renderLiveFramePreview();
}

function loadCustomPngImage(src) {
  const img = new Image();
  img.onload = () => {
    AppState.customPngImageObj = img;
    const modalPreview = document.getElementById('custom-frame-modal-preview');
    if (modalPreview) {
      modalPreview.src = src;
      modalPreview.style.display = 'block';
    }
    renderLiveFramePreview();
  };
  img.src = src;
}

function updateDriveStatusBadge(isConnected = null, detailMsg = '') {
  const badge = document.getElementById('gdrive-connection-status');
  if (!AppState.googleDriveWebhook || !AppState.googleDriveWebhook.startsWith('http')) {
    badge.innerHTML = '⚠ Google Drive Belum Diatur';
    badge.style.color = '#f59e0b';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    return;
  }

  if (isConnected === true) {
    badge.innerHTML = '● Google Drive Terhubung';
    badge.style.color = '#34d399';
    badge.style.borderColor = 'rgba(15, 157, 88, 0.4)';
  } else if (isConnected === false) {
    badge.innerHTML = '❌ Google Drive Terputus (404)';
    badge.style.color = '#f87171';
    badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
  } else {
    badge.innerHTML = '● Memeriksa Google Drive...';
    badge.style.color = '#93c5fd';
    badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
  }
}

async function testWebhookConnection() {
  const webhookInput = document.getElementById('setting-webhook').value.trim();
  const rootInput = document.getElementById('setting-root-folder').value.trim();
  const parentInput = document.getElementById('setting-parent-folder-id').value.trim();
  const feedback = document.getElementById('test-webhook-feedback');
  const btnTest = document.getElementById('btn-test-webhook');

  if (!webhookInput || !webhookInput.startsWith('http')) {
    feedback.style.display = 'block';
    feedback.style.background = 'rgba(239, 68, 68, 0.15)';
    feedback.style.border = '1px solid #ef4444';
    feedback.style.color = '#fca5a5';
    feedback.innerHTML = '⚠ Masukkan URL Webhook Google Apps Script terlebih dahulu (harus diawali https://script.google.com/...)';
    return;
  }

  btnTest.disabled = true;
  btnTest.innerText = '⏳ Menguji...';
  feedback.style.display = 'block';
  feedback.style.background = 'rgba(59, 130, 246, 0.15)';
  feedback.style.border = '1px solid #3b82f6';
  feedback.style.color = '#93c5fd';
  feedback.innerHTML = '📡 Menghubungi Google Apps Script...';

  try {
    const res = await fetch('/api/test-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: webhookInput,
        folderName: AppState.activeFolderDisplayName || AppState.activeFolder || 'Sesi 01',
        rootFolderName: rootInput || '',
        parentFolderId: parentInput || ''
      })
    });
    const result = await res.json();

    if (result.ok) {
      feedback.style.background = 'rgba(16, 185, 129, 0.15)';
      feedback.style.border = '1px solid #10b981';
      feedback.style.color = '#6ee7b7';
      feedback.innerHTML = `✅ <strong>Sukses Terhubung!</strong><br>${result.message}<br><a href="${result.folderUrl}" target="_blank" style="color: #38bdf8; text-decoration: underline;">Buka Folder Google Drive ↗</a>`;
      updateDriveStatusBadge(true);
      if (result.folderUrl) {
        AppState.activeFolderDriveUrl = result.folderUrl;
        localStorage.setItem(`gdrive_url_${AppState.activeFolder}`, result.folderUrl);
        document.getElementById('qr-client-url').innerText = result.folderUrl;
        document.getElementById('btn-open-gdrive-folder').href = result.folderUrl;
        renderActiveFolderQRCode(result.folderUrl);
      }
    } else {
      feedback.style.background = 'rgba(239, 68, 68, 0.15)';
      feedback.style.border = '1px solid #ef4444';
      feedback.style.color = '#fca5a5';
      feedback.innerHTML = `❌ <strong>Koneksi Gagal (Status ${result.status || 'Error'}):</strong><br>${result.message}`;
      updateDriveStatusBadge(false, result.message);
    }
  } catch (err) {
    feedback.style.background = 'rgba(239, 68, 68, 0.15)';
    feedback.style.border = '1px solid #ef4444';
    feedback.style.color = '#fca5a5';
    feedback.innerHTML = `❌ <strong>Gagal Terhubung:</strong> ${err.message}`;
    updateDriveStatusBadge(false);
  } finally {
    btnTest.disabled = false;
    btnTest.innerText = '🔌 Test Koneksi';
  }
}

async function testPublicDomainConnection() {
  const domainInput = document.getElementById('setting-public-domain');
  const feedback = document.getElementById('test-public-domain-feedback');
  const btnTest = document.getElementById('btn-test-public-domain');

  let targetUrl = domainInput ? domainInput.value.trim() : '';
  if (!targetUrl) {
    targetUrl = 'https://foto.berkisahkita.web.id';
    if (domainInput) domainInput.value = targetUrl;
  }
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
    if (domainInput) domainInput.value = targetUrl;
  }
  targetUrl = targetUrl.replace(/\/+$/, '');

  if (btnTest) {
    btnTest.disabled = true;
    btnTest.innerText = '⏳ Cek...';
  }
  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.background = 'rgba(59, 130, 246, 0.15)';
    feedback.style.border = '1px solid #3b82f6';
    feedback.style.color = '#93c5fd';
    feedback.innerHTML = `📡 Menghubungi domain online: <code>${targetUrl}</code>...`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${targetUrl}/api/folders`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      if (feedback) {
        feedback.style.background = 'rgba(16, 185, 129, 0.15)';
        feedback.style.border = '1px solid #10b981';
        feedback.style.color = '#6ee7b7';
        feedback.innerHTML = `✅ <strong>Domain Online Aktif & Terhubung!</strong><br>Server online siap diakses. Tamu yang menscan QR code dengan kuota internet ponsel akan langsung membuka galeri di <code>${targetUrl}</code>.`;
      }
      AppState.publicBaseUrl = targetUrl;
      localStorage.setItem('piufoto_public_base_url', targetUrl);
      updateActiveFolderQR();
    } else {
      if (feedback) {
        feedback.style.background = 'rgba(239, 68, 68, 0.15)';
        feedback.style.border = '1px solid #ef4444';
        feedback.style.color = '#fca5a5';
        feedback.innerHTML = `❌ <strong>Server Online Mengembalikan Status ${res.status}:</strong><br>Pastikan server lokal/Cloudflare Tunnel berjalan.`;
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.style.background = 'rgba(239, 68, 68, 0.15)';
      feedback.style.border = '1px solid #ef4444';
      feedback.style.color = '#fca5a5';
      feedback.innerHTML = `❌ <strong>Gagal Terhubung ke Domain Online:</strong><br>${err.name === 'AbortError' ? 'Waktu koneksi habis (timeout > 6s)' : err.message}<br><br><small>Tips: Pastikan tunnel berjalan (klik <code>start-with-tunnel.bat</code> di laptop) dan tablet terhubung ke jaringan internet/hotspot.</small>`;
    }
  } finally {
    if (btnTest) {
      btnTest.disabled = false;
      btnTest.innerText = '🌐 Cek Online';
    }
  }
}

async function syncSessionPhotosToOnline() {
  const targetUrl = AppState.publicBaseUrl || localStorage.getItem('piufoto_public_base_url') || 'https://foto.berkisahkita.web.id';
  const folderName = AppState.activeFolder || 'Sesi_01';
  const displayName = AppState.activeFolderDisplayName || folderName;

  if (!AppState.photos || AppState.photos.length === 0) {
    alert(`Belum ada foto di sesi "${displayName}" untuk disinkronkan ke online.`);
    return;
  }

  const btnSync = document.getElementById('btn-sync-online-cloud');
  const actEl = document.getElementById('upload-activity-status');

  const confirmSync = confirm(
    `Sinkronkan ${AppState.photos.length} foto dari sesi "${displayName}" ke server online?\n\n` +
    `Domain tujuan: ${targetUrl}\n` +
    `Setelah sinkronisasi, tamu yang menscan QR Code dengan kuota data internet akan langsung melihat semua foto ini.`
  );
  if (!confirmSync) return;

  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerText = '⏳ Menyinkronkan...';
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < AppState.photos.length; i++) {
    const photo = AppState.photos[i];
    const currentNum = i + 1;
    if (actEl) actEl.innerText = `🌐 [SYNC ONLINE] Mengunggah (${currentNum}/${AppState.photos.length}): ${photo.name}...`;

    try {
      let imgData = photo.url;
      if (!imgData.startsWith('data:image')) {
        const res = await fetch(photo.url);
        const blob = await res.blob();
        imgData = await new Promise(r => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.readAsDataURL(blob);
        });
      }

      const res = await fetch(`${targetUrl.replace(/\/+$/, '')}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imgData,
          filename: photo.name,
          folder: folderName,
          ext: 'jpg'
        })
      });

      if (res.ok) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.warn(`Sync photo ${photo.name} failed:`, err);
      failCount++;
    }
  }

  if (btnSync) {
    btnSync.disabled = false;
    btnSync.innerText = '🌐 Sinkronkan Foto Sesi Ini ke Online';
  }

  if (actEl) {
    actEl.innerText = `✓ Selesai! ${successCount} foto sesi "${displayName}" berhasil tersinkron ke online!`;
  }
  playUploadSuccessSound();

  let msg = `✅ Selesai Sinkronisasi Online!\n\n` +
    `• Berhasil: ${successCount} foto\n` +
    (failCount > 0 ? `• Gagal: ${failCount} foto (cek koneksi internet)\n` : '') +
    `\nTamu yang menscan QR code sekarang dapat langsung melihat foto di:\n${targetUrl}/gallery.html?folder=${encodeURIComponent(folderName)}`;
  alert(msg);
}

function saveSettings() {
  AppState.studioName = document.getElementById('setting-studio-name').value.trim() || 'BERKISAHKITA';
  AppState.googleDriveWebhook = document.getElementById('setting-webhook').value.trim();
  const rootInput = document.getElementById('setting-root-folder');
  if (rootInput) AppState.googleDriveRootFolder = rootInput.value.trim();
  const parentInput = document.getElementById('setting-parent-folder-id');
  if (parentInput) AppState.googleDriveParentFolderId = parentInput.value.trim();
  
  const qualitySelect = document.getElementById('setting-photo-quality');
  if (qualitySelect) {
    AppState.photoQuality = qualitySelect.value;
    localStorage.setItem('piufoto_photo_quality', AppState.photoQuality);
  }

  const publicDomainInput = document.getElementById('setting-public-domain');
  if (publicDomainInput) {
    let pUrl = publicDomainInput.value.trim();
    if (!pUrl) pUrl = 'https://foto.berkisahkita.web.id';
    if (!pUrl.startsWith('http://') && !pUrl.startsWith('https://')) pUrl = 'https://' + pUrl;
    pUrl = pUrl.replace(/\/+$/, '');
    AppState.publicBaseUrl = pUrl;
    localStorage.setItem('piufoto_public_base_url', pUrl);
    updateActiveFolderQR();
  }

  localStorage.setItem('piufoto_settings', JSON.stringify({
    studioName: AppState.studioName,
    googleDriveWebhook: AppState.googleDriveWebhook,
    googleDriveRootFolder: AppState.googleDriveRootFolder,
    googleDriveParentFolderId: AppState.googleDriveParentFolderId,
    selectedFrame: AppState.selectedFrame,
    frameTitle: AppState.frameTitle,
    frameSubtitle: AppState.frameSubtitle,
    customPngDataUrl: AppState.customPngDataUrl,
    photoQuality: AppState.photoQuality,
    publicBaseUrl: AppState.publicBaseUrl
  }));
  
  document.getElementById('standee-studio-name').innerText = AppState.studioName;
  updateDriveStatusBadge();
  closeSettingsModal();

  // Sinkronkan webhook Google Drive ke backend server
  try {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleDriveWebhook: AppState.googleDriveWebhook,
        rootFolderName: AppState.googleDriveRootFolder,
        parentFolderId: AppState.googleDriveParentFolderId
      })
    }).catch(() => {});
  } catch (e) {}
  
  if (AppState.googleDriveWebhook) {
    fetchFolderUrlFromGoogleDrive(AppState.activeFolder);
  }
}

// Custom PNG Modal handlers
function openCustomFrameModal() {
  const modal = document.getElementById('modal-custom-frame');
  if (modal) modal.classList.add('active');
  pushModalState('modal-custom-frame');
}

function closeCustomFrameModal() {
  dismissModal('modal-custom-frame');
}

function openFrameTextModal() {
  document.getElementById('input-frame-title-live').value = AppState.frameTitle;
  document.getElementById('input-frame-subtitle-live').value = AppState.frameSubtitle;
  const modal = document.getElementById('modal-edit-frame-text');
  if (modal) modal.classList.add('active');
  pushModalState('modal-edit-frame-text');
}

function closeFrameTextModal() {
  dismissModal('modal-edit-frame-text');
}

function clearFrameText() {
  const titleInput = document.getElementById('input-frame-title-live');
  const subInput = document.getElementById('input-frame-subtitle-live');
  if (titleInput) titleInput.value = '';
  if (subInput) subInput.value = '';
  saveFrameText();
}
window.clearFrameText = clearFrameText;

function saveFrameText() {
  AppState.frameTitle = document.getElementById('input-frame-title-live').value.trim();
  AppState.frameSubtitle = document.getElementById('input-frame-subtitle-live').value.trim();
  saveSettings();
  renderLiveFramePreview();
  closeFrameTextModal();
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('active');
  pushModalState('settings-modal');
}

function closeSettingsModal() {
  dismissModal('settings-modal');
}

// ==========================================
// REALTIME PUSH ENGINE: SERVER-SENT EVENTS (SSE)
// ==========================================
function initDashboardSSE() {
  if (!window.EventSource) return;
  try {
    const sse = new EventSource('/api/events');
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_photo') {
          if (!data.folder || data.folder === AppState.activeFolder) {
            fetchPhotosForActiveFolder();
          }
          fetchFolders();
        } else if (data.type === 'photo_deleted') {
          if (!data.folder || data.folder === AppState.activeFolder) {
            fetchPhotosForActiveFolder();
          }
          fetchFolders();
        } else if (data.type === 'folders_updated') {
          fetchFolders();
        } else if (data.type === 'gdrive_synced') {
          if (data.ok && data.folderUrl) {
            AppState.activeFolderDriveUrl = data.folderUrl;
            localStorage.setItem(`gdrive_url_${data.folder}`, data.folderUrl);
            if (data.folder === AppState.activeFolder) {
              const actEl = document.getElementById('upload-activity-status');
              if (actEl) actEl.innerText = `✓ ${data.filename || 'Foto'} berhasil tersimpan di Google Drive!`;
              document.getElementById('qr-client-url').innerText = data.folderUrl;
              document.getElementById('btn-open-gdrive-folder').href = data.folderUrl;
              renderActiveFolderQRCode(data.folderUrl);
              updateDriveStatusBadge(true);
            }
          } else if (!data.ok) {
            updateDriveStatusBadge(false, data.message);
          }
        }
      } catch (err) {}
    };
    sse.onerror = () => {
      // Reconnect automatically handled by EventSource
    };
  } catch(e) {}
}

// ==========================================
// 10. EVENT LISTENERS INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  initSamplePreviewImage();
  await loadSavedSettings();
  await fetchServerInfo();
  await fetchFolders();
  await fetchPhotosForActiveFolder();
  initDashboardSSE();
  
  setInterval(() => {
    fetchPhotosForActiveFolder();
    fetchFolders();
    fetchServerInfo();
  }, 3000);
  
  // Real-time Frame Selector Buttons
  document.querySelectorAll('.frame-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const isAlreadyCustom = AppState.selectedFrame === 'custom_png' && btn.dataset.frame === 'custom_png';
      AppState.selectedFrame = btn.dataset.frame;
      updateFrameUI();
      saveSettings();
      
      // If user clicks Custom PNG and hasn't uploaded yet, OR clicks again while active, open upload modal!
      if (AppState.selectedFrame === 'custom_png' && (!AppState.customPngImageObj || isAlreadyCustom)) {
        openCustomFrameModal();
      }
    });
  });
  
  // Custom PNG Upload Triggers
  const customPngInput = document.getElementById('custom-png-direct-input');
  document.getElementById('btn-trigger-png-file').addEventListener('click', () => customPngInput.click());
  const btnOpenCustomModal = document.getElementById('btn-open-custom-frame-modal');
  if (btnOpenCustomModal) btnOpenCustomModal.addEventListener('click', openCustomFrameModal);
  document.getElementById('btn-close-custom-frame-modal').addEventListener('click', closeCustomFrameModal);
  
  customPngInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async () => {
        AppState.customPngDataUrl = reader.result;
        loadCustomPngImage(reader.result);
        
        // Also upload to server
        try {
          await fetch('/api/upload-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: reader.result })
          });
        } catch(err){}
        
        AppState.selectedFrame = 'custom_png';
        updateFrameUI();
        saveSettings();
      };
      reader.readAsDataURL(file);
    }
  });
  
  document.getElementById('btn-save-custom-png-modal').addEventListener('click', () => {
    AppState.selectedFrame = 'custom_png';
    updateFrameUI();
    saveSettings();
    closeCustomFrameModal();
  });
  
  // Frame Text Modal triggers
  document.getElementById('btn-open-frame-customizer').addEventListener('click', openFrameTextModal);
  document.getElementById('btn-close-frame-text-modal').addEventListener('click', closeFrameTextModal);
  document.getElementById('btn-save-frame-text').addEventListener('click', saveFrameText);
  document.getElementById('btn-reframe-all-photos').addEventListener('click', reframeAllPhotosInActiveFolder);
  
  const btnOptimizeSession = document.getElementById('btn-optimize-session-photos');
  if (btnOptimizeSession) btnOptimizeSession.addEventListener('click', optimizeAllPhotosInActiveFolder);
  
  // Session Renaming
  const btnRenameSession = document.getElementById('btn-rename-session');
  if (btnRenameSession) btnRenameSession.addEventListener('click', openRenameSessionModal);
  const btnCloseRename = document.getElementById('btn-close-rename-modal');
  if (btnCloseRename) btnCloseRename.addEventListener('click', closeRenameSessionModal);
  const btnCancelRename = document.getElementById('btn-cancel-rename');
  if (btnCancelRename) btnCancelRename.addEventListener('click', closeRenameSessionModal);
  const btnConfirmRename = document.getElementById('btn-confirm-rename-action');
  if (btnConfirmRename) btnConfirmRename.addEventListener('click', executeRenameSession);

  const inputNewSession = document.getElementById('input-new-session-name');
  if (inputNewSession) {
    inputNewSession.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeRenameSession();
      } else if (e.key === 'Escape') {
        closeRenameSessionModal();
      }
    });
  }

  // Session Deletion
  document.getElementById('btn-delete-session').addEventListener('click', openDeleteSessionModal);
  document.getElementById('btn-close-delete-modal').addEventListener('click', closeDeleteSessionModal);
  document.getElementById('btn-cancel-delete').addEventListener('click', closeDeleteSessionModal);
  document.getElementById('btn-confirm-delete-action').addEventListener('click', executeDeleteSession);
  
  // Single Photo Deletion
  document.getElementById('btn-close-delete-photo-modal').addEventListener('click', closeDeletePhotoModal);
  document.getElementById('btn-cancel-delete-photo').addEventListener('click', closeDeletePhotoModal);
  document.getElementById('btn-confirm-delete-photo-action').addEventListener('click', executeDeletePhoto);
  
  const deleteModalEl = document.getElementById('modal-delete-photo-confirm');
  if (deleteModalEl) {
    deleteModalEl.addEventListener('click', (e) => {
      if (e.target.id === 'modal-delete-photo-confirm') closeDeletePhotoModal();
    });
  }

  const btnDeleteViewer = document.getElementById('btn-delete-viewer-photo');
  if (btnDeleteViewer) {
    btnDeleteViewer.addEventListener('click', () => {
      const currentName = document.getElementById('viewer-title').innerText;
      if (currentName) {
        openDeletePhotoModal(null, currentName);
      }
    });
  }
  
  // Create New Folder
  document.getElementById('btn-create-folder').addEventListener('click', createNewFolder);
  
  // Batch File Ingestion (OTG & Manual Upload)
  async function processBatchSelectedFiles(filesList) {
    const files = Array.from(filesList || []);
    if (!files.length) return;
    const actEl = document.getElementById('upload-activity-status');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (actEl) actEl.innerText = `⏳ Memasang bingkai (${i + 1}/${files.length}): ${f.name}...`;
      await uploadPhotoWithFrameToGoogleDrive(f);
    }
    if (actEl) actEl.innerText = `✓ Selesai memproses ${files.length} foto!`;
  }

  const manualFileInput = document.getElementById('manual-file-input');
  if (manualFileInput) {
    manualFileInput.addEventListener('change', async (e) => {
      await processBatchSelectedFiles(e.target.files);
      manualFileInput.value = '';
    });
  }

  const otgFolderInput = document.getElementById('otg-folder-input');
  if (otgFolderInput) {
    otgFolderInput.addEventListener('change', async (e) => {
      await processBatchSelectedFiles(e.target.files);
      otgFolderInput.value = '';
    });
  }

  // Trigger Pantau Folder Kamera OTG
  const pickFolderBtn = document.getElementById('btn-pick-folder');
  if (pickFolderBtn) {
    pickFolderBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      // 1. Android APK: Coba Native SAF Folder Picker atau Photo Picker
      if (typeof window.pickNativeFolder === 'function') {
        const handled = await window.pickNativeFolder();
        if (handled) return;
      }
      if (typeof window.pickNativePhotos === 'function') {
        const handled = await window.pickNativePhotos();
        if (handled) return;
      }

      // 2. Desktop Chrome: File System Access API
      if ('showDirectoryPicker' in window) {
        await startFolderWatcher();
        return;
      }

      // 3. Fallback: input file
      const otgInput = document.getElementById('otg-folder-input');
      if (otgInput) otgInput.click();
    });
  }

  // Trigger Upload Manual
  const manualUploadBtn = document.getElementById('btn-manual-upload');
  if (manualUploadBtn) {
    manualUploadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      // 1. Android APK: Panggil Native Photo Picker
      if (typeof window.pickNativePhotos === 'function') {
        const handled = await window.pickNativePhotos();
        if (handled) return;
      }

      // 2. Fallback: input file
      const manualInput = document.getElementById('manual-file-input');
      if (manualInput) manualInput.click();
    });
  }
  
  // Modals
  document.getElementById('btn-open-qr').addEventListener('click', openQRModal);
  document.getElementById('btn-close-qr').addEventListener('click', closeQRModal);
  document.getElementById('btn-open-standee').addEventListener('click', openStandeeModal);
  document.getElementById('btn-close-standee').addEventListener('click', closeStandeeModal);
  document.getElementById('btn-print-standee').addEventListener('click', printStandee);
  document.getElementById('btn-copy-link').addEventListener('click', copyDriveLink);
  const btnEditLink = document.getElementById('btn-edit-session-drive-link');
  if (btnEditLink) btnEditLink.addEventListener('click', editSessionDriveLink);
  
  const tabAll = document.getElementById('tab-qr-all');
  const tabGallery = document.getElementById('tab-qr-gallery');
  const tabGDrive = document.getElementById('tab-qr-gdrive');
  if (tabAll) {
    tabAll.addEventListener('click', () => {
      AppState.qrTarget = 'all';
      localStorage.setItem('piufoto_qr_target', 'all');
      updateActiveFolderQR();
    });
  }
  if (tabGallery) {
    tabGallery.addEventListener('click', () => {
      AppState.qrTarget = 'gallery';
      localStorage.setItem('piufoto_qr_target', 'gallery');
      updateActiveFolderQR();
    });
  }
  if (tabGDrive) {
    tabGDrive.addEventListener('click', () => {
      AppState.qrTarget = 'gdrive';
      localStorage.setItem('piufoto_qr_target', 'gdrive');
      updateActiveFolderQR();
    });
  }
  document.getElementById('btn-close-viewer').addEventListener('click', closePhotoViewer);
  document.getElementById('btn-open-settings').addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettingsModal);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  const btnTestWebhook = document.getElementById('btn-test-webhook');
  if (btnTestWebhook) btnTestWebhook.addEventListener('click', testWebhookConnection);

  const btnTestPublicDomain = document.getElementById('btn-test-public-domain');
  if (btnTestPublicDomain) btnTestPublicDomain.addEventListener('click', testPublicDomainConnection);

  const btnSyncOnlineCloud = document.getElementById('btn-sync-online-cloud');
  if (btnSyncOnlineCloud) btnSyncOnlineCloud.addEventListener('click', syncSessionPhotosToOnline);
  
  // Fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Live Studio Viewfinder & Frame Preview Unified Controls
  const btnToggleCam = document.getElementById('btn-toggle-camera-main');
  if (btnToggleCam) btnToggleCam.addEventListener('click', toggleCameraStream);

  const btnStartCamMain = document.getElementById('btn-start-camera-main');
  if (btnStartCamMain) btnStartCamMain.addEventListener('click', () => initUnifiedCameraStream());

  const btnSnap = document.getElementById('btn-snap-photo');
  if (btnSnap) btnSnap.addEventListener('click', triggerManualSnap);

  const btnFs = document.getElementById('btn-toggle-fullscreen-viewfinder');
  if (btnFs) btnFs.addEventListener('click', toggleViewfinderFullscreen);

  const devSelect = document.getElementById('viewfinder-device-select');
  if (devSelect) {
    devSelect.addEventListener('change', (e) => {
      if (e.target.value) startCameraStream(e.target.value);
    });
  }

  const checkAuto = document.getElementById('check-auto-shutter-detect');
  if (checkAuto) {
    checkAuto.addEventListener('change', (e) => {
      ViewfinderState.autoShutterEnabled = e.target.checked;
      const statusBadge = document.getElementById('hud-status-badge');
      if (statusBadge) {
        if (!e.target.checked) {
          statusBadge.innerText = '⏸ Auto-Shutter: NONAKTIF';
          statusBadge.className = 'hud-tag';
        } else {
          statusBadge.innerText = ViewfinderState.sensitivityMode === 'full_strict' 
            ? '🎯 Full-Shutter Ready' 
            : (ViewfinderState.sensitivityMode === 'balanced' ? '⚖️ Auto-Shutter: Seimbang' : '⚡ Auto-Shutter: Sensitif');
          statusBadge.className = 'hud-tag hud-green';
        }
      }
    });
  }

  const sensitivitySelect = document.getElementById('shutter-sensitivity-select');
  if (sensitivitySelect) {
    const savedSens = localStorage.getItem('piufoto_shutter_sensitivity');
    if (savedSens) {
      ViewfinderState.sensitivityMode = savedSens;
      sensitivitySelect.value = savedSens;
    }
    sensitivitySelect.addEventListener('change', (e) => {
      ViewfinderState.sensitivityMode = e.target.value;
      localStorage.setItem('piufoto_shutter_sensitivity', e.target.value);
      const statusBadge = document.getElementById('hud-status-badge');
      if (statusBadge && ViewfinderState.autoShutterEnabled) {
        statusBadge.innerText = e.target.value === 'full_strict' 
          ? '🎯 Full-Shutter Ready' 
          : (e.target.value === 'balanced' ? '⚖️ Auto-Shutter: Seimbang' : '⚡ Auto-Shutter: Sensitif');
      }
    });
  }

  const cropModeSelect = document.getElementById('camera-crop-mode-select');
  if (cropModeSelect) {
    let savedCrop = localStorage.getItem('piufoto_crop_mode');
    if (!savedCrop || savedCrop === 'clean_crop') {
      savedCrop = 'original';
      localStorage.setItem('piufoto_crop_mode', 'original');
    }
    AppState.cropMode = savedCrop;
    cropModeSelect.value = savedCrop;
    cropModeSelect.addEventListener('change', (e) => {
      AppState.cropMode = e.target.value;
      localStorage.setItem('piufoto_crop_mode', e.target.value);
      renderLiveFramePreview();
    });
  }

  const checkMirror = document.getElementById('check-mirror-cam');
  if (checkMirror) {
    checkMirror.addEventListener('change', (e) => {
      ViewfinderState.isMirrored = e.target.checked;
    });
  }

  // Camera Rotation / Orientation Selector
  const rotationSelect = document.getElementById('camera-rotation-select');
  if (rotationSelect) {
    const savedRot = localStorage.getItem('piufoto_camera_rotation');
    if (savedRot !== null) {
      AppState.cameraRotation = parseInt(savedRot, 10) || 0;
      rotationSelect.value = String(AppState.cameraRotation);
    }
    rotationSelect.addEventListener('change', (e) => {
      AppState.cameraRotation = parseInt(e.target.value, 10) || 0;
      localStorage.setItem('piufoto_camera_rotation', e.target.value);
      renderLiveFramePreview();
    });
  }

  // Shutter Save Delay Selector (1s default)
  const delaySelect = document.getElementById('shutter-delay-select');
  if (delaySelect) {
    const savedDelay = localStorage.getItem('piufoto_shutter_delay');
    if (savedDelay !== null) {
      ViewfinderState.shutterDelayMs = parseInt(savedDelay, 10);
      delaySelect.value = String(ViewfinderState.shutterDelayMs);
    } else {
      ViewfinderState.shutterDelayMs = 1000;
      delaySelect.value = '1000';
    }
    delaySelect.addEventListener('change', (e) => {
      ViewfinderState.shutterDelayMs = parseInt(e.target.value, 10) || 0;
      localStorage.setItem('piufoto_shutter_delay', e.target.value);
    });
  }

  // Rotate Photo in Viewer Modal
  const btnRotateViewer = document.getElementById('btn-rotate-viewer-photo');
  if (btnRotateViewer) {
    btnRotateViewer.addEventListener('click', () => {
      rotateCurrentViewerPhoto(90);
    });
  }


  // Global Keyboard Shortcuts (Space / Enter to snap, Esc to exit fullscreen)
  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      triggerManualSnap();
    } else if (e.code === 'Escape') {
      const card = document.getElementById('unified-live-card');
      if (card && card.classList.contains('fullscreen-mode')) {
        toggleViewfinderFullscreen();
      }
    }
  });

  // Try auto-discovering camera devices on launch
  setTimeout(() => {
    initUnifiedCameraStream(false);
  }, 800);
});

// ==========================================
// 11. UNIFIED LIVE STUDIO VIEWFINDER & FRAME ENGINE
// ==========================================
const ViewfinderState = {
  stream: null,
  videoEl: null,
  canvas: null,
  analysisCanvas: null,
  analysisCtx: null,
  animId: null,
  isActive: false,
  autoShutterEnabled: true,
  isMirrored: false,
  isCountingDown: false,
  
  // Shutter Save Delay in ms (User requested: save 1 second after shutter press)
  shutterDelayMs: parseInt(localStorage.getItem('piufoto_shutter_delay') || '1000', 10),

  // Rolling frame buffer for pre-blackout snapshot (20 frames = 1000ms window)
  frameBuffer: [],
  maxBufferSize: 20,
  lastBufferSaveTime: 0,
  
  // Shutter blackout detection state
  baselineLuma: 80,
  inBlackout: false,
  blackoutConsecutiveFrames: 0,
  blackoutStartTime: 0,
  cooldownUntil: 0,
  
  // Sensitivity profile: 'full_strict' (default, strictly full mechanical shutter), 'balanced', 'sensitive'
  sensitivityMode: 'full_strict',
  
  videoDevices: []
};

function playCountdownBeep(freq = 523) {
  playChime(freq, 0.08);
}

function playShutterClickSound() {
  try {
    if (!AppState.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) AppState.audioCtx = new AudioCtx();
    }
    if (AppState.audioCtx && AppState.audioCtx.state === 'suspended') {
      AppState.audioCtx.resume();
    }
    playChime(1100, 0.03);
    setTimeout(() => playChime(650, 0.05), 35);
  } catch(e) {}
}

function toggleViewfinderFullscreen() {
  const card = document.getElementById('unified-live-card');
  if (!card) return;
  card.classList.toggle('fullscreen-mode');
}

function toggleCameraStream() {
  if (ViewfinderState.isActive) {
    stopCameraStream();
    renderLiveFramePreview();
  } else {
    initUnifiedCameraStream(true);
  }
}

async function initUnifiedCameraStream(userInitiated = false) {
  ViewfinderState.videoEl = document.getElementById('viewfinder-video');
  ViewfinderState.canvas = document.getElementById('live-frame-preview-canvas');

  if (!ViewfinderState.analysisCanvas) {
    ViewfinderState.analysisCanvas = document.createElement('canvas');
    ViewfinderState.analysisCanvas.width = 32;
    ViewfinderState.analysisCanvas.height = 24;
    ViewfinderState.analysisCtx = ViewfinderState.analysisCanvas.getContext('2d', { willReadFrequently: true });
  }

  const select = document.getElementById('viewfinder-device-select');
  if (select) select.innerHTML = '<option value="">Memeriksa perangkat video...</option>';

  try {
    // If user explicitly clicked or permission not granted, request permission
    if (userInitiated) {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(t => t.stop());
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    ViewfinderState.videoDevices = videoInputs;

    if (videoInputs.length === 0) {
      if (select) select.innerHTML = '<option value="">Tidak ada kamera / capture card</option>';
      return;
    }

    if (select) {
      select.innerHTML = '';
      let selectedId = '';

      videoInputs.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        const label = dev.label || `Kamera ${idx + 1}`;
        opt.innerText = label;

        const lower = label.toLowerCase();
        if (lower.includes('capture') || lower.includes('hdmi') || lower.includes('usb video') || lower.includes('cam')) {
          selectedId = dev.deviceId;
        }
        select.appendChild(opt);
      });

      if (!selectedId && videoInputs.length > 0) {
        selectedId = videoInputs[0].deviceId;
      }
      select.value = selectedId;

      if (userInitiated || selectedId) {
        await startCameraStream(selectedId);
      }
    }
  } catch(err) {
    console.warn("Gagal inisialisasi kamera:", err);
    if (userInitiated) {
      alert("Izin kamera belum diberikan atau perangkat belum tercolok.\n\nPastikan USB Capture Card sudah terhubung ke PC/Tablet dan izinkan akses kamera di browser.");
    }
    if (select) select.innerHTML = `<option value="">Izin kamera ditolak / belum aktif</option>`;
  }
}

async function startCameraStream(deviceId) {
  stopCameraStream();

  const constraints = {
    video: deviceId 
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { width: { ideal: 1920 }, height: { ideal: 1080 } }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    ViewfinderState.stream = stream;
    ViewfinderState.videoEl.srcObject = stream;
    ViewfinderState.isActive = true;

    // UI Updates
    const inactiveBanner = document.getElementById('camera-inactive-banner');
    if (inactiveBanner) inactiveBanner.classList.add('hidden');

    const liveIndicator = document.getElementById('main-live-indicator');
    if (liveIndicator) liveIndicator.style.backgroundColor = '#ef4444';

    const btnText = document.getElementById('btn-toggle-camera-text');
    if (btnText) btnText.innerText = '✓ Kamera (Aktif)';

    ViewfinderState.videoEl.onloadedmetadata = () => {
      ViewfinderState.videoEl.play();

      const resBadge = document.getElementById('viewfinder-res-badge');
      if (resBadge) {
        resBadge.style.display = 'inline-block';
        resBadge.innerText = `${ViewfinderState.videoEl.videoWidth}x${ViewfinderState.videoEl.videoHeight}`;
      }
    };

    if (ViewfinderState.animId) cancelAnimationFrame(ViewfinderState.animId);
    ViewfinderState.animId = requestAnimationFrame(runUnifiedLiveLoop);

  } catch(err) {
    console.warn("Gagal start stream:", err);
    stopCameraStream();
    renderLiveFramePreview();
  }
}

function stopCameraStream() {
  if (ViewfinderState.stream) {
    ViewfinderState.stream.getTracks().forEach(t => t.stop());
    ViewfinderState.stream = null;
  }
  if (ViewfinderState.animId) {
    cancelAnimationFrame(ViewfinderState.animId);
    ViewfinderState.animId = null;
  }
  ViewfinderState.isActive = false;
  ViewfinderState.inBlackout = false;

  const inactiveBanner = document.getElementById('camera-inactive-banner');
  if (inactiveBanner) inactiveBanner.classList.remove('hidden');

  const btnText = document.getElementById('btn-toggle-camera-text');
  if (btnText) btnText.innerText = '📹 Sambungkan Kamera';

  const resBadge = document.getElementById('viewfinder-res-badge');
  if (resBadge) resBadge.style.display = 'none';
}

function saveFrameToRollingBuffer(luma = 80) {
  const video = ViewfinderState.videoEl;
  if (!video || video.readyState < 2 || !video.videoWidth) return;
  // NEVER save frame when in blackout or if frame is starting to darken
  if (ViewfinderState.inBlackout || luma < 18) return;
  
  const w = video.videoWidth;
  const h = video.videoHeight;
  
  let item;
  if (ViewfinderState.frameBuffer.length >= ViewfinderState.maxBufferSize) {
    item = ViewfinderState.frameBuffer.shift();
  } else {
    item = { canvas: document.createElement('canvas'), timestamp: 0, luma: 0 };
  }
  
  if (item.canvas.width !== w || item.canvas.height !== h) {
    item.canvas.width = w;
    item.canvas.height = h;
  }
  
  const ctx = item.canvas.getContext('2d');
  if (ViewfinderState.isMirrored) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(video, 0, 0, w, h);
  }
  
  item.timestamp = performance.now();
  item.luma = luma;
  ViewfinderState.frameBuffer.push(item);
}

// Continuous Real-time Loop on the Main Page
function runUnifiedLiveLoop() {
  if (!ViewfinderState.isActive) return;

  const video = ViewfinderState.videoEl;
  const canvas = document.getElementById('live-frame-preview-canvas');

  if (video && video.readyState >= 2 && video.videoWidth > 0 && canvas) {
    const ctx = canvas.getContext('2d');
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Draw Live Camera Feed with Active Frame Template in real time (Supports 0°, 90°, 180°, 270°)
    renderFramedPhotoToContext(
      ctx, canvas, video, vw, vh,
      AppState.cameraRotation, ViewfinderState.isMirrored, AppState.cropMode
    );


    // Downsample 32x24 for Luminance Analysis & Auto Shutter Detection
    const aCtx = ViewfinderState.analysisCtx;
    aCtx.drawImage(video, 0, 0, 32, 24);
    const imgData = aCtx.getImageData(0, 0, 32, 24).data;
    let sumLuma = 0;
    const totalPixels = 32 * 24;
    for (let i = 0; i < imgData.length; i += 4) {
      sumLuma += imgData[i] * 0.299 + imgData[i+1] * 0.587 + imgData[i+2] * 0.114;
    }
    const currentLuma = sumLuma / totalPixels;
    const now = performance.now();

    // Normal healthy frame (maintain rolling buffer and running baseline)
    if (!ViewfinderState.inBlackout && currentLuma > 18) {
      if (now - ViewfinderState.lastBufferSaveTime > 50) {
        ViewfinderState.lastBufferSaveTime = now;
        saveFrameToRollingBuffer(currentLuma);
      }
      ViewfinderState.baselineLuma = ViewfinderState.baselineLuma * 0.95 + currentLuma * 0.05;
    }

    // Auto Shutter Detection calibrated specifically for Camera Mechanical Shutter
    if (ViewfinderState.autoShutterEnabled && !ViewfinderState.isCountingDown && now > ViewfinderState.cooldownUntil) {
      let lumaThreshold = 8.0;
      let minDuration = 80;
      let maxDuration = 700;
      let minConsecutiveFrames = 2;

      if (ViewfinderState.sensitivityMode === 'balanced') {
        lumaThreshold = 12.0;
        minDuration = 65;
        minConsecutiveFrames = 2;
      } else if (ViewfinderState.sensitivityMode === 'sensitive') {
        lumaThreshold = 18.0;
        minDuration = 40;
        minConsecutiveFrames = 1;
      }

      // Check if current frame is a genuine blackout frame
      const isBlackoutFrame = currentLuma <= lumaThreshold || 
        (ViewfinderState.sensitivityMode !== 'full_strict' && ViewfinderState.baselineLuma > 35 && currentLuma < ViewfinderState.baselineLuma * 0.25);

      if (isBlackoutFrame) {
        ViewfinderState.blackoutConsecutiveFrames++;
        if (!ViewfinderState.inBlackout && ViewfinderState.blackoutConsecutiveFrames >= minConsecutiveFrames) {
          ViewfinderState.inBlackout = true;
          ViewfinderState.blackoutStartTime = now;
        }
      } else {
        if (ViewfinderState.inBlackout) {
          const blackoutDuration = now - ViewfinderState.blackoutStartTime;
          ViewfinderState.inBlackout = false;
          ViewfinderState.blackoutConsecutiveFrames = 0;

          // Camera mechanical shutter curtain blackout must satisfy duration range
          if (blackoutDuration >= minDuration && blackoutDuration <= maxDuration) {
            const delayMs = ViewfinderState.shutterDelayMs;
            ViewfinderState.cooldownUntil = now + delayMs + 2400; // prevent double trigger & post-shot review bounce
            
            // Immediate feedback: Shutter audio click & flash animation
            playShutterClickSound();
            const flash = document.getElementById('shutter-flash');
            if (flash) {
              flash.classList.remove('flashing');
              void flash.offsetWidth;
              flash.classList.add('flashing');
            }

            const statusBadge = document.getElementById('hud-status-badge');
            if (statusBadge) {
              statusBadge.innerText = delayMs > 0 ? `📸 SHUTTER DIPENCET! Menyimpan (${(delayMs/1000).toFixed(1)}s)...` : '📸 FULL SHUTTER TERTANGKAP!';
              statusBadge.style.color = '#ff6b95';
            }

            executeUnifiedSnap('camera_shutter', delayMs);
          }
        } else {
          ViewfinderState.blackoutConsecutiveFrames = 0;
        }
      }
    }
  }

  ViewfinderState.animId = requestAnimationFrame(runUnifiedLiveLoop);
}

function triggerManualSnap() {
  if (ViewfinderState.isCountingDown) return;
  
  const timerSelect = document.getElementById('viewfinder-countdown-select');
  const timerSec = timerSelect ? (parseInt(timerSelect.value, 10) || 0) : 0;
  
  if (timerSec === 0) {
    const delayMs = ViewfinderState.shutterDelayMs;
    executeUnifiedSnap('manual', delayMs);
    return;
  }
  
  ViewfinderState.isCountingDown = true;
  let remaining = timerSec;
  const overlay = document.getElementById('viewfinder-countdown-overlay');
  const numSpan = document.getElementById('countdown-number');
  
  if (overlay) overlay.classList.add('active');
  if (numSpan) numSpan.innerText = remaining;
  playCountdownBeep(523);
  
  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      if (numSpan) numSpan.innerText = remaining;
      playCountdownBeep(523);
    } else {
      clearInterval(interval);
      if (overlay) overlay.classList.remove('active');
      ViewfinderState.isCountingDown = false;
      executeUnifiedSnap('manual', 0);
    }
  }, 1000);
}

async function executeUnifiedSnap(triggerSource = 'manual', delayMs = null) {
  const waitMs = (delayMs !== null) ? delayMs : ((triggerSource === 'camera_shutter') ? ViewfinderState.shutterDelayMs : 0);

  // If delay is configured (default 1000ms = 1 detik), wait so exposure finishes, camera shake settles, and display stabilizes
  if (waitMs > 0) {
    const statusBadge = document.getElementById('hud-status-badge');
    if (statusBadge) {
      statusBadge.innerText = `⏳ Menyimpan foto (${(waitMs/1000).toFixed(1)}s)...`;
      statusBadge.style.color = '#f59e0b';
    }
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  // 1. Shutter Flash Animation
  const flash = document.getElementById('shutter-flash');
  if (flash) {
    flash.classList.remove('flashing');
    void flash.offsetWidth;
    flash.classList.add('flashing');
  }

  // 2. Play Audio Click
  playShutterClickSound();

  // 3. Capture Frame:
  // At 1.0 second after shutter is pressed, capture from active live video (which now has the stable exposed shot)
  let captureCanvas;
  if (ViewfinderState.isActive && ViewfinderState.videoEl && ViewfinderState.videoEl.readyState >= 2) {
    const video = ViewfinderState.videoEl;
    captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth || 1920;
    captureCanvas.height = video.videoHeight || 1080;
    const ctx = captureCanvas.getContext('2d');
    if (ViewfinderState.isMirrored) {
      ctx.translate(captureCanvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  }

  // Fail-safe: if the captured canvas at 1s happens to be dark (e.g. camera review screen or dip), wait 250ms and re-sample
  if (captureCanvas && ViewfinderState.isActive && ViewfinderState.videoEl) {
    const testCtx = captureCanvas.getContext('2d');
    const midX = Math.round(captureCanvas.width / 2);
    const midY = Math.round(captureCanvas.height / 2);
    const p = testCtx.getImageData(midX, midY, 1, 1).data;
    const testLuma = p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
    
    if (testLuma < 12) {
      console.warn("Frame saat 1s masih redup (luma=" + testLuma + "). Menunggu kamera stabil 250ms...");
      await new Promise(r => setTimeout(r, 250));
      const video = ViewfinderState.videoEl;
      captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth || 1920;
      captureCanvas.height = video.videoHeight || 1080;
      const ctx = captureCanvas.getContext('2d');
      if (ViewfinderState.isMirrored) {
        ctx.translate(captureCanvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    }
  }

  // Fallback to rolling buffer if still no bright frame
  if (!captureCanvas && ViewfinderState.frameBuffer.length > 0) {
    const brightFrames = ViewfinderState.frameBuffer.filter(f => f.luma >= 20);
    if (brightFrames.length > 0) {
      captureCanvas = brightFrames[brightFrames.length - 1].canvas;
    }
  }

  if (!captureCanvas && AppState.samplePreviewImg) {
    captureCanvas = AppState.samplePreviewImg;
  }

  if (!captureCanvas) return;

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const cleanSession = (AppState.activeFolderDisplayName || AppState.activeFolder).replace(/\s+/g, '_');
  const filename = `${cleanSession}_${timestamp}.jpg`;

  try {
    const framedBase64 = await applyFrameTemplate(captureCanvas);

    // 4. Optimistic Real-time UI update: add directly to photos list!
    const newPhoto = {
      id: `p_${Date.now()}`,
      name: filename,
      url: framedBase64,
      timestamp: Date.now()
    };
    AppState.photos.unshift(newPhoto);
    AppState.lastRenderedPhotosFingerprint = '';
    renderDashboardGrid();

    const totalCountEl = document.getElementById('stat-total-photos');
    const countTagEl = document.getElementById('gallery-photo-count');
    if (totalCountEl) totalCountEl.innerText = AppState.photos.length;
    if (countTagEl) countTagEl.innerText = `${AppState.photos.length} Foto`;

    document.getElementById('upload-activity-status').innerText = `⏳ Menyimpan & upload ${filename}...`;

    // 5. Upload to Server & Google Drive
    const uploadRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: framedBase64,
        filename: filename,
        folder: AppState.activeFolder,
        googleDriveWebhook: AppState.googleDriveWebhook,
        rootFolderName: AppState.googleDriveRootFolder || '',
        parentFolderId: AppState.googleDriveParentFolderId || '',
        ext: 'jpg'
      })
    });

    const uploadData = await uploadRes.json();
    playUploadSuccessSound();

    if (uploadData.gdrive && uploadData.gdrive.ok) {
      document.getElementById('upload-activity-status').innerText = `✓ ${filename} berhasil diunggah ke Google Drive!`;
      if (uploadData.gdrive.folderUrl) {
        AppState.activeFolderDriveUrl = uploadData.gdrive.folderUrl;
        localStorage.setItem(`gdrive_url_${AppState.activeFolder}`, uploadData.gdrive.folderUrl);
        document.getElementById('qr-client-url').innerText = uploadData.gdrive.folderUrl;
        document.getElementById('btn-open-gdrive-folder').href = uploadData.gdrive.folderUrl;
        renderActiveFolderQRCode(uploadData.gdrive.folderUrl);
      }
    } else if (uploadData.gdrive && uploadData.gdrive.status === 'uploading') {
      document.getElementById('upload-activity-status').innerText = `✓ ${filename} tersimpan! (Sinkronisasi Drive di latar belakang...)`;
    } else {
      document.getElementById('upload-activity-status').innerText = `✓ ${filename} tersimpan di galeri lokal!`;
    }

    await fetchFolders();

  } catch (err) {
    console.warn("Gagal proses jepretan:", err);
    document.getElementById('upload-activity-status').innerText = `⚠ Gagal upload: ${err.message}`;
  } finally {
    const statusBadge = document.getElementById('hud-status-badge');
    if (statusBadge) {
      const modeText = ViewfinderState.sensitivityMode === 'full_strict' 
        ? '🎯 Full-Shutter Ready' 
        : (ViewfinderState.sensitivityMode === 'balanced' ? '⚖️ Auto-Shutter: Seimbang' : '⚡ Auto-Shutter: Sensitif');
      statusBadge.innerText = ViewfinderState.autoShutterEnabled ? modeText : '⏸ Auto-Shutter: NONAKTIF';
      statusBadge.style.color = '#34d399';
    }
  }
}

