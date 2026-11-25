// TEMPELKAN URL WEB APP (/exec) DARI APPS SCRIPT ANDA DI SINI:
const API_URL = "https://script.google.com/macros/s/AKfycbyU4iIcBANGgPUT69XadHIVpyEMTk311taHH9OJTXMNVpnzWudXkhYVS-vOtvbB0RnX/exec";
const ADMIN_PIN = "1234"; // PIN Admin

const subKategoriData = {
  "Raket": ["Badminton", "Tenis", "Padel", "Squash", "Tenis Meja"],
  "Sepatu": ["Badminton", "Tenis", "Sepatu Bola", "Futsal", "Lari (Running)", "Basket"],
  "Pakaian": ["Jersey Badminton", "Jersey Bola", "Celana Olahraga", "Jaket Training"],
  "Aksesori": ["Kok (Shuttlecock)", "Bola Tenis", "Grip Raket", "Tas Olahraga", "Kaos Kaki"]
};

let globalStok = [];
let globalTx = [];
let globalShifts = [];
let cart = [];
let chartInstance = null;
let currentTxData = null;
let isAdminUnlocked = false;
let pendingTabTarget = null;
let html5QrCode = null;

// Variabel untuk Modal Detail Produk & Shift
let activeDetailProduct = null;
let selectedSizeInModal = "";
let shiftSummaryCache = { jumlahTx: 0, tunai: 0, nonTunai: 0, total: 0 };

// --- HELPER PARSE VARIASI UKURAN ---
function parseProductVariants(rawUkuran) {
  const str = String(rawUkuran || '').trim();
  if (!str) return null;
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {}
  }
  const parts = str.split(',').map(s => s.trim()).filter(s => s !== '');
  if (parts.length > 0) {
    return parts.map(sz => ({ size: sz, stok: null }));
  }
  return null;
}

// --- INISIALISASI TEMA ---
function loadSavedTheme() {
  const savedTheme = localStorage.getItem('sportCenterTheme') || 'light';
  document.documentElement.setAttribute('data-bs-theme', savedTheme);
  updateThemeButton(savedTheme);
}

function toggleTheme() {
  const htmlEl = document.documentElement;
  const nextTheme = htmlEl.getAttribute('data-bs-theme') === 'light' ? 'dark' : 'light';
  htmlEl.setAttribute('data-bs-theme', nextTheme);
  localStorage.setItem('sportCenterTheme', nextTheme);
  updateThemeButton(nextTheme);
  renderLaporan();
}

function updateThemeButton(theme) {
  const btnTheme = document.getElementById('btnTheme');
  if (!btnTheme) return;
  if (theme === 'dark') {
    btnTheme.innerHTML = '<i class="fa-solid fa-sun text-warning"></i><span class="d-none d-md-inline ms-1">Light</span>';
  } else {
    btnTheme.innerHTML = '<i class="fa-solid fa-moon"></i><span class="d-none d-md-inline ms-1">Dark</span>';
  }
}

// --- TOAST NOTIFIKASI ---
function showToast(msg, type = 'success') {
  const toastEl = document.getElementById('liveToast');
  const toastBody = document.getElementById('toastMessage');
  toastEl.className = `toast align-items-center border-0 shadow-lg text-white ${type === 'error' ? 'bg-danger' : 'bg-success'}`;
  toastBody.innerText = msg;
  const toast = new bootstrap.Toast(toastEl, { delay: 2500 });
  toast.show();
}

// --- KONTROL LOGIN & TAMPILAN ADMIN ---
function cekAksesAdmin(e, tabSelector) {
  e.preventDefault();
  if (isAdminUnlocked) {
    aktifkanTab(tabSelector);
  } else {
    pendingTabTarget = tabSelector;
    document.getElementById('inputPinAdmin').value = '';
    new bootstrap.Modal(document.getElementById('modalPin')).show();
  }
}

function verifikasiPin() {
  const pin = document.getElementById('inputPinAdmin').value;
  if (pin === ADMIN_PIN) {
    isAdminUnlocked = true;
    bootstrap.Modal.getInstance(document.getElementById('modalPin')).hide();
    updateAdminUI();
    showToast("Berhasil Login Admin");
    if (pendingTabTarget) {
      aktifkanTab(pendingTabTarget);
      pendingTabTarget = null;
    }
  } else {
    showToast("PIN Admin Salah!", "error");
  }
}

function toggleAdminLock() {
  if (isAdminUnlocked) {
    isAdminUnlocked = false;
    updateAdminUI();
    showToast("Anda telah Logout dari Admin");
  } else {
    pendingTabTarget = null;
    document.getElementById('inputPinAdmin').value = '';
    new bootstrap.Modal(document.getElementById('modalPin')).show();
  }
}

function updateAdminUI() {
  const btn = document.getElementById('btnAdminLock');
  const kpiSection = document.getElementById('kpiSection');
  const mainTab = document.getElementById('mainTab');

  if (isAdminUnlocked) {
    kpiSection.classList.remove('d-none');
    mainTab.classList.remove('d-none');
    btn.className = "btn btn-danger rounded-pill px-2 px-md-3 py-1 btn-sm fw-bold";
    btn.innerHTML = '<i class="fa-solid fa-right-from-bracket me-1"></i><span>Logout Admin</span>';
  } else {
    kpiSection.classList.add('d-none');
    mainTab.classList.add('d-none');
    aktifkanTab('#tabKasir');
    btn.className = "btn btn-outline-warning rounded-pill px-2 px-md-3 py-1 btn-sm fw-bold";
    btn.innerHTML = '<i class="fa-solid fa-lock me-1"></i><span>Login Admin</span>';
  }
}

