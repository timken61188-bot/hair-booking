import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const adminId = Deno.env.get("ADMIN_LINE_USER_ID") ?? "";
export const ADMIN_LINE_USER_ID = adminId.startsWith("U") ? adminId : "";
export const LIFF_URL = Deno.env.get("LIFF_URL") ?? "";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

// 台灣時間（UTC+8，沒有日光節約）
const TW = 8 * 3600 * 1000;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function twDate(d: Date) {
  return new Date(d.getTime() + TW).toISOString().slice(0, 10);
}
export function twTime(d: Date) {
  return new Date(d.getTime() + TW).toISOString().slice(11, 16);
}
export function twLabel(iso: string) {
  const d = new Date(iso);
  const t = new Date(d.getTime() + TW);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）${twTime(d)}`;
}
export function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function push(to: string | null | undefined, text: string) {
  if (!LINE_TOKEN || !to) return;
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) console.error("LINE push failed", r.status, await r.text());
}
