/**
 * GOOGLE APPS SCRIPT: AUTO-UPLOAD FOTO KE GOOGLE DRIVE PER NAMA SESI
 * Versi: 2.2 (Simpan Langsung ke Google Drive dengan Nama Sesi Saja)
 * 
 * =========================================================================
 * CARA MEMPERBAHARUI KODE DI SCRIPT.GOOGLE.COM (HANYA 1 MENIT):
 * 
 * 1. Buka project Anda di https://script.google.com
 * 2. HAPUS seluruh kode lama di sana, lalu PASTE seluruh kode ini (dari baris 1 s/d selesai).
 * 3. Klik tombol biru "Deploy" di kanan atas -> Pilih "Manage deployments".
 * 4. Klik icon PENSIL (Edit) pada deployment aktif Anda.
 * 5. Pada pilihan "Version", pilih: "New version" (Versi Baru).
 * 6. Pastikan:
 *    - Execute as: "Me" (email Anda)
 *    - Who has access: "Anyone" (Siapa saja)
 * 7. Klik "Deploy".
 * 8. Selesai! Kembali ke aplikasi Piufoto/BerkisahKita dan klik tombol "Test Koneksi".
 * =========================================================================
 */

// 1. (Opsional) Jika Anda ingin SEMUA sesi dikelompokkan ke dalam satu folder induk,
//    tulis nama foldernya di sini. Jika dikosongkan (""), folder akan dibuat LANGSUNG DENGAN NAMA SESI SAJA!
var DEFAULT_ROOT_FOLDER = "";

// 2. (Opsional) Jika Anda ingin menyimpan ke dalam Folder Drive tertentu yang sudah ada:
//    Paste Link atau Folder ID di sini, atau isi di menu Pengaturan aplikasi.
var DEFAULT_PARENT_FOLDER_ID = "";

/**
 * Helper Aman: Mendapatkan atau membuat Folder di Google Drive langsung dengan Nama Sesi
 */
function getOrCreateSessionFolder(sessionFolderName, data) {
  var parentFolder = null;
  
  // 1. Cek apakah ada Parent Folder ID / Link yang diberikan
  var rawFolderId = "";
  if (data && data.parentFolderId && String(data.parentFolderId).trim() !== "") {
    rawFolderId = String(data.parentFolderId).trim();
  } else if (typeof DEFAULT_PARENT_FOLDER_ID !== "undefined" && DEFAULT_PARENT_FOLDER_ID && String(DEFAULT_PARENT_FOLDER_ID).trim() !== "") {
    rawFolderId = String(DEFAULT_PARENT_FOLDER_ID).trim();
  }
  
  if (rawFolderId) {
    var matched = rawFolderId.match(/[-\w]{25,}/);
    var cleanId = matched ? matched[0] : rawFolderId;
    try {
      parentFolder = DriveApp.getFolderById(cleanId);
    } catch(err) {
      Logger.log("Parent Folder ID tidak valid, menggunakan root Drive: " + err.toString());
      parentFolder = null;
    }
  }
  
  // 2. Cek apakah ada Root Folder induk yang diminta user (selain Piufoto_Galeri_Klien lama)
  var rootName = "";
  if (data && data.rootFolderName && String(data.rootFolderName).trim() !== "") {
    rootName = String(data.rootFolderName).trim();
  } else if (typeof DEFAULT_ROOT_FOLDER !== "undefined" && DEFAULT_ROOT_FOLDER && String(DEFAULT_ROOT_FOLDER).trim() !== "") {
    rootName = String(DEFAULT_ROOT_FOLDER).trim();
  }
  
  // Abaikan default lama "Piufoto_Galeri_Klien" agar selalu menyimpan langsung dengan nama sesi saja
  if (rootName === "Piufoto_Galeri_Klien") {
    rootName = "";
  }
  
  if (!parentFolder && rootName) {
    var rootFolders = DriveApp.getFoldersByName(rootName);
    parentFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(rootName);
    try {
      parentFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}
  }
  
  // 3. Buat atau ambil folder dengan NAMA SESI SAJA
  var targetFolder = null;
  if (parentFolder) {
    var subFolders = parentFolder.getFoldersByName(sessionFolderName);
    targetFolder = subFolders.hasNext() ? subFolders.next() : parentFolder.createFolder(sessionFolderName);
  } else {
    // LANGSUNG DI ROOT GOOGLE DRIVE DENGAN NAMA SESI SAJA
    var directFolders = DriveApp.getFoldersByName(sessionFolderName);
    targetFolder = directFolders.hasNext() ? directFolders.next() : DriveApp.createFolder(sessionFolderName);
  }
  
  try {
    targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {}
  
  return targetFolder;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Payload kosong (tidak ada data yang diterima)"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);
    var action = data.action || "upload";
    
    // Nama sesi/folder (contoh: Sesi 01, Sesi 1, Wedding Sarah Dimas, dsb.)
    var sessionFolderName = (data.folderName && String(data.folderName).trim() !== "") 
      ? String(data.folderName).trim() 
      : "Sesi_01";
      
    // Dapatkan folder Google Drive dengan NAMA SESI SAJA
    var targetFolder = getOrCreateSessionFolder(sessionFolderName, data);
    var folderUrl = targetFolder.getUrl();
    
    // Jika hanya membuat folder baru / request URL folder / test ping
    if (action === "create_folder" || !data.image) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        folderName: sessionFolderName,
        folderUrl: folderUrl
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Simpan file foto berbingkai ke dalam folder sesi tersebut
    var base64Data = data.image.indexOf(',') > -1 ? data.image.split(',')[1] : data.image;
    var fileName = data.fileName || (sessionFolderName + "_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd_HHmmss") + ".jpg");
    
    var decodedBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/jpeg", fileName);
    var file = targetFolder.createFile(decodedBlob);
    
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      folderName: sessionFolderName,
      folderUrl: folderUrl,
      fileId: file.getId(),
      fileName: fileName,
      fileViewUrl: file.getUrl(),
      downloadUrl: "https://drive.google.com/uc?export=download&id=" + file.getId()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var sessionFolderName = params.folder || params.folderName || "Sesi_01";
    var targetFolder = getOrCreateSessionFolder(sessionFolderName, params);
    
    try {
      targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "online",
      folderName: sessionFolderName,
      folderUrl: targetFolder.getUrl()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