function aktifkanTab(tabSelector) {
  document.querySelectorAll('#mainTab .nav-link').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('show', 'active'));
  
  const targetPane = document.querySelector(tabSelector);
  if (targetPane) targetPane.classList.add('show', 'active');

  if (tabSelector === '#tabKasir') document.getElementById('navKasir').classList.add('active');
  if (tabSelector === '#tabStok') document.getElementById('navStok').classList.add('active');
  if (tabSelector === '#tabLaporan') document.getElementById('navLaporan').classList.add('active');
}

// --- AMBIL DATA DARI API ---
async function initData() {
  const badge = document.getElementById('statusKoneksi');
  const loadingScreen = document.getElementById('loadingScreen');
  const mainApp = document.getElementById('mainApp');

  if (badge) badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Sinkron';

  try {
    const response = await fetch(API_URL);
    const res = await response.json();

    if (res.success) {
      globalStok = res.stok || [];
      globalTx = res.transaksi || [];
      globalShifts = res.shifts || [];
      renderKatalog();
      renderTabelStok();
      renderLaporan();
      renderTabelShift();
      updateKPI();

      if (loadingScreen) loadingScreen.classList.add('d-none');
      if (mainApp) mainApp.style.display = 'block';
      if (badge) badge.innerHTML = '<i class="fa-solid fa-circle fs-6 me-1"></i> Online';
    } else {
      loadingScreen.innerHTML = `<div class="text-danger fw-bold p-3">Gagal memuat database: ${res.message}</div>`;
    }
  } catch (err) {
    console.error("Fetch Error:", err);
    loadingScreen.innerHTML = `
      <div class="text-center p-4">
        <i class="fa-solid fa-wifi text-danger fs-1 mb-3"></i>
        <h5 class="fw-bold text-danger">Koneksi Terputus</h5>
        <p class="text-muted small">Pastikan API_URL di script.js sudah diisi dengan URL /exec Anda.</p>
        <button onclick="location.reload()" class="btn btn-orange btn-sm mt-2">Muat Ulang</button>
      </div>`;
  }
}

// --- BUILDER BARIS UKURAN & STOK (TAMBAH & EDIT PRODUK) ---
function toggleVariantMode(mode) {
  const isChecked = document.getElementById(mode === 'add' ? 'toggleAddVariants' : 'toggleEditVariants').checked;
  const singleBox = document.getElementById(mode === 'add' ? 'addSingleStockBox' : 'editSingleStockBox');
  const variantBox = document.getElementById(mode === 'add' ? 'addVariantStockBox' : 'editVariantStockBox');
  const listEl = document.getElementById(mode === 'add' ? 'addVariantList' : 'editVariantList');
  const singleInput = document.getElementById(mode === 'add' ? 'addSingleStokInput' : 'editStok');

  if (isChecked) {
    singleBox.classList.add('d-none');
    singleInput.removeAttribute('required');
    variantBox.classList.remove('d-none');
    if (listEl.children.length === 0) {
      tambahBarisUkuran(mode);
    }
  } else {
    variantBox.classList.add('d-none');
    singleBox.classList.remove('d-none');
    if (mode === 'add') singleInput.setAttribute('required', 'required');
  }
}

