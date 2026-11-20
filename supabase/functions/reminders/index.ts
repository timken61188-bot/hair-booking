// 每天晚上由 GitHub Actions 呼叫：提醒明天的客人，並把明天行程傳給設計師
import { ADMIN_LINE_USER_ID, addDays, cors, db, json, push, twDate, twLabel, twTime } from "../_shared/common.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const tomorrow = addDays(twDate(new Date()), 1);
  const from = new Date(`${tomorrow}T00:00:00+08:00`).toISOString();
  const to = new Date(`${addDays(tomorrow, 1)}T00:00:00+08:00`).toISOString();

  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  const { data: list, error } = await db.from("bookings")
    .select("*, customers(name, phone, line_user_id)")
    .in("status", ["pending", "confirmed"])
    .gte("start_at", from).lt("start_at", to)
    .order("start_at");
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const b of list ?? []) {
    if (b.reminded_at || !b.customers?.line_user_id) continue;
    await push(b.customers.line_user_id,
      `⏰ 預約提醒\n明天 ${twLabel(b.start_at)}\n${b.service_name}\n\n${settings?.shop_name ?? ""}${settings?.address ? "\n📍 " + settings.address : ""}\n\n期待見到你！如需更改請直接回覆訊息 🙏`);
    await db.from("bookings").update({ reminded_at: new Date().toISOString() }).eq("id", b.id);
    sent++;
  }

  if (ADMIN_LINE_USER_ID && (list ?? []).length) {
    const lines = list!.map((b) =>
      `${twTime(new Date(b.start_at))} ${b.customers?.name ?? ""}｜${b.service_name}${b.status === "pending" ? "（待確認）" : ""}`);
    await push(ADMIN_LINE_USER_ID, `📅 明天（${tomorrow.slice(5).replace("-", "/")}）共 ${lines.length} 位\n\n${lines.join("\n")}`);
  }

  return json({ ok: true, tomorrow, total: list?.length ?? 0, reminded: sent });
});
