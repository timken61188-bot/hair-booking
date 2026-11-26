// 客人端（在 LINE 裡用 LIFF 開啟）
let idToken = null;
let me = null;          // { customer, bookings }
let settings = null;
let services = [];
let closed = new Set();
let works = [];
let page = "book";
const pick = { service: null, date: null, time: null, slots: null };
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
  ({ book: renderBook, mine: renderMine, works: renderWorks, price: renderPrice })[p]();
  window.scrollTo(0, 0);
}

// ---------- 預約 ----------
function renderBook() {
  const app = $("#app");
  if (!services.length) { app.innerHTML = `<div class="empty">目前尚未開放線上預約</div>`; return; }

  const today = twToday();
  calMonth ??= today.slice(0, 7);

  app.innerHTML = `
    ${settings.notice ? `<div class="card small">${esc(settings.notice).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>1　選擇服務</h2>
    ${services.map((s) => `
      <div class="card pick ${pick.service?.id === s.id ? "on" : ""}" data-svc="${esc(s.id)}">
        <div class="row between"><b>${esc(s.name)}</b><span class="price">${esc(fmtPrice(s))}</span></div>
        <div class="muted">約 ${fmtDur(s.durationMin)}${s.description ? "・" + esc(s.description) : ""}</div>
      </div>`).join("")}
    <h2 id="stepDate">2　選擇日期</h2>
    <div class="card" id="cal"></div>
    <div id="stepTime" class="${pick.date ? "" : "hidden"}">
      <h2>3　選擇時間</h2>
      <div id="slots"></div>
    </div>
    <div id="stepForm" class="${pick.time ? "" : "hidden"}">
      <h2>4　聯絡資料</h2>
      <div class="card">
        <label class="f"><span>姓名</span><input type="text" id="fName" value="${esc(me.customer.name)}" maxlength="50"></label>
        <label class="f"><span>手機</span><input type="tel" id="fPhone" value="${esc(me.customer.phone)}" maxlength="30" placeholder="09xx-xxx-xxx"></label>
        <label class="f" style="margin:0"><span>備註（選填）</span><textarea id="fNote" maxlength="500" placeholder="想要的造型、髮長、是否需要洗髮等"></textarea></label>
      </div>
    </div>`;

  $$("[data-svc]").forEach((el) => el.addEventListener("click", () => {
    pick.service = services.find((s) => s.id === el.dataset.svc);
    pick.time = null; pick.slots = null;
    renderBook();
    if (pick.date) loadSlots();
    $("#stepDate").scrollIntoView({ behavior: "smooth", block: "start" });
    if (!pick.date) toast("請在月曆上選日期");
  }));
  drawCalendar();
  if (pick.date && pick.slots) drawSlots();
  updateBar();
}

// ---------- 月曆 ----------
function monthAdd(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
async function drawCalendar() {
  const box = $("#cal");
  if (!box) return;
  const today = twToday();
  const minMonth = today.slice(0, 7), maxMonth = addDays(today, settings.daysAhead).slice(0, 7);
  const [y, m] = calMonth.split("-").map(Number);
  const key = `${pick.service?.id || ""}|${calMonth}`;
  const head = `
    <div class="row between" style="margin-bottom:8px">
      <button class="btn ghost sm" id="calPrev" ${calMonth <= minMonth ? "disabled" : ""}>‹</button>
      <b>${y} 年 ${m} 月</b>
      <button class="btn ghost sm" id="calNext" ${calMonth >= maxMonth ? "disabled" : ""}>›</button>
    </div>`;
  if (!monthCache[key]) {
    box.innerHTML = head + `<div class="muted center" style="padding:40px 0">查詢中…</div>`;
    bindNav();
    try { monthCache[key] = (await api("month", { month: calMonth, serviceId: pick.service?.id || "" })).days; }
    catch (e) { box.innerHTML = head + `<div class="muted center">${esc(e.message)}</div>`; bindNav(); return; }
    if (key !== `${pick.service?.id || ""}|${calMonth}`) return;   // 使用者已切換
  }
  const days = monthCache[key];
  const first = `${calMonth}-01`;
  const lead = weekdayOf(first);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<div></div>`);
  Object.keys(days).sort().forEach((d) => {
    const st = days[d];
    const label = { open: "可約", full: "額滿", closed: "公休", out: "" }[st];
    cells.push(`<button class="cal-day ${st} ${pick.date === d ? "on" : ""} ${d === today ? "today" : ""}" data-date="${d}" ${st === "open" ? "" : "disabled"}>
      <b>${Number(d.slice(8))}</b><small>${label}</small></button>`);
  });
  box.innerHTML = head + `
    <div class="cal-grid">${WEEK.map((w) => `<div class="cal-w">${w}</div>`).join("")}${cells.join("")}</div>
    <div class="cal-legend"><span><i class="open"></i>可預約</span><span><i class="full"></i>已約滿</span><span><i class="closed"></i>公休</span></div>
    ${pick.service ? "" : `<div class="muted small center" style="margin-top:6px">先選服務，月曆會依服務時間顯示得更準確</div>`}`;
  bindNav();
  $$("[data-date]", box).forEach((el) => el.addEventListener("click", () => {
    if (!pick.service) { toast("請先選擇服務"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    pick.date = el.dataset.date; pick.time = null;
    $$("[data-date]", box).forEach((b) => b.classList.toggle("on", b === el));
    $("#stepTime").classList.remove("hidden");
    $("#stepForm").classList.add("hidden");
    updateBar();
    loadSlots();
  }));
  function bindNav() {
    $("#calPrev", box).onclick = () => { calMonth = monthAdd(calMonth, -1); drawCalendar(); };
    $("#calNext", box).onclick = () => { calMonth = monthAdd(calMonth, 1); drawCalendar(); };
  }
}

async function loadSlots() {
  const box = $("#slots");
  box.innerHTML = `<div class="muted">查詢中…</div>`;
  try {
    const { slots } = await api("slots", { date: pick.date, serviceId: pick.service.id });
    pick.slots = slots;
    drawSlots();
    $("#stepTime").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { box.innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}

function drawSlots() {
  const box = $("#slots");
  if (!pick.slots.length) { box.innerHTML = `<div class="card muted center">這天已經約滿了，換一天看看 🙏</div>`; return; }
  box.innerHTML = `<div class="slots">${pick.slots.map((t) => `<button class="slot ${pick.time === t ? "on" : ""}" data-time="${t}">${t}</button>`).join("")}</div>`;
  $$("[data-time]", box).forEach((el) => el.addEventListener("click", () => {
    pick.time = el.dataset.time;
    $$("[data-time]", box).forEach((b) => b.classList.toggle("on", b === el));
    $("#stepForm").classList.remove("hidden");
    updateBar();
    $("#stepForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function updateBar() {
  const bar = $("#bar"), btn = $("#barBtn");
  if (page !== "book" || !pick.service || !pick.date || !pick.time) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = `確認預約　${fmtDate(pick.date)} ${pick.time}`;
  btn.onclick = submitBooking;
}

async function submitBooking() {
  const name = $("#fName").value.trim(), phone = $("#fPhone").value.trim();
  if (!name || !phone) { toast("請填寫姓名和手機"); $("#fName").focus(); return; }
  const btn = $("#barBtn");
  btn.disabled = true; btn.textContent = "送出中…";
  try {
    const { booking } = await api("book", {
      serviceId: pick.service.id, date: pick.date, time: pick.time,
      name, phone, note: $("#fNote").value.trim(),
    });
    me.customer.name = name; me.customer.phone = phone;
    me.bookings.unshift(booking);
    const ok = booking.status === "confirmed";
    $("#bar").classList.add("hidden");
    $("#app").innerHTML = `
      <div class="success">
        <div class="big">${ok ? "🎉" : "📩"}</div>
        <h2 style="color:var(--ink);font-size:20px">${ok ? "預約成功！" : "已送出預約"}</h2>
        <p>${fmtWhen(booking.start)}<br>${esc(booking.serviceName)}</p>
        <p class="muted">${ok ? "前一天晚上會用 LINE 提醒你" : "設計師確認後會用 LINE 通知你"}</p>
        <br><button class="btn ghost" onclick="go('mine')">查看我的預約</button>
      </div>`;
    Object.assign(pick, { service: null, date: null, time: null, slots: null });
    Object.keys(monthCache).forEach((k) => delete monthCache[k]);
  } catch (e) {
    toast(e.message, 3500);
    if (/時段/.test(e.message)) { Object.keys(monthCache).forEach((k) => delete monthCache[k]); pick.time = null; $("#stepForm").classList.add("hidden"); loadSlots(); }
    updateBar();
  }
}

// ---------- 我的預約 ----------
function renderMine() {
  const now = Date.now();
  const upcoming = me.bookings.filter((b) => b.start >= now && ["pending", "confirmed"].includes(b.status)).sort((a, b) => a.start - b.start);
  const past = me.bookings.filter((b) => !upcoming.includes(b));
  const card = (b, canCancel) => `
    <div class="card">
      <div class="row between"><b>${fmtWhen(b.start)}</b><span class="badge ${b.status}">${STATUS[b.status]}</span></div>
      <div>${esc(b.serviceName)}</div>
      ${b.note ? `<div class="muted small">備註：${esc(b.note)}</div>` : ""}
      ${canCancel ? `<div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn danger sm" data-cancel="${esc(b.id)}">取消預約</button></div>` : ""}
    </div>`;
  $("#app").innerHTML = `
    <h2>即將到來</h2>
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
    try { await api("cancel", { bookingId: b.id }); b.status = "cancelled"; Object.keys(monthCache).forEach((k) => delete monthCache[k]); toast("已取消預約"); renderMine(); }
    catch (e) { toast(e.message); el.disabled = false; }
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
