var SHEET_NAMES = {
  PROGRAM: "MASTER_PROGRAM",
  UPDATE: "UPDATE_MINGGUAN",
  DEPARTEMEN: "MASTER_DEPARTEMEN",
  PIC: "MASTER_PIC"
};

function doGet(e) {

  if (!isAuthorized_(e)) return unauthorizedResponse_();

  try {
    var scopeRole = String((e && e.parameter && e.parameter.scopeRole) || '').toLowerCase();
    var scopeDepartment = String((e && e.parameter && e.parameter.scopeDepartment) || '').trim();
    if (!['master', 'admin', 'hrd', 'direktur', 'viewer'].includes(scopeRole)) throw new Error('Konteks role tidak valid.');
    if (scopeRole === 'hrd' && !scopeDepartment) throw new Error('Cakupan departemen HRD tidak valid.');
    var ss = getSpreadsheet_();
    var sheetMaster = getRequiredSheet_(ss, SHEET_NAMES.PROGRAM);
    var dataMaster = sheetMaster.getDataRange().getValues();
    var masterProgram = [];

    for (var i = 1; i < dataMaster.length; i++) {
      if (dataMaster[i][0] !== "") {
        masterProgram.push({
          ID_PROGRAM: String(dataMaster[i][0]),
          NAMA_PROGRAM: String(dataMaster[i][1] || ""),
          JENIS: String(dataMaster[i][2] || ""),
          DEPARTEMEN: String(dataMaster[i][3] || ""),
          PIC: String(dataMaster[i][4] || ""),
          TANGGAL_TERBIT: formatDate(dataMaster[i][5]),
          TARGET_SELESAI: formatDate(dataMaster[i][6]),
          PROGRESS: normalizeProgress_(dataMaster[i][7]),
          STATUS: String(dataMaster[i][8] || "On Track"),
          KETERANGAN: String(dataMaster[i][9] || ""),
          STATUS_APPROVAL: String(dataMaster[i][10] || "Pending")
        });
      }
    }

    var updateMingguan = [];
    var sheetUpdate = ss.getSheetByName(SHEET_NAMES.UPDATE);
    if (sheetUpdate) {
      var dataUpdate = sheetUpdate.getDataRange().getValues();
      for (var j = 1; j < dataUpdate.length; j++) {
        if (dataUpdate[j][0] !== "") {
          updateMingguan.push({
            ID_UPDATE: String(dataUpdate[j][0]),
            TANGGAL_UPDATE: formatDate(dataUpdate[j][1]),
            ID_PROGRAM: String(dataUpdate[j][2] || ""),
            PROGRESS: normalizeProgress_(dataUpdate[j][3]),
            KENDALA: String(dataUpdate[j][4] || ""),
            TARGET_SELANJUTNYA: String(dataUpdate[j][5] || ""),
            STATUS: String(dataUpdate[j][6] || "On Track"),
            CATATAN: String(dataUpdate[j][7] || "")
          });
        }
      }
    }

    if (scopeRole === 'hrd') {
      var permittedIds = {};
      masterProgram = masterProgram.filter(function(program) {
        var permitted = String(program.DEPARTEMEN || '').trim() === scopeDepartment;
        if (permitted) permittedIds[String(program.ID_PROGRAM)] = true;
        return permitted;
      });
      updateMingguan = updateMingguan.filter(function(update) {
        return Boolean(permittedIds[String(update.ID_PROGRAM || '')]);
      });
    }

    return json_({
      success: true,
      MASTER_PROGRAM: masterProgram,
      UPDATE_MINGGUAN: updateMingguan,
      MASTER_DEPARTEMEN: scopeRole === 'hrd' ? [scopeDepartment] : getColumnValues(ss, SHEET_NAMES.DEPARTEMEN),
      MASTER_PIC: getColumnValues(ss, SHEET_NAMES.PIC)
    });
  } catch (error) {
    console.error("doGet error: " + error.stack);
    return json_({ success: false, error: "Gagal membaca Google Sheets: " + error.message });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    lock.waitLock(15000);
    hasLock = true;

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Payload permintaan tidak ditemukan.");
    }

    var contents = JSON.parse(e.postData.contents);
    if (!isAuthorized_(e, contents)) return unauthorizedResponse_();
    var action = contents.action || "APPEND_ROW";
    var sheetName = String(contents.sheet || "");
    var data = contents.data || {};
    var accessContext = contents.accessContext || {};
    var scopeRole = String(accessContext.role || '').toLowerCase();
    var scopeDepartment = String(accessContext.departmentName || '').trim();
    if (scopeRole === 'hrd' && !scopeDepartment) throw new Error('Cakupan departemen HRD tidak valid.');
    var ss = getSpreadsheet_();

    if (!['master', 'admin', 'hrd', 'direktur', 'viewer'].includes(scopeRole)) throw new Error('Konteks role tidak valid.');

    if (action === "APPROVE_PROGRAM" || action === "REJECT_PROGRAM") {
      if (scopeRole === 'hrd' || !['master', 'admin', 'direktur'].includes(scopeRole)) {
        throw new Error('Akses approval tidak diizinkan.');
      }
      return processApproval_(ss, data, action);
    }

    if (action !== "APPEND_ROW") {
      throw new Error("Aksi tidak dikenali: " + action);
    }

    if (sheetName === SHEET_NAMES.PROGRAM) {
      if (scopeRole === 'hrd' && String(data.DEPARTEMEN || '').trim() !== scopeDepartment) {
        throw new Error('HRD hanya dapat membuat Program untuk departemennya sendiri.');
      }
      return appendProgram_(ss, data);
    }
    if (sheetName === SHEET_NAMES.UPDATE) {
      if (scopeRole === 'hrd') {
        var scopedProgram = findProgramById_(ss, String(data.ID_PROGRAM || '').trim());
        if (!scopedProgram || String(scopedProgram.DEPARTEMEN || '').trim() !== scopeDepartment) {
          throw new Error('HRD tidak dapat membuat update untuk Program departemen lain.');
        }
      }
      return appendUpdate_(ss, data);
    }

    throw new Error("Sheet tujuan tidak diizinkan: " + sheetName);
  } catch (error) {
    console.error("doPost error: " + error.stack);
    return json_({ success: false, error: error.message || String(error) });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}


