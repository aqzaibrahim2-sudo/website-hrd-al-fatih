
/* =========================================================
   1. CONFIG & STATE
   ========================================================= */
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
    const token = await window.HRDAuth.getAccessToken();
    const response = await fetch('/api/sheets', {
      cache: "no-store",
      redirect: "follow",
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
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
        ${(u.TARGET_SELANJUTNYA || u.TARGET_BERIKUTNYA) ? `<div class="text-[11.5px] text-stone-500"><b>Target selanjutnya:</b> ${u.TARGET_SELANJUTNYA || u.TARGET_BERIKUTNYA}</div>` : ''}
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
  toast("Mengirim update program...");
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
    toast("Update program berhasil dicatat.");
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

function closeMobileSidebar() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebarBackdrop")?.classList.remove("is-visible");
  document.body.classList.remove("sidebar-open");
}

function switchView(view) {
  const isDashboard = view === 'dashboard';
  const isProgram = view === 'program';
  const isUsers = view === 'users';

  document
    .getElementById('viewDashboard')
    ?.classList.toggle('hidden', !isDashboard);

  document
    .getElementById('viewProgram')
    ?.classList.toggle('hidden', !isProgram);

  document
    .getElementById('viewUsers')
    ?.classList.toggle('hidden', !isUsers);

  document
    .querySelectorAll('[data-nav]')
    .forEach(link => {
      link.classList.toggle(
        'active',
        link.dataset.nav === view
      );
    });

  document
    .querySelectorAll('.program-action')
    .forEach(button => {
      button.classList.toggle(
        'hidden',
        !isProgram
      );
    });

  closeMobileSidebar();

  if (isUsers) {
    loadUserManagement();
  }
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

  async function handleAddUser(event) {
  event.preventDefault();

  if (!window.HRDAuth?.isMaster?.()) {
    toast("Hanya MASTER yang dapat menambahkan user.", true);
    return;
  }

  const form = document.getElementById("formAddUser");
  if (!form) return;

  const button = form.querySelector('button[type="submit"]');
  const originalText = button?.innerHTML;

  const fullName = document.getElementById("formAddUserName")?.value.trim();
  const email = document.getElementById("formAddUserEmail")?.value.trim();
  const role = document.getElementById("formAddUserRole")?.value;

  if (!fullName || !email || !role) {
    toast("Nama, email, dan role wajib diisi.", true);
    return;
  }

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Menambahkan...";
    }

    const accessToken = await window.HRDAuth.getAccessToken();

    if (!accessToken) {
      throw new Error("Sesi login tidak ditemukan. Silakan login kembali.");
    }

    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        full_name: fullName,
        email,
        role
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result?.error ||
        result?.message ||
        "Gagal menambahkan user."
      );
    }

    toast("User berhasil ditambahkan.");

    form.reset();

    closeModal("modalAddUser");

    await loadUserManagement();

  } catch (error) {
    console.error("handleAddUser error:", error);
    toast(error.message || "Gagal menambahkan user.", true);

  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalText || "Tambah User";
    }
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
   USER MANAGEMENT — STEP 5A
   ========================================================= */

let userManagementData = [];
let editingUserId = null;

async function handleEditUser(event) {
  event.preventDefault();

  if (!window.HRDAuth?.isMaster?.()) {
    toast("Hanya MASTER yang dapat mengedit user.", true);
    return;
  }

  const form = document.getElementById("formEditUser");
  if (!form || !editingUserId) {
    toast("Data user yang diedit tidak ditemukan.", true);
    return;
  }

  const fullName =
    document.getElementById("formEditUserName")?.value.trim();

  const role =
    document.getElementById("formEditUserRole")?.value;

  if (!fullName || !role) {
    toast("Nama dan role wajib diisi.", true);
    return;
  }

  const button =
    form.querySelector('button[type="submit"]');

  const originalText =
    button?.innerHTML;

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Menyimpan...";
    }

    const accessToken =
      await window.HRDAuth.getAccessToken();

    if (!accessToken) {
      throw new Error(
        "Sesi login tidak ditemukan. Silakan login kembali."
      );
    }

    const response =
      await fetch("/api/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          id: editingUserId,
          full_name: fullName,
          role
        })
      });

    const result =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result?.error ||
        result?.message ||
        "Gagal memperbarui user."
      );
    }

    toast("Data user berhasil diperbarui.");

    form.reset();
    closeModal("modalEditUser");
    editingUserId = null;

    await loadUserManagement();

  } catch (error) {
    console.error("handleEditUser error:", error);
    toast(
      error.message || "Gagal memperbarui user.",
      true
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML =
        originalText || "Simpan Perubahan";
    }
  }
}

function openEditUserModal(userId) {
  if (!window.HRDAuth?.isMaster?.()) {
    toast("Hanya MASTER yang dapat mengedit user.", true);
    return;
  }

  const user =
    userManagementData.find(
      item => item.id === userId
    );

  if (!user) {
    toast("Data user tidak ditemukan.", true);
    return;
  }

  if (user.is_master) {
    toast(
      "Akun MASTER utama tidak dapat diedit melalui website.",
      true
    );
    return;
  }

  editingUserId = user.id;

  const nameInput =
    document.getElementById("formEditUserName");

  const emailInput =
    document.getElementById("formEditUserEmail");

  const roleSelect =
    document.getElementById("formEditUserRole");

  if (!nameInput || !emailInput || !roleSelect) {
    toast("Form edit user tidak ditemukan.", true);
    editingUserId = null;
    return;
  }

  nameInput.value =
    user.full_name || "";

  emailInput.value =
    user.email || "";

  roleSelect.value =
    user.role || "viewer";

  openModal("modalEditUser");
}

