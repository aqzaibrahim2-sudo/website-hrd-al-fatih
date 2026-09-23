
/* =========================================================
   1. CONFIG & STATE
   ========================================================= */
const GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbx5A0LDMoyqKWxasuXtZrXGWn-BX_8oavCcu_lZoQER1NspjrPgLvzphDQPCR9TJZa9/exec";
const GOOGLE_SHEETS_TIMEOUT_MS = 20000;

let MASTER_PROGRAM = [];
let UPDATE_MINGGUAN = [];
let MASTER_DEPARTEMEN = [];
let MASTER_PIC = [];

let chartStatusInstance = null;
let chartDeptInstance = null;
let syncInProgress = false;
const approvalInProgress = new Set();

/* =========================================================
   2. SYNC WITH GOOGLE SHEETS
   ========================================================= */
function setButtonBusy(button, isBusy, busyLabel = "Memproses...") {
  if (!button) return;
  if (isBusy) {
    button.dataset.originalLabel ??= button.innerHTML;
    button.disabled = true;
    button.classList.add("opacity-60", "cursor-not-allowed");
    button.innerHTML = busyLabel;
  } else {
    button.disabled = false;
    button.classList.remove("opacity-60", "cursor-not-allowed");
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
  }
}

async function requestGoogleSheets(options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), GOOGLE_SHEETS_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
      cache: "no-store",
      redirect: "follow",
      ...options,
      signal: controller.signal
    });
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(`Server mengembalikan HTTP ${response.status}.`);
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      throw new Error("Respons server bukan JSON. Periksa deployment dan izin Apps Script.");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Koneksi ke Google Sheets melewati batas waktu 20 detik.");
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchDataFromGoogleSheets() {
  if (syncInProgress) {
    toast("Sinkronisasi masih berjalan. Mohon tunggu.", true);
    return;
  }

  const syncButton = document.getElementById("syncButton");
  syncInProgress = true;
  setButtonBusy(syncButton, true, "Menyinkronkan...");
  try {
    toast("Menghubungi Google Sheets...");
    const json = await requestGoogleSheets();
    if (!json || typeof json !== "object") {
      throw new Error("Format data dari server tidak valid.");
    }
    if (json.success === false) {
      throw new Error(json.error || "Google Apps Script tidak dapat memuat data.");
    }
    
    MASTER_PROGRAM = json.MASTER_PROGRAM || [];
    UPDATE_MINGGUAN = json.UPDATE_MINGGUAN || [];
    MASTER_DEPARTEMEN = json.MASTER_DEPARTEMEN || [];
    MASTER_PIC = json.MASTER_PIC || [];

    populateFilterOptions();
    populateMasterOptions();
    renderAll();
    toast("Data berhasil disinkronkan.");
  } catch (err) {
    console.error("Error Syncing:", err);
    toast(`Gagal menyinkronkan data: ${err.message}`, true);
  } finally {
    syncInProgress = false;
    setButtonBusy(syncButton, false);
  }
}

async function sendDataToGoogleSheets(sheetName, rowData, action = "APPEND_ROW") {
  try {
    const json = await requestGoogleSheets({
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ sheet: sheetName, data: rowData, action: action })
    });
    if (!json || json.success !== true) {
      return { success: false, error: json?.error || "Server tidak mengonfirmasi penyimpanan data." };
    }
    return json;
  } catch (err) {
    console.error("Error Posting:", err);
    return { success: false, error: err.message };
  }
}

/* =========================================================
   3. AUTO ID & MASTER OPTIONS
   ========================================================= */
function generateAutoID() {
  const jenis = document.getElementById("formJenis") ? document.getElementById("formJenis").value : "Program";
  let prefix = "PRG";
  if (jenis === "Project") prefix = "PRJ";
  if (jenis === "Issue") prefix = "ISU";
  if (jenis === "Task") prefix = "TSK";

  const existingIDs = MASTER_PROGRAM
    .map(p => p.ID_PROGRAM)
    .filter(id => id && id.startsWith(prefix + "-"));

  let maxNum = 0;
  existingIDs.forEach(id => {
    const numPart = parseInt(id.split("-")[1], 10);
    if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
  });

  const nextNum = String(maxNum + 1).padStart(3, "0");
  const autoField = document.getElementById("formAutoID");
  if (autoField) autoField.value = `${prefix}-${nextNum}`;
}

