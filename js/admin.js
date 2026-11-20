// 設計師後台
let session = null;
let settings = null;
let services = [];
let page = "bookings";
let bookingFilter = "upcoming";

async function adminApi(action, data = {}) {
  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
    body: JSON.stringify({ action, ...data }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "發生錯誤");
  return j;
}
function must({ data, error }) { if (error) throw new Error(friendly(error)); return data; }
function friendly(e) {
  if (e.code === "23P01") return "這個時段已經有其他預約";
  return e.message || String(e);
}

// ---------- 登入 ----------
async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_e, s) => { session = s; });
  if (!session) return showLogin();
  await start();
}
function showLogin() {
  $("#shell").classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#lBtn").onclick = async () => {
    $("#lBtn").disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPw").value });
    $("#lBtn").disabled = false;
    if (error) return toast("登入失敗：" + error.message);
    session = data.session;
    await start();
  };
}
async function start() {
  $("#login").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  $("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
  await loadBase();
  go(page);
}
async function loadBase() {
  settings = must(await sb.from("settings").select("*").eq("id", 1).single());
  services = must(await sb.from("services").select("*").order("sort").order("id"));
  $("#shopName").textContent = settings.shop_name;
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
  const todayStart = new Date(twToday() + "T00:00:00+08:00").toISOString();
  let q = sb.from("bookings").select("*, customers(id,name,phone,line_user_id)");
  if (bookingFilter === "upcoming") q = q.gte("start_at", todayStart).neq("status", "cancelled").order("start_at");
  if (bookingFilter === "pending") q = q.eq("status", "pending").gte("start_at", new Date().toISOString()).order("start_at");
  if (bookingFilter === "past") q = q.lt("start_at", todayStart)
    .gte("start_at", new Date(Date.now() - 60 * 86400e3).toISOString()).order("start_at", { ascending: false });
  const list = must(await q.limit(500));

  const groups = {};
  list.forEach((b) => { (groups[twParts(b.start_at).date] ??= []).push(b); });

  $("#app").innerHTML = `
    <div class="row between wrap" style="margin-bottom:6px">
      <div class="row">
        ${[["upcoming", "即將到來"], ["pending", "待確認"], ["past", "過去 60 天"]].map(([k, t]) =>
          `<button class="btn sm ${bookingFilter === k ? "" : "ghost"}" data-f="${k}">${t}</button>`).join("")}
      </div>
      <button class="btn accent sm" id="addBooking">＋ 新增預約</button>
    </div>
    ${list.length ? Object.entries(groups).map(([d, arr]) => `
      <h2>${fmtDate(d)}${d === twToday() ? "・今天" : ""}　${arr.filter((b) => b.status !== "cancelled").length} 位</h2>
      ${arr.map(bookingCard).join("")}`).join("") : `<div class="empty">沒有預約</div>`}`;

  $$("[data-f]").forEach((b) => b.addEventListener("click", () => { bookingFilter = b.dataset.f; go("bookings"); }));
  $("#addBooking").onclick = () => newBookingSheet();
  $$("[data-act]").forEach((btn) => btn.addEventListener("click", () => bookingAction(btn.dataset.id, btn.dataset.act, list)));
  $$("[data-cust]").forEach((el) => el.addEventListener("click", () => customerSheet(el.dataset.cust)));
}

function bookingCard(b) {
  const c = b.customers || {};
  const p = twParts(b.start_at), e = twParts(b.end_at);
  const acts = {
    pending: [["confirmed", "確認", "ok"], ["cancelled", "婉拒", "danger"]],
    confirmed: [["done", "完成", ""], ["cancelled", "取消", "danger"]],
    done: [["record", "寫紀錄", "ghost"]],
    cancelled: [],
  }[b.status];
  return `
    <div class="card">
      <div class="row between">
        <b>${p.hm}–${e.hm}　${esc(b.service_name)}</b>
        <span class="badge ${b.status}">${STATUS[b.status]}</span>
      </div>
      <div class="row" style="margin-top:4px">
        <a href="javascript:void 0" data-cust="${c.id}">${esc(c.name || "（未填姓名）")}</a>
        ${c.phone ? `<a class="muted" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""}
        ${c.line_user_id ? `<span class="badge">LINE</span>` : ""}
      </div>
      ${b.note ? `<div class="muted small">備註：${esc(b.note)}</div>` : ""}
      ${acts.length ? `<div class="row" style="margin-top:10px;justify-content:flex-end">
        ${acts.map(([a, t, cls]) => `<button class="btn sm ${cls}" data-act="${a}" data-id="${b.id}">${t}</button>`).join("")}</div>` : ""}
    </div>`;
}

async function bookingAction(id, act, list) {
  const b = list.find((x) => x.id == id);
  if (act === "record") return recordSheet(b.customer_id, null, b);
  let reason = "";
  if (act === "cancelled") {
    reason = prompt(`取消 ${b.customers?.name} ${fmtWhen(b.start_at)} 的預約？\n可以填寫原因（會傳給客人，可留空）：`);
    if (reason === null) return;
  }
  try {
    await adminApi("admin_set_status", { bookingId: b.id, status: act, reason });
    toast({ confirmed: "已確認，已通知客人", cancelled: "已取消", done: "已完成" }[act]);
    if (act === "done") recordSheet(b.customer_id, null, b);
    pageBookings();
  } catch (e) { toast(e.message); }
}

async function newBookingSheet() {
  const customers = must(await sb.from("customers").select("id,name,phone").order("name"));
  sheet(`
    <h3>新增預約（電話／現場）</h3>
    <label class="f"><span>客人</span>
      <select id="nbCust"><option value="">＋ 新客人</option>
        ${customers.map((c) => `<option value="${c.id}">${esc(c.name)} ${esc(c.phone)}</option>`).join("")}</select></label>
    <div id="nbNew" class="row">
      <label class="f grow"><span>姓名</span><input type="text" id="nbName"></label>
      <label class="f grow"><span>電話</span><input type="tel" id="nbPhone"></label>
    </div>
    <label class="f"><span>服務</span><select id="nbSvc">${services.map((s) => `<option value="${s.id}">${esc(s.name)}（${fmtDur(s.duration_min)}）</option>`).join("")}</select></label>
    <div class="row">
      <label class="f grow"><span>日期</span><input type="date" id="nbDate" value="${twToday()}"></label>
      <label class="f grow"><span>時間</span><input type="time" id="nbTime" step="900" value="${settings.open_time.slice(0, 5)}"></label>
    </div>
    <label class="f"><span>時長（分鐘）</span><input type="number" id="nbDur" value="${services[0]?.duration_min || 60}"></label>
    <label class="f"><span>備註</span><textarea id="nbNote"></textarea></label>
    <div class="row"><button class="btn ghost grow" data-close>取消</button><button class="btn accent grow" id="nbSave">建立</button></div>`,
  (o, close) => {
    $("#nbCust", o).onchange = (e) => $("#nbNew", o).classList.toggle("hidden", !!e.target.value);
    $("#nbSvc", o).onchange = (e) => { $("#nbDur", o).value = services.find((s) => s.id == e.target.value).duration_min; };
    $("#nbSave", o).onclick = async () => {
      try {
        let cid = $("#nbCust", o).value;
        if (!cid) {
          const name = $("#nbName", o).value.trim();
          if (!name) return toast("請填客人姓名");
          cid = must(await sb.from("customers").insert({ name, phone: $("#nbPhone", o).value.trim() }).select("id").single()).id;
        }
        const svc = services.find((s) => s.id == $("#nbSvc", o).value);
        const start = new Date(`${$("#nbDate", o).value}T${$("#nbTime", o).value}:00+08:00`);
        const end = new Date(start.getTime() + Number($("#nbDur", o).value) * 60e3);
        must(await sb.from("bookings").insert({
          customer_id: cid, service_id: svc.id, service_name: svc.name,
          start_at: start.toISOString(), end_at: end.toISOString(),
          status: "confirmed", note: $("#nbNote", o).value.trim(), created_by: "admin",
        }));
        close(); toast("已建立預約"); go("bookings");
      } catch (e) { toast(e.message, 3500); }
    };
  });
}

// ---------- 客人 ----------
let allCustomers = [];
async function pageCustomers() {
  allCustomers = must(await sb.from("customers").select("*").order("created_at", { ascending: false }).limit(2000));
  $("#app").innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <input type="search" id="cq" placeholder="搜尋姓名、電話" class="grow">
      <button class="btn accent sm" id="cAdd">＋ 新客人</button>
    </div>
    <div class="muted small" style="margin:0 4px 8px">共 ${allCustomers.length} 位</div>
    <div id="clist"></div>`;
  const draw = () => {
    const q = $("#cq").value.trim().toLowerCase();
    const arr = allCustomers.filter((c) => !q || [c.name, c.phone, c.line_name].some((v) => (v || "").toLowerCase().includes(q)));
    $("#clist").innerHTML = arr.map((c) => `
      <div class="card pick row" data-cust="${c.id}">
        ${c.picture_url ? `<img src="${esc(c.picture_url)}" style="width:40px;height:40px;border-radius:50%">` : `<div style="width:40px;height:40px;border-radius:50%;background:var(--line)"></div>`}
        <div class="grow"><b>${esc(c.name || "（未填姓名）")}</b><div class="muted small">${esc(c.phone)}${c.line_name && c.line_name !== c.name ? "・LINE：" + esc(c.line_name) : ""}</div></div>
        ${c.line_user_id ? `<span class="badge">LINE</span>` : ""}
      </div>`).join("") || `<div class="empty">找不到客人</div>`;
    $$("[data-cust]").forEach((el) => el.addEventListener("click", () => customerSheet(el.dataset.cust)));
  };
  $("#cq").addEventListener("input", draw);
  $("#cAdd").onclick = async () => {
    const name = prompt("客人姓名"); if (!name) return;
    const phone = prompt("電話（可留空）") || "";
    const c = must(await sb.from("customers").insert({ name, phone }).select().single());
    allCustomers.unshift(c); draw(); customerSheet(c.id);
  };
  draw();
}

