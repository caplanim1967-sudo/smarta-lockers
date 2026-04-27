# CLAUDE.md — Smarta Lockers
> קובץ זה נקרא אוטומטית בכל פתיחת שיחה. מעדכן אותו בסוף כל שיחה.
> עדכון אחרון: 2026-04-27

---

## הכלל הראשון

**תמיד קרא קובץ זה לפני כל עבודה. תמיד עדכן אותו בסוף כל שיחה.**

כשהמשתמש אומר: "להתראות" / "ביי" / "מחר ממשיכים" / "סיימנו" — עדכן את הקובץ הזה.

## כללי תקשורת (חשוב!)

- **מילה באנגלית בתוך משפט עברי** — תמיד ירידת שורה לפניה ואחריה.
- אסור לערבב עברית ואנגלית באותה שורה.
- קוד, שמות משתנים, endpoints — בבלוק קוד נפרד, לא בתוך המשפט.
- **לא לחכות לשאלה** — לנדב מידע רלוונטי שהמשתמש צריך לדעת.

---

## מהו הפרויקט

**Smarta Lockers** — פלטפורמת ניהול לוקרים חכמים לישובים כפריים (קיבוצים, מושבים).

### הבעיה שנפתרת
חבילות מדואר ישראל ושליחים מגיעות לישוב → נכנסות ללוקר → דייר מקבל הודעה → פותח ותולש.

### לקוחות (B2B)
- הישוב משלם לסמרטה (לא הדייר)
- 8 ישובים פעילים כרגע (מערכת ישנה, לא מחוברת לפלטפורמה הנוכחית)
- הפלטפורמה הנוכחית מיועדת להרחבה ל-100+ ישובים
- מנהל ישוב מנהל את ההגדרות

### מודל עסקי
- **בייסיק:** עלות הקמה בלבד (חומרה + התקנה)
- **פרמיום:** 500 ₪ לתא (הקמה) + 250 ₪/חודש (ריטיינר תמיכה)
- הארון = רכוש הישוב (לא ליסינג) → אין lock-in חוזי
- הקשר = שירות חודשי → חשוב לתת ערך שוטף

### פרופיל בעל המוצר
- **סולו אופרייטור** — ללא עובדים, הכל אדם אחד
- זה **לא** מקור הפרנסה העיקרי — כל ישוב נוסף הוא בונוס
- יעד: ~100 ישובים, צמיחה צנועה ומבוקרת
- עיקרון: **Never go on site** — תקלה בשטח = חודשיים אבודים
- כשיצטרך: outsource נקודתי, לא גיוס עובדים

---

## שני מסלולים

| | בייסיק | פרמיום |
|---|---|---|
| סוג מנעול | מכאני (קוד 4 ספרות) | אלקטרוני (ESP32) |
| פתיחה | קוד SMS לכל חבילה | שיחת טלפון + אימות |
| מנהל | מפתח מאסטר | שליטה דיגיטלית |

### מתודיקת קוד בייסיק (חשוב!)
```
randPart = מספר אקראי 10-99 (2 ספרות)
cellPart = מספר התא ממולא ל-2 ספרות (תא 3 → "03")
lockCode = randPart + cellPart   →   4 ספרות סה"כ
```
**דוגמה:** תא 5, אקראי 47 → קוד **4705**

**למה זה חכם:** 2 השנתות האחרונות = תא (קבוע). 2 הראשונות משתנות בכל חבילה. אחראי הדואר מסובב רק 2 שנתות.

אחרי שהדייר לוקח → אחראי הדואר מאפס עם המפתח המאסטר.

---

## משתמשים בפלטפורמה

| תפקיד | מה הוא עושה |
|---|---|
| **smarta_admin** | מנהל סמרטה: מגדיר ישובים, לוקרים, מנהלי ישובים |
| **community_manager** | מנהל ישוב: מנהל דיירים, הגדרות ישוב, הסכמי שילוח |
| **mail_manager** (אחראי דואר) | מקצה חבילות לתאים, שולח הודעות לדיירים |
| **courier** | שליח: פותח תאים פנויים תחת מגבלות מנהל הישוב |
| **finance** | חשבונות |