function populateMasterOptions() {
  // Dropdown Departemen di Form
  const deptSelect = document.getElementById("formProgramDept");
  if (deptSelect) {
    deptSelect.innerHTML = '<option value="">-- Pilih Departemen --</option>' +
      MASTER_DEPARTEMEN.map(d => `<option value="${d}">${d}</option>`).join("");
  }

  // Dropdown PIC di Form
  const picSelect = document.getElementById("formProgramPic");
  if (picSelect) {
    picSelect.innerHTML = '<option value="">-- Pilih PIC --</option>' +
      MASTER_PIC.map(p => `<option value="${p}">${p}</option>`).join("");
  }

  // Dropdown Program di Form Update Mingguan
  const updateProgramSelect = document.getElementById("formUpdateProgramSelect");
  if (updateProgramSelect) {
    updateProgramSelect.innerHTML = '<option value="">-- Pilih Program yang Disetujui --</option>' +
      MASTER_PROGRAM.filter(p => p.AKTIF !== false && p.STATUS_APPROVAL === 'Disetujui').map(p => `<option value="${p.ID_PROGRAM}">[${p.ID_PROGRAM}] ${p.NAMA_PROGRAM}</option>`).join("");
  }
}

function populateFilterOptions() {
  const filterDept = document.getElementById("filterDept");
  if (!filterDept) return;
  const curr = filterDept.value;
  filterDept.innerHTML = '<option value="">Semua Dept</option>' +
    MASTER_DEPARTEMEN.map(d => `<option value="${d}">${d}</option>`).join("");
  filterDept.value = curr;
}

/* =========================================================
   4. RENDERERS
   ========================================================= */
function renderStatCards() {
  const active = MASTER_PROGRAM.filter(p => p.AKTIF !== false);
  document.getElementById("statTotal").textContent = active.length;
  document.getElementById("statOnTrack").textContent = active.filter(p => p.STATUS === "On Track").length;
  document.getElementById("statIssue").textContent = active.filter(p => p.STATUS === "Perlu Perhatian" || p.STATUS === "Terlambat").length;
  
  const avg = active.length ? Math.round(active.reduce((s, p) => s + (p.PROGRESS || 0), 0) / active.length) : 0;
  document.getElementById("statAvgProgress").textContent = `${avg}%`;
  document.getElementById("statPendingApproval").textContent = MASTER_PROGRAM.filter(p => p.STATUS_APPROVAL === "Pending").length;
}

