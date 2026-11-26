// 髮型工作室預約系統：後端
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const L = require("./lib");

// 新專案的儲存空間名稱是 <專案ID>.firebasestorage.app
const PROJECT_ID = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
admin.initializeApp({ storageBucket: (process.env.STORAGE_BUCKET || "").trim() || `${PROJECT_ID}.firebasestorage.app` });
const db = admin.firestore();
setGlobalOptions({ region: "asia-east1", maxInstances: 5 });

const env = (k) => (process.env[k] || "").trim();
const LIFF_ID = () => env("LIFF_ID");
const LIFF_URL = () => (LIFF_ID() ? `https://liff.line.me/${LIFF_ID()}` : "");
const ADMIN_LINE = () => (env("ADMIN_LINE_USER_ID").startsWith("U") ? env("ADMIN_LINE_USER_ID") : "");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const STATUS = { pending: "待確認", confirmed: "已確認", cancelled: "已取消", done: "已完成" };
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// ---------- LINE ----------
async function push(to, text) {
  const token = env("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token || !to) return;
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) console.error("LINE push failed", r.status, await r.text());
}

async function verifyLine(idToken) {
  if (!idToken) throw new HttpError(401, "請用 LINE 開啟");
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: env("LINE_LOGIN_CHANNEL_ID") }),
  });
  if (!r.ok) throw new HttpError(401, "LINE_LOGIN_EXPIRED");
  const p = await r.json();
  return { userId: p.sub, name: p.name || "", picture: p.picture || "" };
}

async function getCustomer(idToken) {
  const line = await verifyLine(idToken);
  const ref = db.doc(`customers/L_${line.userId}`);
  const snap = await ref.get();
  if (snap.exists) {
    const c = snap.data();
    if (c.lineName !== line.name || c.pictureUrl !== line.picture) {
      await ref.update({ lineName: line.name, pictureUrl: line.picture });
    }
    return { id: ref.id, ...c, lineName: line.name };
  }
  const c = { lineUserId: line.userId, lineName: line.name, pictureUrl: line.picture, name: line.name, phone: "", note: "", createdAt: Date.now() };
  await ref.set(c);
  return { id: ref.id, ...c };
}