function tambahBarisUkuran(mode, sizeVal = '', stokVal = '') {
  const listEl = document.getElementById(mode === 'add' ? 'addVariantList' : 'editVariantList');
  const row = document.createElement('div');
  row.className = 'input-group input-group-sm variant-row';
  row.innerHTML = `
    <input type="text" class="form-control var-size fw-bold" placeholder="Ukuran (40 / L)" value="${sizeVal}" required>
    <input type="number" class="form-control var-stok text-success fw-bold" placeholder="Stok" value="${stokVal}" min="0" required>
    <button type="button" onclick="this.parentElement.remove()" class="btn btn-outline-danger px-2" title="Hapus Ukuran">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
  listEl.appendChild(row);
}

function isiPresetVariant(mode, sizeArray) {
  const listEl = document.getElementById(mode === 'add' ? 'addVariantList' : 'editVariantList');
  listEl.innerHTML = '';
  sizeArray.forEach(sz => tambahBarisUkuran(mode, sz, '5'));
}

function kumpulkanDataUkuran(mode) {
  const isChecked = document.getElementById(mode === 'add' ? 'toggleAddVariants' : 'toggleEditVariants').checked;
  if (!isChecked) return null;

  const listEl = document.getElementById(mode === 'add' ? 'addVariantList' : 'editVariantList');
  const rows = listEl.querySelectorAll('.variant-row');
  const variants = [];

  rows.forEach(r => {
    const sz = r.querySelector('.var-size').value.trim();
    const st = Number(r.querySelector('.var-stok').value || 0);
    if (sz) {
      variants.push({ size: sz, stok: st });
    }
  });

  return variants.length > 0 ? variants : null;
}

// --- KATEGORI & SUB-KATEGORI ---
function updateFormSub() {
  const mainCat = document.getElementById('formKategoriMain').value;
  const subSelect = document.getElementById('formSubKategori');
  subSelect.innerHTML = '<option value="">-- Pilih Sub-Kategori --</option>';
  if (subKategoriData[mainCat]) {
    subKategoriData[mainCat].forEach(sub => {
      subSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
    });
  }
}

function updateFilterSub() {
  const mainCat = document.getElementById('filterKategoriMain').value;
  const subSelect = document.getElementById('filterSubKategori');
  subSelect.innerHTML = '<option value="">Semua Sub-Kategori</option>';
  if (subKategoriData[mainCat]) {
    subKategoriData[mainCat].forEach(sub => {
      subSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
    });
  }
  renderKatalog();
}

function updateEditSub(selectedSub = "") {
  const mainCat = document.getElementById('editKategoriMain').value;
  const subSelect = document.getElementById('editSubKategori');
  subSelect.innerHTML = '';
  if (subKategoriData[mainCat]) {
    subKategoriData[mainCat].forEach(sub => {
      const isSelected = sub === selectedSub ? 'selected' : '';
      subSelect.innerHTML += `<option value="${sub}" ${isSelected}>${sub}</option>`;
    });
  }
}

// --- KPI & KATALOG SHOPEE POSTCARD ---
function updateKPI() {
  document.getElementById('kpiTotalProduk').innerText = globalStok.length + " Item";
  let totalOmset = 0;
  globalTx.forEach(t => totalOmset += Number(t[3] || 0));
  document.getElementById('kpiOmset').innerText = formatRupiah(totalOmset);
  document.getElementById('kpiStokKritis').innerText = globalStok.filter(s => Number(s[6]) <= 5).length + " Item";
  document.getElementById('kpiTotalTx').innerText = globalTx.length + " Tx";
}

function renderKatalog() {
  const keyword = document.getElementById('searchKasir').value.toLowerCase();
  const mainCat = document.getElementById('filterKategoriMain').value;
  const subCat = document.getElementById('filterSubKategori').value;

  let html = '';
  globalStok.forEach(item => {
    const id = item[0];
    const namaProduk = String(item[2] || '');
    const katMain = String(item[3] || '');
    const subKategori = String(item[4] || '');
    const harga = Number(item[5] || 0);
    const totalStok = Number(item[6] || 0);
    const foto = String(item[7] || '');
    const barcode = String(item[8] || '');

    const matchKeyword = namaProduk.toLowerCase().includes(keyword) || barcode.toLowerCase().includes(keyword);
    const matchMain = !mainCat || katMain === mainCat;
    const matchSub = !subCat || subKategori === subCat;

    if (matchKeyword && matchMain && matchSub) {
      const habisBadge = totalStok <= 0 ? '<div class="sold-out-overlay">STOK HABIS</div>' : '';

      html += `
      <div class="col-6 col-sm-4 col-xl-3">
        <div class="shopee-postcard" onclick="bukaDetailProduk('${id}')">
          <div class="img-container">
            <img src="${foto}" loading="lazy" onerror="this.src='https://via.placeholder.com/300?text=Sport+Center'">
            ${habisBadge}
          </div>
          <div class="p-2 d-flex flex-column flex-grow-1 justify-content-between">
            <div>
              <div class="fw-bold small text-truncate mb-1" title="${namaProduk}">${namaProduk}</div>
              <div class="d-flex gap-1 mb-2 flex-wrap">
                <span class="badge bg-secondary extra-small">${katMain}</span>
                <span class="badge badge-sub extra-small">${subKategori}</span>
              </div>
            </div>
            <div>
              <div class="text-orange fw-bold fs-6 mb-1">${formatRupiah(harga)}</div>
              <div class="d-flex justify-content-between align-items-center pt-1 border-top">
                <small class="text-muted extra-small">Stok: ${totalStok}</small>
                <button type="button" onclick="klikIkonKeranjang(event, '${id}')" class="btn btn-sm btn-orange py-1 px-2" title="Tambah ke Keranjang" ${totalStok <= 0 ? 'disabled' : ''}>
                  <i class="fa-solid fa-cart-plus"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }
  });
  document.getElementById('katalogContainer').innerHTML = html || '<div class="text-center py-5 text-muted">Produk tidak ditemukan.</div>';
}

// --- DETAIL PRODUK & PILIHAN UKURAN ---
function updateInfoStokUkuran(sizeVal) {
  const stokBox = document.getElementById('detailStokUkuranBox');
  if (!activeDetailProduct || !sizeVal) {
    stokBox.classList.add('d-none');
    stokBox.classList.remove('d-flex');
    return;
  }

  const totalStok = Number(activeDetailProduct[6] || 0);
  const variants = parseProductVariants(activeDetailProduct[9]);
  let stokUkuran = totalStok;

  if (variants) {
    const found = variants.find(v => String(v.size) === String(sizeVal));
    if (found && found.stok !== null) {
      stokUkuran = Number(found.stok);
    }
  }

  document.getElementById('selectedSizeLabel').innerText = sizeVal;
  const valEl = document.getElementById('selectedSizeStockValue');
  valEl.innerText = stokUkuran > 0 ? `${stokUkuran} pcs` : 'Habis';
  valEl.className = `fw-bold small ${stokUkuran > 0 ? 'text-success' : 'text-danger'}`;

  stokBox.classList.remove('d-none');
  stokBox.classList.add('d-flex');
}

function bukaDetailProduk(id) {
  const item = globalStok.find(s => s[0] === id);
  if (!item) return;

  activeDetailProduct = item;
  selectedSizeInModal = "";

  const totalStok = Number(item[6] || 0);
  const variants = parseProductVariants(item[9]);
  const deskripsi = String(item[10] || '').trim();

  document.getElementById('detailKategori').innerText = item[3] || '';
  document.getElementById('detailSubKategori').innerText = item[4] || '';
  document.getElementById('detailFoto').src = item[7] || 'https://via.placeholder.com/300?text=Sport+Center';
  document.getElementById('detailNama').innerText = item[2] || '';
  document.getElementById('detailHarga').innerText = formatRupiah(item[5] || 0);
  
  const stokBadge = document.getElementById('detailStok');
  stokBadge.innerText = totalStok > 0 ? `Total Stok: ${totalStok}` : 'Stok Habis';
  stokBadge.className = `badge ${totalStok > 0 ? 'bg-success' : 'bg-danger'}`;

  document.getElementById('detailDeskripsi').innerText = deskripsi || 'Belum ada deskripsi untuk produk ini.';

  const ukuranWrapper = document.getElementById('detailUkuranWrapper');
  const ukuranList = document.getElementById('detailUkuranList');
  const btnTambah = document.getElementById('btnTambahDariDetail');
  const stokUkuranBox = document.getElementById('detailStokUkuranBox');

  if (variants && variants.length > 0) {
    ukuranWrapper.classList.remove('d-none');
    let sizeHtml = '';
    let firstAvailableSet = false;

    variants.forEach(v => {
      const sz = v.size;
      const szStok = v.stok !== null ? Number(v.stok) : totalStok;
      const isHabis = szStok <= 0;

      let activeClass = '';
      if (!isHabis && !firstAvailableSet) {
        selectedSizeInModal = sz;
        activeClass = 'active';
        firstAvailableSet = true;
      }

      sizeHtml += `<button type="button" class="size-pill ${activeClass}" ${isHabis ? 'disabled' : ''} onclick="pilihUkuranModal(this, '${sz}')">${sz}</button>`;
    });

    ukuranList.innerHTML = sizeHtml;
    btnTambah.disabled = !firstAvailableSet;
    updateInfoStokUkuran(selectedSizeInModal);
  } else {
    ukuranWrapper.classList.add('d-none');
    ukuranList.innerHTML = '';
    stokUkuranBox.classList.add('d-none');
    stokUkuranBox.classList.remove('d-flex');
    btnTambah.disabled = totalStok <= 0;
  }

  new bootstrap.Modal(document.getElementById('modalDetailProduk')).show();
}

