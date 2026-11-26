// 客人端（在 LINE 裡用 LIFF 開啟）
let idToken = null;
let me = null;          // { customer, bookings }
let settings = null;
let services = [];
let closed = new Set();
let works = [];
let page = "book";
const pick = { services: [], date: null, time: null, slots: null, reschedule: null };
let calMonth = null;          // "YYYY-MM"
const monthCache = {};        // key: serviceId|month → { date: status }

async function api(action, data = {}) {
  try {
    return await callApi(action, { idToken, ...data });
  } catch (e) {
    if (e.code === "LINE_LOGIN_EXPIRED") { liff.logout(); liff.login({ redirectUri: location.href }); throw new Error("重新登入中…"); }
    throw e;
  }
}

async function init() {
  try {
    const pub = await callApi("public");
    settings = pub.settings; services = pub.services; closed = new Set(pub.closedDates); works = pub.portfolio;
    $("#shopName").textContent = settings.shopName;
    $("#shopSub").textContent = settings.designerName ? `設計師 ${settings.designerName}` : "";
    document.title = settings.shopName + "｜線上預約";

    await liff.init({ liffId: pub.liffId });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    idToken = liff.getIDToken();
    const q = new URLSearchParams(location.search).get("page");
    if (["book", "mine", "works", "price"].includes(q)) page = q;
    me = await api("me");

    $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
    go(page);
  } catch (e) {
    $("#app").innerHTML = `<div class="empty">${esc(e.message)}<br><br><button class="btn ghost sm" onclick="location.reload()">重新整理</button></div>`;
  }
}