function renderNewSubmissionTable() {
  const tbody = document.getElementById("tableNewSubmissionBody");
  if (!tbody) return;
  const submissions = MASTER_PROGRAM.filter(p => p.STATUS_APPROVAL === "Pending");
  if (!submissions.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-stone-400">Tidak ada pengajuan baru yang menunggu approval</td></tr>';
    return;
  }
  tbody.innerHTML = submissions.map(p => `
    <tr class="hover:bg-stone-50 transition">
      <td class="py-3 px-3 font-bold text-stone-900">${p.NAMA_PROGRAM}</td>
      <td class="py-3 px-3 text-stone-600">${p.PIC || '-'}</td>
      <td class="py-3 px-3 text-stone-600">${p.DEPARTEMEN || '-'}</td>
      <td class="py-3 px-3 text-stone-600">${p.TANGGAL_TERBIT || '-'}</td>
    </tr>`).join("");
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  const active = MASTER_PROGRAM.filter(p => p.AKTIF !== false);
  
  // Chart Status
  const statusCounts = { "On Track": 0, "Perlu Perhatian": 0, "Terlambat": 0, "Selesai": 0 };
  active.forEach(p => { if (statusCounts[p.STATUS] !== undefined) statusCounts[p.STATUS]++; });

  const ctxStatus = document.getElementById("chartStatus");
  if (ctxStatus) {
    if (chartStatusInstance) chartStatusInstance.destroy();
    chartStatusInstance = new Chart(ctxStatus, {
      type: "doughnut",
      data: {
        labels: Object.keys(statusCounts),
        datasets: [{
          data: Object.values(statusCounts),
          backgroundColor: ["#2D7A58", "#E5A93C", "#9C3B45", "#0369A1"]
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  }

  // Chart Dept
  const deptData = {};
  active.forEach(p => {
    if (!deptData[p.DEPARTEMEN]) deptData[p.DEPARTEMEN] = { total: 0, count: 0 };
    deptData[p.DEPARTEMEN].total += (p.PROGRESS || 0);
    deptData[p.DEPARTEMEN].count++;
  });

  const deptLabels = Object.keys(deptData);
  const deptAvgs = deptLabels.map(d => Math.round(deptData[d].total / deptData[d].count));

  const ctxDept = document.getElementById("chartDept");
  if (ctxDept) {
    if (chartDeptInstance) chartDeptInstance.destroy();
    chartDeptInstance = new Chart(ctxDept, {
      type: "bar",
      data: {
        labels: deptLabels,
        datasets: [{
          label: "Avg Progress (%)",
          data: deptAvgs,
          backgroundColor: "#D4AF37"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100 } },
        plugins: { legend: { display: false } }
      }
    });
  }
}

function renderProgramTable() {
  const tbody = document.getElementById("tableProgramBody");
  if (!tbody) return;

  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const fDept = document.getElementById("filterDept")?.value || "";
  const fStatus = document.getElementById("filterStatus")?.value || "";

  const filtered = MASTER_PROGRAM.filter(p => {
    if (p.AKTIF === false) return false;
    if (search && !p.NAMA_PROGRAM.toLowerCase().includes(search) && !(p.PIC || "").toLowerCase().includes(search)) return false;
    if (fDept && p.DEPARTEMEN !== fDept) return false;
    if (fStatus && p.STATUS !== fStatus) return false;
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-stone-400">Tidak ada data program ditemukan</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    let badgeClass = "badge-on-track";
    if (p.STATUS === "Perlu Perhatian") badgeClass = "badge-perlu-perhatian";
    if (p.STATUS === "Terlambat") badgeClass = "badge-terlambat";
    if (p.STATUS === "Selesai") badgeClass = "badge-selesai";

    return `
      <tr class="hover:bg-stone-50 transition">
        <td class="py-3 px-3">
          <div class="font-bold text-stone-900">${p.NAMA_PROGRAM}</div>
          <div class="text-[10.5px] font-mono text-stone-400">${p.ID_PROGRAM} · <span class="text-stone-600 font-sans">${p.JENIS || 'Program'}</span></div>
        </td>
        <td class="py-3 px-3">
          <div class="font-medium text-stone-800">${p.DEPARTEMEN}</div>
          <div class="text-[11px] text-stone-500">${p.PIC || '-'}</div>
        </td>
        <td class="py-3 px-3 text-stone-600">${p.TARGET_SELESAI || '-'}</td>
        <td class="py-3 px-3">
          <div class="flex items-center gap-2">
            <div class="w-16 bg-stone-200 h-1.5 rounded-full overflow-hidden">
              <div class="bg-amber-500 h-full" style="width:${p.PROGRESS || 0}%"></div>
            </div>
            <span class="font-bold text-[11.5px]">${p.PROGRESS || 0}%</span>
          </div>
        </td>
        <td class="py-3 px-3"><span class="badge ${badgeClass}">${p.STATUS}</span></td>
        <td class="py-3 px-3 text-right">
          ${p.STATUS_APPROVAL === 'Pending' ? `
            <div class="flex justify-end gap-2">
              <button onclick="approveProgram('${p.ID_PROGRAM}')" class="text-[11px] text-emerald-700 font-semibold hover:underline">Setujui</button>
              <button onclick="rejectProgram('${p.ID_PROGRAM}')" class="text-[11px] text-red-700 font-semibold hover:underline">Tolak</button>
            </div>` : p.STATUS_APPROVAL === 'Ditolak' ? `<span class="text-[11px] text-red-600 font-semibold">Ditolak</span>` : `<button onclick="quickUpdate('${p.ID_PROGRAM}')" class="text-[11px] text-amber-700 font-semibold hover:underline">+ Update</button>`}
        </td>
      </tr>
    `;
  }).join("");
}

function renderUpdateList() {
  const container = document.getElementById("updateList");
  if (!container) return;

  const sorted = [...UPDATE_MINGGUAN].reverse().slice(0, 5);
  if (!sorted.length) {
    container.innerHTML = `<div class="text-center py-4 text-xs text-stone-400">Belum ada catatan update mingguan</div>`;
    return;
  }

  container.innerHTML = sorted.map(u => {
    const prog = MASTER_PROGRAM.find(p => p.ID_PROGRAM === u.ID_PROGRAM);
    return `
      <div class="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 space-y-1">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-stone-800 text-[13px]">${prog ? prog.NAMA_PROGRAM : u.ID_PROGRAM}</div>
          <div class="text-[11px] text-stone-400">${u.TANGGAL_UPDATE}</div>
        </div>
        <div class="text-[12px] text-stone-600">Progress: <b>${u.PROGRESS}%</b> (${u.STATUS})</div>
        ${u.KENDALA ? `<div class="text-[11.5px] text-red-600"><b>Kendala:</b> ${u.KENDALA}</div>` : ''}
        ${u.TARGET_BERIKUTNYA ? `<div class="text-[11.5px] text-stone-500"><b>Rencana:</b> ${u.TARGET_BERIKUTNYA}</div>` : ''}
      </div>
    `;
  }).join("");
}

function renderAll() {
  renderStatCards();
  renderCharts();
  renderNewSubmissionTable();
  renderProgramTable();
  renderUpdateList();
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

/* =========================================================
   5. ACTIONS & HANDLERS
   ========================================================= */
async function handleAddProgram(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  const submitButton = form.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, "Menyimpan...");
  toast("Menyimpan program baru...");
  const res = await sendDataToGoogleSheets("MASTER_PROGRAM", data);

  if (res.success) {
    MASTER_PROGRAM.push({
      ...data,
      PROGRESS: 0,
      STATUS: "On Track",
      AKTIF: true,
      STATUS_APPROVAL: "Pending"
    });
    renderAll();
    closeModal("modalProgram");
    form.reset();
    toast("Program baru berhasil disimpan.");
  } else {
    toast(`Gagal menyimpan program: ${res.error || "terjadi kesalahan."}`, true);
  }
  setButtonBusy(submitButton, false);
}

async function handleAddUpdate(e) {
  e.preventDefault();
  calculateProgramStatus();
  const form = e.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  if (!data.STATUS) {
    toast("Pilih program, tanggal update, dan tahapan progress terlebih dahulu.", true);
    return;
  }

  data.ID_UPDATE = "UPD-" + Date.now();
  data.PROGRESS = parseInt(data.PROGRESS, 10) || 0;

  const submitButton = form.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, "Menyimpan...");
  toast("Mengirim update mingguan...");
  const res = await sendDataToGoogleSheets("UPDATE_MINGGUAN", data);

  if (res.success) {
    UPDATE_MINGGUAN.push(data);
    const prog = MASTER_PROGRAM.find(p => p.ID_PROGRAM === data.ID_PROGRAM);
    if (prog) {
      prog.PROGRESS = data.PROGRESS;
      prog.STATUS = data.STATUS;
    }
    renderAll();
    closeModal("modalUpdate");
    form.reset();
    toast("Update mingguan berhasil dicatat.");
  } else {
    toast(`Gagal mengirim update: ${res.error || "terjadi kesalahan."}`, true);
  }
  setButtonBusy(submitButton, false);
}

function quickUpdate(idProgram) {
  openModal('modalUpdate');
  const sel = document.getElementById("formUpdateProgramSelect");
  if (sel) sel.value = idProgram;
}

function calculateProgramStatus() {
  const programId = document.getElementById('formUpdateProgramSelect')?.value;
  const progress = Number(document.getElementById('formUpdateProgress')?.value);
  const statusField = document.getElementById('formUpdateStatus');
  if (!statusField) return;

  if (!programId || !progress) {
    statusField.value = '';
    return;
  }
  if (progress === 100) {
    statusField.value = 'Selesai';
    return;
  }

  const program = MASTER_PROGRAM.find(p => p.ID_PROGRAM === programId);
  if (!program?.TARGET_SELESAI) {
    statusField.value = 'On Track';
    return;
  }
  const deadline = new Date(`${program.TARGET_SELESAI}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDeadline = Math.round((deadline - today) / 86400000);

  if (daysUntilDeadline < 0) statusField.value = 'Terlambat';
  else if (daysUntilDeadline < 2) statusField.value = 'Perlu Perhatian';
  else statusField.value = 'On Track';
}

async function updateApproval(idProgram, action) {
  if (approvalInProgress.has(idProgram)) {
    toast("Proses approval untuk program ini masih berjalan.", true);
    return;
  }
  approvalInProgress.add(idProgram);
  const label = action === 'APPROVE_PROGRAM' ? 'menyetujui' : 'menolak';
  toast(`Memproses ${label} pengajuan...`);
  const res = await sendDataToGoogleSheets('MASTER_PROGRAM', { ID_PROGRAM: idProgram }, action);
  if (res.success) {
    const program = MASTER_PROGRAM.find(p => p.ID_PROGRAM === idProgram);
    if (program) program.STATUS_APPROVAL = res.status || (action === 'APPROVE_PROGRAM' ? 'Disetujui' : 'Ditolak');
    renderAll();
    toast(`Pengajuan berhasil ${action === 'APPROVE_PROGRAM' ? 'disetujui' : 'ditolak'}.`);
  } else {
    toast(`Gagal memproses approval: ${res.error || 'terjadi kesalahan.'}`, true);
  }
  approvalInProgress.delete(idProgram);
}

function approveProgram(idProgram) { updateApproval(idProgram, 'APPROVE_PROGRAM'); }
function rejectProgram(idProgram) { updateApproval(idProgram, 'REJECT_PROGRAM'); }

function switchView(view) {
  const isDashboard = view === 'dashboard';
  document.getElementById('viewDashboard')?.classList.toggle('hidden', !isDashboard);
  document.getElementById('viewProgram')?.classList.toggle('hidden', isDashboard);
  document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === view));
  document.querySelectorAll('.program-action').forEach(button => button.classList.toggle('hidden', isDashboard));
  document.getElementById('sidebar')?.classList.remove('open');
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("flex");
  
  const today = new Date().toISOString().split('T')[0];
  if (id === 'modalProgram') {
    const tglInput = document.getElementById('formProgramTanggalTerbit');
    if (tglInput) tglInput.value = today;
    generateAutoID();
  }
  if (id === 'modalUpdate') {
    const tglUp = document.getElementById('formUpdateTanggal');
    if (tglUp) tglUp.value = today;
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("flex");
}

function toast(msg, isError = false) {
  const t = document.getElementById("toast");
  const tm = document.getElementById("toastMsg");
  if (!t || !tm) return;
  
  tm.textContent = msg;
  t.style.backgroundColor = isError ? "#9C3B45" : "#0F0F11";
  t.classList.remove("translate-y-10", "opacity-0");
  
  setTimeout(() => {
    t.classList.add("translate-y-10", "opacity-0");
  }, 3000);
}

/* =========================================================
   6. INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }

  fetchDataFromGoogleSheets();

  document.querySelectorAll('[data-nav]').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); switchView(link.dataset.nav); });
  });

  document.getElementById("searchInput")?.addEventListener("input", renderProgramTable);
  document.getElementById("filterDept")?.addEventListener("change", renderProgramTable);
  document.getElementById("filterStatus")?.addEventListener("change", renderProgramTable);

  document.getElementById("menuToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
  });
  document.getElementById("menuClose")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.remove("open");
  });

  const todayLabel = document.getElementById("todayLabel");
  if (todayLabel) {
    todayLabel.textContent = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }

  [...document.querySelectorAll(".modal-backdrop")].forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.classList.add("hidden");
        backdrop.classList.remove("flex");
      }
    });
  });
});