function pilihUkuranModal(btnEl, sizeVal) {
  document.querySelectorAll('#detailUkuranList .size-pill').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  selectedSizeInModal = sizeVal;
  updateInfoStokUkuran(sizeVal);
}

function tambahDariModalDetail() {
  if (!activeDetailProduct) return;
  addToCart(activeDetailProduct[0], selectedSizeInModal);
  const modal = bootstrap.Modal.getInstance(document.getElementById('modalDetailProduk'));
  if (modal) modal.hide();
}

function klikIkonKeranjang(e, id) {
  e.stopPropagation();
  const item = globalStok.find(s => s[0] === id);
  if (!item) return;

  const variants = parseProductVariants(item[9]);
  if (variants && variants.length > 0) {
    bukaDetailProduk(id);
    showToast("Pilih ukuran yang diinginkan terlebih dahulu");
  } else {
    addToCart(id, "");
  }
}

// --- SCAN BARCODE KAMERA ---
function bukaScanner() {
  const modal = new bootstrap.Modal(document.getElementById('modalScanner'));
  modal.show();

  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (decodedText) => {
      tutupScanner();
      const ketemu = globalStok.find(s => String(s[8]).toLowerCase() === decodedText.toLowerCase() || String(s[0]).toLowerCase() === decodedText.toLowerCase());
      if (ketemu) {
        const variants = parseProductVariants(ketemu[9]);
        if (variants && variants.length > 0) {
          bukaDetailProduk(ketemu[0]);
        } else {
          addToCart(ketemu[0], "");
        }
      } else {
        document.getElementById('searchKasir').value = decodedText;
        renderKatalog();
        showToast(`Barcode ${decodedText} tidak ditemukan`, "error");
      }
    },
    () => {}
  ).catch(err => {
    showToast("Kamera tidak dapat diakses: " + err, "error");
  });
}

function tutupScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
  }
  const modalEl = document.getElementById('modalScanner');
  const modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
}

// --- KERANJANG & DISKON (VALIDASI STOK PER UKURAN) ---
function getMaxStokForItem(item, ukuran = "") {
  const totalStok = Number(item[6] || 0);
  const variants = parseProductVariants(item[9]);

  if (ukuran && variants) {
    const found = variants.find(v => String(v.size) === String(ukuran));
    if (found && found.stok !== null) return Number(found.stok);
  }
  return totalStok;
}

function addToCart(id, ukuran = "") {
  const item = globalStok.find(s => s[0] === id);
  if (!item) return;

  const maxStokUkuran = getMaxStokForItem(item, ukuran);
  if (maxStokUkuran <= 0) return showToast(`Stok ${ukuran ? 'ukuran ' + ukuran : 'produk'} habis!`, "error");

  const cartKey = `${id}_${ukuran}`;
  const exist = cart.find(c => c.cartKey === cartKey);
  const labelNama = ukuran ? `${item[2]} (${ukuran})` : item[2];

  if (exist) {
    if (exist.qty >= maxStokUkuran) {
      return showToast(`Stok ukuran ${ukuran || 'ini'} hanya tersisa ${maxStokUkuran}!`, "error");
    }
    exist.qty++;
    showToast(`+1 ${labelNama}`);
  } else {
    cart.push({
      cartKey: cartKey,
      id: item[0],
      nama: item[2],
      ukuran: ukuran,
      harga: Number(item[5]),
      qty: 1
    });
    showToast(`${labelNama} masuk keranjang`);
  }
  renderCart();
}

function hitungTotalBelanja() {
  const subtotal = cart.reduce((sum, i) => sum + (i.harga * i.qty), 0);
  const tipeDiskon = document.getElementById('tipeDiskon').value;
  const nilaiDiskon = Number(document.getElementById('inputDiskon').value) || 0;

  let potongan = 0;
  if (tipeDiskon === 'persen') {
    const persen = nilaiDiskon > 100 ? 100 : nilaiDiskon;
    potongan = Math.round((subtotal * persen) / 100);
  } else {
    potongan = nilaiDiskon > subtotal ? subtotal : nilaiDiskon;
  }

  const totalAkhir = subtotal - potongan;
  return { subtotal, potongan, totalAkhir };
}