function go(p) {
  page = p;
  $$("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.page === p));
  $("#bar").classList.add("hidden");
  if (p !== "book") pick.reschedule = null;
  ({ book: renderBook, mine: renderMine, works: renderWorks, price: renderPrice })[p]();
  window.scrollTo(0, 0);
}

// ---------- 預約 ----------
const clearMonthCache = () => Object.keys(monthCache).forEach((k) => delete monthCache[k]);
const totalMin = () => pick.services.reduce((n, s) => n + (s.durationMin || 0), 0);
function totalPrice() {
  if (pick.services.some((s) => s.price == null)) return "現場報價";
  const n = pick.services.reduce((t, s) => t + Number(s.price), 0);
  return `$${n.toLocaleString()}${pick.services.some((s) => s.priceNote) ? " 起" : ""}`;
}
// 月曆與時段要用的參數
function calParams() {
  if (pick.reschedule) return { key: `R${pick.reschedule.id}`, data: { durationMin: Math.round((pick.reschedule.end - pick.reschedule.start) / 60e3) } };
  const ids = pick.services.map((s) => s.id);
  return { key: ids.join(","), data: { serviceIds: ids } };
}
const ready = () => (pick.reschedule || pick.services.length) && pick.date && pick.time;

function renderBook() {
  const app = $("#app");
  if (!services.length) { app.innerHTML = `<div class="empty">目前尚未開放線上預約</div>`; return; }
  calMonth ??= twToday().slice(0, 7);
  const r = pick.reschedule;

  app.innerHTML = `
    ${settings.notice && !r ? `<div class="card small">${esc(settings.notice).replace(/\n/g, "<br>")}</div>` : ""}
    ${r ? `
      <div class="card" style="border-color:var(--accent);background:var(--accent-soft)">
        <div class="row between"><b>🔁 改期</b><button class="btn ghost sm" id="rsCancel">不改了</button></div>
        <div style="margin-top:4px">${esc(r.serviceName)}</div>
        <div class="muted small">原本時間：${fmtWhen(r.start)}</div>
      </div>
      <h2 id="stepDate">選擇新的日期</h2>` : `
      <h2>1　選擇服務 <span style="font-weight:400">（可以複選）</span></h2>
      ${services.map((s) => `
        <div class="card pick ${pick.services.some((x) => x.id === s.id) ? "on" : ""}" data-svc="${esc(s.id)}">
          <div class="row between"><b>${pick.services.some((x) => x.id === s.id) ? "✓ " : ""}${esc(s.name)}</b><span class="price">${esc(fmtPrice(s))}</span></div>
          <div class="muted">約 ${fmtDur(s.durationMin)}${s.description ? "・" + esc(s.description) : ""}</div>
        </div>`).join("")}
      ${pick.services.length > 1 ? `<div class="card small" style="background:var(--ink);color:#fff">已選 ${pick.services.length} 項：${esc(pick.services.map((s) => s.name).join("＋"))}<br>約 ${fmtDur(totalMin())}・${esc(totalPrice())}</div>` : ""}
      <h2 id="stepDate">2　選擇日期</h2>`}
    <div class="card" id="cal"></div>
    <div id="stepTime" class="${pick.date ? "" : "hidden"}">
      <h2>${r ? "選擇新的時間" : "3　選擇時間"}</h2>
      <div id="slots"></div>
    </div>
    ${r ? "" : `
    <div id="stepForm" class="${pick.time ? "" : "hidden"}">
      <h2>4　聯絡資料</h2>
      <div class="card">
        <label class="f"><span>姓名</span><input type="text" id="fName" value="${esc(me.customer.name)}" maxlength="50"></label>
        <label class="f"><span>手機</span><input type="tel" id="fPhone" value="${esc(me.customer.phone)}" maxlength="30" placeholder="09xx-xxx-xxx"></label>
        <label class="f" style="margin:0"><span>備註（選填）</span><textarea id="fNote" maxlength="500" placeholder="想要的造型、髮長、是否需要洗髮等"></textarea></label>
      </div>
    </div>`}`;

  $$("[data-svc]").forEach((el) => el.addEventListener("click", () => {
    const s = services.find((x) => x.id === el.dataset.svc);
    const i = pick.services.findIndex((x) => x.id === s.id);
    if (i >= 0) pick.services.splice(i, 1); else pick.services.push(s);
    pick.services.sort((a, b) => services.indexOf(a) - services.indexOf(b));
    pick.time = null; pick.slots = null;
    const y = window.scrollY;
    renderBook();
    window.scrollTo(0, y);
    if (pick.date && pick.services.length) loadSlots(false);
  }));
  $("#rsCancel")?.addEventListener("click", () => { pick.reschedule = null; pick.date = null; pick.time = null; go("mine"); });
  drawCalendar();
  if (pick.date && pick.slots) drawSlots();
  updateBar();
}

// ---------- 月曆 ----------
function monthAdd(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
async function drawCalendar() {
  const box = $("#cal");
  if (!box) return;
  const today = twToday();
  const minMonth = today.slice(0, 7), maxMonth = addDays(today, settings.daysAhead).slice(0, 7);
  const [y, m] = calMonth.split("-").map(Number);
  const cp = calParams();
  const key = `${cp.key}|${calMonth}`;
  const head = `
    <div class="row between" style="margin-bottom:8px">
      <button class="btn ghost sm" id="calPrev" ${calMonth <= minMonth ? "disabled" : ""}>‹</button>
      <b>${y} 年 ${m} 月</b>
      <button class="btn ghost sm" id="calNext" ${calMonth >= maxMonth ? "disabled" : ""}>›</button>
    </div>`;
  const bindNav = () => {
    $("#calPrev", box).onclick = () => { calMonth = monthAdd(calMonth, -1); drawCalendar(); };
    $("#calNext", box).onclick = () => { calMonth = monthAdd(calMonth, 1); drawCalendar(); };
  };
  if (!monthCache[key]) {
    box.innerHTML = head + `<div class="muted center" style="padding:40px 0">查詢中…</div>`;
    bindNav();
    try { monthCache[key] = (await api("month", { month: calMonth, ...cp.data })).days; }
    catch (e) { box.innerHTML = head + `<div class="muted center">${esc(e.message)}</div>`; bindNav(); return; }
    if (key !== `${calParams().key}|${calMonth}` || !document.body.contains(box)) return;   // 使用者已切換
  }
  const days = monthCache[key];
  const cells = [];
  for (let i = 0; i < weekdayOf(`${calMonth}-01`); i++) cells.push(`<div></div>`);
  Object.keys(days).sort().forEach((d) => {
    const st = days[d];
    const label = { open: "可約", full: "額滿", closed: "公休", out: "" }[st];
    cells.push(`<button class="cal-day ${st} ${pick.date === d ? "on" : ""} ${d === today ? "today" : ""}" data-date="${d}" ${st === "open" ? "" : "disabled"}>
      <b>${Number(d.slice(8))}</b><small>${label}</small></button>`);
  });
  box.innerHTML = head + `
    <div class="cal-grid">${WEEK.map((w) => `<div class="cal-w">${w}</div>`).join("")}${cells.join("")}</div>
    <div class="cal-legend"><span><i class="open"></i>可預約</span><span><i class="full"></i>已約滿</span><span><i class="closed"></i>公休</span></div>
    ${pick.reschedule || pick.services.length ? "" : `<div class="muted small center" style="margin-top:6px">先選服務，月曆會依服務時間顯示得更準確</div>`}`;
  bindNav();
  $$("[data-date]", box).forEach((el) => el.addEventListener("click", () => {
    if (!pick.reschedule && !pick.services.length) { toast("請先選擇服務"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    pick.date = el.dataset.date; pick.time = null;
    $$("[data-date]", box).forEach((b) => b.classList.toggle("on", b === el));
    $("#stepTime").classList.remove("hidden");
    $("#stepForm")?.classList.add("hidden");
    updateBar();
    loadSlots(true);
  }));
}

async function loadSlots(scroll) {
  const box = $("#slots");
  box.innerHTML = `<div class="muted">查詢中…</div>`;
  try {
    const data = pick.reschedule ? { bookingId: pick.reschedule.id } : { serviceIds: pick.services.map((s) => s.id) };
    const { slots } = await api("slots", { date: pick.date, ...data });
    pick.slots = slots;
    drawSlots();
    if (scroll) $("#stepTime").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { box.innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}

function drawSlots() {
  const box = $("#slots");
  if (!pick.slots.length) {
    box.innerHTML = `<div class="card muted center">這天${pick.services.length > 1 ? "排不進這麼長的時間" : "已經約滿了"}，換一天看看 🙏</div>`;
    return;
  }
  box.innerHTML = `<div class="slots">${pick.slots.map((t) => `<button class="slot ${pick.time === t ? "on" : ""}" data-time="${t}">${t}</button>`).join("")}</div>`;
  $$("[data-time]", box).forEach((el) => el.addEventListener("click", () => {
    pick.time = el.dataset.time;
    $$("[data-time]", box).forEach((b) => b.classList.toggle("on", b === el));
    $("#stepForm")?.classList.remove("hidden");
    updateBar();
    ($("#stepForm") || $("#stepTime")).scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function updateBar() {
  const bar = $("#bar"), btn = $("#barBtn");
  if (page !== "book" || !ready()) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = `${pick.reschedule ? "確認改期" : "確認預約"}　${fmtDate(pick.date)} ${pick.time}`;
  btn.onclick = pick.reschedule ? submitReschedule : submitBooking;
}

function showDone(booking, title, line) {
  $("#bar").classList.add("hidden");
  $("#app").innerHTML = `
    <div class="success">
      <div class="big">${booking.status === "confirmed" ? "🎉" : "📩"}</div>
      <h2 style="color:var(--ink);font-size:20px">${title}</h2>
      <p>${fmtWhen(booking.start)}<br>${esc(booking.serviceName)}</p>
      <p class="muted">${line}</p>
      <br><button class="btn ghost" onclick="go('mine')">查看我的預約</button>
    </div>`;
  Object.assign(pick, { services: [], date: null, time: null, slots: null, reschedule: null });
  clearMonthCache();
}

function onSlotError(e) {
  toast(e.message, 3500);
  if (/時段/.test(e.message)) { clearMonthCache(); pick.time = null; $("#stepForm")?.classList.add("hidden"); loadSlots(false); drawCalendar(); }
  updateBar();
}

async function submitBooking() {
  const name = $("#fName").value.trim(), phone = $("#fPhone").value.trim();
  if (!name || !phone) { toast("請填寫姓名和手機"); $("#fName").focus(); return; }
  const btn = $("#barBtn");
  btn.disabled = true; btn.textContent = "送出中…";
  try {
    const { booking } = await api("book", {
      serviceIds: pick.services.map((s) => s.id), date: pick.date, time: pick.time,
      name, phone, note: $("#fNote").value.trim(),
    });
    me.customer.name = name; me.customer.phone = phone;
    me.bookings.unshift(booking);
    const ok = booking.status === "confirmed";
    showDone(booking, ok ? "預約成功！" : "已送出預約", ok ? "前一天晚上會用 LINE 提醒你" : "設計師確認後會用 LINE 通知你");
  } catch (e) { onSlotError(e); }
}

async function submitReschedule() {
  const btn = $("#barBtn");
  btn.disabled = true; btn.textContent = "送出中…";
  try {
    const { booking } = await api("reschedule", { bookingId: pick.reschedule.id, date: pick.date, time: pick.time });
    const i = me.bookings.findIndex((b) => b.id === booking.id);
    if (i >= 0) me.bookings[i] = booking;
    const ok = booking.status === "confirmed";
    showDone(booking, ok ? "改期成功！" : "已送出改期", ok ? "前一天晚上會用 LINE 提醒你" : "設計師確認後會用 LINE 通知你");
  } catch (e) { onSlotError(e); }
}

// ---------- 我的預約 ----------
function renderMine() {
  const now = Date.now();
  const upcoming = me.bookings.filter((b) => b.start >= now && ["pending", "confirmed"].includes(b.status)).sort((a, b) => a.start - b.start);
  const past = me.bookings.filter((b) => !upcoming.includes(b));
  const cutoff = (settings.cancelHours || 0) * 3600e3;
  const card = (b, upcomingCard) => { const canCancel = upcomingCard && b.start - now >= cutoff; return `
    <div class="card">
      <div class="row between"><b>${fmtWhen(b.start)}</b><span class="badge ${b.status}">${STATUS[b.status]}</span></div>
      <div>${esc(b.serviceName)}</div>
      ${b.note ? `<div class="muted small">備註：${esc(b.note)}</div>` : ""}
      ${canCancel ? `<div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn ghost sm" data-move="${esc(b.id)}">改期</button><button class="btn danger sm" data-cancel="${esc(b.id)}">取消預約</button></div>` : ""}
      ${upcomingCard && !canCancel ? `<div class="muted small" style="margin-top:8px">預約前 ${settings.cancelHours} 小時內無法線上改期或取消，如需更改請直接在聊天室傳訊息給設計師${settings.phone ? `，或來電 <a href="tel:${esc(settings.phone)}">${esc(settings.phone)}</a>` : ""}</div>` : ""}
    </div>`; };
  $("#app").innerHTML = `
    <h2>即將到來</h2>
    ${settings.cancelHours > 0 ? `<div class="muted small" style="margin:-4px 4px 8px">改期、取消請在預約前 ${settings.cancelHours} 小時操作</div>` : ""}
    ${upcoming.length ? upcoming.map((b) => card(b, true)).join("") : `<div class="card muted center">目前沒有預約<br><br><button class="btn accent sm" onclick="go('book')">立即預約</button></div>`}
    ${past.length ? `<h2>過去紀錄</h2>${past.map((b) => card(b, false)).join("")}` : ""}
    <h2>我的資料</h2>
    <div class="card">
      <label class="f"><span>姓名</span><input type="text" id="pName" value="${esc(me.customer.name)}"></label>
      <label class="f"><span>手機</span><input type="tel" id="pPhone" value="${esc(me.customer.phone)}"></label>
      <button class="btn ghost sm" id="pSave">儲存</button>
    </div>
    <p class="muted small center" style="margin-top:24px">LINE ID：${esc(me.customer.lineUserId)}</p>`;

  $$("[data-cancel]").forEach((el) => el.addEventListener("click", async () => {
    const b = me.bookings.find((x) => x.id === el.dataset.cancel);
    if (!confirm(`確定要取消 ${fmtWhen(b.start)} 的預約嗎？`)) return;
    el.disabled = true;
    try { await api("cancel", { bookingId: b.id }); b.status = "cancelled"; clearMonthCache(); toast("已取消預約"); renderMine(); }
    catch (e) { toast(e.message); el.disabled = false; }
  }));
  $$("[data-move]").forEach((el) => el.addEventListener("click", () => {
    pick.reschedule = me.bookings.find((x) => x.id === el.dataset.move);
    Object.assign(pick, { date: null, time: null, slots: null });
    calMonth = twParts(pick.reschedule.start).date.slice(0, 7);
    const keep = pick.reschedule;
    go("book"); pick.reschedule = keep; renderBook();
  }));
  $("#pSave").addEventListener("click", async () => {
    try {
      await api("save_profile", { name: $("#pName").value, phone: $("#pPhone").value });
      me.customer.name = $("#pName").value.trim(); me.customer.phone = $("#pPhone").value.trim();
      toast("已儲存");
    } catch (e) { toast(e.message); }
  });
}

// ---------- 作品集 ----------
function renderWorks() {
  $("#app").innerHTML = works.length
    ? `<div class="gallery">${works.map((w) => `<figure data-src="${esc(w.url)}"><img loading="lazy" src="${esc(w.url)}" alt="">${w.title ? `<figcaption>${esc(w.title)}</figcaption>` : ""}</figure>`).join("")}</div>`
    : `<div class="empty">作品整理中，敬請期待 ✨</div>`;
  $$("[data-src]").forEach((f) => f.addEventListener("click", () => viewImage(f.dataset.src)));
}

// ---------- 價目表 ----------
function renderPrice() {
  const map = settings.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}` : "";
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => settings.openWeekdays.includes(d)).map((d) => WEEK[d]).join("、");
  $("#app").innerHTML = `
    <h2>服務價目</h2>
    <div class="card">
      ${services.map((s, i) => `
        <div style="${i ? "border-top:1px solid var(--line);padding-top:10px;margin-top:10px" : ""}">
          <div class="row between"><b>${esc(s.name)}</b><span class="price">${esc(fmtPrice(s))}</span></div>
          <div class="muted small">約 ${fmtDur(s.durationMin)}${s.description ? "・" + esc(s.description) : ""}</div>
        </div>`).join("")}
    </div>
    <h2>店家資訊</h2>
    <div class="card">
      <div><b>${esc(settings.shopName)}</b></div>
      <div class="muted">營業：週${days}　${settings.openTime}–${settings.closeTime}</div>
      ${settings.address ? `<div style="margin-top:6px">📍 <a href="${map}" target="_blank">${esc(settings.address)}</a></div>` : ""}
      ${settings.phone ? `<div>📞 <a href="tel:${esc(settings.phone)}">${esc(settings.phone)}</a></div>` : ""}
    </div>
    <button class="btn accent block" onclick="go('book')">立即預約</button>`;
}

init();