// ---------- 後台登入（密碼 → 30 天有效的簽章） ----------
const sign = (exp) => crypto.createHmac("sha256", env("ADMIN_PASSWORD")).update(`admin:${exp}`).digest("hex");
function sameText(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function requireAdmin(req) {
  if (!env("ADMIN_PASSWORD")) throw new HttpError(500, "尚未設定後台密碼");
  const [exp, sig] = String(req.get("x-admin-token") || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now() || !sameText(sig, sign(exp))) throw new HttpError(401, "ADMIN_LOGIN_REQUIRED");
}

// ---------- 資料 ----------
async function getSettings() {
  const s = await db.doc("config/settings").get();
  return { ...L.DEFAULT_SETTINGS, ...(s.exists ? s.data() : {}) };
}
async function getService(id, mustBeActive = true) {
  const s = await db.doc(`services/${str(id, 100)}`).get();
  if (!s.exists || (mustBeActive && s.data().active === false)) throw new HttpError(400, "找不到這個服務項目");
  return { id: s.id, ...s.data() };
}
async function dayBookings(date, tx) {
  const q = db.collection("bookings").where("date", "==", date);
  return docs(tx ? await tx.get(q) : await q.get());
}
// 某天的單次封鎖時段（當作已被佔用）
async function dayBlocks(date, tx) {
  const q = db.collection("blocks").where("date", "==", date);
  return docs(tx ? await tx.get(q) : await q.get()).map((b) => ({ ...b, status: "confirmed" }));
}
async function isClosed(date) {
  return (await db.doc(`closedDates/${date}`).get()).exists;
}

// 用「每天一把鎖」確保同一時段不會被兩個人同時約走
async function createBooking({ customer, service, date, time, durationMin, note, status, createdBy, checkSlots }) {
  const settings = await getSettings();
  const closed = await isClosed(date);
  const start = L.toMs(date, time);
  const end = start + durationMin * 60e3;
  if (!Number.isFinite(start)) throw new HttpError(400, "日期時間格式錯誤");

  return db.runTransaction(async (tx) => {
    const lockRef = db.doc(`locks/${date}`);
    await tx.get(lockRef);
    const busy = await dayBookings(date, tx);
    if (checkSlots) {
      const blocks = await dayBlocks(date, tx);
      const slots = L.availableSlots({ date, durationMin, settings, closed, busy: [...busy, ...blocks] });
      if (!slots.includes(time)) throw new HttpError(409, "這個時段已經無法預約，請選其他時間");
    } else if (L.overlaps(start, end, busy)) {
      throw new HttpError(409, "這個時段已經有其他預約");
    }
    const ref = db.collection("bookings").doc();
    const b = {
      customerId: customer.id, customerName: customer.name || "", customerPhone: customer.phone || "",
      serviceId: service.id, serviceName: service.name, date, start, end,
      status, note: str(note, 500), createdBy, remindedAt: null, createdAt: Date.now(),
    };
    tx.set(ref, b);
    tx.set(lockRef, { updatedAt: Date.now() });
    return { id: ref.id, ...b };
  });
}

// 照片：存到 Storage，產生帶權杖的網址
async function savePhoto(folder, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) throw new HttpError(400, "照片格式錯誤");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(400, "照片太大");
  const bucket = admin.storage().bucket();
  const token = crypto.randomUUID();
  const path = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  await bucket.file(path).save(buf, {
    resumable: false,
    metadata: { contentType: `image/${m[1]}`, cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return { path, url };
}
async function deletePhotos(paths) {
  const bucket = admin.storage().bucket();
  await Promise.all(paths.filter(Boolean).map((p) => bucket.file(p).delete().catch(() => {})));
}

const bookingView = (b) => ({ id: b.id, serviceName: b.serviceName, start: b.start, end: b.end, status: b.status, note: b.note });

// ---------- 動作 ----------
const actions = {
  // ===== 公開 =====
  async public() {
    const today = L.twDate(Date.now());
    const [settings, services, closed, works] = await Promise.all([
      getSettings(),
      db.collection("services").get().then(docs),
      db.collection("closedDates").where(admin.firestore.FieldPath.documentId(), ">=", today).get().then(docs),
      db.collection("portfolio").get().then(docs),
    ]);
    return {
      liffId: LIFF_ID(),
      settings,
      services: services.filter((s) => s.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
      closedDates: closed.map((c) => c.id),
      portfolio: works.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || b.createdAt - a.createdAt).map((w) => ({ url: w.url, title: w.title })),
    };
  },

  // ===== 客人 =====
  async me({ idToken }) {
    const c = await getCustomer(idToken);
    const list = docs(await db.collection("bookings").where("customerId", "==", c.id).get())
      .sort((a, b) => b.start - a.start);
    return { customer: { name: c.name, phone: c.phone, lineName: c.lineName, lineUserId: c.lineUserId }, bookings: list.map(bookingView) };
  },

  async save_profile({ idToken, name, phone }) {
    const c = await getCustomer(idToken);
    await db.doc(`customers/${c.id}`).update({ name: str(name, 50), phone: str(phone, 30) });
    return { ok: true };
  },

  // 整個月每天的狀態：open（可預約）、full（已約滿）、closed（公休）、out（不在開放範圍）
  async month({ idToken, month, serviceId }) {
    await verifyLine(idToken);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "月份格式錯誤");
    let durationMin;
    if (serviceId) durationMin = (await getService(serviceId)).durationMin;
    else {
      const all = docs(await db.collection("services").get()).filter((x) => x.active !== false);
      durationMin = all.length ? Math.min(...all.map((x) => x.durationMin || 60)) : 60;
    }
    const first = `${month}-01`;
    const last = L.addDays(L.addDays(first, 32).slice(0, 8) + "01", -1);
    const [settings, closedSnap, booked, blocked] = await Promise.all([
      getSettings(),
      db.collection("closedDates").where(admin.firestore.FieldPath.documentId(), ">=", first)
        .where(admin.firestore.FieldPath.documentId(), "<=", last).get(),
      db.collection("bookings").where("date", ">=", first).where("date", "<=", last).get().then(docs),
      db.collection("blocks").where("date", ">=", first).where("date", "<=", last).get()
        .then((sn) => docs(sn).map((b) => ({ ...b, status: "confirmed" }))),
    ]);
    const closed = new Set(closedSnap.docs.map((d) => d.id));
    const today = L.twDate(Date.now());
    const days = {};
    for (let d = first; d <= last; d = L.addDays(d, 1)) {
      if (d < today || d > L.addDays(today, settings.daysAhead)) { days[d] = "out"; continue; }
      if (closed.has(d) || !settings.openWeekdays.includes(L.weekdayOf(d))) { days[d] = "closed"; continue; }
      const n = L.availableSlots({ date: d, durationMin, settings, busy: [...booked, ...blocked].filter((b) => b.date === d) }).length;
      days[d] = n ? "open" : "full";
    }
    return { days };
  },

  async slots({ idToken, date, serviceId }) {
    await verifyLine(idToken);
    const svc = await getService(serviceId);
    const [settings, closed, busy, blocks] = await Promise.all([getSettings(), isClosed(date), dayBookings(date), dayBlocks(date)]);
    return { slots: L.availableSlots({ date, durationMin: svc.durationMin, settings, closed, busy: [...busy, ...blocks] }) };
  },

  async book({ idToken, serviceId, date, time, name, phone, note }) {
    const c = await getCustomer(idToken);
    name = str(name, 50); phone = str(phone, 30);
    if (!name || !phone) throw new HttpError(400, "請填寫姓名和電話");
    await db.doc(`customers/${c.id}`).update({ name, phone });
    const svc = await getService(serviceId);
    const settings = await getSettings();
    const b = await createBooking({
      customer: { ...c, name, phone }, service: svc, date: str(date, 10), time: str(time, 5),
      durationMin: svc.durationMin, note, status: settings.autoConfirm ? "confirmed" : "pending",
      createdBy: "customer", checkSlots: true,
    });
    const when = L.twLabel(b.start);
    await push(c.lineUserId, settings.autoConfirm
      ? `✅ 預約成功！\n${when}\n${svc.name}\n\n${settings.shopName}${settings.address ? "\n📍 " + settings.address : ""}\n\n如需取消請在預約前 ${settings.cancelHours} 小時到「我的預約」操作${LIFF_URL() ? "\n" + LIFF_URL() + "?page=mine" : ""}`
      : `📩 已收到你的預約，設計師確認後會再通知你\n${when}\n${svc.name}`);
    await push(ADMIN_LINE(), `🔔 新預約${settings.autoConfirm ? "" : "（待確認）"}\n${when}\n${svc.name}\n${name}　${phone}${b.note ? "\n備註：" + b.note : ""}`);
    return { booking: bookingView(b) };
  },

  async cancel({ idToken, bookingId }) {
    const c = await getCustomer(idToken);
    const ref = db.doc(`bookings/${str(bookingId, 100)}`);
    const snap = await ref.get();
    const b = snap.data();
    if (!snap.exists || b.customerId !== c.id || !L.ACTIVE.includes(b.status)) throw new HttpError(400, "這筆預約無法取消");
    if (b.start < Date.now()) throw new HttpError(400, "預約時間已過，無法取消");
    const st = await getSettings();
    if (st.cancelHours > 0 && b.start - Date.now() < st.cancelHours * 3600e3) {
      throw new HttpError(400, `預約前 ${st.cancelHours} 小時內無法線上取消，請直接傳訊息給設計師`);
    }
    await ref.update({ status: "cancelled" });
    await push(ADMIN_LINE(), `❌ 客人取消預約\n${L.twLabel(b.start)}\n${b.serviceName}\n${c.name}　${c.phone}`);
    return { ok: true };
  },

  // ===== 後台 =====
  async admin_login({ password }) {
    if (!env("ADMIN_PASSWORD")) throw new HttpError(500, "尚未設定後台密碼");
    await new Promise((r) => setTimeout(r, 400));
    if (!sameText(password || "", env("ADMIN_PASSWORD"))) throw new HttpError(401, "密碼錯誤");
    const exp = Date.now() + 30 * 86400e3;
    return { token: `${exp}.${sign(exp)}` };
  },

  async admin_init() {
    // 第一次登入時放入預設價目
    if ((await db.collection("services").limit(1).get()).empty) {
      const batch = db.batch();
      [["剪髮", 60, 800, ""], ["染髮", 150, 2500, "起"], ["燙髮", 180, 3000, "起"], ["護髮", 60, 1200, "起"]]
        .forEach(([name, durationMin, price, priceNote], i) => batch.set(db.collection("services").doc(), {
          name, durationMin, price, priceNote, description: "", sort: i + 1, active: true,
        }));
      await batch.commit();
    }
    const [settings, services] = await Promise.all([getSettings(), db.collection("services").get().then(docs)]);
    return { settings, services: services.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), liffId: LIFF_ID() };
  },

  async admin_bookings({ filter }) {
    const now = Date.now(), today = L.twDate(now);
    let list;
    if (filter === "past") {
      list = docs(await db.collection("bookings").where("date", ">=", L.addDays(today, -60)).get())
        .filter((b) => b.date < today).sort((a, b) => b.start - a.start);
    } else {
      list = docs(await db.collection("bookings").where("date", ">=", today).get())
        .filter((b) => (filter === "pending" ? b.status === "pending" && b.start > now : b.status !== "cancelled"))
        .sort((a, b) => a.start - b.start);
    }
    const ids = [...new Set(list.map((b) => b.customerId))];
    const custs = {};
    for (let i = 0; i < ids.length; i += 100) {
      const refs = ids.slice(i, i + 100).map((id) => db.doc(`customers/${id}`));
      (await db.getAll(...refs)).forEach((s) => { if (s.exists) custs[s.id] = s.data(); });
    }
    let blocks = [];
    if (filter !== "past") {
      blocks = docs(await db.collection("blocks").where("date", ">=", today).get()).sort((a, b) => a.start - b.start);
    }
    return {
      blocks,
      bookings: list.map((b) => {
        const c = custs[b.customerId] || {};
        return { ...b, customerName: c.name ?? b.customerName, customerPhone: c.phone ?? b.customerPhone, hasLine: !!c.lineUserId };
      }),
    };
  },

  async admin_set_status({ bookingId, status, reason }) {
    if (!STATUS[status]) throw new HttpError(400, "狀態錯誤");
    const ref = db.doc(`bookings/${str(bookingId, 100)}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "找不到預約");
    const b = snap.data();
    await ref.update({ status });
    const c = (await db.doc(`customers/${b.customerId}`).get()).data() || {};
    if (status === "confirmed") {
      const s = await getSettings();
      await push(c.lineUserId, `✅ 設計師已確認你的預約\n${L.twLabel(b.start)}\n${b.serviceName}\n\n${s.shopName}${s.address ? "\n📍 " + s.address : ""}${s.cancelHours > 0 ? `\n\n如需取消請在預約前 ${s.cancelHours} 小時操作，之後請直接傳訊息給我` : ""}`);
    } else if (status === "cancelled" && b.start > Date.now()) {
      await push(c.lineUserId, `很抱歉，你 ${L.twLabel(b.start)} 的預約（${b.serviceName}）已取消${reason ? "\n原因：" + str(reason, 300) : ""}\n\n歡迎重新預約其他時間 🙏${LIFF_URL() ? "\n" + LIFF_URL() : ""}`);
    }
    return { ok: true };
  },

  async admin_create_booking({ customerId, newName, newPhone, serviceId, date, time, durationMin, note }) {
    let customer;
    if (customerId) {
      const s = await db.doc(`customers/${str(customerId, 100)}`).get();
      if (!s.exists) throw new HttpError(404, "找不到客人");
      customer = { id: s.id, ...s.data() };
    } else {
      if (!str(newName)) throw new HttpError(400, "請填客人姓名");
      const ref = db.collection("customers").doc();
      const data = { lineUserId: null, name: str(newName, 50), phone: str(newPhone, 30), note: "", createdAt: Date.now() };
      await ref.set(data);
      customer = { id: ref.id, ...data };
    }
    const svc = await getService(serviceId, false);
    const b = await createBooking({
      customer, service: svc, date: str(date, 10), time: str(time, 5),
      durationMin: Number(durationMin) || svc.durationMin, note, status: "confirmed", createdBy: "admin", checkSlots: false,
    });
    return { booking: b };
  },

  async admin_customers() {
    const list = docs(await db.collection("customers").get()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { customers: list.map((c) => ({ id: c.id, name: c.name, phone: c.phone, lineName: c.lineName, pictureUrl: c.pictureUrl, hasLine: !!c.lineUserId })) };
  },

  async admin_customer({ id }) {
    const s = await db.doc(`customers/${str(id, 100)}`).get();
    if (!s.exists) throw new HttpError(404, "找不到客人");
    const [records, bookings] = await Promise.all([
      db.collection("records").where("customerId", "==", s.id).get().then(docs),
      db.collection("bookings").where("customerId", "==", s.id).get().then(docs),
    ]);
    const c = s.data();
    return {
      customer: { id: s.id, name: c.name, phone: c.phone, note: c.note, lineName: c.lineName, hasLine: !!c.lineUserId },
      records: records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
      bookings: bookings.sort((a, b) => b.start - a.start),
      stats: {
        visits: bookings.filter((b) => b.status === "done").length,
        total: records.reduce((n, r) => n + (Number(r.price) || 0), 0),
        lastVisit: [...bookings.filter((b) => b.status === "done").map((b) => b.date), ...records.map((r) => r.date)].sort().pop() || null,
        cancelled: bookings.filter((b) => b.status === "cancelled").length,
      },
    };
  },

  async admin_save_customer({ id, name, phone, note }) {
    const data = { name: str(name, 50), phone: str(phone, 30), note: str(note, 2000) };
    if (id) { await db.doc(`customers/${str(id, 100)}`).update(data); return { id }; }
    const ref = await db.collection("customers").add({ ...data, lineUserId: null, createdAt: Date.now() });
    return { id: ref.id };
  },

  async admin_delete_customer({ id }) {
    id = str(id, 100);
    const [records, bookings] = await Promise.all([
      db.collection("records").where("customerId", "==", id).get(),
      db.collection("bookings").where("customerId", "==", id).get(),
    ]);
    await deletePhotos(records.docs.flatMap((d) => (d.data().photos || []).map((p) => p.path)));
    const batch = db.batch();
    [...records.docs, ...bookings.docs].forEach((d) => batch.delete(d.ref));
    batch.delete(db.doc(`customers/${id}`));
    await batch.commit();
    return { ok: true };
  },

  async admin_upload({ folder, dataUrl }) {
    if (!["records", "portfolio"].includes(folder)) throw new HttpError(400, "資料夾錯誤");
    return await savePhoto(folder, dataUrl);
  },

  async admin_save_record({ id, customerId, bookingId, date, service, formula, price, note, photos, removed }) {
    const data = {
      customerId: str(customerId, 100), bookingId: bookingId || null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : L.twDate(Date.now()),
      service: str(service), formula: str(formula, 3000), note: str(note, 3000),
      price: price === "" || price == null ? null : Number(price),
      photos: (photos || []).filter((p) => p && p.path && p.url).map((p) => ({ path: str(p.path, 300), url: str(p.url, 1000) })),
    };
    if (Array.isArray(removed)) await deletePhotos(removed.map((p) => str(p, 300)));
    if (id) await db.doc(`records/${str(id, 100)}`).update(data);
    else await db.collection("records").add({ ...data, createdAt: Date.now() });
    return { ok: true };
  },

  async admin_delete_record({ id }) {
    const ref = db.doc(`records/${str(id, 100)}`);
    const s = await ref.get();
    if (s.exists) { await deletePhotos((s.data().photos || []).map((p) => p.path)); await ref.delete(); }
    return { ok: true };
  },

  async admin_message({ customerId, text }) {
    const c = (await db.doc(`customers/${str(customerId, 100)}`).get()).data();
    if (!c?.lineUserId) throw new HttpError(400, "這位客人沒有綁定 LINE");
    if (!env("LINE_CHANNEL_ACCESS_TOKEN")) throw new HttpError(500, "尚未設定 LINE");
    await push(c.lineUserId, str(text, 2000));
    return { ok: true };
  },

  async admin_portfolio() {
    const list = docs(await db.collection("portfolio").get());
    return { works: list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || b.createdAt - a.createdAt) };
  },
  async admin_add_work({ path, url, title }) {
    await db.collection("portfolio").add({ path: str(path, 300), url: str(url, 1000), title: str(title, 60), sort: 0, createdAt: Date.now() });
    return { ok: true };
  },
  async admin_delete_work({ id }) {
    const ref = db.doc(`portfolio/${str(id, 100)}`);
    const s = await ref.get();
    if (s.exists) { await deletePhotos([s.data().path]); await ref.delete(); }
    return { ok: true };
  },

  async admin_save_service({ id, name, description, durationMin, price, priceNote, sort, active }) {
    if (!str(name)) throw new HttpError(400, "請填名稱");
    const data = {
      name: str(name, 50), description: str(description, 300), durationMin: Math.max(5, Number(durationMin) || 60),
      price: price === "" || price == null ? null : Number(price), priceNote: str(priceNote, 20),
      sort: Number(sort) || 0, active: active !== false,
    };
    if (id) await db.doc(`services/${str(id, 100)}`).set(data, { merge: true });
    else await db.collection("services").add(data);
    return { ok: true };
  },
  async admin_delete_service({ id }) {
    await db.doc(`services/${str(id, 100)}`).delete();
    return { ok: true };
  },

  async admin_save_settings({ settings: s }) {
    const time = (v, d) => (/^\d{2}:\d{2}$/.test(v) ? v : d);
    await db.doc("config/settings").set({
      shopName: str(s.shopName, 50) || L.DEFAULT_SETTINGS.shopName, designerName: str(s.designerName, 50),
      address: str(s.address), phone: str(s.phone, 30), notice: str(s.notice, 1000),
      openTime: time(s.openTime, "10:00"), closeTime: time(s.closeTime, "20:00"),
      openWeekdays: (s.openWeekdays || []).map(Number).filter((n) => n >= 0 && n <= 6),
      slotMinutes: Math.max(5, Number(s.slotMinutes) || 30), daysAhead: Math.max(1, Number(s.daysAhead) || 30),
      minNoticeHours: Math.max(0, Number(s.minNoticeHours) || 0), autoConfirm: !!s.autoConfirm,
      breaks: (s.breaks || []).filter((b) => /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end) && b.end > b.start)
        .slice(0, 5).map((b) => ({ start: b.start, end: b.end })),
      cancelHours: Number.isFinite(Number(s.cancelHours)) ? Math.max(0, Number(s.cancelHours)) : 24,
    });
    return { ok: true };
  },
  async admin_block_add({ date, startTime, endTime, note }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) {
      throw new HttpError(400, "請確認日期和時間（結束要晚於開始）");
    }
    const start = L.toMs(date, startTime), end = L.toMs(date, endTime);
    const clash = (await dayBookings(date)).filter((b) => L.ACTIVE.includes(b.status) && start < b.end && end > b.start);
    await db.collection("blocks").add({ date, start, end, note: str(note, 50), createdAt: Date.now() });
    return { ok: true, clash: clash.length };
  },
  async admin_block_delete({ id }) {
    await db.doc(`blocks/${str(id, 100)}`).delete();
    return { ok: true };
  },
  async admin_closed_dates() {
    const today = L.twDate(Date.now());
    const list = docs(await db.collection("closedDates").where(admin.firestore.FieldPath.documentId(), ">=", today).get());
    return { dates: list.map((d) => ({ date: d.id, note: d.note || "" })).sort((a, b) => a.date.localeCompare(b.date)) };
  },
  async admin_closed_add({ date, note }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "日期格式錯誤");
    await db.doc(`closedDates/${date}`).set({ note: str(note, 50) });
    return { ok: true };
  },
  async admin_closed_delete({ date }) {
    await db.doc(`closedDates/${str(date, 10)}`).delete();
    return { ok: true };
  },
};

exports.api = onRequest({ cors: true, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const body = req.body || {};
    const fn = actions[body.action];
    if (!fn) throw new HttpError(400, "未知的動作");
    if (body.action.startsWith("admin_") && body.action !== "admin_login") requireAdmin(req);
    res.json(await fn(body));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    res.status(e instanceof HttpError ? e.status : 500).json({ error: e.message || String(e) });
  }
});

// 每天晚上 8 點：提醒明天的客人，並把明天行程傳給設計師
exports.dailyReminder = onSchedule({ schedule: "0 20 * * *", timeZone: "Asia/Taipei" }, async () => {
  const tomorrow = L.addDays(L.twDate(Date.now()), 1);
  const [settings, list] = await Promise.all([getSettings(), dayBookings(tomorrow)]);
  const active = list.filter((b) => L.ACTIVE.includes(b.status)).sort((a, b) => a.start - b.start);
  const names = {};
  for (const b of active) {
    const c = (await db.doc(`customers/${b.customerId}`).get()).data() || {};
    names[b.id] = c.name || b.customerName;
    if (b.remindedAt || !c.lineUserId) continue;
    await push(c.lineUserId, `⏰ 預約提醒\n明天 ${L.twLabel(b.start)}\n${b.serviceName}\n\n${settings.shopName}${settings.address ? "\n📍 " + settings.address : ""}\n\n期待見到你！如需更改請直接回覆訊息 🙏`);
    await db.doc(`bookings/${b.id}`).update({ remindedAt: Date.now() });
  }
  if (active.length && ADMIN_LINE()) {
    const lines = active.map((b) => `${L.twTime(b.start)} ${names[b.id]}｜${b.serviceName}${b.status === "pending" ? "（待確認）" : ""}`);
    await push(ADMIN_LINE(), `📅 明天（${tomorrow.slice(5).replace("-", "/")}）共 ${lines.length} 位\n\n${lines.join("\n")}`);
  }
});
