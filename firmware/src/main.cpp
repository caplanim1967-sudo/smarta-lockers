// ════════════════════════════════════════════════════════════════════
//  Smarta Lockers — ESP32 Firmware v1.11
//  Hardware: LilyGo T-SIM7600G-H
//  v1.4: WDT=90s, resetHttpState חכם, WDT resets
//  v1.5: atDiag
//  v1.6: TinyGSM RING/CLIP callbacks
//  v1.7: CFUN restart → גרם ל-3G fallback כשהוגדר אחרי CFUN=1
//  v1.8: ללא CFUN → GPRS נכשל כשהמודם "ישן" (ללא reset radio)
//  v1.9: PWRKEY power cycle → עדיין בעיות timing
//  v1.10: רצף נכון: CFUN=0 → CNMP=38 → CFUN=1 → המתן LTE →
//         אם אין LTE: CFUN=0 → CNMP=2 → CFUN=1 → 3G (עם radio חדש)
//  v1.11: תיקון resetHttpState — secureClient.stop() לפני CIPCLOSE
//         (מנקה write_error של SSLClient, מונע SSL_CLIENT_CONNECT_FAIL)
//         אחרי 2 resets רצופים → GPRS reconnect (IP חדש, TCP stack טרי)
// ════════════════════════════════════════════════════════════════════

#define TINY_GSM_MODEM_SIM7600
#define TINY_GSM_USE_GPRS true
#include <esp_task_wdt.h>
#include <TinyGsmClient.h>
#include <SSLClient.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include "trust_anchors.h"

// ────────────────────────────────────────────────────────────────────
//  ⚙️  הגדרות
// ────────────────────────────────────────────────────────────────────
#define ESP_ID    "MEFA-01"
#define APN       "internet"
#define API_HOST  "smarta-api.smarta-api.workers.dev"

// ────────────────────────────────────────────────────────────────────
//  פינים — LilyGo T-SIM7600G-H
// ────────────────────────────────────────────────────────────────────
#define MODEM_TX      27
#define MODEM_RX      26
#define MODEM_PWRKEY   4
#define RS485_TX      33
#define RS485_RX      34
#define RS485_DE      32

// ────────────────────────────────────────────────────────────────────
//  טיימינג
// ────────────────────────────────────────────────────────────────────
#define SOLENOID_OPEN_MS    1500
#define POLL_INTERVAL_MS   10000
#define RECONNECT_MS       30000
#define RING_CLIP_TIMEOUT   5000

#define WDT_TIMEOUT_S        90   // [v1.4-WDT] 90s — AT+NETOPEN חוסם עד 75s
#define SSL_TIMEOUT_MS     12000  // 12s במקום 30s
#define HTTP_FAIL_RESET        3  // כשלונות לפני resetHttpState

// ════════════════════════════════════════════════════════════════════

HardwareSerial modemSerial(1);
HardwareSerial rs485Serial(2);
TinyGsm        modem(modemSerial);
TinyGsmClient  baseClient(modem);
SSLClient      secureClient(baseClient, TAs, TAs_NUM, 34);

unsigned long lastPollMs      = 0;
unsigned long lastReconnectMs = 0;
unsigned long lastLteCheckMs  = 0;   // [v1.10] בדיקת LTE כל 30 דקות
String        modemLineBuf    = "";
int           s_httpFailCount = 0;
int           s_resetCount   = 0;   // [v1.11] כמה resets רצופים ללא success

bool          ringPending     = false;
bool          clipReceived    = false;
unsigned long ringPendingMs   = 0;
String        pendingCaller   = "";

// ─── [SMARTA PATCH] הגדרת statics של TinyGSM ────────────────────
void (*TinyGsmSim7600::s_urcRingCallback)()           = nullptr;
void (*TinyGsmSim7600::s_urcClipCallback)(const char*) = nullptr;

// ─── Callbacks שמוזנקים מתוך waitResponse של TinyGSM ─────────────
void onRingUrc() {
  // רץ מתוך waitResponse — לא לקרוא ל-httpGet! רק לעדכן state
  if (!ringPending && !clipReceived) ringPendingMs = millis();
  ringPending = true;
  Serial.println("[URC/ISR] RING (בתוך HTTP)");
}