function renderCart() {
  let html = '';
  let totalItem = 0;

  cart.forEach((c, idx) => {
    totalItem += c.qty;
    const sizeTag = c.ukuran ? `<span class="badge bg-secondary ms-1">Size: ${c.ukuran}</span>` : '';
    html += `
    <div class="d-flex justify-content-between align-items-center mb-2 p-2 rounded border">
      <div class="pe-2">
        <div class="fw-bold small">${c.nama} ${sizeTag}</div>
        <small class="text-orange font-monospace">${formatRupiah(c.harga)} x ${c.qty}</small>
      </div>
      <div class="text-nowrap">
        <button onclick="changeQty(${idx}, -1)" class="btn btn-sm btn-outline-secondary px-2 py-0">-</button>
        <span class="mx-2 small fw-bold">${c.qty}</span>
        <button onclick="changeQty(${idx}, 1)" class="btn btn-sm btn-outline-secondary px-2 py-0">+</button>
      </div>
    </div>`;
  });

  document.getElementById('cartContainer').innerHTML = html || '<div class="text-center py-4 text-muted">Keranjang Kosong</div>';

  const { subtotal, potongan, totalAkhir } = hitungTotalBelanja();
  document.getElementById('subtotalText').innerText = formatRupiah(subtotal);
  document.getElementById('diskonText').innerText = "- " + formatRupiah(potongan);
  document.getElementById('totalBayarText').innerText = formatRupiah(totalAkhir);

  const mobileBar = document.getElementById('mobileCartBar');
  if (cart.length > 0) {
    mobileBar.style.setProperty('display', 'block', 'important');
    document.getElementById('mobileCartCount').innerText = `${totalItem} Item di Keranjang`;
    document.getElementById('mobileCartTotal').innerText = formatRupiah(totalAkhir);
  } else {
    mobileBar.style.setProperty('display', 'none', 'important');
  }

  hitungKembalian();
}

function scrollToKeranjang() {
  document.getElementById('sectionKeranjang').scrollIntoView({ behavior: 'smooth' });
}

function changeQty(idx, delta) {
  const itemStok = globalStok.find(s => s[0] === cart[idx].id);
  const maxStokUkuran = itemStok ? getMaxStokForItem(itemStok, cart[idx].ukuran) : 999;

  if (delta > 0 && cart[idx].qty >= maxStokUkuran) {
    return showToast(`Stok ukuran ${cart[idx].ukuran || 'ini'} maksimal ${maxStokUkuran}!`, "error");
  }
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  renderCart();
}

function clearCart() {
  cart = [];
  document.getElementById('inputDiskon').value = '';
  document.getElementById('inputUangBayar').value = '';
  renderCart();
}

function setUangPas() {
  const { totalAkhir } = hitungTotalBelanja();
  document.getElementById('inputUangBayar').value = totalAkhir;
  hitungKembalian();
}

function tambahPecahan(nominal) {
  const current = Number(document.getElementById('inputUangBayar').value) || 0;
  document.getElementById('inputUangBayar').value = current + nominal;
  hitungKembalian();
}

function hitungKembalian() {
  const { totalAkhir } = hitungTotalBelanja();
  const bayar = Number(document.getElementById('inputUangBayar').value) || 0;
  const kembali = bayar - totalAkhir;
  document.getElementById('textKembalian').value = formatRupiah(kembali < 0 ? 0 : kembali);
  document.getElementById('btnBayar').disabled = (cart.length === 0 || bayar < totalAkhir);
}

// --- API POST HELPER ---
async function postToAPI(payloadObj) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payloadObj)
  });
  return await response.json();
}

// --- TRANSAKSI & STRUK ---
async function prosesBayar() {
  const { subtotal, potongan, totalAkhir } = hitungTotalBelanja();
  const bayar = Number(document.getElementById('inputUangBayar').value);
  const payload = {
    items: cart,
    subtotal: subtotal,
    diskon: potongan,
    total: totalAkhir,
    metode: document.getElementById('metodeBayar').value
  };

  const btn = document.getElementById('btnBayar');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i>Memproses...';

  try {
    const res = await postToAPI({ action: "simpanTransaksi", data: payload });
    btn.innerHTML = '<i class="fa-solid fa-receipt me-2"></i>Bayar & Cetak Struk';
    
    if (res.success) {
      currentTxData = { ...payload, txId: res.txId, timestamp: res.timestamp, bayar: bayar, kembali: bayar - totalAkhir };
      tampilkanStruk(currentTxData);
      clearCart();
      initData();
      showToast("Transaksi Berhasil!");
    } else {
      showToast("Gagal: " + res.message, "error");
      btn.disabled = false;
    }
  } catch (err) {
    btn.innerHTML = '<i class="fa-solid fa-receipt me-2"></i>Bayar & Cetak Struk';
    btn.disabled = false;
    showToast("Error jaringan: " + err.message, "error");
  }
}

function tampilkanStruk(data) {
  document.getElementById('strukTxId').innerText = data.txId;
  document.getElementById('strukWaktu').innerText = data.timestamp;
  let html = '';
  data.items.forEach(i => {
    const sz = i.ukuran ? ` [${i.ukuran}]` : '';
    html += `<div class="d-flex justify-content-between mb-1"><span>${i.nama}${sz} x${i.qty}</span><span>${formatRupiah(i.harga * i.qty)}</span></div>`;
  });
  document.getElementById('strukItems').innerHTML = html;
  document.getElementById('strukSubtotal').innerText = formatRupiah(data.subtotal);
  document.getElementById('strukDiskon').innerText = "- " + formatRupiah(data.diskon);
  document.getElementById('strukTotal').innerText = formatRupiah(data.total);
  document.getElementById('strukBayar').innerText = formatRupiah(data.bayar);
  document.getElementById('strukKembali').innerText = formatRupiah(data.kembali);
  
  new bootstrap.Modal(document.getElementById('modalStruk')).show();
}

