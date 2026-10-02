// =========================================================
//  תמלול פלוס – פונקציית שרת אחת ("api") ב-Supabase Edge Functions
//  מחזיקה את המפתחות בסוד ואוכפת הרשאות מנהל/משתמש בשרת.
//  Secrets נדרשים: GROQ_API_KEY, GEMINI_API_KEY, EMAILJS_PRIVATE_KEY
//  (אופציונלי: EMAILJS_SERVICE, EMAILJS_TEMPLATE, EMAILJS_PUBLIC_KEY, SITE_URL)
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const EJ_PRIVATE = Deno.env.get("EMAILJS_PRIVATE_KEY") ?? "";
const EJ_SERVICE = Deno.env.get("EMAILJS_SERVICE") ?? "service_tplus";
const EJ_TEMPLATE = Deno.env.get("EMAILJS_TEMPLATE") ?? "template_gzcqacc";
const EJ_PUBLIC = Deno.env.get("EMAILJS_PUBLIC_KEY") ?? "6G0YaH5dH_TKKk_hu";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://mutzlach-il.github.io/tamlul-plus/";
const FROM_NAME = "מוצלח";

const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sendEmail(to: string, subject: string, message: string, toName = "") {
  const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EJ_SERVICE, template_id: EJ_TEMPLATE, user_id: EJ_PUBLIC, accessToken: EJ_PRIVATE,
      template_params: { to_email: to, email: to, subject, title: subject, message, passcode: message, code: message, name: toName, to_name: toName, from_name: FROM_NAME },
    }),
  });
  if (!r.ok) throw new Error("EmailJS " + r.status + ": " + (await r.text()));
}

async function getCaller(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: prof } = await admin.from("profiles").select("*").eq("id", data.user.id).single();
  if (!prof || prof.disabled) return null;
  return prof as { id: string; email: string; display_name: string; role: string; perms: Record<string, boolean>; minutes_limit: number | null };
}

async function usedSecondsThisMonth(userId: string) {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const { data } = await admin.from("usage").select("seconds").eq("user_id", userId).eq("kind", "transcribe").gte("created_at", start.toISOString());
  return (data ?? []).reduce((a, r) => a + (r.seconds || 0), 0);
}

