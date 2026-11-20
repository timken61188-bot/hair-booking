// 共用小工具
const C = window.APP_CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const FN_URL = C.SUPABASE_URL + "/functions/v1/api";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const STATUS = { pending: "待確認", confirmed: "已確認", cancelled: "已取消", done: "已完成" };

// 台灣時間
function twParts(iso) {
  const t = new Date(new Date(iso).getTime() + 8 * 3600e3);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay(),
    hm: t.toISOString().slice(11, 16), date: t.toISOString().slice(0, 10) };
}
function twToday() { return twParts(new Date().toISOString()).date; }
function addDays(dateStr, n) { const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekdayOf(dateStr) { return new Date(dateStr + "T12:00:00Z").getUTCDay(); }
function fmtWhen(iso) { const p = twParts(iso); return `${p.m}/${p.d}（${WEEK[p.w]}）${p.hm}`; }
function fmtDate(dateStr) { const [, m, d] = dateStr.split("-").map(Number); return `${m}/${d}（${WEEK[weekdayOf(dateStr)]}）`; }
function fmtPrice(s) { return s.price == null ? "現場報價" : `$${Number(s.price).toLocaleString()}${s.price_note ? " " + s.price_note : ""}`; }
function fmtDur(min) { const h = Math.floor(min / 60), m = min % 60; return (h ? h + " 小時" : "") + (m ? m + " 分" : ""); }

function toast(msg, ms = 2400) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function sheet(html, onMount) {
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="sheet">${html}</div>`;
  o.addEventListener("click", (e) => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  const close = () => o.remove();
  $$("[data-close]", o).forEach((b) => b.addEventListener("click", close));
  onMount && onMount(o, close);
  return close;
}

function viewImage(src) {
  const v = document.createElement("div");
  v.className = "viewer";
  v.innerHTML = `<img src="${esc(src)}">`;
  v.addEventListener("click", () => v.remove());
  document.body.appendChild(v);
}

function publicUrl(path) { return sb.storage.from("portfolio").getPublicUrl(path).data.publicUrl; }

// 手機照片先縮小再上傳（最長邊 1600px）
async function compressImage(file, max = 1600) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
}