### זרימת שליח
מנהל ישוב סוגר הסכם עם חברת שילוח → לחברה יש ממשק להוסיף שליחים → שליח פותח רק תאים **פנויים** בתוך המגבלות שמנהל הישוב קבע.

### SMS / WhatsApp
ספק: **Twilio** (מאושר). עדיין לא מחובר — כרגע UI בלבד.
**ערוץ:** SMS או WhatsApp — לפי בחירת הדייר, מוגדר ע"י מנהל הישוב.

### זרימת SMS אישור איסוף (רעיון חדש — טרם מומש)
```
חבילה נכנסת → SMS לדייר: "חבילה בתא 5, קוד: 4705"
דייר לוקח חבילה → שולח SMS חזרה: "1"
Twilio webhook → API → תא מסומן ריק אוטומטית
אם לא מגיב תוך X ימים → תזכורת (מוגדר לפי ישוב)
```
**יתרון:** אין צורך בחיישן דלת (maintenance overhead), אישור אנושי > חיישן מכני.
**הגדרות תזכורות:** מוגדרות לפי ישוב, עם ברירת מחדל מ-Smarta.
**החלטה על מיזוג לחדר:** אחראי הדואר מחליט (לא אוטומטי).

### מתחרים
- **DONE** (done.co.il) — מתחרה עיקרי
- חולשת DONE: לא תומך בדואר ישראל, דורש אפליקציה צרכנית
- יתרון סמרטה: תמיכה בדואר ישראל, ללא אפליקציה לדייר, B2B טהור

---

## ארכיטקטורה טכנית

```
login.html
    ↓ sessionStorage: token, role, user
smarta-all-v2.html  ← bundle עם iframe לכל דף (base64)
    ├── admin.html      (מנהל Smarta)
    ├── manager.html    (מנהל ישוב)
    ├── app.html        (אחראי דואר)
    ├── courier.html    (שליח)
    └── finance.html    (חשבונות)
```

**API:** `https://smarta-api.smarta-api.workers.dev` (Cloudflare Workers)
**סטטוס API:** ✅ פעיל — D1 + JWT. כל endpoints עובדים.
**D1:** `smarta-db` (1e9ab32c-c6fb-4001-aaca-a2c21913dc36)

**GitHub Pages:** `caplanim1967-sudo.github.io/smarta-lockers/smarta-all-v2.html`
**GitHub:** `github.com/caplanim1967-sudo/smarta-lockers`

### Deploy
```
python C:/Users/bitah/smarta-lockers/scripts/deploy.py admin "תיאור"
```
→ re-encode base64 → OneDrive → GitHub Pages

### קבצי עבודה
```
C:/Users/bitah/smarta-lockers/
├── decoded/          ← קבצי HTML לעריכה (admin.html, app.html וכו')
├── bundle/           ← smarta-all-v2.html (הבאנדל המלא)
├── scripts/          ← deploy.py, reencode-admin.py וכו'
├── worker/           ← Cloudflare Worker (backend)
│   ├── wrangler.toml
│   ├── schema.sql
│   └── src/index.js  ← כל ה-API (480 שורות)
└── CLAUDE.md         ← הקובץ הזה
```

### Worker deploy
```
cd C:/Users/bitah/smarta-lockers/worker
wrangler deploy
```

### D1 schema ריסט (זהירות!)
```
wrangler d1 execute smarta-db --remote --file=schema.sql
```

---

## חומרה — פרמיום (ESP32)

