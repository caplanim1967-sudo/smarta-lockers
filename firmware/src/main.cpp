// ════════════════════════════════════════════════════════════════════
//  Smarta Lockers — ESP32 Firmware v1.36
//  Hardware: LilyGo T-SIM7600G-H
//  v1.4:  WDT=90s, resetHttpState חכם, WDT resets
//  v1.5:  atDiag
//  v1.6:  TinyGSM RING/CLIP callbacks
//  v1.11: תיקון resetHttpState — secureClient.stop() לפני CIPCLOSE
//  v1.14: שעה מ-AT+CCLK? לפני SSL (BearSSL מחייב שעה נכונה)
//  v1.17: POLL_INTERVAL_MS=2s, closeCell() אחרי openCell()
//  v1.18: secureClient.stop() ללא תנאי לפני כל בקשה
//  v1.28: DnsOverrideClient — עוקף DNS של 019+
//  v1.32: SSL persistent connection — SSL handshake פעם אחת
//  v1.33: תיקון SSL half-open — status<=0 = reconnect מיידי
//  v1.34: לוג CSQ קבוע ב-DIAG
//  v1.35: OTA — עדכון פירמוור אוטומטי דרך GPRS
//  v1.36: Cloud logging — boot/door/ota/ssl_reset/gprs_reconnect
// ════════════════════════════════════════════════════════════════════

#define TINY_GSM_MODEM_SIM7600
#define TINY_GSM_USE_GPRS true
#include <esp_task_wdt.h>
#include <sys/time.h>   // [v1.14] settimeofday()
#include <TinyGsmClient.h>
#include <SSLClient.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <Update.h>     // [v1.35] OTA
#include "trust_anchors.h"

// ────────────────────────────────────────────────────────────────────
//  ⚙️  הגדרות
// ────────────────────────────────────────────────────────────────────
#define ESP_ID          "MEFA-01"
#define FIRMWARE_VERSION "1.38"   // [v1.36] נשלח ב-poll, Worker משווה לגרסה ב-D1
#define APN             "internet"
#define API_HOST     "smarta-api.smarta-api.workers.dev"
// [v1.28] Cloudflare anycast IPs — עוקף DNS של 019+ שנכשל
// nslookup מהמחשב: 172.67.161.36 / 104.21.9.176 (שתיהן anycast Cloudflare)
#define API_HOST_IP  "104.21.9.176"
// [v1.29] 019+ חוסמת port 443 outbound — Cloudflare תומכת HTTPS גם על 8443
#define API_PORT     8443

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
#define SOLENOID_OPEN_MS     500
#define POLL_INTERVAL_MS    2000   // [v1.17] 2s במקום 10s — תגובה מהירה לפקודות דשבורד
#define RECONNECT_MS       30000
#define RING_CLIP_TIMEOUT   5000

#define WDT_TIMEOUT_S        90   // [v1.4-WDT] 90s — AT+NETOPEN חוסם עד 75s
#define SSL_TIMEOUT_MS     12000  // 12s במקום 30s
#define HTTP_FAIL_RESET        3  // כשלונות לפני resetHttpState

// ════════════════════════════════════════════════════════════════════

// [v1.28] DNS bypass — TinyGsmClient שמחליף API_HOST ב-API_HOST_IP בתוך connect()
// SSLClient עדיין מקבל API_HOST → SNI נכון + אימות cert נכון
// TinyGSM שולח AT+CIPOPEN ל-IP ישיר → ללא DNS resolution
class DnsOverrideClient : public TinyGsmClient {
public:
  DnsOverrideClient(TinyGsm& m, uint8_t mx = 0) : TinyGsmClient(m, mx) {}
  int connect(const char* host, uint16_t port, int timeout_s) override {
    const char* dest = (strcmp(host, API_HOST) == 0) ? API_HOST_IP : host;
    if (dest != host) Serial.printf("[DNS_BYPASS] %s → %s\n", host, dest);
    return TinyGsmClient::connect(dest, port, timeout_s);
  }
};

HardwareSerial    modemSerial(1);
HardwareSerial    rs485Serial(2);
TinyGsm           modem(modemSerial);
DnsOverrideClient baseClient(modem);
SSLClient         secureClient(baseClient, TAs, TAs_NUM, 34);
// [v1.32] HttpClient גלובלי — שמור חיבור SSL פתוח בין פולינגים
HttpClient        persistentHttp(secureClient, API_HOST, API_PORT);