async function customerSheet(id) {
  const [c, recs, bks] = await Promise.all([
    sb.from("customers").select("*").eq("id", id).single().then(must),
    sb.from("records").select("*").eq("customer_id", id).order("date", { ascending: false }).then(must),
    sb.from("bookings").select("*").eq("customer_id", id).order("start_at", { ascending: false }).limit(30).then(must),
  ]);
  const paths = recs.flatMap((r) => r.photos);
  const urls = {};
  if (paths.length) {
    const signed = must(await sb.storage.from("records").createSignedUrls(paths, 3600));
    signed.forEach((s) => { urls[s.path] = s.signedUrl; });
  }
  sheet(`
    <div class="row between"><h3 style="margin:0">${esc(c.name || "客人")}</h3><button class="btn ghost sm" data-close>關閉</button></div>
    <br>
    <div class="card">
      <div class="row">
        <label class="f grow"><span>姓名</span><input type="text" id="cName" value="${esc(c.name)}"></label>
        <label class="f grow"><span>電話</span><input type="tel" id="cPhone" value="${esc(c.phone)}"></label>
      </div>
      <label class="f"><span>客人備註（髮質、過敏、喜好…）</span><textarea id="cNote">${esc(c.note)}</textarea></label>
      <div class="row wrap">
        <button class="btn sm" id="cSave">儲存</button>
        ${c.line_user_id ? `<button class="btn ghost sm" id="cMsg">傳 LINE 訊息</button>` : `<span class="muted small">未綁定 LINE</span>`}
        <button class="btn danger sm" id="cDel" style="margin-left:auto">刪除客人</button>
      </div>
    </div>
    <div class="row between"><h2>服務紀錄</h2><button class="btn accent sm" id="rAdd">＋ 新增紀錄</button></div>
    ${recs.map((r) => `
      <div class="card">
        <div class="row between"><b>${fmtDate(r.date)}　${esc(r.service)}</b>${r.price != null ? `<span class="price">$${r.price.toLocaleString()}</span>` : ""}</div>
        ${r.formula ? `<div class="small" style="white-space:pre-wrap">🧪 ${esc(r.formula)}</div>` : ""}
        ${r.note ? `<div class="muted small" style="white-space:pre-wrap">${esc(r.note)}</div>` : ""}
        ${r.photos.length ? `<div class="thumbs">${r.photos.map((p) => `<img src="${esc(urls[p] || "")}" data-view>`).join("")}</div>` : ""}
        <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn ghost sm" data-edit-rec="${r.id}">編輯</button></div>
      </div>`).join("") || `<div class="card muted center">還沒有紀錄</div>`}
    <h2>預約紀錄</h2>
    ${bks.map((b) => `<div class="card row between"><span>${fmtWhen(b.start_at)}　${esc(b.service_name)}</span><span class="badge ${b.status}">${STATUS[b.status]}</span></div>`).join("") || `<div class="card muted center">沒有預約</div>`}
  `, (o, close) => {
    $("#cSave", o).onclick = async () => {
      try {
        must(await sb.from("customers").update({ name: $("#cName", o).value.trim(), phone: $("#cPhone", o).value.trim(), note: $("#cNote", o).value }).eq("id", id));
        toast("已儲存");
        if (page === "customers") pageCustomers();
      } catch (e) { toast(e.message); }
    };
    $("#cMsg", o)?.addEventListener("click", async () => {
      const text = prompt(`要傳給 ${c.name} 的 LINE 訊息：`);
      if (!text) return;
      try { await adminApi("admin_message", { customerId: id, text }); toast("已傳送"); } catch (e) { toast(e.message); }
    });
    $("#cDel", o).onclick = async () => {
      if (!confirm(`確定要刪除「${c.name}」？\n這位客人的預約、服務紀錄和照片都會一起刪除，無法復原。`)) return;
      try {
        if (paths.length) await sb.storage.from("records").remove(paths);
        must(await sb.from("customers").delete().eq("id", id));
        close(); toast("已刪除"); go(page);
      } catch (e) { toast(e.message); }
    };
    $("#rAdd", o).onclick = () => { close(); recordSheet(id); };
    $$("[data-edit-rec]", o).forEach((b) => b.addEventListener("click", () => { close(); recordSheet(id, recs.find((r) => r.id == b.dataset.editRec)); }));
    $$("[data-view]", o).forEach((img) => img.addEventListener("click", () => viewImage(img.src)));
  });
}

