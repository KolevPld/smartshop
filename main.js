import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  where,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// --------------------------------------------------
// 🔥 Firebase Config
// --------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyD692ktQboNPavUgo9XiANtaqm-8tUOB6c",
  authDomain: "nonstopapp-c30b1.firebaseapp.com",
  projectId: "nonstopapp-c30b1",
  storageBucket: "nonstopapp-c30b1.firebasestorage.app",
  messagingSenderId: "368870682423",
  appId: "1:368870682423:web:5f0ff3245c07c7796a74b2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --------------------------------------------------
// ⚙️ App Settings (loaded from Firestore)
// --------------------------------------------------
let appSettings = null;
const SETTINGS_REF = doc(db, "settings", "config");

function getStores() {
  return appSettings?.stores?.length
    ? appSettings.stores
    : [{ id: "1", name: "Магазин 1" }];
}
function getOwnerCategories() {
  return (appSettings?.owners || []).map(o => o.name);
}
function getCurrencySymbol() {
  const c = appSettings?.currency || "EUR";
  return c === "EUR" ? "€" : c === "BGN" ? "лв." : "$";
}
function getBusinessName() {
  return appSettings?.businessName || "SmartShop";
}

// --------------------------------------------------
// 👤 Email Login / Register
// --------------------------------------------------
window.registerEmail = async function () {
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value?.trim();

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Регистрация успешна!");
  } catch (err) {
    alert("Грешка при регистрация: " + err.message);
    if (document.getElementById("loginEmail")) document.getElementById("loginEmail").value = "";
    if (document.getElementById("loginPassword")) document.getElementById("loginPassword").value = "";
  }
};

window.loginEmail = async function () {
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value?.trim();

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert("Грешка при вход: " + err.message);
    if (document.getElementById("loginEmail")) document.getElementById("loginEmail").value = "";
    if (document.getElementById("loginPassword")) document.getElementById("loginPassword").value = "";
  }
};

window.logout = function () {
  signOut(auth);
};

// --------------------------------------------------
// 🔄 Глобални променливи
// --------------------------------------------------
let records = [];
let filteredRecords = [];
let chartRef = null;
let editingId = null;
let uploadedImageUrl = "";
let imageRemoved = false;
window.addEventListener("imageUploaded", e => { uploadedImageUrl = e.detail.url; imageRemoved = false; });
window.addEventListener("imageRemoved",  () => { uploadedImageUrl = ""; imageRemoved = true; });

// --------------------------------------------------
// 🔒 LOCK на стари месеци
// --------------------------------------------------
const LOCK_PAST_MONTHS = true;       // ако искаш да го изключиш -> false
const UNLOCK_CODE = "1234";          // смени кода (пример)

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function isLockedDate(dateStr) {
  if (!LOCK_PAST_MONTHS) return false;
  if (!dateStr || typeof dateStr !== "string") return false;
  return dateStr.slice(0, 7) !== currentMonthKey();
}

function requireUnlockIfLocked(dateStr) {
  if (!isLockedDate(dateStr)) return true;

  const code = prompt("🔒 Записът е от друг месец. Въведи код за отключване:");
  if (code !== UNLOCK_CODE) {
    alert("❌ Грешен код. Операцията е отказана.");
    return false;
  }
  return true;
}

// --------------------------------------------------
// 💰 Форматиране на суми
// --------------------------------------------------
function formatMoney(val) {
  return Number(val || 0).toLocaleString("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " " + getCurrencySymbol();
}

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

const statusDiv = document.getElementById("status");

function showStatusMsg(msg, durationMs = 3000) {
  if (!statusDiv) return;
  const prev = statusDiv.textContent;
  statusDiv.textContent = msg;
  setTimeout(() => { statusDiv.textContent = prev; }, durationMs);
}

onAuthStateChanged(auth, async user => {
  const isLoggedIn = !!(user && !user.isAnonymous);

  if (isLoggedIn) {
    if (statusDiv) statusDiv.textContent = "⏳ Зареждане...";
    try {
      const snap = await getDoc(SETTINGS_REF);
      if (snap.exists()) {
        appSettings = snap.data();
        // Case-insensitive email compare; if adminEmail missing → treat as admin
        const adminEmail = (appSettings.adminEmail || "").toLowerCase();
        const isAdmin = !adminEmail || user.email?.toLowerCase() === adminEmail;
        initAppWithSettings(user, isAdmin);
      } else {
        // No settings/config yet — show wizard for first-time setup
        document.getElementById("loginScreen")?.classList.add("hidden");
        document.getElementById("app")?.classList.add("hidden");
        document.getElementById("bottomNav")?.classList.add("hidden");
        showWizard(user);
      }
    } catch(e) {
      console.error("Settings load error:", e);
      // Firestore error (e.g. permission denied) — treat as admin and continue
      initAppWithSettings(user, true);
    }
  } else {
    if (statusDiv) statusDiv.textContent = "🔐 Моля, влез с имейл и парола.";
    document.body.classList.remove("admin");
    appSettings = null;
    document.getElementById("loginScreen")?.classList.remove("hidden");
    document.getElementById("app")?.classList.add("hidden");
    document.getElementById("bottomNav")?.classList.add("hidden");
    document.getElementById("setupWizard")?.classList.add("hidden");
  }
});

function initAppWithSettings(user, isAdmin) {
  if (statusDiv) statusDiv.textContent = `🔓 Влязъл: ${user.email}${isAdmin ? " (админ)" : ""}`;
  document.body.classList.toggle("admin", isAdmin);

  // Update business name in login title (visible if user logs out)
  const loginTitle = document.getElementById("loginTitle");
  if (loginTitle) loginTitle.textContent = getBusinessName();

  renderStorePills();
  renderOwnerCategoryOptions();
  renderFilterStoreOptions();
  renderOwnerButtons();

  document.getElementById("setupWizard")?.classList.add("hidden");
  document.getElementById("loginScreen")?.classList.add("hidden");
  document.getElementById("app")?.classList.remove("hidden");
  document.getElementById("bottomNav")?.classList.remove("hidden");

  window.showScreen?.("add");
  loadRecords();
}

// --------------------------------------------------
// 🔄 Локално обновяване на UI (без Firestore заявка)
// --------------------------------------------------
function refreshUI() {
  const isAdmin = document.body.classList.contains("admin");
  renderRecentList();
  renderRecentTable();
  renderTotalSummaryCards();
  if (isAdmin) {
    renderTable();
    renderChart();
    applyFilters();
    renderLiveBalance();
  }
}

// --------------------------------------------------
// 🔥 FIRESTORE: Зареждане
// --------------------------------------------------
async function loadRecords() {
  // Нулираме евентуална редакция при презареждане
  if (editingId) {
    editingId = null;
    imageRemoved = false;
    clearForm();
    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
      submitBtn.onclick = addRecord;
    }
    document.getElementById("cancelEditBtn")?.classList.add("hidden");
  }

  records = [];

  const q = query(collection(db, "records"), orderBy("date", "desc"));
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    records.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (document.body.classList.contains("admin")) {
    renderTable();
    renderRecentList(); renderRecentTable();
    renderChart();
    applyFilters();
    window.showScreen("add"); document.getElementById("bottomNav")?.classList.remove("hidden");
    renderLiveBalance(); renderTotalSummaryCards();
  } else {
    renderRecentList(); renderRecentTable();
    window.showScreen("add"); document.getElementById("bottomNav")?.classList.remove("hidden");
    renderTotalSummaryCards();
  }
}