// ---------- 4-digit codes ----------
async function sendCode(email: string, purpose: string) {
  email = (email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("כתובת מייל לא תקינה");
  const { data: prof } = await admin.from("profiles").select("id,display_name,disabled").eq("email", email).maybeSingle();
  if (!prof) throw new Error("המייל הזה לא רשום במערכת. בקש מהמנהל להוסיף אותך.");
  if (prof.disabled) throw new Error("המשתמש הזה מושבת. פנה למנהל.");
  const { count } = await admin.from("auth_codes").select("id", { count: "exact", head: true })
    .eq("email", email).gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 5) throw new Error("נשלחו יותר מדי קודים. נסה שוב בעוד כמה דקות.");
  const code = String(Math.floor(1000 + Math.random() * 9000));
  await admin.from("auth_codes").insert({ email, purpose, code_hash: await sha256(email + ":" + code), expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
  await sendEmail(email, purpose === "reset" ? "קוד אימות – מוצלח" : "קוד כניסה – מוצלח", code, prof.display_name || "");
}

async function verifyCode(email: string, code: string, purpose: string, newPassword?: string) {
  email = (email || "").trim().toLowerCase();
  const { data: rows } = await admin.from("auth_codes").select("*").eq("email", email).eq("purpose", purpose)
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  if (!row) throw new Error("אין קוד פעיל – שלח קוד חדש");
  if (row.tries >= 5) throw new Error("יותר מדי ניסיונות – שלח קוד חדש");
  if ((await sha256(email + ":" + String(code).trim())) !== row.code_hash) {
    await admin.from("auth_codes").update({ tries: row.tries + 1 }).eq("id", row.id);
    throw new Error(`הקוד שגוי (נשארו ${Math.max(0, 4 - row.tries)} ניסיונות)`);
  }
  await admin.from("auth_codes").delete().eq("email", email);
  const { data: prof } = await admin.from("profiles").select("id,disabled").eq("email", email).single();
  if (!prof || prof.disabled) throw new Error("המשתמש מושבת");
  if (purpose === "reset") {
    if (!newPassword) throw new Error("יש להזין סיסמה חדשה");
    const { error } = await admin.auth.admin.updateUserById(prof.id, { password: newPassword });
    if (error) throw new Error(error.message);
  }
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (le) throw new Error(le.message);
  return { token_hash: link.properties.hashed_token };
}

// ---------- AI proxies ----------
async function groqTranscribe(form: FormData) {
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + GROQ_KEY }, body: form });
  const t = await r.text();
  return new Response(t, { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function groqChat(body: unknown) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + GROQ_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function groqModels() {
  const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + GROQ_KEY } });
  return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function gemini(path: string, body?: unknown) {
  if (!/^\/models(\?pageSize=\d+|\/[\w.\-]+:generateContent)$/.test(path)) throw new Error("bad path");
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta" + path, {
    method: body ? "POST" : "GET", headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// ---------- weekly report ----------
async function weeklyReport() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: recs } = await admin.from("recordings").select("owner,duration,status").gte("created_at", since).is("deleted_at", null);
  const { data: profs } = await admin.from("profiles").select("id,email,display_name,role");
  const byUser: Record<string, { n: number; sec: number; fail: number }> = {};
  (recs ?? []).forEach((r) => { const u = (byUser[r.owner] ??= { n: 0, sec: 0, fail: 0 }); u.n++; if (r.status === "done") u.sec += r.duration || 0; if (r.status === "error") u.fail++; });
  const lines = (profs ?? []).map((p) => { const u = byUser[p.id] ?? { n: 0, sec: 0, fail: 0 }; return `• ${p.display_name || p.email}: ${u.n} הקלטות, ${Math.round(u.sec / 60)} דקות${u.fail ? `, ${u.fail} נכשלו` : ""}`; });
  const total = Object.values(byUser).reduce((a, u) => ({ n: a.n + u.n, sec: a.sec + u.sec }), { n: 0, sec: 0 });
  const msg = `דו"ח שבועי – מוצלח\n\nסה"כ השבוע: ${total.n} הקלטות, ${Math.round(total.sec / 60)} דקות תמלול.\n\n${lines.join("\n")}\n\nכניסה למערכת: ${SITE_URL}`;
  for (const a of (profs ?? []).filter((p) => p.role === "admin")) await sendEmail(a.email, 'דו"ח שבועי – מוצלח', msg, a.display_name || "");
  return { sent: true };
}