unsigned long lastPollMs      = 0;
unsigned long lastReconnectMs = 0;
unsigned long lastLteCheckMs  = 0;   // [v1.10] בדיקת LTE כל 30 דקות
String        modemLineBuf    = "";
int           s_httpFailCount = 0;
int           s_resetCount   = 0;   // [v1.11] כמה resets רצופים ללא success

bool          otaFailed       = false;   // [v1.35] מונע retry אחרי כישלון OTA

// [v1.36] Log queue — אירועים משמעותיים נשלחים ל-Worker בסיבוב הבא
struct LogEntry { char level[8]; char event[48]; char detail[96]; };
static LogEntry s_logQueue[6];
static int      s_logCount = 0;

void queueLog(const char* level, const char* event, const char* detail = "") {
  if (s_logCount >= 6) return;
  strlcpy(s_logQueue[s_logCount].level,  level,  sizeof(s_logQueue[0].level));
  strlcpy(s_logQueue[s_logCount].event,  event,  sizeof(s_logQueue[0].event));
  strlcpy(s_logQueue[s_logCount].detail, detail, sizeof(s_logQueue[0].detail));
  s_logCount++;
}

bool          ringPending     = false;
bool          clipReceived    = false;
unsigned long ringPendingMs   = 0;
String        pendingCaller   = "";

// ─── Forward declarations ─────────────────────────────────────────
void handleModemInput();

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
  delayMicroseconds(200);   // [v1.15] המתן לייצוב DE לפני הביט הראשון
  rs485Serial.write(cmd, 5);
  rs485Serial.flush();
  delayMicroseconds(1000);  // [v1.15] החזק DE עד סיום הביט האחרון
  digitalWrite(RS485_DE, LOW);
}

void openCell(uint8_t board, uint8_t channel) {
  sendRS485(board, channel, 0x11);
  Serial.printf("[RS485] OPEN board=%d ch=%d\n", board, channel);
}

void closeCell(uint8_t board, uint8_t channel) {
  sendRS485(board, channel, 0x22);  // [v1.15] 0x22 = CLOSE (0x00 לא סגר בפועל)
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
  queueLog("warn", "ssl_reset", "");
  s_resetCount++;
  esp_task_wdt_reset();   // [v1.15] מונע WDT קריסה בזמן reset (reset#1-2 לא מתים לפה אחרת)

  // [v1.11/v1.12] stop() + clearWriteError() — stop() לבד לא מנקה write_error
  // (Print::write_error נשאר set אחרי stop() ב-SSLClient)
  secureClient.stop();
  secureClient.clearWriteError();   // [v1.12] חובה — בלי זה fail מיידי בניסיון הבא
  delay(300);

  // [v1.15] RING שהגיע בזמן SSL — שני מנגנונים:
  // א) handleModemInput: תופס bytes שנשארו בבאפר UART אחרי SSL נכשל
  // ב) AT+CLCC: בודק אם השיחה עדיין פעילה (חצי צלצול → יש עוד זמן)
  handleModemInput();
  {
    String clcc;
    modem.sendAT("+CLCC");
    if (modem.waitResponse(1000L, clcc) == 1 && clcc.indexOf("+CLCC:") >= 0) {
      if (clcc.indexOf(",4,") >= 0) {   // status=4 = incoming call
        if (!ringPending && !clipReceived) {
          ringPending   = true;
          ringPendingMs = millis();
          Serial.println("[RING] שיחה נכנסת ← AT+CLCC (RING בזמן SSL)!");
        }
      }
    }
  }

  if (modem.isGprsConnected()) {
    if (s_resetCount <= 2) {
      // reset#1–2: CIPCLOSE בלבד — מהיר (socket-level)
      Serial.printf("[HTTP] GPRS תקין — סוגר socket (reset #%d)\n", s_resetCount);
      modem.sendAT("+CIPCLOSE=0,0");
      modem.waitResponse(3000L);
      delay(1000);   // [v1.11] שנייה נוספת — מודם מתייצב אחרי SSL timeout
    } else {
      // reset#3+: NETCLOSE + GPRS reconnect — TCP stack מלא מאופס
      s_resetCount = 0;
      Serial.println("[HTTP] 2 resets נכשלו → NETCLOSE + GPRS reconnect");
      esp_task_wdt_reset();
      modem.sendAT("+CIPCLOSE=0,0");
      modem.waitResponse(2000L);
      modem.sendAT("+NETCLOSE");        // [v1.33] איפוס TCP stack מלא
      modem.waitResponse(5000L);
      delay(2000);
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
      modem.sendAT("+CDNSCFG=\"8.8.8.8\",\"8.8.4.4\"");
      modem.waitResponse(2000L);
      delay(5000);
      esp_task_wdt_reset();
    }
  } else {
    // ── GPRS ירד — NETCLOSE + reconnect מלא ──
    s_resetCount = 0;
    Serial.println("[HTTP] GPRS ירד — NETCLOSE + reconnect מלא");
    esp_task_wdt_reset();
    modem.sendAT("+NETCLOSE");          // [v1.33] איפוס TCP stack מלא
    modem.waitResponse(5000L);
    delay(2000);
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
    modem.sendAT("+CDNSCFG=\"8.8.8.8\",\"8.8.4.4\"");
    modem.waitResponse(2000L);
    delay(5000);
    esp_task_wdt_reset();
  }

  s_httpFailCount = 0;
  Serial.println("[HTTP] מוכן לניסיון");
}