// --------------------------------------------------
// 🔥 Добавяне на запис
// --------------------------------------------------
async function addRecord() {
  const date = document.getElementById("date")?.value;
  const type = document.getElementById("type")?.value;
  const method = (document.getElementById("method")?.value || "").split(" ")[0];
  const amount = parseFloat(document.getElementById("amount")?.value);
  const store = document.getElementById("store")?.value;
  const note = (document.getElementById("customNote")?.value || "").trim();

  let category = document.getElementById("category")?.value || "";
  if (category === "custom") {
    category = document.getElementById("customCategory")?.value?.trim() || "";
  } else if (category === "собственик") {
    category = document.getElementById("ownerSubSelect")?.value?.trim() || "";
  }

  if (!date || !type || !method || isNaN(amount) || amount <= 0) {
    return alert("Попълни дата и валидна сума.");
  }
  if (!category) {
    return alert("Въведи категория.");
  }

  const imageUrl = uploadedImageUrl || "";
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const docRef = await addDoc(collection(db, "records"), { date, type, method, amount, note, category, store, imageUrl });
    records.unshift({ id: docRef.id, date, type, method, amount, note, category, store, imageUrl });

    if (getOwnerCategories().includes(category)) {
      try {
        await syncOwnerRecord(docRef.id, { name: category, amount, note, date, type });
      } catch (ownerErr) {
        console.error("Грешка при запис в Собственици:", ownerErr);
        alert("Записът е запазен, но грешка в Собственици: " + ownerErr.message);
      }
    }

    clearForm();
    refreshUI();
    showStatusMsg("✅ Записано!");
  } catch (err) {
    alert("Грешка при запис: " + err.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

window.addRecord = addRecord;

// --------------------------------------------------
// ✏️ Редактиране (ВАЖНО: отваря формата от Отчети)
// --------------------------------------------------
window.editImage = async function (id) {
  const record = records.find(r => r.id === id);
  if (!record) return;
  if (!requireUnlockIfLocked(record.date)) return;

  editingId = id;
  imageRemoved = false;

  // ✅ Отваряме формата (ако сме в отчети)
  window.showScreen("add");

  // ✅ Скрол след като формата стане видима
  requestAnimationFrame(() => {
    document.getElementById("addForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // Попълване на полетата
  document.getElementById("date") && (document.getElementById("date").value = record.date || "");
  document.getElementById("type") && (document.getElementById("type").value = record.type || "");
  document.getElementById("amount") && (document.getElementById("amount").value = record.amount ?? "");
  document.getElementById("store") && (document.getElementById("store").value = record.store || "");

  // Метод
  const methodSelect = document.getElementById("method");
  if (methodSelect) {
    const exact = [...methodSelect.options].find(o => o.value === record.method);
    if (exact) methodSelect.value = exact.value;
    else {
      const partial = [...methodSelect.options].find(o => (o.value || "").startsWith(record.method || ""));
      if (partial) methodSelect.value = partial.value;
    }
  }

  // Категория
  const catSelect = document.getElementById("category");
  const customCatInput = document.getElementById("customCategory");
  const ownerSubSel = document.getElementById("ownerSubSelect");
  if (catSelect && customCatInput) {
    const isOwnerCat = getOwnerCategories().includes(record.category);
    if (isOwnerCat) {
      catSelect.value = "собственик";
      customCatInput.classList.add("hidden");
      customCatInput.value = "";
      if (ownerSubSel) {
        ownerSubSel.value = record.category;
        ownerSubSel.classList.remove("hidden");
      }
    } else if ([...catSelect.options].some(o => o.value === record.category)) {
      catSelect.value = record.category;
      customCatInput.classList.add("hidden");
      customCatInput.value = "";
      ownerSubSel?.classList.add("hidden");
    } else {
      catSelect.value = "custom";
      customCatInput.classList.remove("hidden");
      customCatInput.value = record.category || "";
      ownerSubSel?.classList.add("hidden");
    }
  }

  // Бележка
  const customNoteInput = document.getElementById("customNote");
  if (customNoteInput) customNoteInput.value = record.note || "";

  // Снимка (ако още я ползваш)
  const imagePreview = document.getElementById("imagePreview");
  if (record.imageUrl) {
    uploadedImageUrl = record.imageUrl;
    if (imagePreview) {
      imagePreview.src = uploadedImageUrl;
      imagePreview.classList.remove("hidden");
    }
  } else {
    uploadedImageUrl = "";
    if (imagePreview) {
      imagePreview.src = "";
      imagePreview.classList.add("hidden");
    }
  }

  // Смени бутона "Добави" -> "Запази"
  const submitBtn = document.getElementById("submitBtn");
  if (!submitBtn) {
    alert("Липсва бутонът за запис (id='submitBtn'). Провери HTML.");
    return;
  }

  submitBtn.innerHTML = "💾 Запази промените";
  submitBtn.onclick = saveEditedRecord;
  document.getElementById("cancelEditBtn")?.classList.remove("hidden");
  document.getElementById("addForm")?.classList.add("editing-mode");
};

// --------------------------------------------------
// 💾 Запазване на редакция
// --------------------------------------------------
async function saveEditedRecord() {
  if (!editingId) return;

  const date = document.getElementById("date")?.value;
  const type = document.getElementById("type")?.value;
  const method = (document.getElementById("method")?.value || "").split(" ")[0];
  const amount = parseFloat(document.getElementById("amount")?.value);
  const store = document.getElementById("store")?.value;
  const note = (document.getElementById("customNote")?.value || "").trim();

  let category = document.getElementById("category")?.value || "";
  if (category === "custom") {
    category = document.getElementById("customCategory")?.value?.trim() || "";
  } else if (category === "собственик") {
    category = document.getElementById("ownerSubSelect")?.value?.trim() || "";
  }

  if (!date || !type || !method || isNaN(amount) || amount <= 0) {
    return alert("Попълни дата и валидна сума.");
  }
  if (!category) {
    return alert("Въведи категория.");
  }

  const old = records.find(r => r.id === editingId);
  if (old && !requireUnlockIfLocked(old.date)) return;

  const finalImageUrl = imageRemoved
    ? ""
    : (uploadedImageUrl || (old?.imageUrl || ""));

  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) submitBtn.disabled = true;

  const savedId = editingId;
  const oldCategory = old?.category || "";

  try {
    await updateDoc(doc(db, "records", savedId), { date, type, method, amount, note, category, store, imageUrl: finalImageUrl });

    const idx = records.findIndex(r => r.id === savedId);
    if (idx !== -1) records[idx] = { ...records[idx], date, type, method, amount, note, category, store, imageUrl: finalImageUrl };

    // Синхронизирай собственици
    if (getOwnerCategories().includes(category)) {
      await syncOwnerRecord(savedId, { name: category, amount, note, date, type });
    } else if (getOwnerCategories().includes(oldCategory)) {
      // Категорията е сменена от Митко/Велко → изтрий собственик запис
      await deleteOwnerByLinkedId(savedId);
    }

    editingId = null;
    imageRemoved = false;
    document.getElementById("addForm")?.classList.remove("editing-mode");
    document.getElementById("cancelEditBtn")?.classList.add("hidden");
    clearForm();

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
      submitBtn.onclick = addRecord;
    }

    refreshUI();
    showStatusMsg("✅ Промените са запазени!");
    window.showScreen("add");
  } catch (err) {
    alert("Грешка при запис: " + err.message);
    if (submitBtn) submitBtn.disabled = false;
  }
}

window.saveEditedRecord = saveEditedRecord;

// --------------------------------------------------
// 🗑️ Изтриване
// --------------------------------------------------
async function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec && !requireUnlockIfLocked(rec.date)) return;

  if (!confirm("Сигурен ли си?")) return;

  try {
    await deleteDoc(doc(db, "records", id));
    records = records.filter(r => r.id !== id);
    // Изтрий свързания запис в собственици (ако има)
    await deleteOwnerByLinkedId(id);
    refreshUI();
  } catch (err) {
    alert("Грешка при изтриване: " + err.message);
  }
}
window.deleteRecord = deleteRecord;

// --------------------------------------------------
// 🔗 Синхронизация owners ↔ records
// --------------------------------------------------
// OWNER_CATEGORIES is now dynamic — use getOwnerCategories()

async function syncOwnerRecord(recordId, { name, amount, note, date, type }) {
  const month = date.slice(0, 7);
  const data  = { name, amount, note, date, month, type, linkedRecordId: recordId };
  console.log("syncOwnerRecord →", name, amount, date, type);

  // Търси дали вече има запис с този linkedRecordId
  const q = query(collection(db, "owners"), where("linkedRecordId", "==", recordId));
  const snap = await getDocs(q);

  if (snap.empty) {
    const ref = await addDoc(collection(db, "owners"), { ...data, createdAt: new Date().toISOString() });
    console.log("owners: създаден запис", ref.id);
  } else {
    await updateDoc(doc(db, "owners", snap.docs[0].id), data);
    console.log("owners: обновен запис", snap.docs[0].id);
  }
}

async function deleteOwnerByLinkedId(recordId) {
  const q = query(collection(db, "owners"), where("linkedRecordId", "==", recordId));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    await deleteDoc(doc(db, "owners", d.id));
  }
}