function findProgramById_(ss, idProgram) {
  var sheet = getRequiredSheet_(ss, SHEET_NAMES.PROGRAM);
  var row = findRowById_(sheet, idProgram);
  if (row === -1) return null;
  var values = sheet.getRange(row, 1, 1, 11).getDisplayValues()[0];
  return { ID_PROGRAM: String(values[0] || ''), DEPARTEMEN: String(values[3] || '').trim() };
}

function programPrefix_(jenis) {
  var normalized = String(jenis || 'Program').trim().toLowerCase();
  var prefixes = { program: 'PRG', project: 'PRJ', issue: 'ISU', task: 'TSK' };
  if (!prefixes[normalized]) throw new Error('Jenis Program tidak valid.');
  return prefixes[normalized];
}

// Called only from doPost while ScriptLock is held. Reads the global Program sheet,
// so HRD from every department shares one collision-safe sequence per type.
function nextProgramId_(sheet, jenis) {
  var prefix = programPrefix_(jenis);
  var lastRow = sheet.getLastRow();
  var ids = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map(function(row) { return String(row[0] || '').trim(); })
    : [];
  var maxNumber = 0;
  var occupied = {};
  var pattern = new RegExp('^' + prefix + '-(\\d+)$');
  ids.forEach(function(id) {
    occupied[id] = true;
    var match = id.match(pattern);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  });
  var candidateNumber = maxNumber + 1;
  var candidate = prefix + '-' + String(candidateNumber).padStart(3, '0');
  while (occupied[candidate]) {
    candidateNumber += 1;
    candidate = prefix + '-' + String(candidateNumber).padStart(3, '0');
  }
  return candidate;
}

