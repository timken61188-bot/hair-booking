// 不依賴 Firebase 的純函式（方便測試）
const TW = 8 * 3600e3; // 台灣 UTC+8，沒有日光節約
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const ACTIVE = ["pending", "confirmed"];

const DEFAULT_SETTINGS = {
  shopName: "我的髮型工作室",
  designerName: "",
  address: "",
  phone: "",
  notice: "",
  openTime: "10:00",
  closeTime: "20:00",
  openWeekdays: [0, 2, 3, 4, 5, 6], // 0=週日
  slotMinutes: 30,
  daysAhead: 30,
  minNoticeHours: 2,
  autoConfirm: false,
  breaks: [],              // 每天固定休息，例如 [{ start: "13:00", end: "14:00" }]
  cancelHours: 24,         // 預約前幾小時內不能線上取消
};

const twDate = (ms) => new Date(ms + TW).toISOString().slice(0, 10);
const twTime = (ms) => new Date(ms + TW).toISOString().slice(11, 16);
const toMs = (date, time) => Date.parse(`${date}T${time}:00+08:00`);
const weekdayOf = (date) => new Date(date + "T12:00:00Z").getUTCDay();
function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function twLabel(ms) {
  const t = new Date(ms + TW);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）${twTime(ms)}`;
}

/**
 * 計算某天可預約的開始時間
 * busy: [{ start, end, status }]（毫秒）
 */
function availableSlots({ date, durationMin, settings, closed = false, busy = [], now = Date.now() }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const today = twDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  if (date < today || date > addDays(today, s.daysAhead)) return [];
  if (!s.openWeekdays.includes(weekdayOf(date)) || closed) return [];

  const open = toMs(date, s.openTime);
  const close = toMs(date, s.closeTime);
  const dur = durationMin * 60e3;
  const step = Math.max(5, s.slotMinutes) * 60e3;
  const earliest = now + s.minNoticeHours * 3600e3;
  const taken = busy.filter((b) => ACTIVE.includes(b.status));
  for (const br of s.breaks || []) {
    if (/^\d{2}:\d{2}$/.test(br.start) && /^\d{2}:\d{2}$/.test(br.end) && br.end > br.start) {
      taken.push({ start: toMs(date, br.start), end: toMs(date, br.end) });
    }
  }

  const out = [];
  for (let t = open; t + dur <= close; t += step) {
    if (t < earliest) continue;
    if (taken.some((b) => t < b.end && t + dur > b.start)) continue;
    out.push(twTime(t));
  }
  return out;
}

const overlaps = (start, end, busy) =>
  busy.some((b) => ACTIVE.includes(b.status) && start < b.end && end > b.start);

module.exports = { ACTIVE, DEFAULT_SETTINGS, WEEK, twDate, twTime, toMs, weekdayOf, addDays, twLabel, availableSlots, overlaps };