// --------------------------------------------------
// 🧹 Изчистване на формата
// --------------------------------------------------
function clearForm() {
  document.getElementById("date") && (document.getElementById("date").value = "");
  document.getElementById("amount") && (document.getElementById("amount").value = "");

  const noteInput = document.getElementById("customNote"); if (noteInput) noteInput.value = "";

  const categoryInput = document.getElementById("customCategory");
  if (categoryInput) { categoryInput.value = ""; categoryInput.classList.add("hidden"); }

  document.getElementById("category") && (document.getElementById("category").value = "Оборот");
  document.getElementById("ownerSubSelect")?.classList.add("hidden");
  const cn = document.getElementById("customNote"); if (cn) cn.value = "";

  uploadedImageUrl = "";
  imageRemoved = false;
  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview) { imagePreview.src = ""; imagePreview.classList.add("hidden"); }
  document.getElementById("removeImgBtn")?.classList.add("hidden");

  document.getElementById("addForm")?.classList.remove("editing-mode");
}

window.cancelEdit = function () {
  editingId = null;

  clearForm();
  imageRemoved = false;

  document.getElementById("addForm")?.classList.remove("editing-mode");

  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Добави запис';
    submitBtn.onclick = addRecord;
  }

  document.getElementById("cancelEditBtn")?.classList.add("hidden");

  window.showScreen?.("add");
};
// --------------------------------------------------
// 🔄 Филтри
// --------------------------------------------------
// ── Сортиране ─────────────────────────────────────────────────
// Приоритет: Дата DESC → Магазин ASC (М1=1, К.Кеш=2, К.Банка=3) → Тип ASC (Приход=1, Разход=2)
function sortRecords(arr) {
  const storeOrder = { "1": 1, "КасаКеш": 2, "КасаБанка": 3 };
  const typeOrder  = { "Приход": 1, "Разход": 2 };
  return arr.slice().sort((a, b) => {
    const dateCmp = (b.date || "").localeCompare(a.date || "");
    if (dateCmp !== 0) return dateCmp;
    const aStore = effectiveStore(a), bStore = effectiveStore(b);
    const storeCmp = (storeOrder[aStore] ?? 9) - (storeOrder[bStore] ?? 9);
    if (storeCmp !== 0) return storeCmp;
    return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
  });
}

// ── Нормализация ─────────────────────────────────────────────
// Единна нормализация на магазин — ползва се навсякъде
function normStore(s) {
  const raw = String(s ?? "").trim();
  const v   = raw.toLowerCase();
  if (v === "1" || v === "м1" || v === "m1" || v.includes("магазин 1")) return "1";
  if (raw === "КасаКеш"  || v === "касакеш"  || v === "каса кеш")  return "КасаКеш";
  if (raw === "КасаБанка" || v === "касабанка" || v === "каса банка") return "КасаБанка";
  if (v === "каса" || v === "kasa" || v === "cash") return "Каса"; // стари записи
  if (v === "" || v === "null" || v === "undefined") return "";
  return raw;
}

// Ефективен магазин на запис — стара "Каса" се разпределя по метод
function effectiveStore(r) {
  const s = normStore(r.store);
  if (s === "1" || s === "КасаКеш" || s === "КасаБанка") return s;
  // Стара "Каса" или празно → по метод
  return normMethod(r.method) === "Кеш" ? "КасаКеш" : "КасаБанка";
}
function normMethod(m) {
  const v = String(m ?? "").trim().split(/\s+/)[0];
  // Карта и Банка се третират еднакво
  if (v === "Карта") return "Банка";
  return v; // Кеш / Банка
}

// ── Филтри ────────────────────────────────────────────────────
// ВАЖНО: filters обектът е празен — четем DOM при всяко извикване
// защото при зареждане screen-report е hidden и getElementById връща null
const filters = {};

function applyFilters() {
  const type      = document.getElementById("filterType")?.value     ?? "";
  const method    = document.getElementById("filterMethod")?.value   ?? "";
  const category  = document.getElementById("filterCategory")?.value ?? "";
  const startDate = document.getElementById("startDate")?.value      ?? "";
  const endDate   = document.getElementById("endDate")?.value        ?? "";
  const store     = document.getElementById("filterStore")?.value    ?? "";

  filteredRecords = sortRecords(records.filter(r => {
    if (!r) return false;
    const matchType     = !type     || r.type === type;
    const matchMethod   = !method   || normMethod(r.method) === method;
    const matchCategory = !category || (r.category ?? "").trim() === category;
    const matchStart    = !startDate || (r.date ?? "") >= startDate;
    const matchEnd      = !endDate   || (r.date ?? "") <= endDate;
    const matchStore    = !store     || effectiveStore(r) === store;
    return matchType && matchMethod && matchCategory && matchStart && matchEnd && matchStore;
  }));

  renderTable(filteredRecords);
  updateFilterSummary(filteredRecords);
  renderChart();
}

function clearFilters() {
  ["filterType","filterMethod","filterCategory","startDate","endDate","filterStore"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  applyFilters();
}

window.setCurrentMonth = function() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  const sd   = document.getElementById("startDate");
  const ed   = document.getElementById("endDate");
  if (sd) sd.value = `${y}-${m}-01`;
  if (ed) ed.value = `${y}-${m}-${String(last).padStart(2,"0")}`;
  applyFilters();
};

window.applyFilters = applyFilters;
window.clearFilters = clearFilters;

// --------------------------------------------------
// 🏪 Хелпъри за магазин
// --------------------------------------------------
function storeLabel(storeKey) {
  if (storeKey === "КасаКеш")   return "💰 К.Кеш";
  if (storeKey === "КасаБанка") return "🏦 К.Банка";
  const store = getStores().find(s => s.id === storeKey);
  if (store) return `🏪 ${store.name}`;
  return storeKey || "—";
}

function renderStorePills() {
  const stores = getStores();
  const pillRow   = document.getElementById("storePills");
  const storeSel  = document.getElementById("store");
  if (!pillRow || !storeSel) return;

  pillRow.innerHTML = stores.map((s, i) =>
    `<button type="button" class="pill-btn${i === 0 ? ' active' : ''}"
             data-val="${s.id}" onclick="setPill('store','${s.id}',this)">${s.name}</button>`
  ).join('') +
    `<button type="button" class="pill-btn" data-val="КасаКеш"   onclick="setPill('store','КасаКеш',this)">💰 К.Кеш</button>` +
    `<button type="button" class="pill-btn" data-val="КасаБанка" onclick="setPill('store','КасаБанка',this)">🏦 К.Банка</button>`;

  storeSel.innerHTML =
    stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('') +
    `<option value="КасаКеш">Каса Кеш</option>` +
    `<option value="КасаБанка">Каса Банка</option>`;

  if (stores.length > 0) storeSel.value = stores[0].id;
}

function renderOwnerCategoryOptions() {
  const filterCatSel = document.getElementById("filterCategory");
  const ownerSub     = document.getElementById("ownerSubSelect");
  const ownerNames   = getOwnerCategories();

  // Попълни ownerSubSelect с имената на собствениците
  if (ownerSub) {
    ownerSub.innerHTML = ownerNames.length
      ? ownerNames.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')
      : `<option value="">— Няма настроени собственици —</option>`;
  }

  // Добави собствениците към filterCategory за филтриране в Отчети
  if (filterCatSel) {
    filterCatSel.querySelectorAll('.owner-cat-opt').forEach(el => el.remove());
    const drugoOpt = [...filterCatSel.options].find(o => o.value === "Друго");
    ownerNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name; opt.className = 'owner-cat-opt';
      if (drugoOpt) filterCatSel.insertBefore(opt, drugoOpt); else filterCatSel.appendChild(opt);
    });
  }
}

function renderFilterStoreOptions() {
  const sel = document.getElementById("filterStore");
  if (!sel) return;
  const stores = getStores();
  sel.innerHTML =
    `<option value="">Всички магазини</option>` +
    stores.map(s => `<option value="${s.id}">🏪 ${s.name}</option>`).join('') +
    `<option value="КасаКеш">💰 Каса Кеш</option>` +
    `<option value="КасаБанка">🏦 Каса Банка</option>`;
}

function renderOwnerButtons() {
  const segEl = document.getElementById("ownerNameSegment");
  const selEl = document.getElementById("ownerName");
  if (!segEl || !selEl) return;
  const owners = getOwnerCategories();
  if (!owners.length) {
    segEl.innerHTML = '<span style="color:var(--text3);font-size:0.875rem;">Няма настроени собственици</span>';
    selEl.innerHTML = '';
    return;
  }
  segEl.innerHTML = owners.map((name, i) =>
    `<button type="button" class="segment-btn${i === 0 ? ' active' : ''}"
             onclick="ownerSelectBtn('${name}',this)">${name}</button>`
  ).join('');
  selEl.innerHTML = owners.map(name => `<option value="${name}">${name}</option>`).join('');
  selEl.value = owners[0];
}