// ---------- daily job (called by pg_cron): purge trash > 30 days, weekly report on Sunday ----------
async function getSetting(key: string) {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value;
}
async function purgeRecordings(ids: string[]) {
  if (!ids.length) return 0;
  const { data: rows } = await admin.from("recordings").select("id,file_path").in("id", ids);
  const paths = (rows ?? []).map((r) => r.file_path).filter(Boolean);
  if (paths.length) await admin.storage.from("audio").remove(paths);
  await admin.from("recordings").delete().in("id", ids);
  return (rows ?? []).length;
}
async function dailyJob() {
  const old = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: rows } = await admin.from("recordings").select("id").lt("deleted_at", old).limit(500);
  const purged = await purgeRecordings((rows ?? []).map((r) => r.id));
  await admin.from("auth_codes").delete().lt("expires_at", new Date(Date.now() - 864e5).toISOString());
  let weekly = false;
  const enabled = await getSetting("weekly_report");
  const last = await getSetting("last_weekly");
  if (enabled !== false && new Date().getUTCDay() === 0 && (!last || Date.now() - new Date(String(last)).getTime() > 6 * 864e5)) {
    await weeklyReport();
    await admin.from("app_settings").upsert({ key: "last_weekly", value: new Date().toISOString() });
    weekly = true;
  }
  // monthly report on the 1st
  let monthly = false;
  const now = new Date();
  if ((await getSetting("monthly_report")) !== false && now.getUTCDate() === 1 && (await getSetting("last_monthly")) !== now.toISOString().slice(0, 7)) {
    await periodReport(31, 'דו"ח חודשי – מוצלח');
    await admin.from("app_settings").upsert({ key: "last_monthly", value: now.toISOString().slice(0, 7) });
    monthly = true;
  }
  // weekly backup on Sunday → private bucket + emailed link
  let backup = false;
  if (now.getUTCDay() === 0) { try { await weeklyBackup(); backup = true; } catch (e) { console.error("backup", e); } }
  // delete old audio files (keep the text) if the admin set a retention period
  let cleaned = 0;
  const days = Number(await getSetting("audio_retention_days") || 0);
  if (days > 0) {
    const { data: oldRecs } = await admin.from("recordings").select("id,file_path").not("file_path", "is", null).lt("created_at", new Date(Date.now() - days * 864e5).toISOString()).limit(300);
    const paths = (oldRecs ?? []).map((r) => r.file_path).filter(Boolean);
    if (paths.length) { await admin.storage.from("audio").remove(paths); await admin.from("recordings").update({ file_path: null }).in("id", (oldRecs ?? []).map((r) => r.id)); cleaned = paths.length; }
  }
  return { purged, weekly, monthly, backup, cleaned };
}
async function periodReport(days: number, subject: string) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data: recs } = await admin.from("recordings").select("owner,duration,status").gte("created_at", since).is("deleted_at", null);
  const { data: profs } = await admin.from("profiles").select("id,email,display_name,role");
  const byUser: Record<string, { n: number; sec: number }> = {};
  (recs ?? []).forEach((r) => { const u = (byUser[r.owner] ??= { n: 0, sec: 0 }); u.n++; if (r.status === "done") u.sec += r.duration || 0; });
  const lines = (profs ?? []).map((p) => { const u = byUser[p.id] ?? { n: 0, sec: 0 }; return `• ${p.display_name || p.email}: ${u.n} הקלטות, ${Math.round(u.sec / 60)} דקות`; });
  const tot = Object.values(byUser).reduce((a, u) => ({ n: a.n + u.n, sec: a.sec + u.sec }), { n: 0, sec: 0 });
  const msg = `${subject}\n\nסה"כ: ${tot.n} הקלטות, ${Math.round(tot.sec / 60)} דקות תמלול.\n\n${lines.join("\n")}\n\nכניסה למערכת: ${SITE_URL}`;
  for (const a of (profs ?? []).filter((p) => p.role === "admin")) await sendEmail(a.email, subject, msg, a.display_name || "");
}
async function weeklyBackup() {
  const all: unknown[] = [];
  for (let from = 0; ; from += 500) {
    const { data } = await admin.from("recordings").select("id,owner,title,file_name,lang,status,duration,text,segments,summary,translations,tags,folder_id,speaker,category,parasha,hyear,occasion,rec_date,notes,extras,series,series_no,created_at").is("deleted_at", null).range(from, from + 499);
    all.push(...(data ?? [])); if (!data || data.length < 500) break;
  }
  const { data: folders } = await admin.from("folders").select("*");
  const name = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  await admin.storage.from("backups").upload(name, new Blob([JSON.stringify({ app: "tamlul-plus", cloud: true, exported: new Date().toISOString(), folders, recordings: all })], { type: "application/json" }), { upsert: true });
  const { data: link } = await admin.storage.from("backups").createSignedUrl(name, 14 * 864e5 / 1000);
  const { data: profs } = await admin.from("profiles").select("email,display_name,role").eq("role", "admin");
  for (const a of profs ?? []) await sendEmail(a.email, "גיבוי שבועי – מוצלח", `הגיבוי השבועי מוכן (${all.length} הקלטות).\nהורדה (הקישור בתוקף שבועיים):\n${link?.signedUrl ?? ""}`, a.display_name || "");
}
function xmlEsc(s: string) { return String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string)); }
async function publicFolder(slug: string, withAudio = true) {
  const { data: f } = await admin.from("folders").select("id,name,public_title,public_desc,public_slug").eq("public_slug", slug).maybeSingle();
  if (!f) throw new Error("הדף לא נמצא או שהשיתוף בוטל");
  const ids = [f.id];
  for (let i = 0; i < 5; i++) { const { data: kids } = await admin.from("folders").select("id").in("parent_id", ids); const add = (kids ?? []).map((k) => k.id).filter((x) => !ids.includes(x)); if (!add.length) break; ids.push(...add); }
  const { data: recs } = await admin.from("recordings").select("id,title,summary,text,duration,speaker,category,parasha,hyear,occasion,rec_date,created_at,file_path,mime,size,segments").in("folder_id", ids).is("deleted_at", null).eq("status", "done").order("created_at", { ascending: false }).limit(300);
  const out = [];
  for (const r of recs ?? []) {
    let audio = null;
    if (withAudio && r.file_path) { const { data: s } = await admin.storage.from("audio").createSignedUrl(r.file_path, 7 * 86400); audio = s?.signedUrl ?? null; }
    const { file_path: _p, ...pub } = r; out.push({ ...pub, audio });
  }
  return { folder: { name: f.public_title || f.name, desc: f.public_desc || "" }, recordings: out };
}
async function rss(slug: string) {
  const d = await publicFolder(slug, true);
  const items = d.recordings.filter((r) => r.audio).map((r) => `<item><title>${xmlEsc(r.title)}</title><description>${xmlEsc(r.summary || (r.text || "").slice(0, 600))}</description><enclosure url="${xmlEsc(r.audio as string)}" length="${r.size || 0}" type="${xmlEsc(r.mime || "audio/mpeg")}"/><guid isPermaLink="false">${r.id}</guid><pubDate>${new Date(r.created_at).toUTCString()}</pubDate><itunes:duration>${Math.round(r.duration || 0)}</itunes:duration></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>${xmlEsc(d.folder.name)}</title><description>${xmlEsc(d.folder.desc || d.folder.name)}</description><language>he</language><link>${xmlEsc(SITE_URL + "?pub=" + slug)}</link><itunes:image href="${xmlEsc(SITE_URL + "icon-512.png")}"/>${items}</channel></rss>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url); const slug = u.searchParams.get("rss");
      if (slug) return new Response(await rss(slug), { headers: { ...CORS, "Content-Type": "application/rss+xml; charset=utf-8" } });
      return new Response("ok", { headers: CORS });
    }
    const ctype = req.headers.get("content-type") ?? "";
    // multipart = transcription upload
    if (ctype.startsWith("multipart/form-data")) {
      const me = await getCaller(req);
      if (!me) return fail("לא מחובר", 401);
      if (me.perms?.transcribe === false) return fail("אין לך הרשאה לתמלל", 403);
      const form = await req.formData();
      const seconds = Number(form.get("x_seconds") ?? 0);
      form.delete("x_seconds");
      if (me.minutes_limit != null && me.role !== "admin") {
        const used = await usedSecondsThisMonth(me.id);
        if (used + seconds > me.minutes_limit * 60) return fail(`עברת את מכסת הדקות החודשית (${me.minutes_limit} דק׳)`, 403);
      }
      const res = await groqTranscribe(form);
      if (res.ok && seconds) await admin.from("usage").insert({ user_id: me.id, kind: "transcribe", seconds });
      return res;
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ----- public actions -----
    if (action === "send-code") { await sendCode(body.email, body.purpose === "reset" ? "reset" : "login"); return json({ ok: true }); }
    if (action === "verify-code") return json(await verifyCode(body.email, body.code, body.purpose === "reset" ? "reset" : "login", body.password));
    if (action === "share-view") {
      const { data: r } = await admin.from("recordings").select("title,text,segments,summary,translations,created_at,duration,lang,file_path,share_expires,deleted_at,speaker,category,parasha,hyear,occasion,rec_date")
        .eq("share_token", String(body.token || "")).maybeSingle();
      if (!r || r.deleted_at || (r.share_expires && new Date(r.share_expires) < new Date())) return fail("הקישור לא תקף או שפג תוקפו", 404);
      let audio = null;
      if (r.file_path) { const { data: s } = await admin.storage.from("audio").createSignedUrl(r.file_path, 3600); audio = s?.signedUrl ?? null; }
      const { file_path: _f, deleted_at: _d, ...pub } = r;
      return json({ ...pub, audio });
    }
    if (action === "cron") return json(await dailyJob());
    if (action === "public-folder") return json(await publicFolder(String(body.slug || "")));
    if (action === "request-access") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return fail("כתובת מייל לא תקינה");
      const { count } = await admin.from("access_requests").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
      if ((count ?? 0) > 0) return fail("כבר נשלחה בקשה מהמייל הזה. המנהל יעדכן אותך.");
      await admin.from("access_requests").insert({ email, name: String(body.name || "").slice(0, 80), note: String(body.note || "").slice(0, 500) });
      const { data: admins } = await admin.from("profiles").select("email,display_name").eq("role", "admin");
      for (const a of admins ?? []) await sendEmail(a.email, "בקשת הצטרפות – מוצלח", `${body.name || email} (${email}) מבקש גישה למערכת התמלול.\n${body.note ? "הערה: " + body.note + "\n" : ""}\nלאישור: ${SITE_URL} ← ניהול ← בקשות`, a.display_name || "").catch(() => {});
      return json({ ok: true });
    }

    // ----- signed-in actions -----
    const me = await getCaller(req);
    if (!me) return fail("לא מחובר או שהמשתמש מושבת", 401);

    if (action === "groq-chat") {
      const kind = body.kind as string;
      if (kind === "summary" && me.perms?.summarize === false) return fail("אין לך הרשאה לסכם", 403);
      if (kind === "translate" && me.perms?.translate === false) return fail("אין לך הרשאה לתרגם", 403);
      if (kind === "chat" && me.perms?.chat === false) return fail("אין לך הרשאה לצ'אט", 403);
      const res = await groqChat(body.payload);
      if (res.ok) await admin.from("usage").insert({ user_id: me.id, kind: kind || "chat" });
      return res;
    }
    if (action === "groq-models") return await groqModels();
    if (action === "verify-2fa") {
      const { data: rows } = await admin.from("auth_codes").select("*").eq("email", me.email).eq("purpose", "login").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
      const row = rows?.[0]; if (!row) return fail("אין קוד פעיל – שלח קוד חדש");
      if (row.tries >= 5) return fail("יותר מדי ניסיונות – שלח קוד חדש");
      if ((await sha256(me.email + ":" + String(body.code).trim())) !== row.code_hash) { await admin.from("auth_codes").update({ tries: row.tries + 1 }).eq("id", row.id); return fail("הקוד שגוי"); }
      await admin.from("auth_codes").delete().eq("email", me.email);
      return json({ ok: true });
    }
    if (action === "nakdan") {
      const r = await fetch("https://nakdan-2-0.loadbalancer.dicta.org.il/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "nakdan", data: String(body.text || "").slice(0, 20000), genre: "modern", addmorph: false, keepqq: false, nodageshdefmem: false, patachma: false, keepmetagim: true }) });
      if (!r.ok) return fail("שירות הניקוד לא זמין כרגע", 502);
      const arr = await r.json();
      const out = (Array.isArray(arr) ? arr : (arr.data ?? [])).map((w: any) => w.sep ? (w.word ?? "") : ((w.options?.[0]?.w ?? w.options?.[0] ?? w.word ?? "") + "").replace(/\|/g, "")).join("");
      return json({ text: out });
    }
    if (action === "fetch-url") {
      let url = String(body.url || "").trim();
      const g = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*id=)([\w-]{10,})/);
      if (g) url = `https://drive.usercontent.google.com/download?id=${g[1]}&export=download&confirm=t`;
      if (!/^https?:\/\//.test(url)) return fail("קישור לא תקין");
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) return fail("לא הצלחתי להוריד את הקובץ (" + r.status + ")");
      const len = Number(r.headers.get("content-length") || 0);
      if (len > 150 * 1024 * 1024) return fail("הקובץ גדול מדי (מעל 150MB)");
      const ct = r.headers.get("content-type") || "application/octet-stream";
      if (/text\/html/.test(ct)) return fail("הקישור מוביל לדף אינטרנט ולא לקובץ. בגוגל דרייב – ודא שהקובץ משותף לכל מי שיש לו את הקישור.");
      const cd = r.headers.get("content-disposition") || "";
      const fname = decodeURIComponent((cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1] || url.split("/").pop()?.split("?")[0] || "file");
      return new Response(r.body, { headers: { ...CORS, "Content-Type": ct, "X-File-Name": encodeURIComponent(fname), "Access-Control-Expose-Headers": "X-File-Name" } });
    }
    if (action === "gemini") {
      if (body.kind === "translate" && me.perms?.translate === false) return fail("אין לך הרשאה לתרגם", 403);
      if (body.kind === "transcribe") {
        if (me.perms?.transcribe === false) return fail("אין לך הרשאה לתמלל", 403);
        if (me.minutes_limit != null && me.role !== "admin") {
          const used = await usedSecondsThisMonth(me.id);
          if (used + Number(body.seconds || 0) > me.minutes_limit * 60) return fail(`עברת את מכסת הדקות החודשית (${me.minutes_limit} דק׳)`, 403);
        }
      }
      const res = await gemini(body.path, body.payload);
      if (res.ok && body.kind === "transcribe" && body.seconds) await admin.from("usage").insert({ user_id: me.id, kind: "transcribe", seconds: Number(body.seconds) });
      return res;
    }

    // ----- admin only -----
    if (me.role !== "admin") return fail("רק מנהל יכול לבצע פעולה זו", 403);

    if (action === "admin-invite") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return fail("כתובת מייל לא תקינה");
      const { data: exists } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (exists) return fail("המייל הזה כבר רשום במערכת");
      const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: body.password || undefined, app_metadata: { invited: true }, user_metadata: { display_name: body.name || email.split("@")[0] } });
      if (error) return fail(error.message);
      await admin.from("profiles").update({ role: ["admin", "editor"].includes(body.role) ? body.role : "user", display_name: body.name || email.split("@")[0], perms: body.perms ?? undefined, minutes_limit: body.minutes_limit ?? null }).eq("id", u.user.id);
      if (body.sendInvite !== false) {
        await sendEmail(email, "הוזמנת למערכת – מוצלח",
          `שלום ${body.name || ""},\n\n${me.display_name || "המנהל"} הוסיף אותך למערכת התמלול "מוצלח".\n\nכניסה: ${SITE_URL}\n\nאפשר להיכנס עם כפתור "כניסה עם Google" (עם המייל הזה), או עם "כניסה עם קוד למייל" – ויישלח אליך קוד בן 4 ספרות.`, body.name || "");
      }
      return json({ ok: true, id: u.user.id });
    }
    if (action === "admin-update-user") {
      const patch: Record<string, unknown> = {};
      for (const k of ["role", "perms", "minutes_limit", "display_name", "disabled"]) if (k in body) patch[k] = body[k];
      if (body.id === me.id && (patch.role === "user" || patch.disabled === true)) return fail("אי אפשר להוריד הרשאות מעצמך");
      const { error } = await admin.from("profiles").update(patch).eq("id", body.id);
      if (error) return fail(error.message);
      if ("disabled" in body) await admin.auth.admin.updateUserById(body.id, { ban_duration: body.disabled ? "876000h" : "none" });
      if (body.password) await admin.auth.admin.updateUserById(body.id, { password: body.password });
      return json({ ok: true });
    }
    if (action === "admin-delete-user") {
      if (body.id === me.id) return fail("אי אפשר למחוק את עצמך");
      await admin.from("recordings").update({ owner: me.id }).eq("owner", body.id);
      await admin.from("folders").update({ owner: me.id }).eq("owner", body.id);
      const { error } = await admin.auth.admin.deleteUser(body.id);
      if (error) return fail(error.message);
      return json({ ok: true });
    }
    if (action === "admin-test-email") { await sendEmail(me.email, "בדיקה – מוצלח", "1234", me.display_name || ""); return json({ ok: true }); }
    if (action === "admin-weekly-now") return json(await weeklyReport());
    if (action === "admin-purge") return json({ purged: await purgeRecordings((body.ids ?? []).map(String)) });
    if (action === "admin-keys-status") return json({ groq: !!GROQ_KEY, gemini: !!GEMINI_KEY, email: !!EJ_PRIVATE });
    if (action === "admin-monthly-now") { await periodReport(31, 'דו"ח חודשי – מוצלח'); return json({ ok: true }); }
    if (action === "admin-backup-now") { await weeklyBackup(); return json({ ok: true }); }
    if (action === "admin-status") {
      const [{ count: recs }, { count: users }] = await Promise.all([admin.from("recordings").select("id", { count: "exact", head: true }), admin.from("profiles").select("id", { count: "exact", head: true })]);
      const t0 = Date.now(); let groqOk = false, gemOk = false;
      try { groqOk = (await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + GROQ_KEY } })).ok; } catch (_) {}
      const t1 = Date.now();
      try { gemOk = (await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": GEMINI_KEY } })).ok; } catch (_) {}
      return json({ recs, users, groqOk, gemOk, groqMs: t1 - t0, gemMs: Date.now() - t1, lastWeekly: await getSetting("last_weekly"), lastMonthly: await getSetting("last_monthly") });
    }

    return fail("פעולה לא מוכרת");
  } catch (e) {
    return fail((e as Error).message || String(e), 400);
  }
});
