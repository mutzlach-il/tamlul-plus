# תמלול פלוס – סיכום מלא להמשך עבודה (27.9.2026)

## מי אני ואיך לדבר איתי
- לדבר איתי **רק בעברית**, כולל הודעות ביניים וסיכומים. אני לא מבין אנגלית.
- כשצריך שאעשה משהו (התחברות, אישור, הדבקת מפתח): לתת לי **קישור מדויק**, להגיד בדיוק על מה ללחוץ, **שלב אחד בכל פעם**. אם אפשר, להשתמש בכפתורים כתומים בחלון של Claude.
- לעבוד לבד, ולעצור רק כשצריך שאתחבר לחשבון, שאדבר למיקרופון, או לפני מחיקה של משהו.
- מפתחות API וסיסמאות: **אני** מדביק אותם, לא Claude. אסור לשים מפתחות בקוד הציבורי.
- המייל שלי (מנהל המערכת): ay0533115854@gmail.com
- מייל החברה שממנו יוצאים קודים ומיילים: bnyytmrkwt@gmail.com. שם השולח: "מוצלח".

## מה המערכת
"תמלול פלוס": אתר לתמלול הקלטות בעברית, יידיש ואנגלית. זו מערכת נפרדת מהמערכת "tamlul" הישנה שלי.
- אתר: https://mutzlach-il.github.io/tamlul-plus/ (משתמש GitHub: mutzlach-il, לשעבר 328516885)
- מאגר: https://github.com/mutzlach-il/tamlul-plus
- העלאת קבצים לאתר: https://github.com/mutzlach-il/tamlul-plus/upload/main (גוררים את הקבצים, ואז לוחצים על Commit changes)
- **באוויר כרגע: גרסה 1.6.1**, שבה הנתונים נשמרים רק בדפדפן.
- **מוכנה אבל עוד לא הועלתה: גרסה 2.0.0**, עם ענן. הקבצים שלה אצלי במחשב: `C:\Users\User\Downloads\tamlul-plus-v2\` (index.html, sw.js). הם גם בקובץ ה-ZIP המצורף.

## מבנה גרסה 2.0 (ענן, בחינם)
- **Supabase** (פרויקט tamlul-plus, בארגון mutzlach-il's Org, תוכנית Free):
  - לוח בקרה: https://supabase.com/dashboard/project/afmxylpcwqydjgiewewc
  - כתובת: https://afmxylpcwqydjgiewewc.supabase.co
  - מפתח ציבורי (מותר בקוד): sb_publishable_4S8OmERqXFNnc6zI1twl8A_zJbIrxl9
  - מגבלות חינם: 1GB לקובצי שמע, עד 50MB לקובץ. אחרי 7 ימים בלי שימוש הפרויקט נרדם.
- **מסד נתונים** (כבר הורץ: schema.sql ו-schema2.sql):
  - טבלאות: profiles (role, perms, disabled, minutes_limit), folders (shared_with), recordings (כולל deleted_at, share_token, share_expires), login_log, dictionary, app_settings, usage, auth_codes.
  - הרשאות RLS: רק מנהל משנה משתמשים והגדרות, ורק הוא מוחק לצמיתות.
  - המשתמש הראשון שנרשם הופך אוטומטית למנהל. אחריו **אי אפשר להירשם לבד**, רק דרך הזמנה של מנהל (הדגל app_metadata.invited).
  - פונקציות: is_admin, is_active, touch_me, admin_user_stats, list_people, trash_recordings, restore_recordings.
  - אחסון: bucket בשם `audio`, והקבצים נשמרים בנתיב `<user_id>/<rec_id>.<ext>`.
  - משימה מתוזמנת pg_cron בשם tplus-daily, כל יום ב-06:00 UTC. היא קוראת לשרת עם {"action":"cron"}, מנקה את סל המחזור אחרי 30 יום, ושולחת דו"ח שבועי ביום ראשון.
- **פונקציית שרת "api"** (Edge Function, כבר הועלתה, בלי בדיקת JWT):
  - כתובת: https://afmxylpcwqydjgiewewc.supabase.co/functions/v1/api
  - מחזיקה את המפתחות בסוד. היא מתווכת ל-Groq Whisper, Groq chat ו-Gemini, שולחת מיילים דרך EmailJS, ומטפלת בקודי 4 ספרות (send-code, verify-code, שמחזיר token_hash שעליו רץ verifyOtp magiclink), בצפייה בקישור שיתוף, ב-cron ובפעולות מנהל: admin-invite, admin-update-user, admin-delete-user, admin-purge, admin-test-email, admin-weekly-now, admin-keys-status.
  - הקוד המלא: supabase/api.ts בקובץ ה-ZIP.
- **כניסה**: עם Google, עם קוד 4 ספרות למייל, או עם מייל וסיסמה. "שכחתי סיסמה" עובד עם קוד 4 ספרות.
  - Google Client ID: 178659008979-7qgk5ejgokmi3nrajp2nhm70iopqb489.apps.googleusercontent.com (פרויקט Google Cloud "tamlul-plus", האפליקציה "מוצלח", מפורסמת)
  - ספק Google ב-Supabase כבר מופעל. Site URL מוגדר לכתובת האתר החדשה.
- **EmailJS**: service_tplus (מחובר ל-bnyytmrkwt@gmail.com), template_gzcqacc, מפתח ציבורי 6G0YaH5dH_TKKk_hu.
- **מנועי תמלול**:
  - Groq whisper-large-v3 לעברית ולאנגלית.
  - **Gemini** (gemini-3.5-flash, חינם) ליידיש. אפשר לבחור: יידיש, ישר לעברית, או גם וגם. קבצים ארוכים מחולקים לחלקים של 2 דקות, בגלל מגבלה של 150 שניות לבקשה בשרת.
  - סיכום, תרגום, צ'אט וכותרת אוטומטית: Groq gpt-oss-120b.

## מה נוסף בגרסה 2.0 (הרעיונות שבחרתי: 1,2,5,6,9,10,11,12,13,14,16,17,18,19,20)
- אחסון בענן, נגיש מכל מחשב.
- יציאה אוטומטית אחרי זמן בלי פעילות. המנהל קובע כמה דקות, ברירת המחדל 30.
- יומן כניסות.
- הרשאות לכל משתמש (תמלול, הורדה, מחיקה, תרגום, סיכום, צ'אט, שיתוף) ומכסת דקות לחודש.
- תיקיות משותפות.
- השבתת משתמש.
- הזמנה במייל.
- סל מחזור ל-30 יום (רק מנהל משחזר).
- צ'אט עם ההקלטה.
- מילון מונחים.
- מהירות ניגון וקיצורי מקלדת.
- בחירה מרובה בספרייה.
- כותרת אוטומטית.
- קישור שיתוף עם תוקף (הכתובת ?view=...).
- דו"ח שבועי במייל למנהל.
- מסך "ניהול" שרק מנהל רואה.
- מעבר מהגרסה הקודמת: כפתור "העברה לענן" מעלה את ההקלטות שנשמרו בדפדפן.
- כל התכונות נבדקו אוטומטית מול שרת מדומה, והכול עבר. **מול השרת האמיתי עוד לא נבדק**, כי חסרים המפתחות.

## איפה עצרנו – מה נשאר לעשות, לפי הסדר
1. **אני צריך להדביק 3 מפתחות** ב-Supabase ולשמור:
   - הדף: https://supabase.com/dashboard/project/afmxylpcwqydjgiewewc/functions/secrets
   - שלוש שורות, Name ו-Value, ואחר כך Save:
     - `GROQ_API_KEY`: מפתח מ-https://console.groq.com/keys (לוחצים Create API Key ואז Copy)
     - `GEMINI_API_KEY`: מ-https://aistudio.google.com/apikey
     - `EMAILJS_PRIVATE_KEY`: מ-https://dashboard.emailjs.com/admin/account, בלשונית "API keys" (Private Key). **וגם** בלשונית "Security" לסמן "Allow EmailJS API for non-browser applications" ולשמור.
2. **להוסיף את הכתובת החדשה ל-Google**: ב-Google Cloud, בפרויקט tamlul-plus, תחת Credentials, ב-OAuth client, בשדה Authorized JavaScript origins, להוסיף `https://mutzlach-il.github.io`. בלי זה כפתור Google לא יעבוד באתר החדש. אני צריך לאשר או לעשות את זה.
3. לבדוק שהשרת עובד. במסך "ניהול", בלשונית "מצב ומנועים", יש כפתורי בדיקה לכל שירות.
4. **להעלות את גרסה 2.0**: לגרור את index.html ו-sw.js מ-`Downloads\tamlul-plus-v2` אל https://github.com/mutzlach-il/tamlul-plus/upload/main וללחוץ על Commit.
5. להיכנס ראשון באתר עם **"כניסה עם Google"** עם ay0533115854@gmail.com, כדי שאהיה המנהל.
6. בדיקה חיה של הכול: תמלול עברית, יידיש (כולל הראיון של 19 דקות), הזמנת משתמש, קוד למייל, ייצוא Excel/Word/PDF, התקנה בטלפון.
7. להעביר הקלטות ישנות: במסך "ניהול", בלשונית "גיבוי וייבוא", ללחוץ "העברה לענן" (בדפדפן שבו השתמשתי בגרסה הישנה).
8. לשלוח לי מייל עם הקישור ורשימה של מה נבדק.

