// 客人（LINE LIFF）與設計師後台共用的 API
import {
  ADMIN_LINE_USER_ID, LIFF_URL, addDays, cors, db, json, push, twDate, twLabel,
} from "../_shared/common.ts";

const LOGIN_CHANNEL_ID = Deno.env.get("LINE_LOGIN_CHANNEL_ID") ?? "";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const STATUS_TEXT: Record<string, string> = {
  pending: "待確認", confirmed: "已確認", cancelled: "已取消", done: "已完成",
};

// ---------- 身分驗證 ----------
async function verifyLine(idToken?: string) {
  if (!idToken) throw new HttpError(401, "請用 LINE 開啟");
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LOGIN_CHANNEL_ID }),
  });
  if (!r.ok) throw new HttpError(401, "LINE_LOGIN_EXPIRED");
  const p = await r.json();
  return { userId: p.sub as string, name: (p.name ?? "") as string, picture: (p.picture ?? null) as string | null };
}

async function getCustomer(idToken?: string) {
  const line = await verifyLine(idToken);
  const { data: found } = await db.from("customers").select("*").eq("line_user_id", line.userId).maybeSingle();
  if (found) {
    if (found.line_name !== line.name || found.picture_url !== line.picture) {
      await db.from("customers").update({ line_name: line.name, picture_url: line.picture }).eq("id", found.id);
    }
    return { ...found, line_name: line.name };
  }
  const { data, error } = await db.from("customers").insert({
    line_user_id: line.userId, line_name: line.name, picture_url: line.picture, name: line.name,
  }).select().single();
  if (error) throw error;
  return data;
}

async function requireAdmin(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "請先登入後台");
}

// ---------- 可預約時段 ----------
async function getSettings() {
  const { data } = await db.from("settings").select("*").eq("id", 1).single();
  return data!;
}

async function availableSlots(date: string, durationMin: number) {
  const s = await getSettings();
  const today = twDate(new Date());
  if (date < today || date > addDays(today, s.days_ahead)) return [];
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  if (!s.open_weekdays.includes(weekday)) return [];
  const { data: closed } = await db.from("closed_dates").select("date").eq("date", date).maybeSingle();
  if (closed) return [];

  const open = Date.parse(`${date}T${s.open_time.slice(0, 5)}:00+08:00`);
  const close = Date.parse(`${date}T${s.close_time.slice(0, 5)}:00+08:00`);
  const { data: busy } = await db.from("bookings").select("start_at,end_at")
    .in("status", ["pending", "confirmed"])
    .lt("start_at", new Date(close).toISOString())
    .gt("end_at", new Date(open).toISOString());
  const ranges = (busy ?? []).map((b) => [Date.parse(b.start_at), Date.parse(b.end_at)]);
  const earliest = Date.now() + s.min_notice_hours * 3600_000;
  const dur = durationMin * 60_000;
  const step = s.slot_minutes * 60_000;

  const slots: string[] = [];
  for (let t = open; t + dur <= close; t += step) {
    if (t < earliest) continue;
    if (ranges.some(([a, b]) => t < b && t + dur > a)) continue;
    slots.push(new Date(t + 8 * 3600_000).toISOString().slice(11, 16));
  }
  return slots;
}

async function myBookings(customerId: string) {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data } = await db.from("bookings")
    .select("id,service_name,start_at,end_at,status,note")
    .eq("customer_id", customerId).gte("start_at", since)
    .order("start_at", { ascending: false });
  return data ?? [];
}