window.ownerSelectBtn = function(name, btn) {
  document.getElementById("ownerName").value = name;
  btn.closest('.segment').querySelectorAll('.segment-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
};

window.filterByStore = function(store) {
  const el = document.getElementById("filterStore");
  if (!el) return;
  el.value = store;
  applyFilters();
};

// --------------------------------------------------
// 📊 Таблици
// --------------------------------------------------
function renderTable(data = sortRecords(records)) {
  const tbody = document.querySelector("#recordsTable tbody");
  if (!tbody) return;

  const isAdmin = document.body.classList.contains("admin");

  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date || ""}</td>
      <td style="color:${r.type === "Приход" ? "#4caf50" : "#f44336"};">${r.type || ""}</td>
      <td class="money">${formatMoney(r.amount)}</td>
      <td>${r.method || ""}</td>
      <td class="store-cell" data-store="${effectiveStore(r)}" onclick="filterByStore(this.dataset.store)" title="Филтрирай по магазин">${storeLabel(effectiveStore(r))}</td>
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>
      <td style="white-space: nowrap;">
        ${
          r.imageUrl
            ? `<button class="btn-icon btn-photo" type="button" title="Снимка" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>`
            : `<span class="muted">—</span>`
        }
        ${
          isAdmin
            ? `<button class="btn-icon btn-edit" type="button" title="Редакция" onclick="editImage('${r.id}')">✏️</button>
               <button class="btn-icon btn-del" type="button" title="Изтриване" onclick="deleteRecord('${r.id}')">🗑️</button>`
            : ``
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRecentTable() {
  const tbody = document.querySelector("#recentTable tbody");
  if (!tbody) return;

  const isAdmin = document.body.classList.contains("admin");

  tbody.innerHTML = records.slice(0, 5).map(r => `
    <tr>
      <td>${r.date || ""}</td>
      <td style="color:${r.type === "Приход" ? "#4caf50" : "#f44336"};">${r.type || ""}</td>
      <td class="money">${formatMoney(r.amount)}</td>
      <td>${r.method || ""}</td>
      <td>${storeLabel(r.store)}</td>
      <td>${r.category || ""}</td>
      <td>${r.note || ""}</td>

      <td class="actions">
        <div class="actions-wrap">
          ${
            r.imageUrl
              ? `<button class="btn-icon btn-photo" type="button" title="Снимка" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>`
              : `<span class="muted">—</span>`
          }

          ${
            isAdmin
              ? `<button class="btn-icon btn-edit" type="button" title="Редакция" onclick="editImage('${r.id}')">✏️</button>`
              : ``
          }

          ${
            isAdmin
              ? `<button class="btn-icon btn-del" type="button" title="Изтриване" onclick="deleteRecord('${r.id}')">🗑️</button>`
              : ``
          }
        </div>
      </td>
    </tr>
  `).join("");
}

function updateFilterSummary(data) {
  const el = document.getElementById("filterSummary");
  if (!el) return;
  if (!data.length) { el.style.display = "none"; el.innerHTML = ""; return; }

  let totalInc = 0, totalExp = 0;
  data.forEach(r => {
    const a = Number(r.amount || 0);
    if (r.type === "Приход") totalInc += a; else totalExp += a;
  });

  const net = totalInc - totalExp;
  const f   = n => n.toFixed(2) + " " + getCurrencySymbol();
  const cls = n => n >= 0 ? "color:var(--green)" : "color:var(--red)";

  el.style.display = "block";
  el.innerHTML = `<div class="filter-summary-box">
    <div class="fs-header">📊 Резултат — <strong>${data.length}</strong> записа</div>
    <div class="fs-totals">
      <div class="fs-total-item"><span class="fs-label">Приходи</span><span class="fs-value" style="color:var(--green)">${f(totalInc)}</span></div>
      <div class="fs-total-item"><span class="fs-label">Разходи</span><span class="fs-value" style="color:var(--red)">${f(totalExp)}</span></div>
      <div class="fs-total-item"><span class="fs-label">Салдо</span><span class="fs-value" style="${cls(net)};font-size:1.1rem">${f(net)}</span></div>
    </div>
  </div>`;
}

// --------------------------------------------------
// 📈 Обобщения
// --------------------------------------------------


// --------------------------------------------------
// 📊 Chart.js
// --------------------------------------------------
function renderChart() {
  const canvas = document.getElementById("chart");
  if (!canvas || typeof Chart === "undefined") return;

  // Ползваме filteredRecords ако има активни филтри, иначе всички records
  const src = filteredRecords.length > 0 ? filteredRecords : records;

  let totalInc = 0, totalExp = 0;
  src.forEach(r => {
    const a = Number(r.amount || 0);
    if (r.type === "Приход") totalInc += a;
    else if (r.type === "Разход") totalExp += a;
  });

  const saldo = totalInc - totalExp;
  const sym   = getCurrencySymbol();
  const fmt   = n => Number(n).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + sym;
  const total = totalInc + totalExp;
  const incPct = total > 0 ? ((totalInc / total) * 100).toFixed(1) : "0.0";
  const expPct = total > 0 ? ((totalExp / total) * 100).toFixed(1) : "0.0";

  if (chartRef) chartRef.destroy();

  // Plugin за централен текст (салдо)
  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart) {
      const { ctx: c, chartArea: { top, bottom, left, right } } = chart;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const saldoVal = saldo;
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#e2e8f0";
      c.font = "bold 11px sans-serif";
      c.fillText("Салдо", cx, cy - 12);
      c.font = `bold 15px sans-serif`;
      c.fillStyle = saldoVal >= 0 ? "#4ade80" : "#f87171";
      c.fillText(fmt(saldoVal), cx, cy + 6);
      c.restore();
    }
  };

  const ctx = canvas.getContext("2d");
  chartRef = new Chart(ctx, {
    type: "doughnut",
    plugins: [centerTextPlugin],
    data: {
      labels: [`Приходи (${incPct}%)`, `Разходи (${expPct}%)`],
      datasets: [{
        data: [totalInc || 0.001, totalExp || 0.001],
        backgroundColor: ["#4caf50", "#f44336"],
        borderColor: ["#388e3c", "#c62828"],
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        title: {
          display: true,
          text: "Приходи vs Разходи",
          color: "#ffffff",
          font: { size: 14, weight: "bold" },
          padding: { bottom: 10 }
        },
        legend: {
          position: "bottom",
          labels: {
            color: "#ffffff",
            padding: 16,
            font: { size: 13 },
            generateLabels(chart) {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => ({
                text: `${label}  ${fmt(ds.data[i] < 0.01 ? 0 : ds.data[i])}`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.borderColor[i],
                lineWidth: 1,
                index: i
              }));
            }
          }
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.raw < 0.01 ? 0 : ctx.raw;
              return ` ${fmt(val)}`;
            }
          }
        }
      }
    }
  });
}

// --------------------------------------------------
// 🗒️ Бележки и категории
// --------------------------------------------------
function toggleCustomNote() { /* бележката е просто текстово поле */ }
window.toggleCustomNote = toggleCustomNote;

function saveCustomNote(note) {}
function updateNoteOptions() {}

function toggleCustomCategory() {
  const select    = document.getElementById("category");
  const input     = document.getElementById("customCategory");
  const ownerSub  = document.getElementById("ownerSubSelect");
  if (!select || !input) return;

  if (select.value === "custom") {
    input.classList.remove("hidden");
    input.focus();
    ownerSub?.classList.add("hidden");
  } else if (select.value === "собственик") {
    ownerSub?.classList.remove("hidden");
    input.classList.add("hidden");
    input.value = "";
  } else {
    input.classList.add("hidden");
    input.value = "";
    ownerSub?.classList.add("hidden");
  }
}
window.toggleCustomCategory = toggleCustomCategory;


// ════════════════════════════════════════════════
// 🆕 НОВИ ФУНКЦИИ — редизайн 2026-03
// ════════════════════════════════════════════════