// ────────────────────────────────────────────────────────────────────
//  [v1.32] ensureConnected — SSL persistent connection
//  מתחבר מחדש רק אם החיבור נפל. החיסכון:
//  SSL handshake (~7KB) נעשה פעם אחת — לא בכל פולינג של 2s.
//  SIM7600 שולח +IPCLOSE URC כשהחיבור נפסק → connected() אמין.
// ────────────────────────────────────────────────────────────────────
void ensureConnected() {
  if (secureClient.connected()) return;   // חיבור קיים — ממשיך ישירות
  Serial.println("[SSL] חיבור SSL חדש...");
  secureClient.stop();
  secureClient.clearWriteError();
  delay(100);
  bool ok = (bool)secureClient.connect(API_HOST, API_PORT);
  Serial.printf("[SSL] %s\n", ok ? "מחובר" : "כישלון חיבור");
}

// ────────────────────────────────────────────────────────────────────
//  HTTPS
// ────────────────────────────────────────────────────────────────────
String httpPost(const String& path, const String& body) {
  if (s_httpFailCount >= HTTP_FAIL_RESET) resetHttpState();
  ensureConnected();
  if (!secureClient.connected()) { s_httpFailCount++; return ""; }
  persistentHttp.connectionKeepAlive();
  persistentHttp.setTimeout(15000);
  int err = persistentHttp.post(path, "application/json", body);
  if (err != 0) {
    s_httpFailCount++;
    Serial.printf("[HTTP] POST error: %d (fail#%d)\n", err, s_httpFailCount);
    secureClient.stop();
    secureClient.clearWriteError();
    return "";
  }
  int status = persistentHttp.responseStatusCode();
  if (status <= 0) {  // [v1.33] SSL נפל תוך קריאה — reconnect מיידי
    s_httpFailCount++;
    Serial.printf("[HTTP] POST bad status: %d (fail#%d)\n", status, s_httpFailCount);
    secureClient.stop();
    secureClient.clearWriteError();
    return "";
  }
  s_httpFailCount = 0;
  s_resetCount    = 0;
  String resp = persistentHttp.responseBody();
  Serial.printf("[HTTP] POST %s → %d\n", path.c_str(), status);
  if (status != 200) return "";
  return resp;
}

String httpGet(const String& path) {
  if (s_httpFailCount >= HTTP_FAIL_RESET) resetHttpState();
  ensureConnected();
  if (!secureClient.connected()) { s_httpFailCount++; return ""; }
  persistentHttp.connectionKeepAlive();
  persistentHttp.setTimeout(6000);  // [v1.33] 6s — לא לחסום RING
  int err = persistentHttp.get(path);
  if (err != 0) {
    s_httpFailCount++;
    Serial.printf("[HTTP] GET error: %d (fail#%d)\n", err, s_httpFailCount);
    secureClient.stop();
    secureClient.clearWriteError();
    return "";
  }
  int status = persistentHttp.responseStatusCode();
  if (status <= 0) {  // [v1.33] SSL נפל תוך קריאה — reconnect מיידי
    s_httpFailCount++;
    Serial.printf("[HTTP] GET bad status: %d (fail#%d)\n", status, s_httpFailCount);
    secureClient.stop();
    secureClient.clearWriteError();
    return "";
  }
  s_httpFailCount = 0;
  s_resetCount    = 0;
  String resp = persistentHttp.responseBody();
  Serial.printf("[HTTP] GET %s → %d\n", path.c_str(), status);
  if (status != 200) return "";
  return resp;
}