### רכיבים מאושרים
| רכיב | פרטים |
|------|--------|
| בקר | ESP32 (WiFi מובנה + SIM backup) |
| מנעול | סולנואיד NC 12V — נפתח כשמקבל מתח, נסגר ללא חשמל (fail-secure) |
| לוח ממסרים | I2C relay board (AliExpress) — בקר אחד לכל עמודות הארון |
| גיבוי חשמל | LiFePO4 — חיוני! בלי חשמל = לא ניתן לפתוח |
| ניטור דלת | **ללא** חיישן reed — החלטה מכוונת (maintenance overhead) |

### פתיחת תא פרמיום
```
דייר מתקשר למספר הטלפון של הלוקר (SIM בבקר ESP32)
ESP32 מזהה RING + Caller ID (ללא מענה — זול יותר, לא צריך SIM קולי)
ESP32 שולח בקשה ל-API: "caller=05XXXXXXX, locker=NIR-01"
API מאמת: האם לדייר הזה יש חבילה בלוקר הזה?
API מחזיר: cell_number=5
ESP32 מפעיל ממסר תא 5 → סולנואיד נפתח
```

### גודל ארונות
- מינימום: **14 תאים**
- מקסימום: **52 תאים**
- כל תא = דלת נפרדת
- יש ישובים עם **חדר משותף** (תא מיוחד לחבילות גדולות)

### עיקרון Never Go On Site
- OTA firmware updates לESP32
- Heartbeat מהלוקר ל-API (ניטור)
- התראה אוטומטית אם לוקר offline
- כל תקלה נפתרת מרחוק — שדה = הפסד כספי

---

## חדר משותף (Shared Room)

תא מיוחד שיכולים להירשם אליו **מספר דיירים**.
- שימוש: חבילות גדולות שלא נכנסות לתא רגיל
- אחראי הדואר מחליט מתי למזג חבילות לחדר
- כל הדיירים המורשים מקבלים SMS עם קוד/גישה

```json
{
  "cellType": "shared_room",
  "authorizedResidents": ["phone1", "phone2", "phone3"],
  "maxPackages": 10
}
```

---

## localStorage — מפתחות פעילים

| מפתח | תוכן |
|------|------|
| `smarta_settlements` | רשימת ישובים |
| `smarta_users` | מנהלי ישובים + passwordHash |
| `smarta_locker_config` | תצורת לוקר ברירת מחדל |
| `smarta_locker_config_<id>` | תצורת לוקר לפי ישוב |
| `smarta_pkg_v2` | נתוני חבילות (packageData) |
| `smarta_history_NIR01` | היסטוריית חבילות |

---

## sessionStorage — מפתחות

| מפתח | תוכן |
|------|------|
| `smarta_token` | JWT |
| `smarta_role` | תפקיד |
| `smarta_user` | אובייקט משתמש |
| `smarta_tabs` | טאבים זמינים |
| `[role]_token` | טוקן לפי תפקיד |
| `[role]_user` | משתמש לפי תפקיד |

---

## מה נבנה — לפי דף

### admin.html ✅ פעיל
- ישובים CRUD (הוסף/ערוך/מחק)
- wizard הוספת ישוב (3 שלבים)
- טבלת ישובים עם עמודת לוקרים (כמות תאים + קישור לסינון)
- טבלת ישובים עם עמודת מנהל (שואבת מ-allUsers)
- בניית לוקר (preview יחסי, ולידציה מידות)
- **מנהלי ישובים** (שם הטאב — לא "בעלי תפקידים"):
  - CRUD מנהלי ישובים
  - סיסמה חזקה: SHA-256, אייקון עין, מד חוזק
  - תפוגת סיסמה 180 יום, אזהרה 14 יום, badges
  - כפתור עריכה עם מודל עריכה + איפוס סיסמה אופציונלי
  - ולידציה נייד: `05` + 10 ספרות
  - אין שדה תפקיד (תמיד community_manager)

### login.html ✅ פעיל
- כניסה API (smarta_admin)
- כניסה מקומית fallback (community_manager מ-localStorage)
  - hashPassword SHA-256 + fallback btoa
  - משווה hash עם smarta_users