void onClipUrc(const char* clipLine) {
  // clipLine = תוכן השורה אחרי "+CLIP:" כבר trimmed
  // פורמט: "number",type,...  או ,"",128,...  (מספר חסוי)
  if (ringPending) {
    ringPending  = false;
    clipReceived = true;
    String line = clipLine;
    int q1 = line.indexOf('"');
    int q2 = line.indexOf('"', q1 + 1);
    if (q1 >= 0 && q2 > q1) pendingCaller = line.substring(q1 + 1, q2);
    Serial.printf("[URC/ISR] CLIP caller=%s (בתוך HTTP)\n",
                  pendingCaller.isEmpty() ? "unknown" : pendingCaller.c_str());
  }
}

// ────────────────────────────────────────────────────────────────────
//  RS485
// ────────────────────────────────────────────────────────────────────
void sendRS485(uint8_t board, uint8_t channel, uint8_t cmd_byte) {
  uint8_t cmd[5] = { 0x8A, board, channel, cmd_byte, 0 };
  cmd[4] = cmd[0] ^ cmd[1] ^ cmd[2] ^ cmd[3];
  digitalWrite(RS485_DE, HIGH);
  rs485Serial.write(cmd, 5);
  rs485Serial.flush();
  delay(10);
  digitalWrite(RS485_DE, LOW);
}

void openCell(uint8_t board, uint8_t channel) {
  sendRS485(board, channel, 0x11);
  Serial.printf("[RS485] OPEN board=%d ch=%d\n", board, channel);
}

void closeCell(uint8_t board, uint8_t channel) {
  sendRS485(board, channel, 0x00);
  Serial.printf("[RS485] CLOSE board=%d ch=%d\n", board, channel);
}

// ────────────────────────────────────────────────────────────────────
//  [v1.11] resetHttpState — מאפס state HTTP
//  תמיד קודם secureClient.stop() → מנקה write_error של SSLClient
//  אחרי 2 resets רצופים ללא success → GPRS reconnect מלא (IP חדש)
//  GPRS ירד → reconnect מלא תמיד
// ────────────────────────────────────────────────────────────────────
void resetHttpState() {
  Serial.println("[HTTP] מאפס חיבור HTTP...");
  s_resetCount++;

  // [v1.11/v1.12] stop() + clearWriteError() — stop() לבד לא מנקה write_error
  // (Print::write_error נשאר set אחרי stop() ב-SSLClient)
  secureClient.stop();
  secureClient.clearWriteError();   // [v1.12] חובה — בלי זה fail מיידי בניסיון הבא
  delay(300);

  if (modem.isGprsConnected()) {
    if (s_resetCount <= 2) {
      // reset#1–2: CIPCLOSE בלבד — מהיר (socket-level)
      Serial.printf("[HTTP] GPRS תקין — סוגר socket (reset #%d)\n", s_resetCount);
      modem.sendAT("+CIPCLOSE=0,0");
      modem.waitResponse(3000L);
      delay(1000);   // [v1.11] שנייה נוספת — מודם מתייצב אחרי SSL timeout
    } else {
      // reset#3+: GPRS reconnect — IP חדש, TCP stack טרי
      s_resetCount = 0;
      Serial.println("[HTTP] 2 resets נכשלו → GPRS reconnect (IP חדש)");
      esp_task_wdt_reset();
      modem.gprsDisconnect();
      delay(3000);
      esp_task_wdt_reset();
      bool ok = false;
      int att = 0;
      while (!ok) {
        att++;
        Serial.printf("[HTTP] GPRS ניסיון %d\n", att);
        ok = modem.gprsConnect(APN);
        if (!ok) { delay(10000); esp_task_wdt_reset(); }
      }
      delay(5000);
      esp_task_wdt_reset();
    }
  } else {
    // ── GPRS ירד — reconnect מלא עם WDT protection ──
    s_resetCount = 0;
    Serial.println("[HTTP] GPRS ירד — reconnect מלא");
    esp_task_wdt_reset();
    modem.gprsDisconnect();
    delay(3000);
    esp_task_wdt_reset();
    bool ok = false;
    int att = 0;
    while (!ok) {
      att++;
      Serial.printf("[HTTP] GPRS ניסיון %d\n", att);
      ok = modem.gprsConnect(APN);
      if (!ok) { delay(10000); esp_task_wdt_reset(); }
    }
    delay(5000);
    esp_task_wdt_reset();
  }

  s_httpFailCount = 0;
  Serial.println("[HTTP] מוכן לניסיון");
}

