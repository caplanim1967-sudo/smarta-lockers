// ════════════════════════════════════════════════════════════════════
//  Smarta Lockers — ESP32 Firmware v1.2
//  Hardware: LilyGo T-SIM7600G-H
//  HTTPS דרך TinyGsmClientSecure + ArduinoHttpClient
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
//  ⚙️  הגדרות — ערוך לפני כל צריבה
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
#define RS485_TX      17
#define RS485_RX      16
#define RS485_DE      32

// ────────────────────────────────────────────────────────────────────
//  טיימינג
// ────────────────────────────────────────────────────────────────────
#define SOLENOID_OPEN_MS   1500
#define POLL_INTERVAL_MS   10000   // 10 שניות
#define RECONNECT_MS      30000

// ════════════════════════════════════════════════════════════════════

HardwareSerial modemSerial(1);
HardwareSerial rs485Serial(2);
TinyGsm        modem(modemSerial);
TinyGsmClient  baseClient(modem);
SSLClient      secureClient(baseClient, TAs, TAs_NUM, 34);

unsigned long lastPollMs      = 0;
unsigned long lastReconnectMs = 0;
String        modemLineBuf    = "";
bool          ringPending     = false;
String        pendingCaller   = "";

// ────────────────────────────────────────────────────────────────────
//  RS485 — פתיחת תא
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
//  HTTPS — TinyGsmClientSecure + ArduinoHttpClient
// ────────────────────────────────────────────────────────────────────
String httpPost(const String& path, const String& body) {
  HttpClient http(secureClient, API_HOST, 443);
  http.setTimeout(15000);
  int err = http.post(path, "application/json", body);
  if (err != 0) { Serial.printf("[HTTP] POST error: %d\n", err); http.stop(); return ""; }
  int status = http.responseStatusCode();
  String resp = http.responseBody();
  http.stop();
  Serial.printf("[HTTP] POST %s → %d\n", path.c_str(), status);
  if (status != 200) return "";
  return resp;
}

String httpGet(const String& path) {
  HttpClient http(secureClient, API_HOST, 443);
  http.setTimeout(15000);
  int err = http.get(path);
  if (err != 0) { Serial.printf("[HTTP] GET error: %d\n", err); http.stop(); return ""; }
  int status = http.responseStatusCode();
  String resp = http.responseBody();
  http.stop();
  Serial.printf("[HTTP] GET %s → %d\n", path.c_str(), status);
  if (status != 200) return "";
  return resp;
}

// ────────────────────────────────────────────────────────────────────
//  פתח תאים לפי JSON מה-API
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
//  טיפול בשיחה נכנסת מדייר
// ────────────────────────────────────────────────────────────────────
void onRingDetected(const String& caller) {
  Serial.printf("[RING] %s\n", caller.c_str());
  modem.callHangup();
  delay(3000);

  if (!modem.isGprsConnected()) {
    Serial.println("[RING] מחבר GPRS...");
    modem.gprsConnect(APN);
    delay(3000);
  }

  String resp = "";
  for (int attempt = 1; attempt <= 3 && resp.isEmpty(); attempt++) {
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
//  Polling — פקודות שליח
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
//  קריאת URC מהמודם
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
    if (line == "RING") { ringPending = true; return; }
    if (ringPending && line.startsWith("+CLIP:")) {
      ringPending = false;
      int q1 = line.indexOf('"');
      int q2 = line.indexOf('"', q1 + 1);
      if (q1 >= 0 && q2 > q1) pendingCaller = line.substring(q1 + 1, q2);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
//  Reconnect
// ────────────────────────────────────────────────────────────────────
void checkConnection() {
  if (modem.isGprsConnected()) return;
  Serial.println("[NET] מתחבר מחדש...");
  if (!modem.gprsConnect(APN)) { Serial.println("[NET] כישלון — מאתחל"); ESP.restart(); }
  Serial.println("[NET] מחובר");
}

// ════════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[BOOT] Smarta Lockers v1.2 — " ESP_ID);

  pinMode(RS485_DE, OUTPUT);
  digitalWrite(RS485_DE, LOW);
  rs485Serial.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);

  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  modemSerial.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(1000);

  if (!modem.testAT(3000L)) {
    Serial.println("[MODEM] מפעיל...");
    digitalWrite(MODEM_PWRKEY, HIGH);
    delay(1000);
    digitalWrite(MODEM_PWRKEY, LOW);
    delay(10000);
    if (!modem.testAT(10000L)) { Serial.println("[MODEM] לא מגיב"); ESP.restart(); }
  }
  Serial.println("[MODEM] AT OK");

  Serial.println("[MODEM] ממתין לרשת...");
  delay(30000);
  Serial.printf("[MODEM] %s\n", modem.getOperator().c_str());

  bool gprsOk = false;
  for (int i = 1; i <= 5 && !gprsOk; i++) {
    Serial.printf("[MODEM] GPRS ניסיון %d/5\n", i);
    gprsOk = modem.gprsConnect(APN);
    if (!gprsOk) delay(10000);
  }
  if (!gprsOk) { Serial.println("[MODEM] GPRS נכשל לחלוטין"); ESP.restart(); }
  Serial.println("[MODEM] מחובר");

  modem.sendAT("+CLIP=1");
  modem.waitResponse();

  esp_task_wdt_init(60, true);
  esp_task_wdt_add(NULL);

  Serial.println("[BOOT] מוכן.\n");
}

// ════════════════════════════════════════════════════════════════════
//  LOOP
// ════════════════════════════════════════════════════════════════════
void loop() {
  esp_task_wdt_reset();
  handleModemInput();

  if (!pendingCaller.isEmpty()) {
    String caller = pendingCaller;
    pendingCaller = "";
    onRingDetected(caller);
  }

  unsigned long now = millis();
  if (now - lastPollMs >= POLL_INTERVAL_MS) { lastPollMs = now; pollCourierCommands(); }
  if (now - lastReconnectMs >= RECONNECT_MS) { lastReconnectMs = now; checkConnection(); }
}