// ────────────────────────────────────────────────────────────────────
//  פתח תאים לפי JSON
// ────────────────────────────────────────────────────────────────────
void processCells(const String& json) {
  StaticJsonDocument<2048> doc;
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
    delay(50);
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
  delay(300);
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
//  [v1.35] OTA — הורדת פירמוור חדש דרך GPRS ועדכון Flash
//  path   = נתיב ב-Worker (למשל /api/esp/ota/firmware.bin)
//  size   = גודל בbytes (0 = אוטומטי מ-Content-Length)
//  md5str = MD5 לאימות (ריק = ללא אימות)
// ────────────────────────────────────────────────────────────────────
void performOTA(const String& path, int size, const String& md5str) {
  Serial.printf("[OTA] מתחיל: %d bytes מ-%s\n", size, path.c_str());
  esp_task_wdt_delete(NULL);   // OTA אורך זמן — הסר מה-WDT

  // סגור חיבור SSL קיים
  persistentHttp.stop();
  secureClient.stop();
  secureClient.clearWriteError();
  delay(1000);

  // חיבור SSL חדש
  Serial.println("[OTA] מתחבר SSL...");
  if (!secureClient.connect(API_HOST, API_PORT)) {
    Serial.println("[OTA] כישלון SSL — מסמן כישלון ולא מנסה שוב");
    otaFailed = true;
    return;
  }

  // HTTP GET ידני (לא דרך ArduinoHttpClient — צריך stream גולמי)
  secureClient.printf("GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
                      path.c_str(), API_HOST);

  // קרא headers — אסוף Content-Length
  int actualSize = size;
  unsigned long hdrStart = millis();
  while (secureClient.connected() && millis() - hdrStart < 15000) {
    if (!secureClient.available()) { delay(5); continue; }
    String line = secureClient.readStringUntil('\n');
    line.trim();
    if (line.startsWith("Content-Length:")) {
      String lenStr = line.substring(15);
      lenStr.trim();
      actualSize = lenStr.toInt();
    }
    if (line.isEmpty()) break;   // שורה ריקה = סוף headers
  }
  Serial.printf("[OTA] Content-Length=%d\n", actualSize);
  if (actualSize <= 0) {
    Serial.println("[OTA] גודל לא ידוע — מבטל");
    secureClient.stop();
    otaFailed = true;
    return;
  }

  // התחל Update partition
  if (!Update.begin(actualSize)) {
    Serial.printf("[OTA] Update.begin כישלון: %s\n", Update.errorString());
    secureClient.stop();
    otaFailed = true;
    return;
  }
  if (md5str.length() > 0) Update.setMD5(md5str.c_str());

  // הורד וכתוב בחתיכות
  uint8_t buf[512];
  int written = 0;
  unsigned long lastLog = millis();
  unsigned long lastData = millis();

  while (written < actualSize) {
    if (!secureClient.available()) {
      if (!secureClient.connected() || millis() - lastData > 30000) {
        Serial.println("[OTA] timeout או חיבור נסגר");
        break;
      }
      delay(5);
      continue;
    }
    int n = secureClient.read(buf, min((int)sizeof(buf), actualSize - written));
    if (n > 0) {
      if (Update.write(buf, n) != (size_t)n) {
        Serial.printf("[OTA] כתיבה כשלה: %s\n", Update.errorString());
        break;
      }
      written += n;
      lastData = millis();
    }
    if (millis() - lastLog > 10000) {
      lastLog = millis();
      Serial.printf("[OTA] התקדמות: %d / %d bytes (%.0f%%)\n",
                    written, actualSize, 100.0f * written / actualSize);
    }
  }

  secureClient.stop();
  Serial.printf("[OTA] הורד %d / %d bytes\n", written, actualSize);

  if (Update.end(true)) {
    Serial.println("[OTA] הצלחה! מאתחל ל-v חדשה...");
    delay(2000);
    ESP.restart();
  } else {
    Serial.printf("[OTA] שגיאת Flash: %s\n", Update.errorString());
    queueLog("error", "ota_fail", Update.errorString());
    otaFailed = true;
  }
}

// ────────────────────────────────────────────────────────────────────
//  [v1.36] flushLogs — שולח לוג entries ממתינים ל-Worker
// ────────────────────────────────────────────────────────────────────
void flushLogs() {
  if (s_logCount == 0) return;
  for (int i = 0; i < s_logCount; i++) {
    char body[220];
    snprintf(body, sizeof(body),
      "{\"esp_id\":\"" ESP_ID "\",\"level\":\"%s\",\"event\":\"%s\",\"detail\":\"%s\"}",
      s_logQueue[i].level, s_logQueue[i].event, s_logQueue[i].detail);
    persistentHttp.beginRequest();
    persistentHttp.post("/api/esp/log");
    persistentHttp.sendHeader("Content-Type", "application/json");
    persistentHttp.sendHeader("Content-Length", String(strlen(body)));
    persistentHttp.beginBody();
    persistentHttp.print(body);
    persistentHttp.endRequest();
    int sc = persistentHttp.responseStatusCode();
    persistentHttp.skipResponseHeaders();
    persistentHttp.responseBody();
    if (sc != 200) {
      // אל תנסה שוב — פשוט בטל
      Serial.printf("[LOG] שגיאת שליחה %d\n", sc);
      break;
    }
  }
  s_logCount = 0;
}

// ────────────────────────────────────────────────────────────────────
//  Polling
// ────────────────────────────────────────────────────────────────────
void pollCourierCommands() {
  // שלח logs ממתינים לפני הפולינג
  flushLogs();

  // [v1.35] גרסת פירמוור בURL — Worker משווה ומחזיר ota:{} אם יש עדכון
  String resp = httpGet("/api/esp/commands?esp_id=" ESP_ID "&fw=" FIRMWARE_VERSION);
  handleModemInput();   // [v1.15] תפוס RING שהגיע בזמן HTTP
  if (resp.isEmpty()) return;

  StaticJsonDocument<1024> doc;   // [v1.35] הגדל ל-1024 בגלל authorized_callers + ota
  if (deserializeJson(doc, resp)) return;

  // [v1.35] OTA — בדוק אם יש עדכון פירמוור
  if (!otaFailed && doc.containsKey("ota")) {
    const char* otaVer  = doc["ota"]["version"] | "";
    const char* otaPath = doc["ota"]["path"]    | "";
    int         otaSize = doc["ota"]["size"]    | 0;
    const char* otaMd5  = doc["ota"]["md5"]     | "";
    if (strlen(otaVer) > 0 && strcmp(otaVer, FIRMWARE_VERSION) != 0 && strlen(otaPath) > 0) {
      Serial.printf("[OTA] עדכון: v%s → v%s\n", FIRMWARE_VERSION, otaVer);
      queueLog("info", "ota_start", otaVer);
      flushLogs();
      performOTA(String(otaPath), otaSize, String(otaMd5));
      return;
    }
  }

  if (doc["no_command"] | false) return;

  // batch: כל ה-OPEN תחילה, delay אחד, כל ה-CLOSE — פתיחת כל התאים בפול אחד
  if (doc.containsKey("cells")) {
    JsonArray cells = doc["cells"].as<JsonArray>();
    if (cells.size() == 0) return;
    Serial.printf("[POLL] batch פותח %d תאים\n", (int)cells.size());
    for (int cell : cells) {
      if (cell <= 0) continue;
      char detail[24]; snprintf(detail, sizeof(detail), "board=1 ch=%d", cell);
      queueLog("info", "door_open", detail);
      openCell(1, (uint8_t)cell);
      delay(SOLENOID_OPEN_MS);
      closeCell(1, (uint8_t)cell);
      delay(50);
    }
    return;
  }

  // תאימות לאחור — cell_number בודד
  int cell = doc["cell_number"] | 0;
  if (cell <= 0) return;
  Serial.printf("[POLL] פקודת דשבורד — תא %d\n", cell);
  char detail[24]; snprintf(detail, sizeof(detail), "board=1 ch=%d", cell);
  queueLog("info", "door_open", detail);
  openCell(1, (uint8_t)cell);
  delay(SOLENOID_OPEN_MS);
  closeCell(1, (uint8_t)cell);
  delay(100);
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
  queueLog("warn", "gprs_reconnect", "");
  esp_task_wdt_reset();                // [v1.4-WDT2] לפני gprsConnect
  if (!modem.gprsConnect(APN)) { Serial.println("[NET] כישלון — יינסה בסיבוב הבא"); return; }
  modem.sendAT("+CDNSCFG=\"8.8.8.8\",\"8.8.4.4\"");  // [v1.27] Google DNS
  modem.waitResponse(2000L);
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
  Serial.println("\n[BOOT] Smarta Lockers v" FIRMWARE_VERSION " — " ESP_ID);  // v1.36

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

  Serial.println("[MODEM] GPRS מחובר — מייצב 15 שניות...");

  // [v1.27] Google DNS — DNS של 019+ לא מצליח לפתור smarta-api.workers.dev
  modem.sendAT("+CDNSCFG=\"8.8.8.8\",\"8.8.4.4\"");
  modem.waitResponse(3000L);
  Serial.println("[DNS] הוגדר Google DNS 8.8.8.8/8.8.4.4");

  delay(5000);
  // [v1.20] AT+NETOPEN? — מחכה שה-TCP stack יהיה מוכן לפני המשך
  // CIPOPEN error 11 = TCP stack לא מוכן עדיין אחרי NETOPEN
  {
    bool netOk = false;
    for (int t = 0; t < 10 && !netOk; t++) {
      while (modemSerial.available()) modemSerial.read();
      modemSerial.print("AT+NETOPEN?\r\n");
      delay(1500);
      String r = "";
      unsigned long tw = millis();
      while (millis() - tw < 1000) {
        while (modemSerial.available()) r += (char)modemSerial.read();
      }
      Serial.printf("[NETOPEN?] %s\n", r.substring(0, 60).c_str());
      if (r.indexOf("+NETOPEN: 1") >= 0) { netOk = true; break; }
      delay(1000);
    }
    if (!netOk) {
      Serial.println("[NETOPEN] לא מוכן — שולח NETOPEN...");
      modem.sendAT("+NETOPEN");
      modem.waitResponse(10000L);
      delay(3000);
    }
  }
  Serial.println("[MODEM] מחובר");

  // [v1.14] הגדרת שעה ל-BearSSL — setVerificationTime(days, secs)
  // BearSSL סופר ימים מ-שנת 0000 (לא מ-1970, לא מ-2000)
  // נוסחה: br_days = (unix_utc_epoch / 86400) + 719528
  // 719528 = קבוע: ימים מ-0000-01-01 עד 1970-01-01 (גרגוריאני)
  {
    while (modemSerial.available()) modemSerial.read();
    modemSerial.print("AT+CCLK?\r\n");
    delay(1000);
    String clkResp = "";
    unsigned long tw = millis();
    while (millis() - tw < 1500) {
      while (modemSerial.available()) clkResp += (char)modemSerial.read();
    }
    Serial.printf("[TIME] CCLK raw: %s\n", clkResp.substring(0, 60).c_str());
    int q1 = clkResp.indexOf('"');
    int q2 = clkResp.indexOf('"', q1 + 1);
    bool timeSet = false;
    if (q1 >= 0 && q2 > q1) {
      String ts = clkResp.substring(q1 + 1, q2);  // "26/08/14,09:43:43+12"
      int yy = ts.substring(0, 2).toInt() + 2000;
      int mo = ts.substring(3, 5).toInt();
      int dd = ts.substring(6, 8).toInt();
      int hh = ts.substring(9, 11).toInt();
      int mm = ts.substring(12, 14).toInt();
      int ss = ts.substring(15, 17).toInt();
      if (yy > 2020 && mo >= 1 && mo <= 12) {
        // שלב 1: ימים מ-1970-01-01 עד התאריך הנתון (Unix epoch days)
        const int dpm[] = {31,28,31,30,31,30,31,31,30,31,30,31};
        bool isLeap = (yy%4==0) && (yy%100!=0 || yy%400==0);
        long epochDays = 0;
        for (int y = 1970; y < yy; y++) {
          bool lp = (y%4==0) && (y%100!=0 || y%400==0);
          epochDays += lp ? 366 : 365;
        }
        for (int m = 1; m < mo; m++) epochDays += dpm[m-1] + (m==2&&isLeap?1:0);
        epochDays += dd - 1;
        // שלב 2: Unix epoch UTC (CCLK = ישראל קיץ UTC+3 → חסר 10800 שניות)
        long epochUTC = epochDays * 86400L + (long)hh*3600 + (long)mm*60 + ss - 10800L;
        // שלב 3: המרה ל-BearSSL (מ-שנת 0000) → +719528
        uint32_t br_days = (uint32_t)(epochUTC / 86400L) + 719528UL;
        uint32_t br_secs = (uint32_t)(epochUTC % 86400L);
        secureClient.setVerificationTime(br_days, br_secs);
        int utcH = (int)((epochUTC % 86400L) / 3600);
        Serial.printf("[TIME] BearSSL days=%u secs=%u (%d-%02d-%02d %02d:%02d UTC)\n",
                      br_days, br_secs, yy, mo, dd, utcH, mm);
        timeSet = true;
      }
    }
    if (!timeSet) {
      // fallback: 2026-08-14 06:00 UTC → br_days=20679+719528=740207, br_secs=21600
      secureClient.setVerificationTime(740207, 21600);
      Serial.println("[TIME] fallback BearSSL: days=740207 (2026-08-14 06:00 UTC)");
    }
  }

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
  // [v1.15] CNMP=2 (auto) — מאפשר קבלת שיחות ב-3G
  // CNMP=38 (LTE only) גורם ל-busy מיידי כי 019+ לא תומכת CSFB
  modem.sendAT("+CNMP=2");
  modem.waitResponse(3000L);
  Serial.println("[VOICE] CNMP=2 (auto) — שיחות קוליות ב-3G");
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
  atDiag("+CSQ");        // Signal: rssi 0-31 (99=unknown), ber
  Serial.println("[DIAG] ────────────────────────────────");

  // [v1.30] IP לוג בלבד — הוסרו כל בדיקות TCP/DNS (גרמו לחסימת AT interface)
  {
    while (modemSerial.available()) modemSerial.read();
    modemSerial.print("AT+CGPADDR=1\r\n");
    delay(2000);
    String ipR = "";
    unsigned long tw = millis();
    while (millis() - tw < 1500) { while (modemSerial.available()) ipR += (char)modemSerial.read(); }
    Serial.printf("[IP] %s\n", ipR.substring(0, 80).c_str());
  }

  // [v1.30] בדיקת TCP port 80 ישיר (ללא SSL) — מוכיח ש-TCP עובד בכלל
  {
    TinyGsmClient rawClient(modem, 1);   // channel 1 — לא channel 0 של secureClient
    Serial.println("[TCP_TEST] מנסה TCP port 80 ל-1.1.1.1...");
    bool ok = rawClient.connect("1.1.1.1", 80);
    Serial.printf("[TCP_TEST] תוצאה: %s\n", ok ? "הצליח!" : "נכשל");
    if (ok) {
      rawClient.print("GET / HTTP/1.0\r\nHost: 1.1.1.1\r\n\r\n");
      delay(3000);
      String resp = "";
      while (rawClient.available()) resp += (char)rawClient.read();
      Serial.printf("[TCP_TEST] תגובה: %s\n", resp.substring(0, 80).c_str());
      rawClient.stop();
    }
  }

  // [v1.10] HTTP warm-up — מוודא internet לפני WDT
  // WDT לא פעיל עדיין, אפשר לנסות הרבה פעמים
  Serial.println("[WARMUP] בדיקת internet...");
  {
    String warmResp = "";
    int warmFails = 0;
    for (int i = 1; i <= 30 && warmResp.isEmpty(); i++) {
      Serial.printf("[WARMUP] ניסיון %d/30\n", i);
      s_httpFailCount = 0;   // reset כדי לא לגרור resetHttpState מ-httpGet עצמו
      warmResp = httpGet("/api/esp/commands?esp_id=" ESP_ID);
      if (warmResp.isEmpty()) {
        warmFails++;
        // [v1.18] כל 3 כשלונות — resetHttpState לניקוי TCP stack (סוקטים תקועים)
        if (warmFails % 3 == 0) {
          Serial.printf("[WARMUP] %d כשלונות — resetHttpState לניקוי TCP\n", warmFails);
          s_httpFailCount = HTTP_FAIL_RESET;   // כופה resetHttpState (כולל CIPCLOSE + GPRS reconnect)
          resetHttpState();
          s_httpFailCount = 0;
        }
        // backoff קצר — resetHttpState כבר עשה GPRS reconnect, אין צורך בהמתנה ארוכה
        int waitMs = (warmFails <= 3) ? 5000 : 10000;
        Serial.printf("[WARMUP] נכשל — ממתין %ds\n", waitMs/1000);
        delay(waitMs);
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
  queueLog("info", "boot", FIRMWARE_VERSION);
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