// ────────────────────────────────────────────────────────────────────
//  HTTPS
// ────────────────────────────────────────────────────────────────────
String httpPost(const String& path, const String& body) {
  if (s_httpFailCount >= HTTP_FAIL_RESET) resetHttpState();
  secureClient.clearWriteError();    // [v1.12] stop() לא מנקה write_error
  if (baseClient.connected()) { secureClient.stop(); delay(200); }
  HttpClient http(secureClient, API_HOST, 443);
  http.setTimeout(15000);
  int err = http.post(path, "application/json", body);
  if (err != 0) {
    s_httpFailCount++;
    Serial.printf("[HTTP] POST error: %d (fail#%d)\n", err, s_httpFailCount);
    http.stop();
    return "";
  }
  s_httpFailCount = 0;
  s_resetCount    = 0;   // [v1.11] success → אפס מונה resets
  int status = http.responseStatusCode();
  String resp = http.responseBody();
  http.stop();
  Serial.printf("[HTTP] POST %s → %d\n", path.c_str(), status);
  if (status != 200) return "";
  return resp;
}

String httpGet(const String& path) {
  if (s_httpFailCount >= HTTP_FAIL_RESET) resetHttpState();
  secureClient.clearWriteError();    // [v1.12] stop() לא מנקה write_error
  if (baseClient.connected()) { secureClient.stop(); delay(200); }
  HttpClient http(secureClient, API_HOST, 443);
  http.setTimeout(15000);
  int err = http.get(path);
  if (err != 0) {
    s_httpFailCount++;
    Serial.printf("[HTTP] GET error: %d (fail#%d)\n", err, s_httpFailCount);
    http.stop();
    return "";
  }
  s_httpFailCount = 0;
  s_resetCount    = 0;   // [v1.11] success → אפס מונה resets
  int status = http.responseStatusCode();
  String resp = http.responseBody();
  http.stop();
  Serial.printf("[HTTP] GET %s → %d\n", path.c_str(), status);
  if (status != 200) return "";
  return resp;
}

// ────────────────────────────────────────────────────────────────────
//  פתח תאים לפי JSON
// ────────────────────────────────────────────────────────────────────
void processCells(const String& json) {
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, json)) { Serial.println("[JSON] parse error"); return; }
  JsonArray cells = doc["cells"].as<JsonArray>();
  if (cells.size() == 0) {
    Serial.printf("[OPEN] אין תאים: %s\n", doc["reason"] | "unknown");
    return;
  }
  for (int cell : cells) {
    if (cell <= 0) continue;
    Serial.printf("[OPEN] פותח תא %d\n", cell);
    openCell(1, (uint8_t)cell);
    delay(SOLENOID_OPEN_MS);
    closeCell(1, (uint8_t)cell);
  }
}

// ────────────────────────────────────────────────────────────────────
//  שיחה נכנסת
// ────────────────────────────────────────────────────────────────────
void onRingDetected(const String& caller) {
  ringPending   = false;
  clipReceived  = false;
  pendingCaller = "";

  Serial.printf("[RING] caller=%s\n", caller.isEmpty() ? "unknown" : caller.c_str());
  modem.callHangup();
  delay(1000);
  esp_task_wdt_reset();

  if (!modem.isGprsConnected()) {
    Serial.println("[RING] מחבר GPRS...");
    esp_task_wdt_reset();              // [v1.4-WDT2] לפני gprsConnect
    modem.gprsConnect(APN);
    delay(3000);
    esp_task_wdt_reset();
  }

  String resp = "";
  for (int attempt = 1; attempt <= 3 && resp.isEmpty(); attempt++) {
    esp_task_wdt_reset();
    Serial.printf("[RING] ניסיון %d\n", attempt);
    String body = "{\"esp_id\":\"" ESP_ID "\",\"caller\":\"" + caller + "\"}";
    resp = httpPost("/api/locker/open", body);
    if (resp.isEmpty()) delay(2000);
  }
  if (resp.isEmpty()) { Serial.println("[RING] API לא הגיב"); return; }
  Serial.printf("[RING] תגובה: %s\n", resp.c_str());
  processCells(resp);
}

