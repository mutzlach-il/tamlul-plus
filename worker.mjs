// המעבד האוטומטי של המערכת: פותח את המערכת עצמה בדפדפן בשרת של GitHub, מחובר כמשתמש "מעבד אוטומטי",
// ומתמלל כל הקלטה שמחכה בענן ואף מחשב לא מטפל בה – בכל חסידות שהמשתמש חבר בה. אותו קוד, אותם כללים בדיוק.
// הסיסמה לא כתובה כאן – היא נשמרת אצל GitHub בתור "סוד" (WORKER_EMAIL, WORKER_PASSWORD).
import { chromium } from 'playwright';
const APP = 'https://mutzlach-il.github.io/tamlul-plus/';
const SB_URL = 'https://afmxylpcwqydjgiewewc.supabase.co';
const SB_KEY = 'sb_publishable_4S8OmERqXFNnc6zI1twl8A_zJbIrxl9';
const LIMIT_MS = (Number(process.env.WORKER_MINUTES) || 330) * 60 * 1000;
const t0 = Date.now();
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);

let session;
if (process.env.WORKER_SESSION) session = JSON.parse(process.env.WORKER_SESSION); // רק לבדיקות
else {
  // רווחים / ירידת שורה שנכנסו בטעות בהקלדת הסוד בגיטהאב – מנקים
  const email = String(process.env.WORKER_EMAIL || '').trim().toLowerCase(), password = String(process.env.WORKER_PASSWORD || '').replace(/^[\s\u200e\u200f]+|[\s\u200e\u200f]+$/g, '');
  const rawE = String(process.env.WORKER_EMAIL || ''), rawP = String(process.env.WORKER_PASSWORD || '');
  log(`בדיקת הסודות (בלי לחשוף אותם): מייל תקין=${email === 'bnyytmrkwt+worker@gmail.com'} · רווחים במייל=${rawE !== rawE.trim()} · סיסמה קיימת=${password.length >= 6} · רווחים בסיסמה=${rawP.length !== password.length}`);
  if (!email || !password) { log('המעבד עוד לא הוגדר (חסרים WORKER_EMAIL / WORKER_PASSWORD בסודות של GitHub) – לא עושה כלום'); process.exit(0); }
  const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  session = await r.json();
  if (!r.ok || !session.access_token) { log('הכניסה נכשלה: ' + (session.error_description || session.msg || r.status)); process.exit(1); }
}
session.expires_at = session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600);

// כרום שכבר מותקן בשרת של גיטהאב – בלי הורדות (הורדת הדפדפן נתקעה לפעמים)
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch (e) { log('כרום המותקן לא זמין – משתמש בדפדפן של Playwright'); browser = await chromium.launch(); }
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block' });
if (process.env.WORKER_ROUTES) await (await import(process.env.WORKER_ROUTES)).default(ctx); // רק לבדיקות
await ctx.addInitScript((s) => { try { localStorage.setItem('tplus-cloud-auth', JSON.stringify(s)); localStorage.setItem('tp_worker', '1'); localStorage.setItem('tp_tourDone', '1'); localStorage.setItem('seenNew', JSON.stringify('9.9.9')); } catch (e) {} }, session);
const page = await ctx.newPage();
page.on('dialog', (d) => d.dismiss());
page.on('console', (m) => { const t = m.text(); if (/^\[worker\]/.test(t)) log(t); else if (m.type() === 'error' && !/Failed to load resource/.test(t)) log('⚠️ ' + t.slice(0, 200)); });

const ready = () => page.waitForFunction(() => typeof ME !== 'undefined' && ME && typeof ORG !== 'undefined' && ORG && window.__worker, null, { timeout: 90000 });
async function openOrg(org) {
  if (org) { // עוברים לחסידות בשרת, ואז טוענים מחדש – כמו "⇄ מעבר לחסידות"
    const err = await page.evaluate(async (o) => { try { sessionStorage.setItem('tp_orgPick', o); sessionStorage.setItem('tp_urlOrgDone', '1'); } catch (e) {} const { error } = await sb.rpc('switch_org', { p_org: o }); return error ? error.message : ''; }, org);
    if (err) { log(`מעבר ל-${org} נכשל: ${err}`); return; }
  }
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready();
}
let total = 0;
try {
  await openOrg(null);
  const orgs = await page.evaluate(async () => ((await sb.rpc('my_orgs')).data || []).filter((o) => o.active !== false).map((o) => o.id));
  log('חסידויות: ' + orgs.join(', '));
  for (const org of orgs) {
    if (Date.now() - t0 > LIMIT_MS) break;
    await openOrg(org);
    const cur = await page.evaluate(() => ORG.id);
    if (cur !== org) { log(`לא הצלחתי לעבור ל-${org} (נמצא ב-${cur}) – מדלג`); continue; }
    await page.waitForFunction(() => window.__worker && window.__worker.done, null, { timeout: Math.max(60000, LIMIT_MS - (Date.now() - t0)), polling: 5000 }).catch(() => log('⏱️ נגמר הזמן באמצע – ימשיך בהרצה הבאה'));
    const w = await page.evaluate(() => window.__worker);
    total += w.processed || 0;
  }
} catch (e) { log('שגיאה: ' + (e.message || e)); }
log(`סיום · תומללו ${total} הקלטות · ${Math.round((Date.now() - t0) / 60000)} דקות`);
await browser.close();