- אייקון עין (הצג/הסתר סיסמה)
- שכחתי סיסמה (UI בלבד — צריך SMS)

### app.html (אחראי דואר) ✅ פעיל
- לוח בקרה: גריד לוקר ממלא מסך, יחסי לפי config
- **מצבי תא:** ריק🟢 / בטעינה🟣 / תפוס🔴 / מאחר🔴⬛ / תקלה⚫
- חבילה חדשה: חיפוש דייר, תא, שליח, ברקוד
- סריקת ברקוד: מצלמה (Quagga) + USB + הקלדה ידנית
- שיוך ברקודים: דייר + תא + שליח לכולם
- שליחת הודעות לכולם (loading → occupied)
- דיווח תקלה + ניהול תקלות ✅ (רק אחראית דואר — מנהל ישוב וsmarta_admin אינם יכולים)
- היסטוריה: מקובצת לפי groupId, מיון + חיפוש
- שמירת כל הנתונים ב-localStorage + sync עם D1
- **קוד מנעול מכאני** נוצר אוטומטית בעת שיוך
- כפתור "🧹 פנה תפוסים" — מרוקן כל תאים תפוסים בלחיצה

### manager.html ⚠️ חלקי
- דשבורד ✅ — כולל stat-free / stat-occ מ-/api/cells, fmtDate תוקן
- דיירים CRUD ✅ מול API (כולל ייבוא אקסל)
- חבילות ✅ מול API (ממתינות + היסטוריה)
- תאים / לוקר ✅ קריאה בלבד — מנהל ישוב רואה סטטוס, לא יכול לדווח/לנקות תקלה
- בעלי תפקידים ✅ CRUD מול API
- תזכורות — UI בלבד (לא נשמר ל-API)

### כללי shell (smarta-all-v2.html) ✅
- postMessage refresh: חזרה לטאב שנטען → שולח `smarta-refresh` → הדף מרענן נתונים בלבד, ללא reload iframe
- activateCommunity: smarta_admin מתחזה לישוב — כל 4 טאבים מקבלים token חדש
- community banner: מציג ישוב פעיל + כפתור "חזור לניהול Smarta"

### courier.html / finance.html
- לא נבדקו/עודכנו בסשנים האחרונים

---

## משתמשי בדיקה

| שם משתמש | סיסמה | תפקיד | הערה |
|---|---|---|---|
| smarta_admin | Smarta2026! | smarta_admin | API — D1 |
| mgr_nir | Manager123! | community_manager | NIR-01 — קיבוץ נירעד |
| nir_doa | NirDoa2026! | mail_manager | NIR-01 — אחראי דואר |

**חשוב:** שנה סיסמת smarta_admin ו-mgr_nir אחרי הפרסום לייצור!

### שינוי סיסמה לsmarta_admin
```
wrangler d1 execute smarta-db --remote --command="UPDATE users SET password_hash='<SHA256 HEX>' WHERE username='smarta_admin';"
```

### דיירי demo ב-NIR-01 (D1)
- משה קפלן — 0521111111 (WhatsApp)
- משה קפלן — 0521234561 (WhatsApp) ← כפול, מחק אחד
- שרה לוי — 0549876543 (SMS)
- דוד כהן — 0505556666 (WhatsApp)
- נועה אברהם — 0581112222 (WhatsApp)
- רינה גולן — 0533334444 (SMS)

---

## בעיות פתוחות

### קריטי
- [ ] תזכורות ב-manager.html לא נשמרות (צריך endpoint + D1 + UI מחובר)
- [x] ~~תאי לוקר ב-manager.html לא עובדים~~ — תוקן: /api/cells עובד, תצוגה קריאה בלבד
- [x] ~~saveLocker לא שמר ל-D1~~ — תוקן: תמיד POST עם INSERT OR REPLACE
- [x] ~~לוקר לא מוצג ב-app.html~~ — תוקן: builderConfigToLayout ממיר פורמט admin לפורמט app

