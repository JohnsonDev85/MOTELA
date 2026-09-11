/* =========================================================
   MOTELA INVESTIMENT - Mfumo wa Usimamizi
   Mtumiaji mmoja anaendesha kila kitu (hakuna Manager/Sales Person)
   ========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyDpb22tIKwWhl0AUMGYp0neAQOqj_V_o8w",
  authDomain: "motela.firebaseapp.com",
  databaseURL: "https://motela-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "motela",
  storageBucket: "motela.firebasestorage.app",
  messagingSenderId: "345086281822",
  appId: "1:345086281822:web:98b927a156509343bfcccf"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentUserName = "";
let productsCache = [];
let categoriesCache = [];     // {id, name}
let houseTypesCache = [];     // {id, name, rate}
let currentPeriod = "quarterly";

/* ---------------- HELPERS ---------------- */
function fmtMoney(n) {
  return "Tsh " + Number(n || 0).toLocaleString("en-US");
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + type;
  setTimeout(() => t.classList.add("hidden"), 3000);
}
function daysAgoStr(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
// Kokotoa tarehe ambayo kodi mpya inatakiwa kuanza:
// tarehe ya malipo + idadi ya miezi aliyolipia + siku 1
function computeExpectedDueDate(paymentDateStr, months) {
  const d = new Date(paymentDateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------- AUTH (Anonymous + Username/Password lookup) ----------------
   Mfumo huu ni wa mtumiaji mmoja (mmiliki wa biashara) - hakuna tena
   "role" ya manager/salesperson. Document ndani ya motela_users inahitaji
   tu fields: username, password, name (hiari).
   ---------------------------------------------------------------- */
let currentUsername = null;
const SESSION_KEY = "motela_session";

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const pass = document.getElementById("loginPassword").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }
    const snap = await db.collection("motela_users")
      .where("username", "==", username).limit(1).get();
    if (snap.empty) {
      errEl.textContent = "Jina la mtumiaji halipo.";
      return;
    }
    const userDoc = snap.docs[0];
    const data = userDoc.data();
    if (data.password !== pass) {
      errEl.textContent = "Password si sahihi.";
      return;
    }
    const session = { username: data.username, name: data.name };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    applySession(session);
  } catch (err) {
    errEl.textContent = "Hitilafu: " + err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  currentUsername = null;
  auth.signOut();
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
});

function applySession(session) {
  currentUsername = session.username;
  currentUserName = session.name || session.username || "Mtumiaji";

  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("userNameDisplay").textContent = currentUserName;
  document.getElementById("mainDashboard").classList.remove("hidden");

  initDashboard();
}

auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  currentUser = user;
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      applySession(JSON.parse(saved));
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
  }
});

if (!auth.currentUser) {
  auth.signInAnonymously().catch(() => {});
}

/* ---------------- TABS ---------------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "summaryTab") loadSummary();
  });
});

/* =========================================================
   MAIN DASHBOARD INIT
   ========================================================= */
let dashboardInitialized = false;
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  listenCategories();
  listenHouseTypes();
  listenProducts();
  listenSales();
  listenRealEstate();
  listenExpenses();
  loadSummary();
}

/* ---- CATEGORIES (dynamic, mmiliki anaongeza mwenyewe) ---- */
function listenCategories() {
  db.collection("motela_categories").orderBy("name")
    .onSnapshot((snap) => {
      categoriesCache = [];
      snap.forEach((doc) => categoriesCache.push({ id: doc.id, ...doc.data() }));

      const list = document.getElementById("categoryList");
      list.innerHTML = "";
      categoriesCache.forEach((c) => {
        list.innerHTML += `<span class="chip">${c.name}
          <button class="chip-remove" onclick="deleteCategory('${c.id}')" title="Futa">&times;</button>
        </span>`;
      });

      const prodCategorySelect = document.getElementById("prodCategory");
      const prevSelected = prodCategorySelect.value;
      prodCategorySelect.innerHTML = "";
      if (categoriesCache.length === 0) {
        prodCategorySelect.innerHTML = `<option value="">-- Ongeza category kwanza --</option>`;
      } else {
        categoriesCache.forEach((c) => {
          prodCategorySelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
        });
        if (prevSelected) prodCategorySelect.value = prevSelected;
      }

      renderExpenseSourceOptions();
    }, (err) => {
      showToast("Hitilafu ya categories: " + err.message, "error");
    });
}