function kirimWA() {
  const hp = prompt("Masukkan Nomor WA Pelanggan (Contoh: 628123456789):");
  if (hp) {
    let daftarItem = currentTxData.items.map(i => {
      const sz = i.ukuran ? ` [Size: ${i.ukuran}]` : '';
      return `- ${i.nama}${sz} (x${i.qty}): ${formatRupiah(i.harga * i.qty)}`;
    }).join('\n');
    const msg = `*NOTA SPORT CENTER STORE*\nID: ${currentTxData.txId}\nWaktu: ${currentTxData.timestamp}\n\n${daftarItem}\n\nSubtotal: ${formatRupiah(currentTxData.subtotal)}\nDiskon: -${formatRupiah(currentTxData.diskon)}\n*TOTAL BAYAR: ${formatRupiah(currentTxData.total)}*\nMetode: ${currentTxData.metode} (LUNAS)\n\nTerima kasih telah berbelanja!`;
    window.open(`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`, '_blank');
  }
}

// --- TUTUP KASIR HARIAN (SHIFT CLOSING) ---
function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function bukaModalShift() {
  const todayStr = getTodayDateString();
  document.getElementById('shiftTanggalHariIni').innerText = todayStr;

  let jumlahTx = 0;
  let tunai = 0;
  let nonTunai = 0;

  globalTx.forEach(t => {
    const rawDate = String(t[1] || '').split(' ')[0].split('T')[0];
    let normDate = rawDate;
    if (rawDate.includes('/')) {
      const parts = rawDate.split('/');
      if (parts.length === 3) normDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }

    if (normDate === todayStr) {
      jumlahTx++;
      const nominal = Number(t[3] || 0);
      const metode = String(t[4] || '').toLowerCase();
      if (metode.includes('tunai') && !metode.includes('non')) {
        tunai += nominal;
      } else {
        nonTunai += nominal;
      }
    }
  });

  const total = tunai + nonTunai;
  shiftSummaryCache = { jumlahTx, tunai, nonTunai, total, tanggal: todayStr };

  document.getElementById('shiftJumlahTx').innerText = jumlahTx;
  document.getElementById('shiftSistemTunaiText').innerText = formatRupiah(tunai);
  document.getElementById('shiftSistemNonTunaiText').innerText = formatRupiah(nonTunai);
  document.getElementById('shiftTotalOmsetText').innerText = formatRupiah(total);

  document.getElementById('inputUangFisikLaci').value = '';
  document.getElementById('inputCatatanShift').value = '';
  hitungSelisihShift();

  new bootstrap.Modal(document.getElementById('modalShiftClosing')).show();
}

function hitungSelisihShift() {
  const fisik = Number(document.getElementById('inputUangFisikLaci').value) || 0;
  const selisih = fisik - shiftSummaryCache.tunai;
  const el = document.getElementById('shiftSelisihText');

  if (selisih === 0) {
    el.className = "fw-bold fs-6 text-success";
    el.innerText = "Rp 0 (PAS)";
  } else if (selisih < 0) {
    el.className = "fw-bold fs-6 text-danger";
    el.innerText = `${formatRupiah(selisih)} (KURANG)`;
  } else {
    el.className = "fw-bold fs-6 text-primary";
    el.innerText = `+${formatRupiah(selisih)} (LEBIH)`;
  }
}

