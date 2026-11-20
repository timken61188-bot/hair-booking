// 客人端（在 LINE 裡用 LIFF 開啟）
let idToken = null;
let me = null;          // { customer, bookings }
let settings = null;
let services = [];
let closed = new Set();
let works = [];
let page = "book";
const pick = { service: null, date: null, time: null, slots: null };

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
  const days = [];
  for (let i = 0; i <= settings.daysAhead; i++) {
    const d = addDays(today, i);
    days.push({ d, open: settings.openWeekdays.includes(weekdayOf(d)) && !closed.has(d) });
  }

  app.innerHTML = `
    ${settings.notice ? `<div class="card small">${esc(settings.notice).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>1　選擇服務</h2>
    ${services.map((s) => `
      <div class="card pick ${pick.service?.id === s.id ? "on" : ""}" data-svc="${esc(s.id)}">
        <div class="row between"><b>${esc(s.name)}</b><span class="price">${esc(fmtPrice(s))}</span></div>
        <div class="muted">約 ${fmtDur(s.durationMin)}${s.description ? "・" + esc(s.description) : ""}</div>
      </div>`).join("")}
    <div id="stepDate" class="${pick.service ? "" : "hidden"}">
      <h2>2　選擇日期</h2>
      <div class="chips">
        ${days.map(({ d, open }) => {
          const [, m, dd] = d.split("-").map(Number);
          return `<button class="chip ${pick.date === d ? "on" : ""}" data-date="${d}" ${open ? "" : "disabled"}>
            <small>${m}月</small><b>${dd}</b><small>${d === today ? "今天" : "週" + WEEK[weekdayOf(d)]}</small></button>`;
        }).join("")}
      </div>
    </div>
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
  }));
  $$("[data-date]").forEach((el) => el.addEventListener("click", () => {
    pick.date = el.dataset.date; pick.time = null;
    $$("[data-date]").forEach((b) => b.classList.toggle("on", b === el));
    $("#stepTime").classList.remove("hidden");
    $("#stepForm").classList.add("hidden");
    updateBar();
    loadSlots();
  }));
  $(".chip.on")?.scrollIntoView({ inline: "center", block: "nearest" });
  if (pick.date && pick.slots) drawSlots();
  updateBar();
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
  } catch (e) {
    toast(e.message, 3500);
    if (/時段/.test(e.message)) { pick.time = null; $("#stepForm").classList.add("hidden"); loadSlots(); }
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
    try { await api("cancel", { bookingId: b.id }); b.status = "cancelled"; toast("已取消預約"); renderMine(); }
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