## הערות טכניות
- מבנה הקבצים: index.html אחד (HTML, CSS ו-JS), sw.js, manifest.webmanifest ואייקונים. הספרייה supabase-js@2.117.2 נטענת מ-jsdelivr.
- הקוד ב-ZIP: index.html, sw.js, supabase/schema.sql, supabase/schema2.sql, supabase/api.ts.
- אזור Supabase נבחר אוטומטית (Asia-Pacific). זה לא משנה לשימוש.


## עדכון 1.10.2026 – גרסה 2.1.0 (מוכנה, עוד לא באוויר)
נוסף: תמלול סרטונים (הקול מוצא ונדחס ל-MP3 בדפדפן), פרטים לכל קובץ בהעלאה (שם, תיקייה, דובר, סוג, פרשה, שנה, מועד, תאריך), שינוי שם והעברה לתיקייה ישר מהכרטיס, תיקיות משנה + סמל וצבע, תצוגת "כל התיקיות", סינון לפי דובר/סוג/פרשה/שנה/שפה/תגית, לוח עברי חודשי (Hebcal), לוח פרשיות ומועדים, תאריך עברי ופרשה אוטומטיים, נגן קטן קבוע + המשך מאיפה שעצרו + ניגון ברצף + שליטה ממסך הנעילה, סימניות, הערות, סימון משפטים חשובים, עריכת משפט בלחיצה כפולה, חיפוש בתוך התמלול, החלפת מילים/שמות דוברים, גלילה עם השמע, גודל כתב, מצב קריאה, לולאה על משפט, הורדת ההקלטה, כלים חכמים (תוכן עניינים, מראי מקומות, ציטוטים, מאמר ערוך, שאלות חזרה, תגיות), ייצוא מתקדם (Word/PDF/Excel/PowerPoint/TXT/HTML/Markdown/SRT/VTT, עם או בלי זמנים, פסקאות, ZIP, "ספר" אחד עם תוכן עניינים), QR ווואטסאפ לקישור שיתוף, השהיית הקלטה, ביטול בתור, אזהרת כפילות, התראה כשהתמלול נגמר, הודעה לכל המשתמשים, מד אחסון, ייצוא משתמשים ל-Excel, מדריך משתמש + מדריך מנהל (לשונית עזרה), מסך פתיחה, פס "אין חיבור".
**לפני העלאה חובה:** להריץ ב-SQL Editor את supabase/schema3.sql, ולעדכן את פונקציית api (הקובץ supabase/api.ts – שינוי קטן ב-share-view).