### בינוני
- [ ] SMS/WhatsApp לא מחובר (Twilio — עדיין UI בלבד) ← פאזה 2
- [ ] כרטיסי תחזוקה לא מומשו
- [ ] smarta_admin — password_changed_at לא נשמר בD1 (אין עמודה, צריך ALTER TABLE)
- [ ] ב-admin.html: password reminder SMS — עדיין mock ("Twilio pending")

### קוסמטי
- [ ] ESP32 ID לא מיוצר אוטומטית
- [ ] מחירים בדף תשלומים hardcoded

---

## שאלות פתוחות לבעל המוצר

1. **אחראי דואר** — עוד לא העמקנו יחד (נדחה בכוונה)
2. **תאי לוקר ב-manager** — האם מציג סטטוס מ-ESP32 בעתיד?
3. **smarta_admin fallback** — האם צריך כניסה offline?
4. **תשלומים** — האם הדף פעיל לשימוש אמיתי?
5. **courier / finance** — האם יש שינויים נדרשים?

---

## היסטוריה של הפרויקט

### Claude Chat (לפני אפריל 2026)
- בנה את הגרסה הראשונה של smarta-all-v2.html (באנדל מיניפייד 5MB)
- app.html (אחראי דואר) — עובד מלא
- manager.html — JS פגום, צריך בנייה מחדש
- finance.html — עובד
- admin.html, courier.html — לא נבדקו

### אפריל 17 (Claude Code, session 89a887ea)
- הוסבר הפרויקט, הועבר מ-Claude Chat
- הקובץ הועלה מ-Downloads לפרויקט
- התחלת בניית manager.html מחדש
- נוצרה תשתית decode/encode לעבודה על הקבצים

### אפריל 20-24 (Claude Code, session 12df241b)
- ישובים CRUD — localStorage persistence
- לוקרים: badge תאים, סינון, קישור
- עמודת מנהל בטבלת ישובים
- allUsers persistence
- סיסמה חזקה (SHA-256, עין, מד חוזק, תפוגה)
- שינוי שם: "בעלי תפקידים" → "מנהלי ישובים"
- הסרת mail_manager מ-admin
- כפתור עריכה + מודל עריכה מנהל ישוב
- login fallback מקומי לcommunity_manager
- ולידציה נייד + מניעת העתקה בסיסמה2
- PROJECT_STATUS.md נוצר
- CLAUDE.md נוצר (הקובץ הזה)
- גילוי עסקי: שני מסלולים, מתודיקת קוד, זרימת שליח

### אפריל 27 — session (Claude Code)

**app.html:**
- Toast clearTimeout — toast 3 שניות מדויק (לא קוטע toast קודם)
- JWT decode ב-client (`_jwtPayload`, `_isSuperAdmin`) — smarta_admin מקבל הודעה ידידותית במקום forbidden
- `loadPackagesFromAPI` — מביא גם /api/cells במקביל, שומר תאים עם תקלה
- `clearFault` — קורא ל-/api/cells/clear-fault (לא רק local state)
- כפתור "🧹 פנה תפוסים" בדשבורד — מרוקן כל תאים תפוסים בלחיצה אחת (לא תקלות)
- postMessage listener: חזרה לטאב → refresh אוטומטי

**admin.html:**
- ניטור: קריאה בלבד — הוסרו כפתורי "נקה הכל" ו"הסר" (רק אחראית דואר מנקה תקלות)
- יישור עמודת תאריך בניטור: direction:ltr על גם th וגם td
- `manageSettlement` → קורא ל-`activateCommunity` בshell
- postMessage listener: חזרה לטאב → refresh אוטומטי