// ── showScreen — единна функция (add / report / notes) ────────
window.showScreen = function(screen) {
  const addScreen    = document.getElementById("screen-add");
  const reportScreen = document.getElementById("screen-report");
  const notesScreen  = document.getElementById("screen-notes");
  const ownersScreen = document.getElementById("screen-owners");
  const isAdmin      = document.body.classList.contains("admin");

  addScreen?.classList.add("hidden");
  reportScreen?.classList.add("hidden");
  notesScreen?.classList.add("hidden");
  ownersScreen?.classList.add("hidden");

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  if (screen === "report") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    reportScreen?.classList.remove("hidden");
    document.getElementById('navReports')?.classList.add('active');
    renderLiveBalance(); renderTable();
    renderChart(); applyFilters();

  } else if (screen === "notes") {
    notesScreen?.classList.remove("hidden");
    document.getElementById('navNotes')?.classList.add('active');
    loadTasksRealtime();
    renderTasks();
    checkNotifStatus();

  } else if (screen === "owners") {
    if (!isAdmin) { alert("Нямаш достъп до този екран."); return; }
    ownersScreen?.classList.remove("hidden");
    document.getElementById('navOwners')?.classList.add('active');
    loadOwnersForMonth();

  } else {
    addScreen?.classList.remove("hidden");
    document.getElementById('navAdd')?.classList.add('active');
    renderRecentList(); renderRecentTable();
  }
};

// ── renderRecentList — card-based списък ─────────────────────
function renderRecentList() {
  const container = document.getElementById("recentList");
  if (!container) return;
  const isAdmin = document.body.classList.contains("admin");

  if (!records.length) {
    container.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:0.875rem;">Няма записи</div>`;
    return;
  }

  container.innerHTML = sortRecords(records).slice(0, 10).map(r => {
    const isIncome = r.type === "Приход";
    const sign = isIncome ? "+" : "−";
    const cls  = isIncome ? "income" : "expense";
    const adminBtns = isAdmin
      ? `<div class="record-actions">
          ${r.imageUrl ? `<button class="btn-icon btn-photo" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>` : ''}
          <button class="btn-icon btn-edit" onclick="editImage('${r.id}')">✏️</button>
          <button class="btn-icon btn-del"  onclick="deleteRecord('${r.id}')">🗑️</button>
         </div>`
      : (r.imageUrl ? `<button class="btn-icon btn-photo" data-imgurl="${escHtml(r.imageUrl)}" onclick="openImageModal(this.dataset.imgurl)">📷</button>` : '');

    return `
      <div class="record-row">
        <span class="record-type-dot ${cls}"></span>
        <div class="record-meta">
          <span class="record-date">${r.date || ''} · ${r.method || ''}</span>
          <span class="record-name">${r.category || ''}${r.note ? ' · ' + r.note : ''}</span>
          <span class="record-sub">${storeLabel(effectiveStore(r))}</span>
        </div>
        <div class="record-right">
          <span class="record-amount ${cls}">${sign}${formatMoney(r.amount)}</span>
          ${adminBtns}
        </div>
      </div>`;
  }).join('');
}

// ── renderTotalSummaryCards — 4 stat карти ────────────────────
function renderTotalSummaryCards() {
  const el = document.getElementById("totalSummary");
  if (!el) return;

  const today        = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  let todayInc = 0, todayExp = 0, monthInc = 0, monthExp = 0;

  records.forEach(({ date, type, amount }) => {
    const a = Number(amount || 0);
    const isInc = type === "Приход";
    if (date === today)                        { if (isInc) todayInc += a; else todayExp += a; }
    if ((date || "").startsWith(currentMonth)) { if (isInc) monthInc += a; else monthExp += a; }
  });

  const todaySaldo = todayInc - todayExp;
  const monthSaldo = monthInc - monthExp;
  const f = n => n.toFixed(2) + " " + getCurrencySymbol();

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Днес приход</div>
        <div class="stat-value green">${f(todayInc)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Днес салдо</div>
        <div class="stat-value ${todaySaldo >= 0 ? 'green' : 'red'}">${f(todaySaldo)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Месец приход</div>
        <div class="stat-value">${f(monthInc)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Месец салдо</div>
        <div class="stat-value ${monthSaldo >= 0 ? 'green' : 'red'}">${f(monthSaldo)}</div>
      </div>
    </div>`;
}

// ── renderLiveBalance → renderStoreComparison ─────────────────
function renderLiveBalance() { renderStoreComparison(); }

function renderStoreComparison() {
  const el = document.getElementById("liveBalance");
  if (!el) return;

  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const toDate = (iso) => {
    const p = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return p ? new Date(+p[1], +p[2]-1, +p[3]) : null;
  };

  // По магазин (всички настроени магазини)
  const configStores = getStores();
  const m = {};
  configStores.forEach(s => { m[s.id] = { inc: 0, exp: 0 }; });
  // Каса Кеш = ВСИЧКИ Кеш транзакции (М1 + М2 + стара Каса)
  // Каса Банка = ВСИЧКИ Карта/Банка транзакции
  let kkInc=0, kkExp=0, kbInc=0, kbExp=0;
  // Истинско общо (без двойно броене)
  let tI=0, tE=0;

  records.forEach(r => {
    const amount = Number(r.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = toDate(r.date);
    if (!d || d < monthStart || d >= nextMonth) return;
    const store  = normStore(r.store);
    const isInc  = r.type === "Приход";
    const isKesh = normMethod(r.method) === "Кеш";

    // Общо (всеки запис се брои веднъж)
    if (isInc) tI += amount; else tE += amount;

    // По магазин (всички настроени)
    if (m[store]) {
      if (isInc) m[store].inc += amount; else m[store].exp += amount;
    }

    // Каса Кеш / Каса Банка = по метод, от ВСИЧКИ магазини
    if (isKesh) {
      if (isInc) kkInc += amount; else kkExp += amount;
    } else {
      if (isInc) kbInc += amount; else kbExp += amount;
    }
  });

  const kkS = kkInc - kkExp;
  const kbS = kbInc - kbExp;
  const tS  = tI - tE;

  const f   = n => n.toFixed(2) + " " + getCurrencySymbol();
  const cls = n => n >= 0 ? "pos" : "neg";
  const th  = s => `<th class="sc-th">${s}</th>`;
  const td2 = (v, c) => `<td class="sc-val"><span class="sc-num ${c}">${f(v)}</span></td>`;
  const tdB = (v, c) => `<td class="sc-val"><span class="sc-num-lg ${c}">${f(v)}</span></td>`;

  const mkCard = (title, inc, exp, sal) => `
    <div class="sc-card">
      <div class="sc-card-title">${title}</div>
      <div class="sc-card-row"><span class="sc-card-label">Приходи</span><span class="sc-num pos">${f(inc)}</span></div>
      <div class="sc-card-row"><span class="sc-card-label">Разходи</span><span class="sc-num neg">${f(exp)}</span></div>
      <div class="sc-card-row sc-card-saldo"><span class="sc-card-label"><strong>Салдо</strong></span><span class="sc-num-xl ${cls(sal)}">${f(sal)}</span></div>
    </div>`;

  const storeHeaders = configStores.map(s => th(`🏪 ${s.name}`)).join('');
  const storeIncRow  = configStores.map(s => td2(m[s.id]?.inc || 0, "pos")).join('');
  const storeExpRow  = configStores.map(s => td2(m[s.id]?.exp || 0, "neg")).join('');
  const storeSalRow  = configStores.map(s => { const sal = (m[s.id]?.inc||0)-(m[s.id]?.exp||0); return tdB(sal,cls(sal)); }).join('');
  const storeCards   = configStores.map(s => {
    const sal = (m[s.id]?.inc||0) - (m[s.id]?.exp||0);
    return mkCard(`🏪 ${s.name}`, m[s.id]?.inc||0, m[s.id]?.exp||0, sal);
  }).join('');

  el.innerHTML = `
    <h3><i class="fa-solid fa-scale-balanced"></i> Сравнение — текущ месец</h3>

    <!-- Таблица (десктоп/таблет) -->
    <table class="sc-table">
      <thead>
        <tr>
          <th class="sc-label-th"></th>
          ${storeHeaders}${th("💰 Каса Кеш")}${th("🏦 Каса Банка")}${th("📊 Общо")}
        </tr>
      </thead>
      <tbody>
        <tr class="sc-row">
          <td class="sc-label">Приходи</td>
          ${storeIncRow}${td2(kkInc,"pos")}${td2(kbInc,"pos")}
          <td class="sc-val"><span class="sc-num-lg pos">${f(tI)}</span></td>
        </tr>
        <tr class="sc-row">
          <td class="sc-label">Разходи</td>
          ${storeExpRow}${td2(kkExp,"neg")}${td2(kbExp,"neg")}
          <td class="sc-val"><span class="sc-num-lg neg">${f(tE)}</span></td>
        </tr>
        <tr class="sc-row sc-saldo">
          <td class="sc-label"><strong>Салдо</strong></td>
          ${storeSalRow}${tdB(kkS,cls(kkS))}${tdB(kbS,cls(kbS))}
          <td class="sc-val"><span class="sc-num-xl ${cls(tS)}">${f(tS)}</span></td>
        </tr>
      </tbody>
    </table>

    <!-- Карти (мобилен изглед) -->
    <div class="sc-cards">
      ${storeCards}
      ${mkCard("💰 Каса Кеш",   kkInc, kkExp, kkS)}
      ${mkCard("🏦 Каса Банка", kbInc, kbExp, kbS)}
      ${mkCard("📊 Общо",       tI,    tE,    tS)}
    </div>`;
}

// ── syncPills ─────────────────────────────────────────────────
window.syncPills = function() {
  ['method','store'].forEach(id => {
    const val = document.getElementById(id)?.value;
    if (!val) return;
    document.querySelectorAll(`#${id}Pills .pill-btn`).forEach(b => {
      b.classList.toggle('active', b.dataset.val === val);
    });
  });
};