function appendProgram_(ss, data) {
  var sheet = getRequiredSheet_(ss, SHEET_NAMES.PROGRAM);
  // Ignore any client-supplied ID. Server allocates it under the script-wide lock.
  var id = nextProgramId_(sheet, data.JENIS);

  if (findRowById_(sheet, id) !== -1) {
    throw new Error("Nomor Program otomatis bertabrakan. Silakan coba simpan kembali.");
  }

  sheet.appendRow([
    id,
    String(data.NAMA_PROGRAM || ""),
    String(data.JENIS || ""),
    String(data.DEPARTEMEN || ""),
    String(data.PIC || ""),
    String(data.TANGGAL_TERBIT || ""),
    String(data.TARGET_SELESAI || ""),
    0,
    "On Track",
    String(data.KETERANGAN || ""),
    "Pending"
  ]);
  SpreadsheetApp.flush();
  return json_({ success: true, ID_PROGRAM: id, message: "Program berhasil disimpan." });
}

function appendUpdate_(ss, data) {
  var updateSheet = getRequiredSheet_(ss, SHEET_NAMES.UPDATE);
  var masterSheet = getRequiredSheet_(ss, SHEET_NAMES.PROGRAM);
  var idUpdate = requiredText_(data.ID_UPDATE, "ID update");
  var idProgram = requiredText_(data.ID_PROGRAM, "ID program");
  var progress = Number(data.PROGRESS);

  if (!isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error("Progress harus berupa angka antara 0 sampai 100.");
  }
  if (findRowById_(updateSheet, idUpdate) !== -1) {
    throw new Error("ID update sudah pernah disimpan. Hindari mengirim data yang sama dua kali.");
  }

  var masterRow = findRowById_(masterSheet, idProgram);
  if (masterRow === -1) {
    throw new Error("Program " + idProgram + " tidak ditemukan.");
  }

  updateSheet.appendRow([
    idUpdate,
    String(data.TANGGAL_UPDATE || ""),
    idProgram,
    progress / 100,
    String(data.KENDALA || ""),
    String(data.TARGET_SELANJUTNYA || data.TARGET_BERIKUTNYA || ""),
    String(data.STATUS || "On Track"),
    String(data.CATATAN || "")
  ]);
  masterSheet.getRange(masterRow, 8, 1, 2).setValues([[progress / 100, String(data.STATUS || "On Track")]]);
  SpreadsheetApp.flush();
  return json_({ success: true, message: "Update program berhasil disimpan." });
}

function processApproval_(ss, data, action) {
  var masterSheet = getRequiredSheet_(ss, SHEET_NAMES.PROGRAM);
  var idProgram = requiredText_(data.ID_PROGRAM, "ID program");
  var row = findRowById_(masterSheet, idProgram);
  if (row === -1) {
    throw new Error("Program " + idProgram + " tidak ditemukan.");
  }

  var newStatus = action === "APPROVE_PROGRAM" ? "Disetujui" : "Ditolak";
  masterSheet.getRange(row, 11).setValue(newStatus);
  SpreadsheetApp.flush();
  return json_({ success: true, status: newStatus });
}

function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Spreadsheet aktif tidak ditemukan. Pastikan skrip terikat pada spreadsheet yang benar.");
  return ss;
}

function getRequiredSheet_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' tidak ditemukan.");
  return sheet;
}

function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
  }
  return -1;
}

function getColumnValues(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  return data.filter(function(row) { return row[0] !== ""; }).map(function(row) { return String(row[0]); });
}

function requiredText_(value, label) {
  var text = String(value || "").trim();
  if (!text) throw new Error(label + " wajib diisi.");
  return text;
}

function normalizeProgress_(value) {
  var numeric = parseFloat(value);
  if (!isFinite(numeric)) return 0;
  return Math.round(numeric <= 1 ? numeric * 100 : numeric);
}

function formatDate(dateVal) {
  if (!dateVal) return "";
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(dateVal);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAuthorized_(e, contents) {
  var expected = PropertiesService.getScriptProperties()
    .getProperty("APPS_SCRIPT_SHARED_SECRET");
  var received = contents
    ? contents.internalKey
    : (e && e.parameter ? e.parameter.internalKey : "");

  return Boolean(expected && received && expected === received);
}

function unauthorizedResponse_() {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: false,
      error: "Akses langsung ke API tidak diizinkan."
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