**manager.html:**
- תאים: קריאה בלבד — הוסרו כפתורי דיווח תקלה וניקוי (רק אחראית דואר)
- `fmtDate` תוקן: מטפל ב-Unix timestamp (מספר שלם) מ-D1
- דשבורד: שואב גם /api/cells → מציג stat-free + stat-occ
- טיפול שגיאות: tbody מציג "שגיאת טעינה" במקום "טוען..." לנצח
- `loadResidentsFromAPI` → `loadResidents` (תיקון bug)
- postMessage listener: חזרה לטאב → refresh הסקשן הנוכחי בלבד

**shell (smarta-all-v2.html):**
- postMessage refresh: `showTab` שולח `{type:'smarta-refresh'}` כשחוזרים לטאב שנטען
- `activateCommunity`: מגדיר טוקנים לכל 4 טאבים + מציג community banner
- `clearCommunityContext`: משחזר טוקנים מקוריים + מחזיר לטאב admin

### אפריל 25 — session המשך (Claude Code)
- גילוי עמוק: ארכיטקטורה, חומרה, עסק
- חומרה מאושרת: ESP32 + NC solenoid 12V + I2C relay + LiFePO4
- Ring detection (לא מענה מלא) — Caller ID בלי SIM קולי
- רעיון SMS אישור איסוף (Twilio webhook → תא ריק אוטומטי)
- חדר משותף: מודל נתונים + זרימה
- מתחרה: DONE — נחסם בדואר ישראל
- מודל עסקי מאושר: 500₪/תא + 250₪/חודש
- פרופיל: סולו, צנוע, Never Go On Site
- CLAUDE.md עודכן עם כל הגילויים
- תכנית בנייה פאזית נכתבה

**פאזה 1 הושלמה — Backend D1 חי!**
- Cloudflare Workers + D1 — פרוס ועובד
- schema.sql — 7 טבלאות (settlements, users, residents, locker_configs, packages, cells, shared_room_residents)
- JWT עם Hebrew תקין (TextEncoder/TextDecoder, לא escape/unescape)
- כל endpoints — auth, admin, community — פעילים ובדוקים
- security בדוק: setup חסום, unauthorized, forbidden, bad password
- קבצים ב: C:/Users/bitah/smarta-lockers/worker/

---

## סכמת נתונים

### Settlement
```json
{
  "id": "NIR-01",
  "name": "קיבוץ נירעד",
  "region": "דרום",
  "plan": "basic|premium",
  "status": "active|suspended",
  "manager": "שם מנהל",
  "contact": "...",
  "phone": "..."
}
```

### User (community_manager)
```json
{
  "id": "local_<timestamp>",
  "first_name": "...",
  "last_name": "...",
  "role": "community_manager",
  "community_id": "NIR-01",
  "username": "...",
  "phone": "05XXXXXXXX",
  "passwordHash": "<sha256 hex>",
  "passwordChangedAt": 1714000000000
}
```

### Locker Config
```json
{
  "lockerId": "NIR-01",
  "communityId": "NIR-01",
  "maxWidth": 120,
  "maxHeight": 200,
  "legHeight": 20,
  "cols": 3,
  "tier": "basic|premium",
  "esp_id": null,
  "columns": [
    { "width": 40, "depth": 30, "cells": 5, "cellHeights": [36,36,36,36,36] }
  ]
}
```

### Package Data (per cell)
```json
{
  "status": "empty|loading|occupied|late|faulty",
  "resident": "שם דייר",
  "courier": "דואר ישראל",
  "time": "היום 14:32",
  "days": "0",
  "code": "4705",
  "packages": [
    { "barcode": "...", "resident": "...", "phone": "...", "courier": "...", "time": "..." }
  ]
}
```

### Resident (global — phone = unique ID)
```json
{
  "phone": "0521234567",
  "first_name": "משה",
  "last_name": "קפלן",
  "community_id": "NIR-01",
  "notify_method": "sms|whatsapp",
  "active": true
}
```

---

## תכנית בנייה פאזית

