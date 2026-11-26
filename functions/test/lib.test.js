const test = require("node:test");
const assert = require("node:assert");
const { availableSlots, overlaps, toMs, twLabel, addDays, revisitDue } = require("../lib");

// 2026-11-20 是週五，台灣時間早上 9 點
const now = toMs("2026-11-20", "09:00");
const settings = { openTime: "10:00", closeTime: "13:00", slotMinutes: 30, minNoticeHours: 2, daysAhead: 30, openWeekdays: [0, 2, 3, 4, 5, 6] };

test("營業時間內依間隔列出時段，並扣掉提前時數", () => {
  const s = availableSlots({ date: "2026-11-20", durationMin: 60, settings, now });
  // 11:00 前不能約（提前 2 小時），12:00 是最後一個能做完 60 分鐘的時段
  assert.deepStrictEqual(s, ["11:00", "11:30", "12:00"]);
});

test("已被預約的時段不能約，已取消的可以", () => {
  const busy = [
    { start: toMs("2026-11-21", "10:30"), end: toMs("2026-11-21", "11:30"), status: "confirmed" },
    { start: toMs("2026-11-21", "12:00"), end: toMs("2026-11-21", "13:00"), status: "cancelled" },
  ];
  const s = availableSlots({ date: "2026-11-21", durationMin: 60, settings, busy, now });
  assert.deepStrictEqual(s, ["11:30", "12:00"]);
});

test("公休日、不營業的星期、超過可預約天數、過去日期都沒有時段", () => {
  assert.deepStrictEqual(availableSlots({ date: "2026-11-23", durationMin: 60, settings, now }), []); // 週一
  assert.deepStrictEqual(availableSlots({ date: "2026-11-21", durationMin: 60, settings, now, closed: true }), []);
  assert.deepStrictEqual(availableSlots({ date: addDays("2026-11-20", 31), durationMin: 60, settings, now }), []);
  assert.deepStrictEqual(availableSlots({ date: "2026-11-19", durationMin: 60, settings, now }), []);
  assert.deepStrictEqual(availableSlots({ date: "bad", durationMin: 60, settings, now }), []);
});

test("重疊判斷", () => {
  const busy = [{ start: toMs("2026-11-21", "10:00"), end: toMs("2026-11-21", "11:00"), status: "pending" }];
  assert.ok(overlaps(toMs("2026-11-21", "10:30"), toMs("2026-11-21", "11:30"), busy));
  assert.ok(!overlaps(toMs("2026-11-21", "11:00"), toMs("2026-11-21", "12:00"), busy));
});

test("台灣時間顯示", () => {
  assert.strictEqual(twLabel(toMs("2026-11-21", "14:30")), "11/21（六）14:30");
});

test("每天固定休息時間不能約", () => {
  const s = availableSlots({ date: "2026-11-21", durationMin: 60, settings: { ...settings, breaks: [{ start: "11:00", end: "12:00" }] }, now });
  assert.deepStrictEqual(s, ["10:00", "12:00"]);
});

test("單次封鎖（當作佔用）不能約", () => {
  const busy = [{ start: toMs("2026-11-21", "12:00"), end: toMs("2026-11-21", "13:00"), status: "confirmed" }];
  assert.deepStrictEqual(availableSlots({ date: "2026-11-21", durationMin: 30, settings, busy, now }), ["10:00", "10:30", "11:00", "11:30"]);
});

test("回訪提醒：到期才提醒，已約下次或已提醒過就不傳", () => {
  const revisitDays = { dye: 42, cut: 35 };
  const bookings = [
    { id: "1", customerId: "A", status: "done", date: "2026-10-01", serviceIds: ["dye"] },             // 10/1 + 42 = 11/12
    { id: "2", customerId: "B", status: "done", date: "2026-10-01", serviceIds: ["dye"] },
    { id: "3", customerId: "B", status: "confirmed", date: "2026-11-20", serviceIds: ["cut"] },        // B 已約下次
    { id: "4", customerId: "C", status: "done", date: "2026-10-01", serviceIds: ["dye"], revisitSentAt: 1 },
    { id: "5", customerId: "D", status: "done", date: "2026-10-08", serviceIds: ["dye", "cut"] },      // 取短的 35 天 = 11/12
    { id: "6", customerId: "E", status: "done", date: "2026-10-01", serviceIds: ["perm"] },            // 沒設定
  ];
  const due = revisitDue({ bookings, revisitDays, today: "2026-11-12" }).map((x) => x.booking.id);
  assert.deepStrictEqual(due, ["1", "5"]);
});