async function simpanShiftClosing() {
  const fisikInput = document.getElementById('inputUangFisikLaci').value;
  if (fisikInput === '') return showToast("Masukkan jumlah uang fisik di laci!", "error");

  const fisik = Number(fisikInput);
  const selisih = fisik - shiftSummaryCache.tunai;
  const catatan = document.getElementById('inputCatatanShift').value;

  const btn = document.getElementById('btnSimpanShift');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Menyimpan...';

  try {
    const res = await postToAPI({
      action: "simpanShift",
      data: {
        jumlahTx: shiftSummaryCache.jumlahTx,
        sistemTunai: shiftSummaryCache.tunai,
        sistemNonTunai: shiftSummaryCache.nonTunai,
        totalOmset: shiftSummaryCache.total,
        uangFisik: fisik,
        selisih: selisih,
        catatan: catatan
      }
    });

    btn.disabled = false;
    btn.innerHTML = 'Simpan Tutup Kasir';

    if (res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalShiftClosing')).hide();
      showToast(res.message);
      initData();
    } else {
      showToast(res.message, "error");
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = 'Simpan Tutup Kasir';
    showToast("Gagal menyimpan shift: " + err.message, "error");
  }
}

function kirimShiftWA() {
  const hp = prompt("Masukkan Nomor WA Owner / Manajer (Contoh: 628123456789):");
  if (hp) {
    const fisik = Number(document.getElementById('inputUangFisikLaci').value) || 0;
    const selisih = fisik - shiftSummaryCache.tunai;
    const catatan = document.getElementById('inputCatatanShift').value || '-';
    const msg = `*LAPORAN TUTUP KASIR (SHIFT CLOSING)*\nSport Center Store Pro\nTanggal: ${shiftSummaryCache.tanggal}\nTotal Transaksi: ${shiftSummaryCache.jumlahTx} Tx\n\nSistem Tunai: ${formatRupiah(shiftSummaryCache.tunai)}\nNon-Tunai (QRIS/TF): ${formatRupiah(shiftSummaryCache.nonTunai)}\n*Total Omset: ${formatRupiah(shiftSummaryCache.total)}*\n\nUang Fisik Laci: ${formatRupiah(fisik)}\nSelisih Kas: ${formatRupiah(selisih)}\nCatatan: ${catatan}`;
    window.open(`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`, '_blank');
  }
}

function renderTabelShift() {
  let html = '';
  globalShifts.slice().reverse().forEach(s => {
    const selisih = Number(s[7] || 0);
    const badgeClass = selisih === 0 ? 'bg-success' : (selisih < 0 ? 'bg-danger' : 'bg-primary');
    html += `<tr>
      <td class="small fw-bold">${s[0]}</td>
      <td class="small">${formatWaktuTx(s[1])}</td>
      <td>${s[2]}</td>
      <td class="small">${formatRupiah(s[3])}</td>
      <td class="small">${formatRupiah(s[4])}</td>
      <td class="small fw-bold">${formatRupiah(s[6])}</td>
      <td><span class="badge ${badgeClass}">${formatRupiah(selisih)}</span></td>
      <td class="small text-muted">${s[8] || '-'}</td>
    </tr>`;
  });
  document.getElementById('tabelShiftBody').innerHTML = html || '<tr><td colspan="8" class="text-center text-muted py-3">Belum ada riwayat tutup kasir</td></tr>';
}

// --- MANAJEMEN STOK, EDIT & HAPUS ---
function renderTabelStok() {
  const keyword = (document.getElementById('searchStok')?.value || '').toLowerCase();
  let html = '';

  globalStok.forEach(row => {
    if (String(row[2]).toLowerCase().includes(keyword) || String(row[0]).toLowerCase().includes(keyword)) {
      html += `<tr>
        <td><img src="${row[7]}" class="rounded" style="width:45px; height:45px; object-fit:cover;" onerror="this.src='https://via.placeholder.com/50'"></td>
        <td><b>${row[2]}</b><br><small class="text-muted">${row[0]}</small></td>
        <td><span class="badge bg-secondary">${row[3]}</span> <span class="badge badge-sub">${row[4]}</span></td>
        <td class="text-orange font-monospace fw-bold">${formatRupiah(row[5])}</td>
        <td><span class="badge ${Number(row[6]) <= 5 ? 'bg-danger' : 'bg-success'}">${row[6]} Pcs</span></td>
        <td class="text-end text-nowrap">
          <button onclick="bukaModalEdit('${row[0]}')" class="btn btn-sm btn-outline-warning me-1" title="Edit / Lihat Stok Ukuran"><i class="fa-solid fa-pen"></i></button>
          <button onclick="hapus('${row[0]}')" class="btn btn-sm btn-outline-danger" title="Hapus"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }
  });
  document.getElementById('tabelStokBody').innerHTML = html || '<tr><td colspan="6" class="text-center text-muted py-3">Tidak ada data barang</td></tr>';
}

function bukaModalEdit(id) {
  const item = globalStok.find(s => s[0] === id);
  if (!item) return;

  document.getElementById('editIdProduk').value = item[0];
  document.getElementById('editNamaProduk').value = item[2];
  document.getElementById('editKategoriMain').value = item[3];
  updateEditSub(item[4]);
  document.getElementById('editHarga').value = item[5];
  document.getElementById('editStok').value = item[6];
  document.getElementById('editBarcode').value = item[8] || '';
  document.getElementById('editDeskripsi').value = item[10] || '';
  document.getElementById('editFotoProduk').value = '';

  const variants = parseProductVariants(item[9]);
  const toggleEdit = document.getElementById('toggleEditVariants');
  const editList = document.getElementById('editVariantList');
  editList.innerHTML = '';

  if (variants && variants.length > 0) {
    toggleEdit.checked = true;
    toggleVariantMode('edit');
    editList.innerHTML = '';
    variants.forEach(v => {
      tambahBarisUkuran('edit', v.size, v.stok !== null ? v.stok : 0);
    });
  } else {
    toggleEdit.checked = false;
    toggleVariantMode('edit');
  }

  new bootstrap.Modal(document.getElementById('modalEditProduk')).show();
}

function handleEditSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveEdit');
  const fileInput = document.getElementById('editFotoProduk');
  const file = fileInput.files[0];

  const variants = kumpulkanDataUkuran('edit');
  const ukuranPayload = variants ? JSON.stringify(variants) : "";
  const totalStok = variants ? variants.reduce((s, v) => s + v.stok, 0) : Number(document.getElementById('editStok').value || 0);

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Menyimpan...';

  const editData = {
    idProduk: document.getElementById('editIdProduk').value,
    namaProduk: document.getElementById('editNamaProduk').value,
    kategoriMain: document.getElementById('editKategoriMain').value,
    subKategori: document.getElementById('editSubKategori').value,
    harga: document.getElementById('editHarga').value,
    stok: totalStok,
    barcode: document.getElementById('editBarcode').value,
    ukuran: ukuranPayload,
    deskripsi: document.getElementById('editDeskripsi').value,
    fileData: null,
    fileName: null
  };

  const kirimEdit = async (payload) => {
    try {
      const res = await postToAPI({ action: "editProduk", data: payload });
      btn.disabled = false;
      btn.innerHTML = 'Simpan Perubahan';
      if (res.success) {
        bootstrap.Modal.getInstance(document.getElementById('modalEditProduk')).hide();
        showToast(res.message);
        initData();
      } else {
        showToast(res.message, "error");
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = 'Simpan Perubahan';
      showToast("Gagal memperbarui: " + err.message, "error");
    }
  };

  if (file) {
    const reader = new FileReader();
    reader.onload = function(event) {
      editData.fileData = event.target.result;
      editData.fileName = file.name;
      kirimEdit(editData);
    };
    reader.readAsDataURL(file);
  } else {
    kirimEdit(editData);
  }
}

function handleFormSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmit');
  const form = document.getElementById('formProduk');
  const fileInput = form.querySelector('input[name="fotoProduk"]');
  const file = fileInput.files[0];

  const variants = kumpulkanDataUkuran('add');
  const ukuranPayload = variants ? JSON.stringify(variants) : "";
  const totalStok = variants ? variants.reduce((s, v) => s + v.stok, 0) : Number(form.stok.value || 0);

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Mengunggah...';

  const formData = {
    namaProduk: form.namaProduk.value,
    kategoriMain: form.kategoriMain.value,
    subKategori: form.subKategori.value,
    harga: form.harga.value,
    stok: totalStok,
    barcode: form.barcode.value,
    ukuran: ukuranPayload,
    deskripsi: form.deskripsi.value,
    fileData: null,
    fileName: null
  };

  const kirimData = async (payload) => {
    try {
      const res = await postToAPI({ action: "simpanProduk", data: payload });
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up me-1"></i> Simpan Produk';
      if (res.success) {
        showToast(res.message);
        form.reset();
        document.getElementById('addVariantList').innerHTML = '';
        document.getElementById('toggleAddVariants').checked = false;
        toggleVariantMode('add');
        initData();
      } else {
        showToast(res.message, "error");
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up me-1"></i> Simpan Produk';
      showToast("Gagal mengunggah: " + err.message, "error");
    }
  };

  if (file) {
    const reader = new FileReader();
    reader.onload = function(event) {
      formData.fileData = event.target.result;
      formData.fileName = file.name;
      kirimData(formData);
    };
    reader.readAsDataURL(file);
  } else {
    kirimData(formData);
  }
}

async function hapus(id) {
  if (confirm("Yakin ingin menghapus produk ini secara permanen?")) {
    try {
      const res = await postToAPI({ action: "hapusProduk", id: id });
      if (res.success) {
        showToast(res.message);
        initData();
      } else {
        showToast(res.message, "error");
      }
    } catch (err) {
      showToast("Gagal menghapus: " + err.message, "error");
    }
  }
}

// --- LAPORAN, FILTER TANGGAL & GRAFIK ---
function formatWaktuTx(rawWaktu) {
  const str = String(rawWaktu || '');
  if (str.includes('T') && str.endsWith('Z')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('id-ID', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    }
  }
  return str;
}

function bukaDetailTransaksi(txId) {
  const tx = globalTx.find(t => String(t[0]) === String(txId));
  if (!tx) return;

  document.getElementById('detTxId').innerText = tx[0];
  document.getElementById('detTxWaktu').innerText = formatWaktuTx(tx[1]);
  document.getElementById('detTxMetode').innerText = tx[4] || 'Tunai';

  const itemsRaw = String(tx[2] || '-');
  const itemListHtml = itemsRaw.split(', ').map(item => `<li class="mb-1 fw-semibold">${item}</li>`).join('');
  document.getElementById('detTxItemsList').innerHTML = itemListHtml;

  const total = Number(tx[3] || 0);
  const subtotal = tx[5] !== undefined && tx[5] !== '' ? Number(tx[5]) : total;
  const diskon = Number(tx[6] || 0);

  document.getElementById('detTxSubtotal').innerText = formatRupiah(subtotal);
  document.getElementById('detTxDiskon').innerText = "- " + formatRupiah(diskon);
  document.getElementById('detTxTotal').innerText = formatRupiah(total);

  new bootstrap.Modal(document.getElementById('modalDetailTx')).show();
}

function renderLaporan() {
  const tglMulai = document.getElementById('filterTglMulai')?.value;
  const tglAkhir = document.getElementById('filterTglAkhir')?.value;

  const filteredTx = globalTx.filter(t => {
    const rawDate = String(t[1] || '').split(' ')[0].split('T')[0];
    if (!tglMulai && !tglAkhir) return true;
    
    let normDate = rawDate;
    if (rawDate.includes('/')) {
      const parts = rawDate.split('/');
      if (parts.length === 3) normDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }

    if (tglMulai && normDate < tglMulai) return false;
    if (tglAkhir && normDate > tglAkhir) return false;
    return true;
  });

  let html = '';
  let totalFiltered = 0;
  filteredTx.slice().reverse().forEach(t => {
    totalFiltered += Number(t[3] || 0);
    const rincianBarang = String(t[2] || '-');
    const waktuRapi = formatWaktuTx(t[1]);

    html += `<tr style="cursor: pointer;" onclick="bukaDetailTransaksi('${t[0]}')" title="Klik untuk detail transaksi">
      <td class="small fw-bold text-nowrap">${t[0]}</td>
      <td class="small text-nowrap">${waktuRapi}</td>
      <td class="small">${rincianBarang}</td>
      <td class="text-orange fw-bold text-nowrap">${formatRupiah(t[3])}</td>
      <td><span class="badge bg-info text-dark">${t[4]}</span></td>
    </tr>`;
  });

  document.getElementById('tabelTxBody').innerHTML = html || '<tr><td colspan="5" class="text-center text-muted py-3">Belum ada transaksi pada periode ini</td></tr>';
  document.getElementById('badgeTotalFilter').innerText = `Total: ${formatRupiah(totalFiltered)}`;

  const ctx = document.getElementById('chartPenjualan').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: filteredTx.map(t => formatWaktuTx(t[1])),
      datasets: [{
        label: 'Omset Penjualan (Rp)',
        data: filteredTx.map(t => Number(t[3] || 0)),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.15)',
        tension: 0.3,
        fill: true
      }]
    }
  });
}

function resetFilterTanggal() {
  document.getElementById('filterTglMulai').value = '';
  document.getElementById('filterTglAkhir').value = '';
  renderLaporan();
}

function cetakLaporanPDF() {
  window.print();
}

function eksporExcel() {
  let csv = "ID,Tanggal,Nama,Kategori Utama,Sub Kategori,Harga,Total Stok,Barcode,Variasi Ukuran,Deskripsi\n";
  globalStok.forEach(r => { csv += `"${r[0]}","${r[1]}","${r[2]}","${r[3]}","${r[4]}",${r[5]},${r[6]},"${r[8] || ''}","${String(r[9] || '').replace(/"/g, '""')}","${String(r[10] || '').replace(/"/g, '""')}"\n`; });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'SportCenter_Stok.csv';
  a.click();
}

function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
}

window.onload = function() {
  loadSavedTheme();
  updateAdminUI();
  initData();
};