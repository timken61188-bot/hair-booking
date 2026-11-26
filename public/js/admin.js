// 設計師後台
let token = null;
let settings = null;
let services = [];
let liffId = "";
let page = "bookings";
let bookingFilter = "upcoming";

try { token = localStorage.getItem("adminToken"); } catch (_) {}

async function api(action, data = {}) {
  try {
    return await callApi(action, data, { "x-admin-token": token || "" });
  } catch (e) {
    if (e.code === "ADMIN_LOGIN_REQUIRED") { logout(); throw new Error("請重新登入"); }
    throw e;
  }
}
function logout() {
  token = null;
  try { localStorage.removeItem("adminToken"); } catch (_) {}
  showLogin();
}

// ---------- 登入 ----------
function showLogin() {
  $("#shell").classList.add("hidden");
  $("#login").classList.remove("hidden");
  const submit = async () => {
    $("#lBtn").disabled = true;
    try {
      const r = await callApi("admin_login", { password: $("#lPw").value });
      token = r.token;
      try { localStorage.setItem("adminToken", token); } catch (_) {}
      await start();
    } catch (e) { toast(e.message); }
    $("#lBtn").disabled = false;
  };
  $("#lBtn").onclick = submit;
  $("#lPw").onkeydown = (e) => { if (e.key === "Enter") submit(); };
}
async function start() {
  try { await loadBase(); } catch (e) { if (!token) return; toast(e.message); return; }
  $("#login").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  go(page);
}
async function loadBase() {
  const r = await api("admin_init");
  settings = r.settings; services = r.services; liffId = r.liffId;
  $("#shopName").textContent = settings.shopName;
}
function go(p) {
  page = p;
  $$("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.page === p));
  $("#app").innerHTML = `<div class="loading">載入中…</div>`;
  ({ bookings: pageBookings, customers: pageCustomers, works: pageWorks, services: pageServices, settings: pageSettings })[p]()
    .catch((e) => { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
}

// ---------- 預約 ----------
async function pageBookings() {
  const { bookings: list, blocks } = await api("admin_bookings", { filter: bookingFilter });
  const groups = {};
  list.forEach((b) => { (groups[b.date] ??= []).push(b); });
  if (bookingFilter === "upcoming") blocks.forEach((k) => { (groups[k.date] ??= []).push({ ...k, isBlock: true }); });
  const dates = Object.keys(groups).sort();
  if (bookingFilter === "past") dates.reverse();
  dates.forEach((d) => groups[d].sort((a, b) => (bookingFilter === "past" ? b.start - a.start : a.start - b.start)));

  $("#app").innerHTML = `
    <div class="row between wrap" style="margin-bottom:6px">
      <div class="row">
        ${[["upcoming", "即將到來"], ["pending", "待確認"], ["past", "過去 60 天"]].map(([k, t]) =>
          `<button class="btn sm ${bookingFilter === k ? "" : "ghost"}" data-f="${k}">${t}</button>`).join("")}
      </div>
      <div class="row">
        <button class="btn ghost sm" id="addBlock">封鎖時段</button>
        <button class="btn accent sm" id="addBooking">＋ 新增預約</button>
      </div>
    </div>
    ${dates.length ? dates.map((d) => { const arr = groups[d]; return `
      <h2>${fmtDate(d)}${d === twToday() ? "・今天" : ""}　${arr.filter((b) => !b.isBlock && b.status !== "cancelled").length} 位</h2>
      ${arr.map((b) => (b.isBlock ? blockCard(b) : bookingCard(b))).join("")}`; }).join("") : `<div class="empty">沒有預約</div>`}`;

  $$("[data-f]").forEach((b) => b.addEventListener("click", () => { bookingFilter = b.dataset.f; go("bookings"); }));
  $("#addBooking").onclick = () => newBookingSheet();
  $("#addBlock").onclick = () => blockSheet();
  $$("[data-unblock]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("解除這個封鎖時段？客人就可以預約這段時間。")) return;
    try { await api("admin_block_delete", { id: btn.dataset.unblock }); toast("已解除"); pageBookings(); } catch (e) { toast(e.message); }
  }));
  $$("[data-act]").forEach((btn) => btn.addEventListener("click", () => bookingAction(btn.dataset.id, btn.dataset.act, list)));
  $$("[data-cust]").forEach((el) => el.addEventListener("click", () => customerSheet(el.dataset.cust)));
}

function bookingCard(b) {
  const p = twParts(b.start), e = twParts(b.end);
  const acts = {
    pending: [["confirmed", "確認", "ok"], ["cancelled", "婉拒", "danger"]],
    confirmed: [["done", "完成", ""], ["cancelled", "取消", "danger"]],
    done: [["record", "寫紀錄", "ghost"]],
    cancelled: [],
  }[b.status];
  return `
    <div class="card">
      <div class="row between">
        <b>${p.hm}–${e.hm}　${esc(b.serviceName)}</b>
        <span class="badge ${b.status}">${STATUS[b.status]}</span>
      </div>
      <div class="row" style="margin-top:4px">
        <a href="javascript:void 0" data-cust="${esc(b.customerId)}">${esc(b.customerName || "（未填姓名）")}</a>
        ${b.customerPhone ? `<a class="muted" href="tel:${esc(b.customerPhone)}">${esc(b.customerPhone)}</a>` : ""}
        ${b.hasLine ? `<span class="badge">LINE</span>` : ""}
      </div>
      ${b.note ? `<div class="muted small">備註：${esc(b.note)}</div>` : ""}
      ${acts.length ? `<div class="row" style="margin-top:10px;justify-content:flex-end">
        ${acts.map(([a, t, cls]) => `<button class="btn sm ${cls}" data-act="${a}" data-id="${esc(b.id)}">${t}</button>`).join("")}</div>` : ""}
    </div>`;
}

function blockCard(k) {
  return `
    <div class="card row between" style="background:#f1ece8;border-style:dashed">
      <div><b>${twParts(k.start).hm}–${twParts(k.end).hm}　🚫 不開放預約</b>${k.note ? `<div class="muted small">${esc(k.note)}</div>` : ""}</div>
      <button class="btn ghost sm" data-unblock="${esc(k.id)}">解除</button>
    </div>`;
}

function blockSheet() {
  sheet(`
    <h3>封鎖時段</h3>
    <p class="muted small" style="margin-top:-6px">這段時間客人在 LINE 上就選不到。整天休息請到「設定 → 公休日」。</p>
    <label class="f"><span>日期</span><input type="date" id="bkDate" value="${twToday()}"></label>
    <div class="row">
      <label class="f grow"><span>開始</span><input type="time" id="bkStart" step="900" value="13:00"></label>
      <label class="f grow"><span>結束</span><input type="time" id="bkEnd" step="900" value="14:00"></label>
    </div>
    <label class="f"><span>原因（自己看的，選填）</span><input type="text" id="bkNote" placeholder="例如：看牙醫"></label>
    <div class="row"><button class="btn ghost grow" data-close>取消</button><button class="btn accent grow" id="bkSave">封鎖</button></div>`,
  (o, close) => {
    $("#bkSave", o).onclick = async () => {
      try {
        const r = await api("admin_block_add", { date: $("#bkDate", o).value, startTime: $("#bkStart", o).value, endTime: $("#bkEnd", o).value, note: $("#bkNote", o).value });
        close();
        toast(r.clash ? `已封鎖。注意：這段時間已經有 ${r.clash} 筆預約，請自行聯絡客人` : "已封鎖", r.clash ? 5000 : 2400);
        bookingFilter = "upcoming"; pageBookings();
      } catch (e) { toast(e.message); }
    };
  });
}

async function bookingAction(id, act, list) {
  const b = list.find((x) => x.id === id);
  if (act === "record") return recordSheet(b.customerId, null, b);
  let reason = "";
  if (act === "cancelled") {
    reason = prompt(`取消 ${b.customerName} ${fmtWhen(b.start)} 的預約？\n可以填寫原因（會傳給客人，可留空）：`);
    if (reason === null) return;
  }
  try {
    await api("admin_set_status", { bookingId: b.id, status: act, reason });
    toast({ confirmed: "已確認，已通知客人", cancelled: "已取消", done: "已完成" }[act]);
    if (act === "done") recordSheet(b.customerId, null, b);
    pageBookings();
  } catch (e) { toast(e.message); }
}

async function newBookingSheet() {
  const { customers } = await api("admin_customers");
  customers.sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hant"));
  sheet(`
    <h3>新增預約（電話／現場）</h3>
    <label class="f"><span>客人</span>
      <select id="nbCust"><option value="">＋ 新客人</option>
        ${customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} ${esc(c.phone)}</option>`).join("")}</select></label>
    <div id="nbNew" class="row">
      <label class="f grow"><span>姓名</span><input type="text" id="nbName"></label>
      <label class="f grow"><span>電話</span><input type="tel" id="nbPhone"></label>
    </div>
    <label class="f"><span>服務</span><select id="nbSvc">${services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}（${fmtDur(s.durationMin)}）</option>`).join("")}</select></label>
    <div class="row">
      <label class="f grow"><span>日期</span><input type="date" id="nbDate" value="${twToday()}"></label>
      <label class="f grow"><span>時間</span><input type="time" id="nbTime" step="900" value="${settings.openTime}"></label>
    </div>
    <label class="f"><span>時長（分鐘）</span><input type="number" id="nbDur" value="${services[0]?.durationMin || 60}"></label>
    <label class="f"><span>備註</span><textarea id="nbNote"></textarea></label>
    <div class="row"><button class="btn ghost grow" data-close>取消</button><button class="btn accent grow" id="nbSave">建立</button></div>`,
  (o, close) => {
    $("#nbCust", o).onchange = (e) => $("#nbNew", o).classList.toggle("hidden", !!e.target.value);
    $("#nbSvc", o).onchange = (e) => { $("#nbDur", o).value = services.find((s) => s.id === e.target.value).durationMin; };
    $("#nbSave", o).onclick = async () => {
      const btn = $("#nbSave", o); btn.disabled = true;
      try {
        await api("admin_create_booking", {
          customerId: $("#nbCust", o).value, newName: $("#nbName", o).value, newPhone: $("#nbPhone", o).value,
          serviceId: $("#nbSvc", o).value, date: $("#nbDate", o).value, time: $("#nbTime", o).value,
          durationMin: $("#nbDur", o).value, note: $("#nbNote", o).value,
        });
        close(); toast("已建立預約"); go("bookings");
      } catch (e) { toast(e.message, 3500); btn.disabled = false; }
    };
  });
}