// ── Бележки — Firebase realtime sync ─────────────────────────
const tasksCol = collection(db, "tasks");
let _tasks      = [];
let _tasksUnsub = null;
let _expandedTasks  = new Set();  // ID-та на разгънати бележки
let _newChecklist   = [];         // [{id, text}] за формата

// ── loadTasksRealtime ─────────────────────────────────────────
function loadTasksRealtime() {
  if (_tasksUnsub) return;
  const q = query(tasksCol, orderBy("createdAt", "desc"));
  _tasksUnsub = onSnapshot(q, snap => {
    _tasks = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    renderTasks();
    scheduleTaskReminders();
  }, err => console.error("tasks snapshot:", err));
}

// ── Checklist builder (форма) ─────────────────────────────────
window.addChecklistField = function() {
  _newChecklist.push({ id: Date.now(), text: '' });
  renderChecklistBuilder();
};
window.removeChecklistField = function(id) {
  _newChecklist = _newChecklist.filter(i => i.id !== id);
  renderChecklistBuilder();
};
window.updateChecklistField = function(id, text) {
  const item = _newChecklist.find(i => i.id === id);
  if (item) item.text = text;
};
function renderChecklistBuilder() {
  const el = document.getElementById('taskChecklistBuilder');
  if (!el) return;
  el.innerHTML = _newChecklist.map(item => `
    <div class="checklist-field-row">
      <input type="text" class="checklist-input" placeholder="Подзадача..."
             oninput="updateChecklistField(${item.id},this.value)">
      <button type="button" class="btn-icon btn-del" onclick="removeChecklistField(${item.id})">✕</button>
    </div>`).join('');
}

// ── addTask ───────────────────────────────────────────────────
window.addTask = async function() {
  const inp  = document.getElementById('taskInput');
  const prio = document.getElementById('taskPriority');
  const due  = document.getElementById('taskDueDate');
  const remD = document.getElementById('taskReminderDate');
  const remT = document.getElementById('taskReminderTime');
  const text = (inp?.value || '').trim();
  if (!text) { inp?.focus(); return; }

  // Прочитаме стойностите ПРЕДИ да изчистваме формата
  const dueDateVal      = due?.value   || null;
  const reminderDateVal = remD?.value  || null;
  const reminderTimeVal = remT?.value  || null;
  const priorityVal     = prio?.value  || 'normal';

  const checklist = _newChecklist
    .filter(i => i.text.trim())
    .map(i => ({ id: String(Date.now() + Math.random()), text: i.text.trim(), done: false }));

  // Директно от DOM ПРЕДИ reset — трябва да видим правилните стойности
  console.log("📋 addTask стойности ПРЕДИ reset:");
  console.log("  dueDate el value:      ", document.getElementById('taskDueDate')?.value);
  console.log("  reminderDate el value: ", document.getElementById('taskReminderDate')?.value);
  console.log("  reminderTime el value: ", document.getElementById('taskReminderTime')?.value);
  console.log("📦 Записани константи:", { dueDateVal, reminderDateVal, reminderTimeVal });

  // Reset form
  inp.value = '';
  if (due)  due.value  = '';
  if (remD) remD.value = '';
  if (remT) remT.value = '';
  _newChecklist = [];
  renderChecklistBuilder();
  inp.focus();

  try {
    await addDoc(tasksCol, {
      text,
      priority:     priorityVal,
      dueDate:      dueDateVal,
      reminderDate: reminderDateVal,
      reminderTime: reminderTimeVal,
      checklist,
      done: false,
      createdAt: Date.now(),
      created: new Date().toLocaleDateString('bg-BG', { day:'2-digit', month:'2-digit', year:'numeric' })
    });
  } catch(e) { console.error("addTask:", e); }
};

// ── toggleTask / deleteTask ───────────────────────────────────
window.toggleTask = async function(firestoreId) {
  const task = _tasks.find(t => t.firestoreId === firestoreId);
  if (!task) return;
  try { await updateDoc(doc(db, "tasks", firestoreId), { done: !task.done }); }
  catch(e) { console.error("toggleTask:", e); }
};

window.deleteTask = async function(firestoreId) {
  try { await deleteDoc(doc(db, "tasks", firestoreId)); }
  catch(e) { console.error("deleteTask:", e); }
};

// ── toggleChecklistItem ───────────────────────────────────────
window.toggleChecklistItem = async function(taskId, itemId) {
  const task = _tasks.find(t => t.firestoreId === taskId);
  if (!task) return;
  const checklist = (task.checklist || []).map(c =>
    c.id === itemId ? { ...c, done: !c.done } : c
  );
  try { await updateDoc(doc(db, "tasks", taskId), { checklist }); }
  catch(e) { console.error("toggleChecklistItem:", e); }
};

// ── toggleTaskExpand ──────────────────────────────────────────
window.toggleTaskExpand = function(id) {
  if (_expandedTasks.has(id)) _expandedTasks.delete(id);
  else _expandedTasks.add(id);
  renderTasks();
};

// ── renderTasks ───────────────────────────────────────────────
function renderTasks() {
  const el    = document.getElementById('taskList');
  const badge = document.getElementById('taskCount');
  if (!el) return;

  const pending = _tasks.filter(t => !t.done).length;
  if (badge) { badge.textContent = pending; badge.className = 'task-badge' + (pending ? '' : ' zero'); }

  if (!_tasks.length) {
    el.innerHTML = '<div class="tasks-empty">Няма бележки — добави първата 👆</div>';
    return;
  }

  // Приоритет: Важно(1) > Нормално(2) > Ниско(3); завършени накрая
  const prioOrder = { high:1, urgent:1, normal:2, low:3, info:3 };
  const dotCls    = { high:'high', urgent:'high', normal:'normal', low:'low', info:'low' };
  const esc       = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const today     = new Date().toISOString().slice(0, 10);

  const sorted = [..._tasks].sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    return (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);
  });

  el.innerHTML = sorted.map(t => {
    const expanded  = _expandedTasks.has(t.firestoreId);
    const checklist = t.checklist || [];
    const clDone    = checklist.filter(c => c.done).length;
    const isOverdue = t.dueDate && t.dueDate < today && !t.done;
    const hasRemind = t.reminderDate && t.reminderTime;

    const clHtml = checklist.length ? `
      <div class="task-checklist${expanded ? '' : ' hidden'}" id="cl-${t.firestoreId}">
        ${checklist.map(c => `
          <div class="task-cl-item${c.done ? ' done' : ''}">
            <div class="task-check small" onclick="toggleChecklistItem('${t.firestoreId}','${c.id}')">${c.done ? '✓' : ''}</div>
            <span class="task-cl-text">${esc(c.text)}</span>
          </div>`).join('')}
      </div>
      <button class="task-expand-btn" onclick="toggleTaskExpand('${t.firestoreId}')">
        ${expanded ? '▲ Скрий' : `▼ ${checklist.length} подзадачи (${clDone}/${checklist.length})`}
      </button>` : '';

    return `
      <div class="task-item${t.done ? ' done' : ''}">
        <div class="task-row-main">
          <div class="task-check" onclick="toggleTask('${t.firestoreId}')">${t.done ? '✓' : ''}</div>
          <span class="task-priority-dot ${dotCls[t.priority] || 'normal'}"></span>
          <div class="task-body">
            <div class="task-text">${esc(t.text)}</div>
            <div class="task-meta">
              ${t.dueDate  ? `<span class="task-due${isOverdue ? ' overdue' : ''}">📅 до ${t.dueDate}</span>` : ''}
              ${hasRemind  ? `<span class="task-reminder">🔔 ${t.reminderDate} ${t.reminderTime}</span>` : ''}
              ${t.created  ? `<span class="task-created">добавено: ${t.created}</span>` : ''}
            </div>
          </div>
          <button class="task-del btn-icon" onclick="deleteTask('${t.firestoreId}')">🗑️</button>
        </div>
        ${clHtml}
      </div>`;
  }).join('');
}