// ---------- 主程式 ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const { action } = body;

    // ===== 客人 =====
    if (action === "me") {
      const c = await getCustomer(body.idToken);
      return json({ customer: { name: c.name, phone: c.phone, line_name: c.line_name, line_user_id: c.line_user_id }, bookings: await myBookings(c.id) });
    }

    if (action === "save_profile") {
      const c = await getCustomer(body.idToken);
      await db.from("customers").update({
        name: String(body.name ?? "").trim().slice(0, 50),
        phone: String(body.phone ?? "").trim().slice(0, 30),
      }).eq("id", c.id);
      return json({ ok: true });
    }

    if (action === "slots") {
      await verifyLine(body.idToken);
      const { data: svc } = await db.from("services").select("duration_min").eq("id", body.serviceId).eq("active", true).single();
      if (!svc) throw new HttpError(400, "找不到這個服務項目");
      return json({ slots: await availableSlots(body.date, svc.duration_min) });
    }

    if (action === "book") {
      const c = await getCustomer(body.idToken);
      const name = String(body.name ?? "").trim().slice(0, 50);
      const phone = String(body.phone ?? "").trim().slice(0, 30);
      if (!name || !phone) throw new HttpError(400, "請填寫姓名和電話");
      const { data: svc } = await db.from("services").select("*").eq("id", body.serviceId).eq("active", true).single();
      if (!svc) throw new HttpError(400, "找不到這個服務項目");
      const slots = await availableSlots(body.date, svc.duration_min);
      if (!slots.includes(body.time)) throw new HttpError(409, "這個時段已經無法預約，請選其他時間");

      const s = await getSettings();
      const start = new Date(`${body.date}T${body.time}:00+08:00`);
      const end = new Date(start.getTime() + svc.duration_min * 60_000);
      await db.from("customers").update({ name, phone }).eq("id", c.id);
      const { data: b, error } = await db.from("bookings").insert({
        customer_id: c.id, service_id: svc.id, service_name: svc.name,
        start_at: start.toISOString(), end_at: end.toISOString(),
        status: s.auto_confirm ? "confirmed" : "pending",
        note: String(body.note ?? "").slice(0, 500),
      }).select().single();
      if (error) {
        if (error.code === "23P01") throw new HttpError(409, "這個時段剛被預約走了，請選其他時間");
        throw error;
      }

      const when = twLabel(b.start_at);
      await push(c.line_user_id, s.auto_confirm
        ? `✅ 預約成功！\n${when}\n${svc.name}\n\n${s.shop_name}${s.address ? "\n📍 " + s.address : ""}\n\n如需取消請到「我的預約」${LIFF_URL ? "\n" + LIFF_URL + "?page=mine" : ""}`
        : `📩 已收到你的預約，設計師確認後會再通知你\n${when}\n${svc.name}`);
      await push(ADMIN_LINE_USER_ID,
        `🔔 新預約${s.auto_confirm ? "" : "（待確認）"}\n${when}\n${svc.name}\n${name}　${phone}${b.note ? "\n備註：" + b.note : ""}`);
      return json({ booking: b });
    }

    if (action === "cancel") {
      const c = await getCustomer(body.idToken);
      const { data: b } = await db.from("bookings").select("*").eq("id", body.bookingId).eq("customer_id", c.id).single();
      if (!b || !["pending", "confirmed"].includes(b.status)) throw new HttpError(400, "這筆預約無法取消");
      if (Date.parse(b.start_at) < Date.now()) throw new HttpError(400, "預約時間已過，無法取消");
      await db.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
      await push(ADMIN_LINE_USER_ID, `❌ 客人取消預約\n${twLabel(b.start_at)}\n${b.service_name}\n${c.name}　${c.phone}`);
      return json({ ok: true });
    }

    // ===== 設計師後台 =====
    if (action === "admin_set_status") {
      await requireAdmin(req);
      const status = body.status;
      if (!STATUS_TEXT[status]) throw new HttpError(400, "狀態錯誤");
      const { data: b, error } = await db.from("bookings").update({ status }).eq("id", body.bookingId)
        .select("*, customers(line_user_id)").single();
      if (error) {
        if (error.code === "23P01") throw new HttpError(409, "這個時段已經有其他預約");
        throw error;
      }
      const to = b.customers?.line_user_id;
      if (body.notify !== false) {
        if (status === "confirmed") {
          const s = await getSettings();
          await push(to, `✅ 設計師已確認你的預約\n${twLabel(b.start_at)}\n${b.service_name}\n\n${s.shop_name}${s.address ? "\n📍 " + s.address : ""}`);
        } else if (status === "cancelled") {
          await push(to, `很抱歉，你 ${twLabel(b.start_at)} 的預約（${b.service_name}）已取消${body.reason ? "\n原因：" + body.reason : ""}\n\n歡迎重新預約其他時間 🙏${LIFF_URL ? "\n" + LIFF_URL : ""}`);
        } else if (status === "done" && body.thanks) {
          await push(to, `謝謝你今天的光臨 💇\n有任何問題都可以直接在這裡留言給我！`);
        }
      }
      return json({ ok: true });
    }

    if (action === "admin_message") {
      await requireAdmin(req);
      const { data: c } = await db.from("customers").select("line_user_id").eq("id", body.customerId).single();
      if (!c?.line_user_id) throw new HttpError(400, "這位客人沒有綁定 LINE");
      await push(c.line_user_id, String(body.text ?? "").slice(0, 2000));
      return json({ ok: true });
    }

    throw new HttpError(400, "未知的動作");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