// ────────────────────────────────────────────────────────────────────
//  Polling
// ────────────────────────────────────────────────────────────────────
void pollCourierCommands() {
  String resp = httpGet("/api/esp/commands?esp_id=" ESP_ID);
  if (resp.isEmpty()) return;
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, resp)) return;
  if (doc["no_command"] | false) return;
  int cell = doc["cell_number"] | 0;
  if (cell <= 0) return;
  Serial.printf("[POLL] פקודת שליח — תא %d\n", cell);
  openCell(1, (uint8_t)cell);
  delay(SOLENOID_OPEN_MS);
}

// ────────────────────────────────────────────────────────────────────
//  URC
// ────────────────────────────────────────────────────────────────────
void handleModemInput() {
  while (modemSerial.available()) {
    char c = (char)modemSerial.read();
    if (c == '\r') continue;
    modemLineBuf += c;
    if (c != '\n') continue;
    String line = modemLineBuf;
    modemLineBuf = "";
    line.trim();
    if (line.isEmpty()) continue;
    Serial.printf("[URC] %s\n", line.c_str());
    if (line == "RING") {
      if (!ringPending && !clipReceived) ringPendingMs = millis();
      ringPending = true;
      continue;
    }
    if (ringPending && line.startsWith("+CLIP:")) {
      ringPending  = false;
      clipReceived = true;
      int q1 = line.indexOf('"');
      int q2 = line.indexOf('"', q1 + 1);
      if (q1 >= 0 && q2 > q1) pendingCaller = line.substring(q1 + 1, q2);
      continue;
    }
  }
}

// ────────────────────────────────────────────────────────────────────
//  Reconnect
// ────────────────────────────────────────────────────────────────────
void checkConnection() {
  if (modem.isGprsConnected()) return;
  Serial.println("[NET] מתחבר מחדש...");
  esp_task_wdt_reset();                // [v1.4-WDT2] לפני gprsConnect
  if (!modem.gprsConnect(APN)) { Serial.println("[NET] כישלון — יינסה בסיבוב הבא"); return; }
  Serial.println("[NET] מחובר");
}

// ────────────────────────────────────────────────────────────────────
//  [v1.5-DIAG] שולח AT command ישירות ומדפיס תגובה גולמית ל-Serial
//  (לא דרך TinyGSM — כדי לא לאכול את התגובה)
// ────────────────────────────────────────────────────────────────────
void atDiag(const char* cmd) {
  // שטוף מה שנשאר בחוצץ
  while (modemSerial.available()) modemSerial.read();
  // שלח פקודה
  modemSerial.print("AT");
  modemSerial.print(cmd);
  modemSerial.print("\r\n");
  delay(800);
  // קרא תגובה
  String r = "";
  unsigned long t = millis();
  while (millis() - t < 1500) {
    while (modemSerial.available()) r += (char)modemSerial.read();
  }
  // הסר echo (שורה ראשונה = AT<cmd>)
  int nl = r.indexOf('\n');
  if (nl >= 0) r = r.substring(nl + 1);
  r.replace("\r", " "); r.replace("\n", " "); r.trim();
  Serial.printf("[DIAG] AT%s → %s\n", cmd, r.c_str());
}