document.getElementById("categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("categoryName");
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    await db.collection("motela_categories").add({
      name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    nameInput.value = "";
    showToast("Category imeongezwa.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

async function deleteCategory(id) {
  if (!confirm("Una uhakika unataka kufuta category hii? (Bidhaa zilizopo chini yake hazitafutwa, lakini jina la category halitaonekana tena kwenye chaguo mpya)")) return;
  try {
    await db.collection("motela_categories").doc(id).delete();
    showToast("Category imefutwa.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}

/* ---- HOUSE / BUSINESS TYPES (dynamic, mmiliki anaongeza mwenyewe) ---- */
function listenHouseTypes() {
  db.collection("motela_houseTypes").orderBy("name")
    .onSnapshot((snap) => {
      houseTypesCache = [];
      snap.forEach((doc) => houseTypesCache.push({ id: doc.id, ...doc.data() }));

      const list = document.getElementById("houseTypeList");
      list.innerHTML = "";
      houseTypesCache.forEach((h) => {
        list.innerHTML += `<span class="chip">${h.name} (${fmtMoney(h.rate)}/mwezi)
          <button class="chip-remove" onclick="deleteHouseType('${h.id}')" title="Futa">&times;</button>
        </span>`;
      });

      const houseTypeSelect = document.getElementById("houseType");
      const prevSelected = houseTypeSelect.value;
      houseTypeSelect.innerHTML = "";
      if (houseTypesCache.length === 0) {
        houseTypeSelect.innerHTML = `<option value="">-- Ongeza aina kwanza --</option>`;
      } else {
        houseTypesCache.forEach((h) => {
          houseTypeSelect.innerHTML += `<option value="${h.id}" data-rate="${h.rate}">${h.name}</option>`;
        });
        if (prevSelected) houseTypeSelect.value = prevSelected;
      }
      computeTotalDisplay();
      renderExpenseSourceOptions();
    }, (err) => {
      showToast("Hitilafu ya house types: " + err.message, "error");
    });
}

document.getElementById("houseTypeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("houseTypeName");
  const rateInput = document.getElementById("houseTypeRate");
  const name = nameInput.value.trim();
  const rate = Number(rateInput.value);
  if (!name || rate < 0) return;
  try {
    await db.collection("motela_houseTypes").add({
      name, rate,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    nameInput.value = "";
    rateInput.value = "";
    showToast("Aina imeongezwa.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

async function deleteHouseType(id) {
  if (!confirm("Una uhakika unataka kufuta aina hii?")) return;
  try {
    await db.collection("motela_houseTypes").doc(id).delete();
    showToast("Aina imefutwa.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}

/* ---- EXPENSE SOURCE OPTIONS (dynamic: kila category + kila house type + Jumla) ---- */
function renderExpenseSourceOptions() {
  const select = document.getElementById("expenseSource");
  if (!select) return;
  const prevSelected = select.value;
  select.innerHTML = "";
  categoriesCache.forEach((c) => {
    select.innerHTML += `<option value="cat:${c.id}">${c.name}</option>`;
  });
  houseTypesCache.forEach((h) => {
    select.innerHTML += `<option value="house:${h.id}">${h.name}</option>`;
  });
  select.innerHTML += `<option value="jumla">Jumla (Vyote)</option>`;
  if (prevSelected) select.value = prevSelected;
}

/* ---- PRODUCTS ---- */
// Bidhaa za "Mbao" pekee ndizo zinazotumia Stock In (yard tracking).
// Category yoyote yenye jina linalobeba neno "mbao" inahesabika.
function isMboaCategory(categoryName) {
  return (categoryName || "").toLowerCase().includes("mbao");
}

function listenProducts() {
  db.collection("motela_products").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      productsCache = [];
      const tbody = document.querySelector("#productsTable tbody");
      const stockSelect = document.getElementById("stockProductSelect");
      const sellSelect = document.getElementById("sellProductSelect");
      const prevStockSelected = stockSelect.value;
      const prevSellSelected = sellSelect.value;
      tbody.innerHTML = "";
      stockSelect.innerHTML = "";
      sellSelect.innerHTML = "";
      let mbaoCount = 0;
      snap.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        productsCache.push(p);
        tbody.innerHTML += `<tr id="prod-row-${p.id}">
          <td>${p.categoryName || ""}</td>
          <td>${p.name}</td>
          <td>${p.variant || "-"}</td>
          <td>${fmtMoney(p.buyingPrice)}</td><td>${fmtMoney(p.sellingPrice)}</td>
          <td>${p.stockQty}</td>
          <td><button class="link-btn" onclick="deleteProduct('${p.id}')">Delete</button></td>
        </tr>`;
        const label = p.name + (p.variant ? " (" + p.variant + ")" : "") + " - Stock: " + p.stockQty;
        sellSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
        if (isMboaCategory(p.categoryName)) {
          mbaoCount++;
          stockSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
        }
      });
      if (mbaoCount === 0) {
        stockSelect.innerHTML = `<option value="">-- Hakuna bidhaa za Mbao bado --</option>`;
      }
      if (prevStockSelected) stockSelect.value = prevStockSelected;
      if (prevSellSelected) sellSelect.value = prevSellSelected;
      updateSellPriceDisplay();
    }, (err) => {
      showToast("Hitilafu ya kuappload bidhaa: " + err.message, "error");
    });
}

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const categoryId = document.getElementById("prodCategory").value;
  const category = categoriesCache.find((c) => c.id === categoryId);
  if (!category) return showToast("Chagua/ongeza category kwanza.", "error");
  const name = document.getElementById("prodName").value.trim();
  const variant = document.getElementById("prodVariant").value.trim();
  const buyingPrice = Number(document.getElementById("prodBuyPrice").value);
  const sellingPrice = Number(document.getElementById("prodSellPrice").value);
  const stockQty = Number(document.getElementById("prodStock").value);
  try {
    await db.collection("motela_products").add({
      name, variant: variant || null, buyingPrice, sellingPrice, stockQty,
      categoryId: category.id, categoryName: category.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    showToast("Product registered.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

async function deleteProduct(id) {
  if (!confirm("Una uhakika unataka kufuta bidhaa hii?")) return;
  const row = document.getElementById("prod-row-" + id);
  if (row) row.remove();
  productsCache = productsCache.filter((p) => p.id !== id);
  showToast("Bidhaa imefutwa.", "success");
  try {
    await db.collection("motela_products").doc(id).delete();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}

/* ---- STOCK IN (Mbao Yard) - Stock Out haihitajiki, mauzo yanapunguza stock kiotomatiki ---- */
document.getElementById("stockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("stockProductSelect").value;
  const qty = Number(document.getElementById("stockQty").value);
  const reason = document.getElementById("stockReason").value.trim();
  const product = productsCache.find((p) => p.id === productId);
  if (!product) return showToast("Chagua bidhaa ya mbao kwanza.", "error");

  const newStock = product.stockQty + qty;

  try {
    const batch = db.batch();
    batch.update(db.collection("motela_products").doc(productId), { stockQty: newStock });
    batch.set(db.collection("motela_stockLogs").doc(), {
      productId, productName: product.name, type: "in", qty, reason,
      doneBy: currentUsername, date: todayStr(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    e.target.reset();
    showToast("Stock imeongezwa.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

/* ---- SELL (mmiliki mwenyewe anauza moja kwa moja) ---- */
function updateSellPriceDisplay() {
  const select = document.getElementById("sellProductSelect");
  const priceDisplay = document.getElementById("sellPriceDisplay");
  const product = productsCache.find((p) => p.id === select.value);
  priceDisplay.value = product ? fmtMoney(product.sellingPrice) : "";
}
document.getElementById("sellProductSelect").addEventListener("change", updateSellPriceDisplay);

document.getElementById("sellForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = document.getElementById("sellProductSelect").value;
  const qty = Number(document.getElementById("sellQty").value);
  const product = productsCache.find((p) => p.id === productId);
  if (!product) return showToast("Chagua bidhaa.", "error");
  if (qty > product.stockQty) return showToast("Stock haitoshi.", "error");

  const total = product.sellingPrice * qty;
  const profit = (product.sellingPrice - product.buyingPrice) * qty;

  try {
    const batch = db.batch();
    batch.update(db.collection("motela_products").doc(productId), {
      stockQty: product.stockQty - qty
    });
    batch.set(db.collection("motela_sales").doc(), {
      productId, productName: product.name,
      categoryId: product.categoryId || null, categoryName: product.categoryName || null,
      qty,
      buyingPrice: product.buyingPrice, sellingPrice: product.sellingPrice,
      total, profit,
      soldBy: currentUsername, soldByName: currentUserName,
      date: todayStr(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    e.target.reset();
    showToast("Mauzo yamekamilika.", "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
});

async function deleteSale(id) {
  if (!confirm("Una uhakika unataka kufuta mauzo haya? Stock ya bidhaa itarudishwa.")) return;
  const row = document.getElementById("sale-row-" + id);
  if (row) row.remove();
  try {
    const saleDoc = await db.collection("motela_sales").doc(id).get();
    if (!saleDoc.exists) return;
    const s = saleDoc.data();
    const productRef = db.collection("motela_products").doc(s.productId);
    const productSnap = await productRef.get();
    const batch = db.batch();
    batch.delete(db.collection("motela_sales").doc(id));
    if (productSnap.exists) {
      batch.update(productRef, {
        stockQty: firebase.firestore.FieldValue.increment(s.qty)
      });
    }
    await batch.commit();
    if (productSnap.exists) {
      showToast("Mauzo yamefutwa, stock imerudishwa.", "success");
    } else {
      showToast("Mauzo yamefutwa. Bidhaa hii haipo tena, stock haikurudishwa.", "success");
    }
  } catch (err) {
    showToast("Hitilafu kufuta: " + err.message, "error");
  }
}

/* ---- SALES LISTENER (ripoti + muhtasari wa siku) ---- */
function listenSales() {
  db.collection("motela_sales").orderBy("createdAt", "desc").limit(100)
    .onSnapshot((snap) => {
      const tbody = document.querySelector("#salesTable tbody");
      tbody.innerHTML = "";
      const byDate = {};
      snap.forEach((doc) => {
        const s = doc.data();
        tbody.innerHTML += `<tr id="sale-row-${doc.id}">
          <td>${s.productName}</td><td>${s.categoryName || ""}</td><td>${s.qty}</td>
          <td>${fmtMoney(s.sellingPrice)}</td><td>${fmtMoney(s.total)}</td>
          <td>${fmtMoney(s.profit)}</td><td>${s.date}</td>
          <td><button class="link-btn" onclick="deleteSale('${doc.id}')">Delete</button></td>
        </tr>`;
        if (!byDate[s.date]) byDate[s.date] = { count: 0, total: 0, profit: 0 };
        byDate[s.date].count += 1;
        byDate[s.date].total += Number(s.total || 0);
        byDate[s.date].profit += Number(s.profit || 0);
      });

      const summaryTbody = document.querySelector("#dailySalesSummaryTable tbody");
      summaryTbody.innerHTML = "";
      Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach((date) => {
        const d = byDate[date];
        summaryTbody.innerHTML += `<tr>
          <td>${date}</td><td>${d.count}</td><td>${fmtMoney(d.total)}</td><td>${fmtMoney(d.profit)}</td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu ya kuappload mauzo: " + err.message, "error");
    });
}

/* ---- REAL ESTATE ---- */
function computeTotalDisplay() {
  const sel = document.getElementById("houseType");
  if (!sel.selectedOptions.length || !sel.selectedOptions[0].dataset.rate) {
    document.getElementById("totalPaidDisplay").value = "";
    return;
  }
  const rate = Number(sel.selectedOptions[0].dataset.rate);
  const months = Number(document.getElementById("numMonths").value);
  document.getElementById("totalPaidDisplay").value = fmtMoney(rate * months);
}
document.getElementById("houseType").addEventListener("change", computeTotalDisplay);
document.getElementById("numMonths").addEventListener("change", computeTotalDisplay);
document.getElementById("paymentDate").value = todayStr();

let realEstateCache = [];
function listenRealEstate() {
  db.collection("motela_realEstatePayments").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      realEstateCache = [];
      const tbody = document.querySelector("#realEstateTable tbody");
      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const r = { id: doc.id, ...doc.data() };
        realEstateCache.push(r);
        tbody.innerHTML += `<tr id="re-row-${r.id}">
          <td>${r.tenantName}</td><td>${r.houseTypeName || ""}</td>
          <td>${fmtMoney(r.monthlyRate)}</td><td>${r.months}</td>
          <td>${fmtMoney(r.totalPaid)}</td><td>${r.paymentDate}</td>
          <td>${r.expectedDueDate || ""}</td>
          <td><button class="link-btn" onclick="deleteRealEstate('${r.id}')">Delete</button></td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu ya kuappload real estate: " + err.message, "error");
    });
}

document.getElementById("realEstateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tenantName = document.getElementById("tenantName").value.trim();
  const houseTypeId = document.getElementById("houseType").value;
  const houseType = houseTypesCache.find((h) => h.id === houseTypeId);
  if (!houseType) return showToast("Chagua/ongeza aina ya nyumba kwanza.", "error");
  const monthlyRate = houseType.rate;
  const months = Number(document.getElementById("numMonths").value);
  const paymentDate = document.getElementById("paymentDate").value;
  const totalPaid = monthlyRate * months;
  const expectedDueDate = computeExpectedDueDate(paymentDate, months);

  try {
    await db.collection("motela_realEstatePayments").add({
      tenantName,
      houseTypeId: houseType.id, houseTypeName: houseType.name,
      monthlyRate, months, totalPaid, paymentDate, expectedDueDate,
      recordedBy: currentUsername,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    document.getElementById("paymentDate").value = todayStr();
    computeTotalDisplay();
    showToast("Malipo yamesajiliwa.", "success");
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

async function deleteRealEstate(id) {
  if (!confirm("Una uhakika unataka kufuta rekodi hii?")) return;
  const row = document.getElementById("re-row-" + id);
  if (row) row.remove();
  realEstateCache = realEstateCache.filter((r) => r.id !== id);
  showToast("Rekodi imefutwa.", "success");
  try {
    await db.collection("motela_realEstatePayments").doc(id).delete();
  } catch (err) {
    showToast("Delete Error: " + err.message, "error");
  }
}

/* =========================================================
   SUMMARY (Quarterly / Semi-Annual / Annually)
   Inahesabu kwa DYNAMIC per-category na per-house-type.
   ========================================================= */
document.querySelectorAll(".period-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".period-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    loadSummary();
  });
});

const PERIOD_MONTHS = { quarterly: 3, semiannual: 6, annual: 12 };
const PERIOD_LABELS_SW = { quarterly: "Miezi 3 iliyopita", semiannual: "Miezi 6 iliyopita", annual: "Miezi 12 iliyopita" };

let lastSummaryData = null;

async function loadSummary() {
  const months = PERIOD_MONTHS[currentPeriod];
  const startDate = daysAgoStr(months);
  document.getElementById("periodLabel").textContent = PERIOD_LABELS_SW[currentPeriod] + " (kuanzia " + startDate + ")";

  const [salesSnap, reSnap, expSnap] = await Promise.all([
    db.collection("motela_sales").where("date", ">=", startDate).get(),
    db.collection("motela_realEstatePayments").where("paymentDate", ">=", startDate).get(),
    db.collection("motela_expenses").where("date", ">=", startDate).get()
  ]);

  // Faida kwa kila category (keyed by categoryId)
  const profitByCategory = {};
  salesSnap.forEach((doc) => {
    const s = doc.data();
    const key = s.categoryId || "bila_category";
    if (!profitByCategory[key]) profitByCategory[key] = { name: s.categoryName || "Bila Category", total: 0 };
    profitByCategory[key].total += Number(s.profit || 0);
  });

  // Mapato kwa kila house type (keyed by houseTypeId)
  const incomeByHouseType = {};
  reSnap.forEach((doc) => {
    const r = doc.data();
    const key = r.houseTypeId || "bila_aina";
    if (!incomeByHouseType[key]) incomeByHouseType[key] = { name: r.houseTypeName || "Bila Aina", total: 0 };
    incomeByHouseType[key].total += Number(r.totalPaid || 0);
  });

  // Expenses: chukua "cat:ID" / "house:ID" / "jumla"
  let expJumla = 0;
  let totalExpenses = 0;
  expSnap.forEach((doc) => {
    const ex = doc.data();
    const amt = Number(ex.amount || 0);
    totalExpenses += amt;
    if (ex.source === "jumla") {
      expJumla += amt;
    } else if (ex.source && ex.source.startsWith("cat:")) {
      const key = ex.source.slice(4);
      if (profitByCategory[key]) profitByCategory[key].total -= amt;
    } else if (ex.source && ex.source.startsWith("house:")) {
      const key = ex.source.slice(6);
      if (incomeByHouseType[key]) incomeByHouseType[key].total -= amt;
    }
  });

  const categorySum = Object.values(profitByCategory).reduce((sum, c) => sum + c.total, 0);
  const houseTypeSum = Object.values(incomeByHouseType).reduce((sum, h) => sum + h.total, 0);
  const grandTotal = categorySum + houseTypeSum - expJumla;

  const container = document.getElementById("summaryStatsContainer");
  container.innerHTML = "";
  Object.values(profitByCategory).forEach((c) => {
    container.innerHTML += `<div class="stat-card">
      <span class="stat-label">Faida - ${c.name}</span>
      <span class="stat-value">${fmtMoney(c.total)}</span>
    </div>`;
  });
  Object.values(incomeByHouseType).forEach((h) => {
    container.innerHTML += `<div class="stat-card">
      <span class="stat-label">Mapato - ${h.name}</span>
      <span class="stat-value">${fmtMoney(h.total)}</span>
    </div>`;
  });

  document.getElementById("statTotalExpenses").textContent = fmtMoney(totalExpenses);
  document.getElementById("statGrandTotal").textContent = fmtMoney(grandTotal);

  lastSummaryData = {
    profitByCategory, incomeByHouseType,
    totalExpenses, grandTotal, startDate, period: currentPeriod
  };
}

/* ---- PDF: Real Estate Records ---- */
document.getElementById("downloadRealEstatePdf").addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("MOTELA INVESTIMENT - Ripoti ya Real Estate", 14, 16);
  doc.setFontSize(10);
  doc.text("Tarehe ya ripoti: " + todayStr(), 14, 23);

  const rows = realEstateCache.map((r) => {
    return [
      r.tenantName, r.houseTypeName || "", fmtMoney(r.monthlyRate),
      r.months, fmtMoney(r.totalPaid), r.paymentDate, r.expectedDueDate || ""
    ];
  });
  doc.autoTable({
    startY: 30,
    head: [["Mpangaji", "Aina", "Rate/Mwezi", "Miezi", "Jumla", "Tarehe", "Kodi Mpya Kuanzia"]],
    body: rows,
    styles: { fontSize: 8 }
  });
  doc.save("Motela-RealEstate-" + todayStr() + ".pdf");
});

/* ---- PDF: Summary Report ---- */
document.getElementById("downloadSummaryPdf").addEventListener("click", () => {
  if (!lastSummaryData) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("MOTELA INVESTIMENT - Summary ya Mapato", 14, 16);
  doc.setFontSize(10);
  doc.text("Kipindi: " + PERIOD_LABELS_SW[lastSummaryData.period], 14, 24);
  doc.text("Tarehe ya ripoti: " + todayStr(), 14, 30);

  const bodyRows = [];
  Object.values(lastSummaryData.profitByCategory).forEach((c) => {
    bodyRows.push(["Faida - " + c.name, fmtMoney(c.total)]);
  });
  Object.values(lastSummaryData.incomeByHouseType).forEach((h) => {
    bodyRows.push(["Mapato - " + h.name, fmtMoney(h.total)]);
  });
  bodyRows.push(["Jumla ya Matumizi (Expenses)", fmtMoney(lastSummaryData.totalExpenses)]);
  bodyRows.push(["JUMLA KUU", fmtMoney(lastSummaryData.grandTotal)]);

  doc.autoTable({
    startY: 38,
    head: [["Kipengele", "Kiasi"]],
    body: bodyRows,
    styles: { fontSize: 10 }
  });
  doc.save("Motela-Summary-" + todayStr() + ".pdf");
});

/* ---- EXPENSES ---- */
document.getElementById("expenseDate").value = todayStr();

document.getElementById("expenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("expenseDate").value;
  const description = document.getElementById("expenseDesc").value.trim();
  const sourceSelect = document.getElementById("expenseSource");
  const source = sourceSelect.value;
  const sourceLabel = sourceSelect.selectedOptions.length ? sourceSelect.selectedOptions[0].textContent : source;
  const amount = Number(document.getElementById("expenseAmount").value);
  if (!source) return showToast("Chagua Source of Fund.", "error");
  try {
    await db.collection("motela_expenses").add({
      date, description, source, sourceLabel, amount,
      recordedBy: currentUsername,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    e.target.reset();
    document.getElementById("expenseDate").value = todayStr();
    showToast("Expense added.", "success");
    loadSummary();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
});

function listenExpenses() {
  db.collection("motela_expenses").orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      const tbody = document.querySelector("#expensesTable tbody");
      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const ex = doc.data();
        tbody.innerHTML += `<tr id="exp-row-${doc.id}">
          <td>${ex.date}</td><td>${ex.description}</td>
          <td>${ex.sourceLabel || ex.source}</td>
          <td>${fmtMoney(ex.amount)}</td>
          <td><button class="link-btn" onclick="deleteExpense('${doc.id}')">Delete</button></td>
        </tr>`;
      });
    }, (err) => {
      showToast("Hitilafu: " + err.message, "error");
    });
}
async function deleteExpense(id) {
  if (!confirm("Una uhakika unataka kufuta expense hii?")) return;
  const row = document.getElementById("exp-row-" + id);
  if (row) row.remove();
  showToast("Expense imefutwa.", "success");
  try {
    await db.collection("motela_expenses").doc(id).delete();
    loadSummary();
  } catch (err) {
    showToast("Hitilafu: " + err.message, "error");
  }
}