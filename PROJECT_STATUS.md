# Smarta Lockers — מצב פרויקט

עדכון אחרון: 2026-04-24

---

## ארכיטקטורה

```
login.html
    ↓ (sessionStorage: token, role, user)
smarta-all-v2.html  ← shell עם iframe לכל דף
    ├── admin.html      (מנהל Smarta)
    ├── manager.html    (מנהל ישוב)
    ├── app.html        (אחראי דואר)
    ├── courier.html    (שליח)
    └── finance.html    (חשבונות)
```

**API:** `https://smarta-api.smarta-api.workers.dev`
**סטטוס API:** רוב נקודות הקצה מחזירות 404 / ריק — המערכת עובדת בעיקר מ-localStorage.

**Deploy:** `python scripts/deploy.py [page] "message"` → re-encode → OneDrive → GitHub Pages

---

## localStorage — מפתחות פעילים

| מפתח | תוכן | נכתב ב | נקרא ב |
|------|------|---------|---------|
| `smarta_settlements` | רשימת ישובים | admin.html | admin.html, login.html |
| `smarta_users` | רשימת מנהלי ישובים + passwordHash | admin.html | login.html |
| `smarta_locker_config` | תצורת לוקר ברירת מחדל | admin.html | admin.html |
| `smarta_locker_config_<id>` | תצורת לוקר לפי ישוב | admin.html | admin.html |

---

## Roles ו-Flow

| תפקיד | כניסה | דף ראשי |
|--------|-------|---------|
| `smarta_admin` | API בלבד | admin.html |
| `community_manager` | API → fallback localStorage | manager.html |
| `mail_manager` | API | app.html |
| `courier` | API | courier.html |
| `finance` | API | finance.html |

**זרימת כניסה:**
1. `login.html` → POST `/api/auth/login`
2. אם נכשל → בדיקה מול `smarta_users` ב-localStorage (SHA-256 hash)
3. sessionStorage ← token + role + user
4. redirect → `smarta-all-v2.html#[tab]`

---

## מצב פיצ'רים לפי דף

### admin.html ✅ פעיל

| פיצ'ר | סטטוס | הערות |
|--------|-------|-------|
| רשימת ישובים | ✅ עובד | נשמר ב-localStorage |
| הוספת ישוב (wizard) | ✅ עובד | 3 שלבים |
| עריכת ישוב | ✅ עובד | |
| מחיקת ישוב | ✅ עובד | |
| עמודת לוקרים בטבלה | ✅ עובד | מציגה תאים, קישור עם סינון |
| עמודת מנהל בטבלה | ✅ עובד | שואבת מ-allUsers |
| רשימת לוקרים | ✅ עובד | מ-localStorage |
| בניית לוקר | ✅ עובד | preview יחסי, וולידציה מידות |
| סינון לוקרים לפי ישוב | ✅ עובד | |
| מנהלי ישובים (users) | ✅ עובד | localStorage |
| הוספת מנהל ישוב | ✅ עובד | hash סיסמה, וולידציה |
| עריכת מנהל ישוב | ✅ עובד | איפוס סיסמה אופציונלי |
| תפוגת סיסמה | ✅ עובד | 180 יום, warning 14 יום |
| SMS תזכורת סיסמה | ⚠️ UI בלבד | צריך Twilio/SMS gateway |
| מוניטורינג | ⚠️ חלקי | תלוי API |
| תשלומים | ⚠️ UI בלבד | מחירים hardcoded |
| תחזוקה / כרטיסים | ❌ stub | לא מומש |

### login.html ✅ פעיל

| פיצ'ר | סטטוס | הערות |
|--------|-------|-------|
| כניסה API | ✅ עובד | smarta_admin בלבד בפועל |
| כניסה מקומית | ✅ עובד | community_manager מ-localStorage |
| הצגת סיסמה (עין) | ✅ עובד | |
| שכחתי סיסמה | ⚠️ UI בלבד | צריך SMS gateway |

### manager.html ⚠️ חלקי

| פיצ'ר | סטטוס | הערות |
|--------|-------|-------|
| דשבורד | ✅ עובד | תלוי API |
| דיירים (CRUD) | ✅ עובד | תלוי API |
| חבילות | ✅ עובד | תלוי API |
| תאים / לוקר | ❌ לא עובד | endpoint לא ממומש בAPI |
| בעלי תפקידים | ⚠️ חלקי | תלוי API |
| תזכורות | ❌ UI בלבד | אין שמירה לAPI |

### app.html / courier.html / finance.html
- לא נבדקו/עודכנו בסשן הנוכחי

---

## בעיות פתוחות

### קריטי
- [ ] תאי לוקר ב-manager.html לא עובדים (API endpoint חסר)
- [ ] תזכורות ב-manager.html לא נשמרות

### בינוני
- [ ] SMS gateway לא מחובר (תזכורות סיסמה + שכחתי)
- [ ] כרטיסי תחזוקה לא מומשו
- [ ] smarta_admin — כניסה תלויה ב-API בלבד (אין fallback)

### קוסמטי
- [ ] ESP32 ID — לא מיוצר אוטומטית
- [ ] מחירים בדף תשלומים hardcoded

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
  "passwordHash": "<sha256 or fallback:base64>",
  "passwordChangedAt": 1714000000000
}
```

### Locker Config
```json
{
  "lockerId": "NIR-01",
  "communityId": "NIR-01",
  "communityName": "קיבוץ נירעד",
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

---

## שאלות פתוחות לבעל המוצר

1. **תאי לוקר** — האם manager.html צריך להציג את מצב התאים מה-ESP32, או שזה בעתיד?
2. **SMS** — האם יש ספק SMS שנבחר (Twilio / 019 / אחר)?
3. **smarta_admin fallback** — האם מנהל Smarta צריך גם כניסה offline?
4. **תשלומים** — האם הדף הזה פעיל לשימוש אמיתי עכשיו?
5. **app.html / courier.html** — האם יש שינויים נדרשים שם?