async function loadUserManagement() {
  const tbody = document.getElementById('tableUsersBody');

  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="py-8 text-center text-stone-400">
        Memuat data user...
      </td>
    </tr>
  `;

  try {
    const token =
      await window.HRDAuth.getAccessToken();

    const response = await fetch('/api/users', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload =
      await response.json();

    if (!response.ok) {
      throw new Error(
        payload.error ||
        'Gagal mengambil daftar user.'
      );
    }

    userManagementData =
      Array.isArray(payload.users)
        ? payload.users
        : [];

    renderUserTable();

  } catch (error) {

    console.error(
      'User management error:',
      error
    );

    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-red-500">
          ${escapeHtml(
            error.message ||
            'Gagal memuat data user.'
          )}
        </td>
      </tr>
    `;
  }
}


function renderUserTable() {
  const tbody =
    document.getElementById('tableUsersBody');

  if (!tbody) return;

  const search =
    (
      document.getElementById(
        'userSearchInput'
      )?.value || ''
    )
      .trim()
      .toLowerCase();

  const filtered =
    userManagementData.filter(user => {

      const name =
        String(user.full_name || '')
          .toLowerCase();

      const email =
        String(user.email || '')
          .toLowerCase();

      return (
        !search ||
        name.includes(search) ||
        email.includes(search)
      );
    });


  if (!filtered.length) {

    tbody.innerHTML = `
      <tr>
        <td
          colspan="6"
          class="py-8 text-center text-stone-400"
        >
          Tidak ada user yang ditemukan.
        </td>
      </tr>
    `;

    return;
  }


  tbody.innerHTML =
    filtered.map(user => {

      const role =
        String(user.role || 'viewer')
          .toUpperCase();

      const status =
        user.is_active !== false
          ? 'Aktif'
          : 'Nonaktif';

      const statusClass =
        user.is_active !== false
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-red-50 text-red-700';

      const lastLogin =
        user.last_sign_in_at
          ? formatUserDate(
              user.last_sign_in_at
            )
          : 'Belum login';

      const name =
        user.full_name ||
        user.email ||
        '-';

      const masterBadge =
        user.is_master
          ? `
            <span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
              MASTER
            </span>
          `
          : '';


      return `
        <tr class="hover:bg-stone-50">

          <td class="py-3 px-3 font-medium text-stone-800">
            ${escapeHtml(name)}
            ${masterBadge}
          </td>

          <td class="py-3 px-3 text-stone-600">
            ${escapeHtml(user.email || '-')}
          </td>

          <td class="py-3 px-3">
            <span class="text-[10px] font-semibold uppercase px-2 py-1 rounded bg-stone-100 text-stone-700">
              ${escapeHtml(role)}
            </span>
          </td>

          <td class="py-3 px-3">
            <span class="text-[10px] font-semibold px-2 py-1 rounded ${statusClass}">
              ${status}
            </span>
          </td>

          <td class="py-3 px-3 text-stone-500">
            ${escapeHtml(lastLogin)}
          </td>

          <td class="py-3 px-3 text-right">
            ${
              user.is_master
                ? `
                  <span class="text-[10px] text-stone-400">
                    Akun utama
                  </span>
                `
                : `
                  <button
                    type="button"
                    class="buttonEditUser inline-flex items-center gap-1 text-[11px] text-amber-700 font-semibold hover:underline"
                    data-user-id="${escapeHtml(user.id)}"
                    title="Edit user"
                  >
                    <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                    Edit
                  </button>
                `
            }
          </td>

        </tr>
      `;

    }).join('');


  if (
    window.lucide &&
    typeof lucide.createIcons === 'function'
  ) {
    lucide.createIcons();
  }
}


function formatUserDate(value) {
  const date =
    new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString(
    'id-ID',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  );
}


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}



/* =========================================================
   6. INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }

  try {
  const account =
    await window.HRDAuth.ready;

  fetchDataFromGoogleSheets();

  const userManagementNav =
    document.getElementById(
      'navUserManagement'
    );

  if (
    userManagementNav &&
    account?.profile?.is_master === true
  ) {
    userManagementNav.classList.remove(
      'hidden'
    );
  }

} catch {
  return;
}

  document.querySelectorAll('[data-nav]').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); switchView(link.dataset.nav); });
  });

  document.getElementById("searchInput")?.addEventListener("input", renderProgramTable);
  document.getElementById("filterDept")?.addEventListener("change", renderProgramTable);
  document.getElementById("filterStatus")?.addEventListener("change", renderProgramTable);

  document.getElementById("menuToggle")?.addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    const isOpening = !sidebar?.classList.contains("open");
    sidebar?.classList.toggle("open", isOpening);
    document.getElementById("sidebarBackdrop")?.classList.toggle("is-visible", isOpening);
    document.body.classList.toggle("sidebar-open", isOpening);
  });
  document.getElementById("menuClose")?.addEventListener("click", closeMobileSidebar);
  document.getElementById("sidebarBackdrop")?.addEventListener("click", closeMobileSidebar);
  
  document.getElementById('userSearchInput')?.addEventListener('input',
    renderUserTable
  );

  document.getElementById('tableUsersBody')?.addEventListener('click', (event) => {
    const button = event.target.closest('.buttonEditUser');
    if (!button) return;

    openEditUserModal(button.dataset.userId);
  });

  document.getElementById('buttonAddUser')?.addEventListener('click', () => {
  if (!window.HRDAuth?.isMaster?.()) {
    toast("Hanya MASTER yang dapat menambahkan user.", true);
    return;
  }

  const form = document.getElementById('formAddUser');
  form?.reset();

  openModal('modalAddUser');
  });

  document.getElementById("formAddUser")?.addEventListener(
  "submit",
  handleAddUser
  );

  document.getElementById("formEditUser")?.addEventListener(
    "submit",
    handleEditUser
  );

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