// ════════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[BOOT] Smarta Lockers v1.13 — " ESP_ID);

  pinMode(RS485_DE, OUTPUT);
  digitalWrite(RS485_DE, LOW);
  rs485Serial.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);

  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  modemSerial.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(1000);

  // [v1.8] אם המודם לא מגיב — פולס PWRKEY להפעלה חומרתית
  if (!modem.testAT(5000L)) {
    Serial.println("[MODEM] לא מגיב — פולס PWRKEY...");
    digitalWrite(MODEM_PWRKEY, HIGH);
    delay(1000);
    digitalWrite(MODEM_PWRKEY, LOW);
    delay(12000);
    if (!modem.testAT(10000L)) { Serial.println("[MODEM] כישלון — ESP restart"); ESP.restart(); }
  }
  Serial.println("[MODEM] AT OK");

  // [v1.13] חזרה ל-v1.4 style — ללא CFUN/CNMP cycling
  // המודם מתחבר לרשת הטובה ביותר הזמינה (LTE ראשון, אוטומטי)
  Serial.println("[MODEM] מנקה state ישן...");
  modem.gprsDisconnect();
  delay(2000);
  Serial.println("[MODEM] ממתין לרשת...");
  modem.waitForNetwork(120000L);
  Serial.printf("[MODEM] מפעיל: %s\n", modem.getOperator().c_str());

  // GPRS — לולאה עם דיאגנוסטיקה + power cycle אחרי 5 כישלונות
  bool gprsOk = false;
  int gprsAttempt = 0;
  int pwrCycles = 0;
  while (!gprsOk) {
    gprsAttempt++;
    Serial.printf("[MODEM] GPRS ניסיון %d\n", gprsAttempt);
    gprsOk = modem.gprsConnect(APN);
    if (!gprsOk) {
      atDiag("+CGREG?");
      atDiag("+COPS?");
      delay(2000);
      // אחרי 5 כישלונות — PWRKEY power cycle + LTE scan מחדש
      if (gprsAttempt >= 5) {
        gprsAttempt = 0;
        pwrCycles++;
        Serial.printf("[MODEM] Power cycle #%d — PWRKEY 3.5s off...\n", pwrCycles);
        digitalWrite(MODEM_PWRKEY, HIGH);
        delay(3500);
        digitalWrite(MODEM_PWRKEY, LOW);
        delay(6000);
        Serial.println("[MODEM] PWRKEY 1s on...");
        digitalWrite(MODEM_PWRKEY, HIGH);
        delay(1000);
        digitalWrite(MODEM_PWRKEY, LOW);
        delay(40000);             // 40s cold start
        bool atOk = modem.testAT(15000L);
        if (!atOk) { delay(20000); atOk = modem.testAT(10000L); }
        if (!atOk) { Serial.println("[MODEM] כישלון — ESP restart"); ESP.restart(); }
        Serial.println("[MODEM] AT OK אחרי power cycle");
        // [v1.13] ממתין לרשת — ללא CFUN/CNMP forcing
        Serial.println("[MODEM] ממתין לרשת אחרי power cycle...");
        modem.waitForNetwork(120000L);
        modem.gprsDisconnect(); delay(2000);
      }
    }
  }

  Serial.println("[MODEM] GPRS מחובר — מייצב 5 שניות...");
  delay(5000);
  Serial.println("[MODEM] מחובר");

  // SSL timeout
  secureClient.setTimeout(SSL_TIMEOUT_MS);
  Serial.printf("[SSL] timeout = %dms\n", SSL_TIMEOUT_MS);

  // קול — הגדרות קריטיות לשיחות נכנסות
  modem.sendAT("+CLIP=1");     // הפעל Caller ID
  modem.waitResponse();
  modem.sendAT("+CVHU=0");     // ATH מנתק שיחות קוליות + מאפשר incoming
  modem.waitResponse(3000L);
  modem.sendAT("+GSMBUSY=0");  // [v1.4-VOICE] אל תדחה שיחות בזמן GPRS
  modem.waitResponse(3000L);
  modem.sendAT("+CREG?");      // לוג — CS domain registration (קול)
  modem.waitResponse(3000L);
  modem.sendAT("+CGREG?");     // לוג — PS domain registration (data)
  modem.waitResponse(3000L);
  modem.sendAT("+CSCS=\"GSM\""); // character set
  modem.waitResponse(1000L);

  // [v1.6] חבר callbacks ל-TinyGSM — RING/CLIP יתפסו גם בתוך HTTP
  TinyGsmSim7600::s_urcRingCallback = onRingUrc;
  TinyGsmSim7600::s_urcClipCallback = onClipUrc;
  Serial.println("[VOICE] callbacks מחוברים ל-TinyGSM");

  // [v1.5-DIAG] אבחון קול + רשת — מדפיס לSerial לפני WDT
  Serial.println("[DIAG] ────────────────────────────────");
  atDiag("+CREG?");      // CS registration (קול): stat=1→home, 5→roaming
  atDiag("+CGREG?");     // PS registration (data): stat=1→home
  atDiag("+CNMP?");      // Network mode: 2=auto, 13=GSM, 38=LTE only
  atDiag("+GSMBUSY?");   // 0=allow calls, 1=reject
  atDiag("+CVHU?");      // 0=ATH hangs voice, 1/2=ATH ignored
  atDiag("+COPS?");      // Operator + access tech (7=LTE, 2=WCDMA)
  Serial.println("[DIAG] ────────────────────────────────");

  // [v1.10] HTTP warm-up — מוודא internet לפני WDT
  // WDT לא פעיל עדיין, אפשר לנסות הרבה פעמים
  // אם SSL נכשל: backoff ארוך (30s), ואחרי 5 כישלונות — GPRS reconnect לIP חדש
  Serial.println("[WARMUP] בדיקת internet...");
  {
    String warmResp = "";
    int warmFails = 0;
    for (int i = 1; i <= 30 && warmResp.isEmpty(); i++) {
      Serial.printf("[WARMUP] ניסיון %d/30\n", i);
      s_httpFailCount = 0;   // reset כדי לא לגרום ל-resetHttpState מוקדם מדי
      warmResp = httpGet("/api/esp/commands?esp_id=" ESP_ID);
      if (warmResp.isEmpty()) {
        warmFails++;
        // backoff: 10s, 20s, 30s (לתת ל-IP rate limit להתאפס)
        int waitMs = (warmFails <= 2) ? 10000 : (warmFails <= 5) ? 20000 : 30000;
        Serial.printf("[WARMUP] נכשל — ממתין %ds\n", waitMs/1000);
        delay(waitMs);
        // אחרי 5 כישלונות — GPRS reconnect לקבלת IP חדש
        if (warmFails == 5) {
          Serial.println("[WARMUP] GPRS reconnect לIP חדש...");
          modem.gprsDisconnect();
          delay(3000);
          if (!modem.gprsConnect(APN)) {
            Serial.println("[WARMUP] GPRS reconnect נכשל — ממשיך");
          }
          delay(5000);
          s_httpFailCount = 0;
        }
      }
    }
    if (!warmResp.isEmpty()) {
      Serial.println("[WARMUP] internet OK!");
    } else {
      Serial.println("[WARMUP] אזהרה: internet לא אושר — ממשיך בכל זאת");
    }
  }

  // [v1.4-WDT] 90s — מכסה AT+NETOPEN שחוסם עד 75s
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  Serial.println("[BOOT] מוכן.\n");
}

// ════════════════════════════════════════════════════════════════════
//  LOOP
// ════════════════════════════════════════════════════════════════════
void loop() {
  esp_task_wdt_reset();
  handleModemInput();

  if (clipReceived) {
    String caller = pendingCaller;
    pendingCaller = "";
    clipReceived  = false;
    onRingDetected(caller);
  } else if (ringPending && (millis() - ringPendingMs > RING_CLIP_TIMEOUT)) {
    Serial.println("[RING] timeout — טיפול ללא +CLIP");
    onRingDetected("");
  }

  unsigned long now = millis();
  if (now - lastPollMs >= POLL_INTERVAL_MS)    { lastPollMs = now;      pollCourierCommands(); }
  if (now - lastReconnectMs >= RECONNECT_MS)   { lastReconnectMs = now; checkConnection();     }

  // [v1.13] הוסר LTE check — ללא CFUN/CNMP cycling בלופ
}