// ── Напомняния за бележки — polling на всяка минута ──────────
// Следим кои вече са изпратени (в рамките на тази сесия + localStorage)
const _firedReminders = new Set(
  JSON.parse(localStorage.getItem('ns_fired_reminders') || '[]')
);

function _reminderKey(t) {
  return `${t.firestoreId}|${t.reminderDate}|${t.reminderTime}`;
}

function checkTaskReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now   = new Date();
  const nowYM = now.toISOString().slice(0, 10);        // "YYYY-MM-DD"
  const nowHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  _tasks.forEach(t => {
    if (t.done || !t.reminderDate || !t.reminderTime) return;
    const key = _reminderKey(t);
    if (_firedReminders.has(key)) return;

    if (t.reminderDate === nowYM && t.reminderTime === nowHM) {
      new Notification(`📝 ${getBusinessName()} — Бележка`, {
        body: t.text,
        icon: 'icon-192.png',
        tag:  key   // предотвратява дублиране на OS ниво
      });
      _firedReminders.add(key);
      // Запази само последните 200 ключа за да не расте без край
      const arr = [..._firedReminders].slice(-200);
      localStorage.setItem('ns_fired_reminders', JSON.stringify(arr));
      console.log('📝 Reminder fired:', t.text);
    }
  });
}

// Стартирай polling веднага при зареждане + на всяка минута
// (синхронизиран с началото на следващата минута за точност)
function startReminderPolling() {
  checkTaskReminders();
  const now   = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    checkTaskReminders();
    setInterval(checkTaskReminders, 60_000);
  }, msToNextMinute);
}
startReminderPolling();

// scheduleTaskReminders остава като no-op за съвместимост
function scheduleTaskReminders() { checkTaskReminders(); }

// ── Тест: изпрати известие за първата бележка с напомняне ────
window.testTaskReminder = function() {
  if (!('Notification' in window)) { alert('Браузърът не поддържа известия.'); return; }
  if (Notification.permission !== 'granted') {
    alert('Известията не са разрешени. Включи ги от превключвателя по-горе.'); return;
  }
  const t = _tasks.find(x => !x.done && x.reminderDate && x.reminderTime);
  const statusEl = document.getElementById('testTaskReminderStatus');
  if (!t) {
    if (statusEl) statusEl.textContent = '⚠️ Няма бележки с напомняне';
    alert('Няма бележки с напомняне за тест.'); return;
  }
  new Notification(`📝 ${getBusinessName()} — Бележка (Тест)`, {
    body: `${t.text} | ${t.reminderDate} ${t.reminderTime}`,
    icon: 'icon-192.png'
  });
  if (statusEl) statusEl.textContent = `✅ Изпратено: „${t.text}"`;
  console.log('testTaskReminder → fired for:', t.text);
};

// ── Push нотификации ──────────────────────────────────────────
function checkNotifStatus() {
  const toggle = document.getElementById('notifToggle');
  const status = document.getElementById('notifStatus');
  if (!toggle || !status) return;
  const on = localStorage.getItem('ns_notif') === '1';
  toggle.checked = on;
  if (!('Notification' in window))          { status.textContent = 'Не се поддържа'; toggle.disabled = true; return; }
  if (Notification.permission === 'denied') { status.textContent = '⛔ Блокирани'; toggle.checked = false; toggle.disabled = true; return; }
  status.textContent = on ? '✅ Включено — 18:00' : 'Изключено';
}

window.toggleNotifications = async function(on) {
  const status = document.getElementById('notifStatus');
  if (on) {
    if (!('Notification' in window)) { document.getElementById('notifToggle').checked = false; return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      status.textContent = '⛔ Отказано';
      document.getElementById('notifToggle').checked = false;
      localStorage.setItem('ns_notif','0'); return;
    }
    localStorage.setItem('ns_notif','1');
    status.textContent = '✅ Включено — 18:00';
    scheduleReminder();
  } else {
    localStorage.setItem('ns_notif','0');
    status.textContent = 'Изключено';
  }
};

window.sendTestNotif = function() {
  if (!('Notification' in window) || Notification.permission !== 'granted') { alert('Разреши известията първо.'); return; }
  new Notification(`🏪 ${getBusinessName()} — Тест`, { body: 'Известията работят!', icon: 'icon-192.png' });
};