// ---------- 客人 ----------
async function pageCustomers() {
  const { customers: all } = await api("admin_customers");
  $("#app").innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <input type="search" id="cq" placeholder="搜尋姓名、電話" class="grow">
      <button class="btn accent sm" id="cAdd">＋ 新客人</button>
    </div>
    <div class="muted small" style="margin:0 4px 8px">共 ${all.length} 位</div>
    <div id="clist"></div>`;
  const draw = () => {
    const q = $("#cq").value.trim().toLowerCase();
    const arr = all.filter((c) => !q || [c.name, c.phone, c.lineName].some((v) => (v || "").toLowerCase().includes(q)));
    $("#clist").innerHTML = arr.map((c) => `
      <div class="card pick row" data-cust="${esc(c.id)}">
        ${c.pictureUrl ? `<img src="${esc(c.pictureUrl)}" style="width:40px;height:40px;border-radius:50%">` : `<div style="width:40px;height:40px;border-radius:50%;background:var(--line)"></div>`}
        <div class="grow"><b>${esc(c.name || "（未填姓名）")}</b><div class="muted small">${esc(c.phone)}${c.lineName && c.lineName !== c.name ? "・LINE：" + esc(c.lineName) : ""}</div></div>
        ${c.hasLine ? `<span class="badge">LINE</span>` : ""}
      </div>`).join("") || `<div class="empty">找不到客人</div>`;
    $$("[data-cust]").forEach((el) => el.addEventListener("click", () => customerSheet(el.dataset.cust)));
  };
  $("#cq").addEventListener("input", draw);
  $("#cAdd").onclick = async () => {
    const name = prompt("客人姓名"); if (!name) return;
    const phone = prompt("電話（可留空）") || "";
    try { const { id } = await api("admin_save_customer", { name, phone, note: "" }); await pageCustomers(); customerSheet(id); }
    catch (e) { toast(e.message); }
  };
  draw();
}

async function customerSheet(id) {
  let data;
  try { data = await api("admin_customer", { id }); } catch (e) { return toast(e.message); }
  const { customer: c, records: recs, bookings: bks, stats } = data;
  sheet(`
    <div class="row between"><h3 style="margin:0">${esc(c.name || "客人")}</h3><button class="btn ghost sm" data-close>關閉</button></div>
    <br>
    <div class="card stats">
      <div><b>${stats.visits}</b><span>來店次數</span></div>
      <div><b>$${stats.total.toLocaleString()}</b><span>累計消費</span></div>
      <div><b>${stats.lastVisit ? fmtDate(stats.lastVisit).replace(/（.*/, "") : "—"}</b><span>上次來店</span></div>
      <div><b>${stats.cancelled}</b><span>取消次數</span></div>
    </div>
    <div class="card">
      <div class="row">
        <label class="f grow"><span>姓名</span><input type="text" id="cName" value="${esc(c.name)}"></label>
        <label class="f grow"><span>電話</span><input type="tel" id="cPhone" value="${esc(c.phone)}"></label>
      </div>
      <label class="f"><span>客人備註（髮質、過敏、喜好…）</span><textarea id="cNote">${esc(c.note)}</textarea></label>
      <div class="row wrap">
        <button class="btn sm" id="cSave">儲存</button>
        ${c.hasLine ? `<button class="btn ghost sm" id="cMsg">傳 LINE 訊息</button>` : `<span class="muted small">未綁定 LINE</span>`}
        <button class="btn danger sm" id="cDel" style="margin-left:auto">刪除客人</button>
      </div>
    </div>
    <div class="row between"><h2>服務紀錄（${recs.length} 筆）</h2><button class="btn accent sm" id="rAdd">＋ 新增紀錄</button></div>
    ${recs.map((r) => `
      <div class="card">
        <div class="row between"><b>${fmtDate(r.date)}　${esc(r.service)}</b>${r.price != null ? `<span class="price">$${Number(r.price).toLocaleString()}</span>` : ""}</div>
        ${r.formula ? `<div class="small" style="white-space:pre-wrap">🧪 ${esc(r.formula)}</div>` : ""}
        ${r.note ? `<div class="muted small" style="white-space:pre-wrap">${esc(r.note)}</div>` : ""}
        ${r.photos?.length ? `<div class="thumbs">${r.photos.map((p) => `<img src="${esc(p.url)}" data-view>`).join("")}</div>` : ""}
        <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn ghost sm" data-edit-rec="${esc(r.id)}">編輯</button></div>
      </div>`).join("") || `<div class="card muted center">還沒有紀錄</div>`}
    <h2>全部預約紀錄（${bks.length} 筆）</h2>
    ${bks.map((b) => `<div class="card row between"><span>${fmtWhen(b.start)}　${esc(b.serviceName)}</span><span class="badge ${b.status}">${STATUS[b.status]}</span></div>`).join("") || `<div class="card muted center">沒有預約</div>`}
  `, (o, close) => {
    $("#cSave", o).onclick = async () => {
      try {
        await api("admin_save_customer", { id, name: $("#cName", o).value, phone: $("#cPhone", o).value, note: $("#cNote", o).value });
        toast("已儲存");
        if (page === "customers") pageCustomers();
      } catch (e) { toast(e.message); }
    };
    $("#cMsg", o)?.addEventListener("click", async () => {
      const text = prompt(`要傳給 ${c.name} 的 LINE 訊息：`);
      if (!text) return;
      try { await api("admin_message", { customerId: id, text }); toast("已傳送"); } catch (e) { toast(e.message); }
    });
    $("#cDel", o).onclick = async () => {
      if (!confirm(`確定要刪除「${c.name}」？\n這位客人的預約、服務紀錄和照片都會一起刪除，無法復原。`)) return;
      try { await api("admin_delete_customer", { id }); close(); toast("已刪除"); go(page); } catch (e) { toast(e.message); }
    };
    $("#rAdd", o).onclick = () => { close(); recordSheet(id); };
    $$("[data-edit-rec]", o).forEach((b) => b.addEventListener("click", () => { close(); recordSheet(id, recs.find((r) => r.id === b.dataset.editRec)); }));
    $$("[data-view]", o).forEach((img) => img.addEventListener("click", () => viewImage(img.src)));
  });
}

function recordSheet(customerId, rec = null, booking = null) {
  const r = rec || { date: booking ? booking.date : twToday(), service: booking?.serviceName || "", formula: "", price: null, note: "", photos: [] };
  let photos = [...(r.photos || [])];
  const removed = [];
  sheet(`
    <h3>${rec ? "編輯" : "新增"}服務紀錄</h3>
    <div class="row">
      <label class="f grow"><span>日期</span><input type="date" id="rDate" value="${r.date}"></label>
      <label class="f grow"><span>金額</span><input type="number" id="rPrice" value="${r.price ?? ""}"></label>
    </div>
    <label class="f"><span>項目</span><input type="text" id="rSvc" value="${esc(r.service)}"></label>
    <label class="f"><span>配方（染膏、藥水、比例、時間）</span><textarea id="rFormula">${esc(r.formula)}</textarea></label>
    <label class="f"><span>備註</span><textarea id="rNote">${esc(r.note)}</textarea></label>
    <div id="rPhotos" class="thumbs"></div>
    <label class="f" style="margin-top:8px"><span>新增照片</span><input type="file" id="rFiles" accept="image/*" multiple></label>
    <div class="row">
      ${rec ? `<button class="btn danger" id="rDel">刪除</button>` : ""}
      <button class="btn ghost grow" data-close>取消</button>
      <button class="btn accent grow" id="rSave">儲存</button>
    </div>`,
  (o, close) => {
    const drawPhotos = () => {
      $("#rPhotos", o).innerHTML = photos.map((p, i) => `<div style="position:relative"><img src="${esc(p.url)}"><button class="btn sm" style="position:absolute;top:2px;right:2px;padding:0 6px;background:rgba(0,0,0,.6)" data-rm="${i}">×</button></div>`).join("");
      $$("[data-rm]", o).forEach((b) => b.onclick = () => { removed.push(photos[b.dataset.rm].path); photos.splice(b.dataset.rm, 1); drawPhotos(); });
    };
    drawPhotos();
    $("#rSave", o).onclick = async () => {
      const btn = $("#rSave", o); btn.disabled = true;
      try {
        const files = [...$("#rFiles", o).files];
        for (const [i, f] of files.entries()) {
          btn.textContent = `上傳照片 ${i + 1}/${files.length}`;
          photos.push(await api("admin_upload", { folder: "records", dataUrl: await imageToDataUrl(f) }));
        }
        btn.textContent = "儲存中…";
        await api("admin_save_record", {
          id: rec?.id, customerId, bookingId: rec?.bookingId ?? booking?.id ?? null,
          date: $("#rDate", o).value, service: $("#rSvc", o).value, formula: $("#rFormula", o).value,
          note: $("#rNote", o).value, price: $("#rPrice", o).value, photos, removed,
        });
        close(); toast("已儲存紀錄"); customerSheet(customerId);
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "儲存"; }
    };
    $("#rDel", o)?.addEventListener("click", async () => {
      if (!confirm("確定刪除這筆紀錄和照片？無法復原。")) return;
      try { await api("admin_delete_record", { id: rec.id }); close(); toast("已刪除"); customerSheet(customerId); }
      catch (e) { toast(e.message); }
    });
  });
}

// ---------- 作品集 ----------
async function pageWorks() {
  const { works: list } = await api("admin_portfolio");
  $("#app").innerHTML = `
    <div class="card">
      <label class="f"><span>作品說明（選填，例如「霧感奶茶色」）</span><input type="text" id="wTitle"></label>
      <label class="f"><span>選擇照片（可多選）</span><input type="file" id="wFiles" accept="image/*" multiple></label>
      <button class="btn accent" id="wUp">上傳</button>
    </div>
    <div class="gallery">${list.map((w) => `
      <figure><img loading="lazy" src="${esc(w.url)}" data-view>
        ${w.title ? `<figcaption>${esc(w.title)}</figcaption>` : ""}
        <button class="btn sm del" style="background:rgba(0,0,0,.55)" data-del="${esc(w.id)}">刪除</button></figure>`).join("")}</div>
    ${list.length ? "" : `<div class="empty">還沒有作品</div>`}`;
  $("#wUp").onclick = async () => {
    const files = [...$("#wFiles").files];
    if (!files.length) return toast("請先選照片");
    const btn = $("#wUp"); btn.disabled = true;
    try {
      for (const [i, f] of files.entries()) {
        btn.textContent = `上傳中 ${i + 1}/${files.length}`;
        const p = await api("admin_upload", { folder: "portfolio", dataUrl: await imageToDataUrl(f) });
        await api("admin_add_work", { ...p, title: $("#wTitle").value });
      }
      toast("已上傳"); pageWorks();
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "上傳"; }
  };
  $$("[data-view]").forEach((img) => img.addEventListener("click", () => viewImage(img.src)));
  $$("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm("刪除這張作品？")) return;
    try { await api("admin_delete_work", { id: b.dataset.del }); pageWorks(); } catch (err) { toast(err.message); }
  }));
}

// ---------- 服務項目 ----------
async function pageServices() {
  await loadBase();
  const card = (s) => `
    <div class="card" data-svc="${esc(s.id || "")}">
      <div class="row">
        <label class="f grow"><span>名稱</span><input type="text" name="name" value="${esc(s.name)}"></label>
        <label class="f" style="width:90px"><span>排序</span><input type="number" name="sort" value="${s.sort ?? 0}"></label>
      </div>
      <div class="row">
        <label class="f grow"><span>價格（空白=現場報價）</span><input type="number" name="price" value="${s.price ?? ""}"></label>
        <label class="f grow"><span>價格附註</span><input type="text" name="priceNote" value="${esc(s.priceNote)}" placeholder="起"></label>
        <label class="f grow"><span>時長（分）</span><input type="number" name="durationMin" value="${s.durationMin}"></label>
      </div>
      <label class="f"><span>說明</span><input type="text" name="description" value="${esc(s.description)}"></label>
      <div class="row between">
        <label class="row small"><input type="checkbox" name="active" ${s.active !== false ? "checked" : ""}> 開放預約</label>
        <div class="row">${s.id ? `<button class="btn danger sm" data-sdel>刪除</button>` : ""}<button class="btn sm" data-ssave>儲存</button></div>
      </div>
    </div>`;
  $("#app").innerHTML = `
    <div class="row between"><h2>服務項目</h2><button class="btn accent sm" id="sAdd">＋ 新增</button></div>
    <div id="newSvc"></div>
    ${services.map(card).join("")}`;
  $("#sAdd").onclick = () => {
    $("#newSvc").innerHTML = card({ name: "", price: null, priceNote: "", durationMin: 60, description: "", sort: services.length + 1, active: true });
    bind();
  };
  function bind() {
    $$("[data-svc]").forEach((el) => {
      const id = el.dataset.svc;
      $("[data-ssave]", el).onclick = async () => {
        const v = (n) => $(`[name=${n}]`, el);
        try {
          await api("admin_save_service", {
            id, name: v("name").value, description: v("description").value, durationMin: v("durationMin").value,
            price: v("price").value, priceNote: v("priceNote").value, sort: v("sort").value, active: v("active").checked,
          });
          toast("已儲存"); pageServices();
        } catch (e) { toast(e.message); }
      };
      const del = $("[data-sdel]", el);
      if (del) del.onclick = async () => {
        if (!confirm("刪除這個服務？（只想暫停可以取消勾選「開放預約」）")) return;
        try { await api("admin_delete_service", { id }); pageServices(); } catch (e) { toast(e.message); }
      };
    });
  }
  bind();
}

// ---------- 設定 ----------
async function pageSettings() {
  await loadBase();
  const { dates: closed } = await api("admin_closed_dates");
  const s = settings;
  const liff = liffId ? `https://liff.line.me/${liffId}` : "（尚未設定 LIFF ID）";
  $("#app").innerHTML = `
    <h2>店家資訊</h2>
    <div class="card">
      <label class="f"><span>店名</span><input type="text" id="sShop" value="${esc(s.shopName)}"></label>
      <label class="f"><span>設計師名稱</span><input type="text" id="sDesigner" value="${esc(s.designerName)}"></label>
      <label class="f"><span>地址</span><input type="text" id="sAddr" value="${esc(s.address)}"></label>
      <label class="f"><span>電話</span><input type="tel" id="sPhone" value="${esc(s.phone)}"></label>
      <label class="f"><span>預約頁公告（例如：遲到 15 分鐘以上需改期）</span><textarea id="sNotice">${esc(s.notice)}</textarea></label>
    </div>
    <h2>營業時間</h2>
    <div class="card">
      <div class="row wrap" style="margin-bottom:10px">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="row small"><input type="checkbox" data-wd="${d}" ${s.openWeekdays.includes(d) ? "checked" : ""}> 週${WEEK[d]}</label>`).join("")}
      </div>
      <div class="row">
        <label class="f grow"><span>開始</span><input type="time" id="sOpen" value="${s.openTime}"></label>
        <label class="f grow"><span>結束</span><input type="time" id="sClose" value="${s.closeTime}"></label>
      </div>
      <div class="row">
        <label class="f grow"><span>時段間隔（分）</span><input type="number" id="sSlot" value="${s.slotMinutes}"></label>
        <label class="f grow"><span>開放幾天內</span><input type="number" id="sAhead" value="${s.daysAhead}"></label>
        <label class="f grow"><span>至少提前（小時）</span><input type="number" id="sMin" value="${s.minNoticeHours}"></label>
      </div>
      <div class="f" style="margin-top:4px"><span class="muted small">每天固定休息（例如午休），這段時間不開放預約</span>
        <div id="brList"></div>
        <button class="btn ghost sm" id="brAdd" style="margin-top:6px">＋ 新增休息時間</button>
      </div>
      <label class="row small"><input type="checkbox" id="sAuto" ${s.autoConfirm ? "checked" : ""}> 客人預約後自動成立（不勾＝需要我確認）</label>
    </div>
    <button class="btn accent block" id="sSave">儲存設定</button>
    <h2>公休日／請假</h2>
    <div class="card">
      <div class="row">
        <input type="date" id="cdDate" class="grow" value="${twToday()}">
        <input type="text" id="cdNote" class="grow" placeholder="原因（選填）">
        <button class="btn sm" id="cdAdd">加入</button>
      </div>
      ${closed.map((c) => `<div class="row between" style="margin-top:10px"><span>${fmtDate(c.date)} ${esc(c.note)}</span><button class="btn danger sm" data-cd="${c.date}">移除</button></div>`).join("")}
    </div>
    <h2>連結</h2>
    <div class="card small">
      客人預約頁（放在 LINE 圖文選單）：<br><code>${esc(liff)}</code><br><br>
      其他分頁：在後面加上 <code>?page=mine</code>（我的預約）、<code>?page=works</code>（作品集）、<code>?page=price</code>（價目表）
    </div>
    <button class="btn ghost block" id="logout" style="margin-top:20px">登出</button>`;

  let breaks = (s.breaks || []).map((b) => ({ ...b }));
  const drawBreaks = () => {
    $("#brList").innerHTML = breaks.map((b, i) => `
      <div class="row" style="margin-top:6px">
        <input type="time" step="900" value="${b.start}" data-br="${i}" data-k="start">
        <span>–</span>
        <input type="time" step="900" value="${b.end}" data-br="${i}" data-k="end">
        <button class="btn danger sm" data-brdel="${i}">刪除</button>
      </div>`).join("") || `<div class="muted small" style="margin-top:4px">目前沒有</div>`;
    $$("[data-br]").forEach((el) => el.onchange = () => { breaks[el.dataset.br][el.dataset.k] = el.value; });
    $$("[data-brdel]").forEach((el) => el.onclick = () => { breaks.splice(el.dataset.brdel, 1); drawBreaks(); });
  };
  drawBreaks();
  $("#brAdd").onclick = () => { breaks.push({ start: "13:00", end: "14:00" }); drawBreaks(); };

  $("#sSave").onclick = async () => {
    if (breaks.some((b) => !b.start || !b.end || b.end <= b.start)) return toast("休息時間的結束要晚於開始");
    try {
      await api("admin_save_settings", { settings: {
        shopName: $("#sShop").value, designerName: $("#sDesigner").value, address: $("#sAddr").value,
        phone: $("#sPhone").value, notice: $("#sNotice").value,
        openWeekdays: $$("[data-wd]").filter((c) => c.checked).map((c) => Number(c.dataset.wd)),
        openTime: $("#sOpen").value, closeTime: $("#sClose").value, slotMinutes: $("#sSlot").value,
        daysAhead: $("#sAhead").value, minNoticeHours: $("#sMin").value, autoConfirm: $("#sAuto").checked,
        breaks, cancelHours: s.cancelHours,
      } });
      toast("已儲存"); pageSettings();
    } catch (e) { toast(e.message); }
  };
  $("#cdAdd").onclick = async () => {
    try { await api("admin_closed_add", { date: $("#cdDate").value, note: $("#cdNote").value }); pageSettings(); }
    catch (e) { toast(e.message); }
  };
  $$("[data-cd]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("admin_closed_delete", { date: b.dataset.cd }); pageSettings(); } catch (e) { toast(e.message); }
  }));
  $("#logout").onclick = logout;
}

$$("nav.tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
if (token) start(); else showLogin();