### עיקרון מנחה
**כל פאזה עומדת בפני עצמה ומספקת ערך.** לא מתחילים פאזה הבאה לפני שהקודמת יציבה.
פשטות > שלמות. אמינות > פיצ'רים.

---

### פאזה 1 — Backend יציב (Cloudflare Workers + D1)
**מה:** מחליף localStorage בבסיס נתונים אמיתי, נגיש מכל מכשיר.
**למה עכשיו:** localStorage = נתונים תקועים בדפדפן אחד. זה אבל מבני.

```
טבלאות D1:
  settlements    → כל ישובי הלקוחות
  users          → כל המשתמשים (כל התפקידים)
  locker_configs → תצורת ארון לפי ישוב
  packages       → חבילות פעילות
  history        → חבילות שנאספו
  shared_rooms   → authorized_residents
```

Workers endpoints (להחליף את ה-404 הקיימים):
- `GET/POST /settlements`
- `GET/POST /users`
- `GET/PUT/DELETE /packages/:id`
- `GET /locker/:communityId`
- `POST /auth/login`

**קריטריון סיום:** login.html + admin.html + app.html עובדים מול D1, לא localStorage.

---

### פאזה 2 — Twilio SMS חי
**מה:** SMS אמיתי לדיירים + webhook לאישור איסוף.
**תלות:** פאזה 1 (צריך packages ב-D1 לעדכן סטטוס).

```
זרימה:
  app.html שולח → Worker → Twilio API → SMS לדייר
  דייר מגיב "1" → Twilio webhook → Worker → packages[status] = "empty"
  
Worker endpoint חדש:
  POST /twilio/incoming  ← webhook מ-Twilio
```

תזכורות: cron job ב-Cloudflare Workers (חינמי):
```javascript
// כל שעה: סרוק חבילות שלא נאספו > X ימים → שלח תזכורת
```

**קריטריון סיום:** דייר מקבל SMS אמיתי ואישור איסוף מסמן תא ריק.

---

### פאזה 3 — ניטור לוקרים (Heartbeat)
**מה:** כל ESP32 שולח heartbeat כל 5 דקות. אם שתק — התראה.
**למה:** Never Go On Site → חייבים לדעת לפני הלקוח שיש בעיה.

```
Worker endpoint:
  POST /locker/heartbeat  ← ESP32 שולח { locker_id, timestamp, cells_status }
  
Cron (כל 10 דקות):
  בדוק: האם כל לוקר שלח heartbeat בשעה האחרונה?
  לא → SMS/email לבעל המוצר (caplanim1967@gmail.com)
```

**קריטריון סיום:** אם לוקר מתנתק מרשת — SMS אוטומטי תוך 15 דקות.

---

### פאזה 4 — ESP32 Firmware
**מה:** קוד C++ לבקר — ring detection, Caller ID lookup, solenoid control, OTA.
**תלות:** פאזה 1 (צריך API פעיל לאמת שיחות).

```cpp
// זרימה עיקרית
onRING(callerID) → 
  POST /locker/open { caller: "0521234567", locker_id: "NIR-01" } →
  response: { cell: 5 } →
  activateRelay(5, 3000ms)  // פתוח 3 שניות
  
// OTA
checkFirmwareUpdate() → every 24h → pull from Cloudflare R2
```

**קריטריון סיום:** שיחה לנייד הלוקר → תא נפתח → נסגר אחרי 3 שניות.

---

### פאזה 5 — manager.html שלם
**מה:** ממשק מנהל ישוב עובד במלואו מול D1.
**תלות:** פאזה 1.

פיצ'רים חסרים:
- דיירים CRUD (מול API)
- תאים / לוקר (סטטוס חי)
- הגדרות תזכורות
- הסכמי שילוח

---

### סדר עדיפויות בתוך כל פאזה
1. אמינות > פיצ'רים
2. Simple > Clever
3. לוג שגיאות > שתיקה
4. בדוק בשדה (ישוב אמיתי) > בדיקות דמו בלבד