function scheduleReminder() {
  const now = new Date(), target = new Date(now);
  target.setHours(18, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  setTimeout(() => {
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = records.some(r => (r.date||'').startsWith(today));
    if (!hasToday && localStorage.getItem('ns_notif') === '1' && Notification.permission === 'granted') {
      new Notification(`🏪 ${getBusinessName()} — Напомняне`, { body: `Няма запис за днес (${today})!`, icon: 'icon-192.png' });
    }
    scheduleReminder();
  }, target - now);
}

if (localStorage.getItem('ns_notif') === '1' && 'Notification' in window && Notification.permission === 'granted') {
  scheduleReminder();
}

// --------------------------------------------------
// 🖨️ Принтиране на филтрираните записи
// --------------------------------------------------
window.printFilteredTable = function() {
  window.print();
};

// --------------------------------------------------
// 📊 Експорт в Excel (SheetJS)
// --------------------------------------------------
window.exportFilteredToExcel = function() {
  if (typeof XLSX === "undefined") {
    alert("Excel библиотеката не е заредена. Провери интернет връзката.");
    return;
  }

  const data = filteredRecords.length ? filteredRecords : records;
  if (!data.length) { alert("Няма записи за експорт."); return; }

  const rows = data.map(r => ({
    "Дата":      r.date     || "",
    "Тип":       r.type     || "",
    "Сума (€)":  parseFloat(r.amount) || 0,
    "Метод":     r.method   || "",
    "Магазин":   storeLabel(effectiveStore(r)),
    "Категория": r.category || "",
    "Бележка":   r.note     || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Ширини на колоните
  ws["!cols"] = [
    { wch: 12 }, // Дата
    { wch: 10 }, // Тип
    { wch: 10 }, // Сума
    { wch: 10 }, // Метод
    { wch: 12 }, // Магазин
    { wch: 16 }, // Категория
    { wch: 30 }, // Бележка
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Отчет");

  // Име на файла с текущия месец от филтъра или текущата дата
  const month = (filteredRecords[0]?.date || new Date().toISOString()).slice(0, 7);
  XLSX.writeFile(wb, `${getBusinessName().replace(/[^\w\u0400-\u04FF]/g,'_')}_Отчет_${month}.xlsx`);
};

// --------------------------------------------------
// 🛡️ Глобален handler за необработени Promise грешки
// --------------------------------------------------
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
});

// ════════════════════════════════════════════════
// 👥 СОБСТВЕНИЦИ
// ════════════════════════════════════════════════

let _ownersMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
let _ownersUnsub = null;

function ownersMonthLabel(ym) {
  const [y, m] = ym.split("-");
  const names = ["Януари","Февруари","Март","Април","Май","Юни",
                  "Юли","Август","Септември","Октомври","Ноември","Декември"];
  return `${names[parseInt(m,10)-1]} ${y}`;
}

function ownersChangeMonth(delta) {
  const [y, m] = _ownersMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  _ownersMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  document.getElementById("ownersMonthLabel").textContent = ownersMonthLabel(_ownersMonth);
  loadOwnersForMonth();
}
window.ownersChangeMonth = ownersChangeMonth;

function loadOwnersForMonth() {
  if (_ownersUnsub) { _ownersUnsub(); _ownersUnsub = null; }

  // Само where без orderBy — избягва изискване за composite index
  const q = query(
    collection(db, "owners"),
    where("month", "==", _ownersMonth)
  );

  document.getElementById("ownersMonthLabel").textContent = ownersMonthLabel(_ownersMonth);

  // Set default date to today (or first day of selected month if navigating past)
  const today = new Date().toISOString().slice(0, 10);
  const todayMonth = today.slice(0, 7);
  const ownerDateEl = document.getElementById("ownerDate");
  if (ownerDateEl && !ownerDateEl.value) {
    ownerDateEl.value = _ownersMonth === todayMonth ? today : _ownersMonth + "-01";
  }

  _ownersUnsub = onSnapshot(q, snap => {
    // Сортираме по дата в JS
    const entries = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    renderOwners(entries);
  }, err => {
    console.error("Owners snapshot error:", err);
  });
}

function renderOwners(entries) {
  const container  = document.getElementById("ownersTablesContainer");
  if (!container) return;
  const ownerNames = getOwnerCategories();
  const fmt = v => (parseFloat(v) || 0).toFixed(2) + " " + getCurrencySymbol();

  if (!ownerNames.length) {
    container.innerHTML = `<div class="card"><p style="text-align:center;padding:20px;color:var(--text2);">Няма настроени собственици.</p></div>`;
    return;
  }

  const typeBadge = t => {
    const isInc = (t || "").toLowerCase().includes("приход");
    return `<span class="owners-type-badge ${isInc ? 'owners-income' : 'owners-expense'}">${t || "—"}</span>`;
  };

  let html = '';
  const allSums = [];

  ownerNames.forEach(ownerName => {
    const arr   = entries.filter(e => e.name === ownerName);
    let inc = 0, exp = 0;
    arr.forEach(e => {
      const a = parseFloat(e.amount) || 0;
      if ((e.type || "").toLowerCase().includes("приход")) inc += a; else exp += a;
    });
    const total = arr.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    allSums.push({ name: ownerName, inc, exp, net: inc - exp, total });

    const dataRows = arr.map(e => `
      <tr>
        <td>${e.date || "—"}</td>
        <td class="mono">${fmt(e.amount)}</td>
        <td>${typeBadge(e.type)}</td>
        <td>${escHtml(e.note || "")}</td>
        <td>${e.linkedRecordId
          ? '<span title="Свързан с Отчети" style="color:var(--text3);font-size:.75rem">🔗</span>'
          : `<button class="btn-danger btn-sm" onclick="deleteOwnerEntry('${e.id}')">🗑️</button>`}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="owners-empty">Няма записи</td></tr>`;

    html += `
      <div class="card owners-table-card">
        <div class="owners-table-title">💼 ${escHtml(ownerName)}</div>
        <div class="table-responsive">
          <table class="owners-table">
            <thead><tr><th>Дата</th><th>Сума</th><th>Тип</th><th>Бележка</th><th></th></tr></thead>
            <tbody>
              ${dataRows}
              <tr class="owners-total-row">
                <td class="owners-total-label">Общо за месеца:</td>
                <td class="mono owners-total-amount">${fmt(total)}</td>
                <td colspan="3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  });

  // Summary table
  const headerCols = allSums.map(s => `<th>${escHtml(s.name)}</th>`).join('');
  const incRow     = allSums.map(s => `<td class="mono income">${fmt(s.inc)}</td>`).join('');
  const expRow     = allSums.map(s => `<td class="mono expense">${fmt(s.exp)}</td>`).join('');
  const netRow     = allSums.map(s =>
    `<td class="mono ${s.net >= 0 ? 'income' : 'expense'}">${s.net >= 0 ? '+' : ''}${fmt(s.net)}</td>`).join('');
  const totRow     = allSums.map(s => `<td class="mono owners-grand-total-amount">${fmt(s.total)}</td>`).join('');

  html += `
    <div class="card owners-table-card">
      <div class="owners-table-title">📊 Обобщение</div>
      <div class="table-responsive">
        <table class="owners-table">
          <thead><tr><th></th>${headerCols}</tr></thead>
          <tbody>
            <tr><td class="owners-summary-label">Приходи</td>${incRow}</tr>
            <tr><td class="owners-summary-label">Разходи</td>${expRow}</tr>
            <tr class="owners-diff-row"><td class="owners-summary-label">Нето</td>${netRow}</tr>
            <tr class="owners-grand-total-row"><td class="owners-summary-label">Общо</td>${totRow}</tr>
          </tbody>
        </table>
      </div>
    </div>`;

  container.innerHTML = html;
}

window.addOwnerEntry = async function() {
  const amount = parseFloat(document.getElementById("ownerAmount").value);
  const name   = document.getElementById("ownerName").value;
  const note   = document.getElementById("ownerNote").value.trim();
  const date   = document.getElementById("ownerDate").value;

  if (!amount || amount <= 0) { alert("Въведи сума!"); return; }
  if (!date)                  { alert("Избери дата!");  return; }

  try {
    await addDoc(collection(db, "owners"), {
      name,
      amount,
      note,
      date,
      month: date.slice(0, 7),
      createdAt: new Date().toISOString()
    });
    document.getElementById("ownerAmount").value = "";
    document.getElementById("ownerNote").value   = "";
  } catch(err) {
    alert("Грешка при запис: " + err.message);
  }
};

window.deleteOwnerEntry = async function(id) {
  if (!confirm("Изтрий този запис?")) return;
  try {
    await deleteDoc(doc(db, "owners", id));
  } catch(err) {
    alert("Грешка при изтриване: " + err.message);
  }
};

// ════════════════════════════════════════════════
// 🧙 SETUP WIZARD
// ════════════════════════════════════════════════
let _wizUser = null;

function showWizard(user) {
  _wizUser = user;
  document.getElementById("setupWizard")?.classList.remove("hidden");
  wizShowStep(1);
}

function wizShowStep(step) {
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`wizStep${i}`)?.classList.toggle("hidden", i !== step);
  }
}

// Skip wizard — use defaults, treat as admin
window.wizSkip = function() {
  if (!_wizUser) return;
  const defaultSettings = {
    businessName: "SmartShop",
    currency: "EUR",
    stores: [{ id: "1", name: "Магазин 1" }],
    owners: [],
    adminEmail: _wizUser.email,
    createdAt: new Date().toISOString()
  };
  setDoc(SETTINGS_REF, defaultSettings).catch(e => console.warn("Settings save:", e));
  appSettings = defaultSettings;
  initAppWithSettings(_wizUser, true);
};

window.wizSelectCurrency = function(currency, btn) {
  document.getElementById("wizCurrency").value = currency;
  btn.closest('.segment').querySelectorAll('.segment-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
};

window.wizNext = function(step) {
  if (step === 1) {
    const name = document.getElementById("wizBusinessName")?.value?.trim();
    if (!name) { alert("Въведи ime на бизнеса!"); return; }
    wizShowStep(2);
  } else if (step === 2) {
    const names = [...document.querySelectorAll('.wiz-store-input')]
      .map(i => i.value.trim()).filter(Boolean);
    if (!names.length) { alert("Добави поне 1 обект!"); return; }
    wizShowStep(3);
  }
};

window.wizBack = function(step) {
  wizShowStep(step - 1);
};

window.wizAddStore = function() {
  const list = document.getElementById("wizStoresList");
  const count = list.querySelectorAll('.wiz-store-input').length;
  if (count >= 5) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'wiz-store-input';
  inp.placeholder = `Напр. Магазин ${count + 1}`;
  inp.maxLength = 30;
  inp.autocomplete = 'off';
  list.appendChild(inp);
  if (count + 1 >= 5) document.getElementById("wizAddStoreBtn")?.classList.add("hidden");
};

window.wizAddOwner = function() {
  const list = document.getElementById("wizOwnersList");
  const count = list.querySelectorAll('.wiz-owner-input').length;
  if (count >= 5) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'wiz-owner-input';
  inp.placeholder = `Напр. Собственик ${count + 1}`;
  inp.maxLength = 30;
  inp.autocomplete = 'off';
  list.appendChild(inp);
  if (count + 1 >= 5) document.getElementById("wizAddOwnerBtn")?.classList.add("hidden");
};

window.wizFinish = async function() {
  const btn = document.getElementById("wizFinishBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Запазване..."; }

  const businessName = document.getElementById("wizBusinessName")?.value?.trim() || "SmartShop";
  const currency     = document.getElementById("wizCurrency")?.value || "BGN";

  const stores = [...document.querySelectorAll('.wiz-store-input')]
    .map((inp, i) => ({ id: String(i + 1), name: inp.value.trim() }))
    .filter(s => s.name);

  const owners = [...document.querySelectorAll('.wiz-owner-input')]
    .map((inp, i) => ({ id: String(i + 1), name: inp.value.trim() }))
    .filter(o => o.name);

  const settings = {
    businessName,
    currency,
    stores: stores.length ? stores : [{ id: "1", name: "Магазин 1" }],
    owners,
    adminEmail: _wizUser.email,
    createdAt: new Date().toISOString()
  };

  try {
    await setDoc(SETTINGS_REF, settings);
    appSettings = settings;
    initAppWithSettings(_wizUser, true);
  } catch(err) {
    alert("Грешка при запазване: " + err.message);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Завърши'; }
  }
};