function recordSheet(customerId, rec = null, booking = null) {
  const r = rec || { date: booking ? twParts(booking.start_at).date : twToday(), service: booking?.service_name || "", formula: "", price: null, note: "", photos: [] };
  sheet(`
    <h3>${rec ? "編輯" : "新增"}服務紀錄</h3>
    <div class="row">
      <label class="f grow"><span>日期</span><input type="date" id="rDate" value="${r.date}"></label>
      <label class="f grow"><span>金額</span><input type="number" id="rPrice" value="${r.price ?? ""}"></label>
    </div>
    <label class="f"><span>項目</span><input type="text" id="rSvc" value="${esc(r.service)}"></label>
    <label class="f"><span>配方（染膏、藥水、比例、時間）</span><textarea id="rFormula">${esc(r.formula)}</textarea></label>
    <label class="f"><span>備註</span><textarea id="rNote">${esc(r.note)}</textarea></label>
    <label class="f"><span>新增照片${r.photos.length ? `（已有 ${r.photos.length} 張）` : ""}</span><input type="file" id="rFiles" accept="image/*" multiple></label>
    <div class="row">
      ${rec ? `<button class="btn danger" id="rDel">刪除</button>` : ""}
      <button class="btn ghost grow" data-close>取消</button>
      <button class="btn accent grow" id="rSave">儲存</button>
    </div>`,
  (o, close) => {
    $("#rSave", o).onclick = async () => {
      const btn = $("#rSave", o); btn.disabled = true; btn.textContent = "上傳中…";
      try {
        const photos = [...r.photos];
        for (const f of $("#rFiles", o).files) {
          const blob = await compressImage(f);
          const path = `${customerId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
          must(await sb.storage.from("records").upload(path, blob, { contentType: "image/jpeg" }));
          photos.push(path);
        }
        const price = $("#rPrice", o).value;
        const row = {
          customer_id: customerId, booking_id: rec?.booking_id ?? booking?.id ?? null,
          date: $("#rDate", o).value, service: $("#rSvc", o).value.trim(),
          formula: $("#rFormula", o).value, note: $("#rNote", o).value,
          price: price === "" ? null : Number(price), photos,
        };
        must(rec ? await sb.from("records").update(row).eq("id", rec.id) : await sb.from("records").insert(row));
        close(); toast("已儲存紀錄"); customerSheet(customerId);
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "儲存"; }
    };
    $("#rDel", o)?.addEventListener("click", async () => {
      if (!confirm("確定刪除這筆紀錄和照片？無法復原。")) return;
      try {
        if (rec.photos.length) await sb.storage.from("records").remove(rec.photos);
        must(await sb.from("records").delete().eq("id", rec.id));
        close(); toast("已刪除"); customerSheet(customerId);
      } catch (e) { toast(e.message); }
    });
  });
}

// ---------- 作品集 ----------
async function pageWorks() {
  const list = must(await sb.from("portfolio").select("*").order("sort").order("created_at", { ascending: false }));
  $("#app").innerHTML = `
    <div class="card">
      <label class="f"><span>作品說明（選填，例如「霧感奶茶色」）</span><input type="text" id="wTitle"></label>
      <label class="f"><span>選擇照片（可多選）</span><input type="file" id="wFiles" accept="image/*" multiple></label>
      <button class="btn accent" id="wUp">上傳</button>
    </div>
    <div class="gallery">${list.map((w) => `
      <figure><img loading="lazy" src="${esc(publicUrl(w.image_path))}" data-view>
        ${w.title ? `<figcaption>${esc(w.title)}</figcaption>` : ""}
        <button class="btn sm del" style="background:rgba(0,0,0,.55)" data-del="${w.id}">刪除</button></figure>`).join("")}</div>
    ${list.length ? "" : `<div class="empty">還沒有作品</div>`}`;
  $("#wUp").onclick = async () => {
    const files = [...$("#wFiles").files];
    if (!files.length) return toast("請先選照片");
    const btn = $("#wUp"); btn.disabled = true;
    try {
      for (const [i, f] of files.entries()) {
        btn.textContent = `上傳中 ${i + 1}/${files.length}`;
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        must(await sb.storage.from("portfolio").upload(path, await compressImage(f), { contentType: "image/jpeg" }));
        must(await sb.from("portfolio").insert({ image_path: path, title: $("#wTitle").value.trim() }));
      }
      toast("已上傳"); pageWorks();
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "上傳"; }
  };
  $$("[data-view]").forEach((img) => img.addEventListener("click", () => viewImage(img.src)));
  $$("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm("刪除這張作品？")) return;
    const w = list.find((x) => x.id == b.dataset.del);
    await sb.storage.from("portfolio").remove([w.image_path]);
    must(await sb.from("portfolio").delete().eq("id", w.id));
    pageWorks();
  }));
}

// ---------- 服務項目 ----------
async function pageServices() {
  await loadBase();
  const card = (s) => `
    <div class="card" data-svc="${s.id ?? "new"}">
      <div class="row">
        <label class="f grow"><span>名稱</span><input type="text" name="name" value="${esc(s.name)}"></label>
        <label class="f" style="width:90px"><span>排序</span><input type="number" name="sort" value="${s.sort ?? 0}"></label>
      </div>
      <div class="row">
        <label class="f grow"><span>價格（空白=現場報價）</span><input type="number" name="price" value="${s.price ?? ""}"></label>
        <label class="f grow"><span>價格附註</span><input type="text" name="price_note" value="${esc(s.price_note)}" placeholder="起"></label>
        <label class="f grow"><span>時長（分）</span><input type="number" name="duration_min" value="${s.duration_min}"></label>
      </div>
      <label class="f"><span>說明</span><input type="text" name="description" value="${esc(s.description)}"></label>
      <div class="row between">
        <label class="row small"><input type="checkbox" name="active" ${s.active ? "checked" : ""}> 開放預約</label>
        <div class="row">${s.id ? `<button class="btn danger sm" data-sdel>刪除</button>` : ""}<button class="btn sm" data-ssave>儲存</button></div>
      </div>
    </div>`;
  $("#app").innerHTML = `
    <div class="row between"><h2>服務項目</h2><button class="btn accent sm" id="sAdd">＋ 新增</button></div>
    <div id="newSvc"></div>
    ${services.map(card).join("")}`;
  $("#sAdd").onclick = () => {
    $("#newSvc").innerHTML = card({ name: "", price: null, price_note: "", duration_min: 60, description: "", sort: services.length + 1, active: true });
    bind();
  };
  function bind() {
    $$("[data-svc]").forEach((el) => {
      const id = el.dataset.svc;
      $("[data-ssave]", el).onclick = async () => {
        const v = (n) => $(`[name=${n}]`, el);
        const row = {
          name: v("name").value.trim(), description: v("description").value.trim(),
          duration_min: Number(v("duration_min").value) || 60, price: v("price").value === "" ? null : Number(v("price").value),
          price_note: v("price_note").value.trim(), sort: Number(v("sort").value) || 0, active: v("active").checked,
        };
        if (!row.name) return toast("請填名稱");
        try {
          must(id === "new" ? await sb.from("services").insert(row) : await sb.from("services").update(row).eq("id", id));
          toast("已儲存"); pageServices();
        } catch (e) { toast(e.message); }
      };
      const del = $("[data-sdel]", el);
      if (del) del.onclick = async () => {
        if (!confirm("刪除這個服務？（只想暫停可以取消勾選「開放預約」）")) return;
        try { must(await sb.from("services").delete().eq("id", id)); pageServices(); } catch (e) { toast(e.message); }
      };
    });
  }
  bind();
}

// ---------- 設定 ----------
async function pageSettings() {
  await loadBase();
  const closed = must(await sb.from("closed_dates").select("*").gte("date", twToday()).order("date"));
  const s = settings;
  $("#app").innerHTML = `
    <h2>店家資訊</h2>
    <div class="card">
      <label class="f"><span>店名</span><input type="text" id="sShop" value="${esc(s.shop_name)}"></label>
      <label class="f"><span>設計師名稱</span><input type="text" id="sDesigner" value="${esc(s.designer_name)}"></label>
      <label class="f"><span>地址</span><input type="text" id="sAddr" value="${esc(s.address)}"></label>
      <label class="f"><span>電話</span><input type="tel" id="sPhone" value="${esc(s.phone)}"></label>
      <label class="f"><span>預約頁公告（例如：遲到 15 分鐘以上需改期）</span><textarea id="sNotice">${esc(s.notice)}</textarea></label>
    </div>
    <h2>營業時間</h2>
    <div class="card">
      <div class="row wrap" style="margin-bottom:10px">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="row small"><input type="checkbox" data-wd="${d}" ${s.open_weekdays.includes(d) ? "checked" : ""}> 週${WEEK[d]}</label>`).join("")}
      </div>
      <div class="row">
        <label class="f grow"><span>開始</span><input type="time" id="sOpen" value="${s.open_time.slice(0, 5)}"></label>
        <label class="f grow"><span>結束</span><input type="time" id="sClose" value="${s.close_time.slice(0, 5)}"></label>
      </div>
      <div class="row">
        <label class="f grow"><span>時段間隔（分）</span><input type="number" id="sSlot" value="${s.slot_minutes}"></label>
        <label class="f grow"><span>開放幾天內</span><input type="number" id="sAhead" value="${s.days_ahead}"></label>
        <label class="f grow"><span>至少提前（小時）</span><input type="number" id="sNotice2" value="${s.min_notice_hours}"></label>
      </div>
      <label class="row small"><input type="checkbox" id="sAuto" ${s.auto_confirm ? "checked" : ""}> 客人預約後自動成立（不勾＝需要我確認）</label>
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
      客人預約頁（放在 LINE 圖文選單）：<br><code>https://liff.line.me/${esc(C.LIFF_ID)}</code><br><br>
      其他分頁：在後面加上 <code>?page=mine</code>（我的預約）、<code>?page=works</code>（作品集）、<code>?page=price</code>（價目表）
    </div>`;

  $("#sSave").onclick = async () => {
    try {
      must(await sb.from("settings").update({
        shop_name: $("#sShop").value.trim() || "我的髮型工作室", designer_name: $("#sDesigner").value.trim(),
        address: $("#sAddr").value.trim(), phone: $("#sPhone").value.trim(), notice: $("#sNotice").value,
        open_weekdays: $$("[data-wd]").filter((c) => c.checked).map((c) => Number(c.dataset.wd)),
        open_time: $("#sOpen").value, close_time: $("#sClose").value,
        slot_minutes: Number($("#sSlot").value) || 30, days_ahead: Number($("#sAhead").value) || 30,
        min_notice_hours: Number($("#sNotice2").value) || 0, auto_confirm: $("#sAuto").checked,
      }).eq("id", 1));
      toast("已儲存"); pageSettings();
    } catch (e) { toast(e.message); }
  };
  $("#cdAdd").onclick = async () => {
    try { must(await sb.from("closed_dates").upsert({ date: $("#cdDate").value, note: $("#cdNote").value.trim() })); pageSettings(); }
    catch (e) { toast(e.message); }
  };
  $$("[data-cd]").forEach((b) => b.addEventListener("click", async () => {
    must(await sb.from("closed_dates").delete().eq("date", b.dataset.cd)); pageSettings();
  }));
}

boot();
