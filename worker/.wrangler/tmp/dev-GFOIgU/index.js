var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
__name(json, "json");
function ok(data) {
  return json(data);
}
__name(ok, "ok");
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
__name(err, "err");
function unauthorized() {
  return err("Unauthorized", 401);
}
__name(unauthorized, "unauthorized");
function forbidden() {
  return err("Forbidden", 403);
}
__name(forbidden, "forbidden");
function notFound() {
  return err("Not found", 404);
}
__name(notFound, "notFound");
function b64urlFromStr(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(b64urlFromStr, "b64urlFromStr");
function b64urlFromBuf(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(b64urlFromBuf, "b64urlFromBuf");
function b64urlToStr(str) {
  const binary = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
__name(b64urlToStr, "b64urlToStr");
function b64urlToBytes(str) {
  const binary = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
__name(b64urlToBytes, "b64urlToBytes");
async function jwtSign(payload, secret) {
  const header = b64urlFromStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlFromStr(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64urlFromBuf(sig)}`;
}
__name(jwtSign, "jwtSign");
async function jwtVerify(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(data));
  if (!valid) return null;
  const payload = JSON.parse(b64urlToStr(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1e3)) return null;
  return payload;
}
__name(jwtVerify, "jwtVerify");
async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256hex, "sha256hex");
function newId() {
  return crypto.randomUUID();
}
__name(newId, "newId");
function nowSec() {
  return Math.floor(Date.now() / 1e3);
}
__name(nowSec, "nowSec");
async function sendMessage(to, body, channel) {
  console.log(`[MSG:${(channel || "sms").toUpperCase()}] \u2192 ${to} | ${body.substring(0, 80)}`);
  return true;
}
__name(sendMessage, "sendMessage");
async function getUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return jwtVerify(auth.slice(7), env.JWT_SECRET);
}
__name(getUser, "getUser");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (path === "/api/health" && method === "GET") {
        return ok({ status: "ok", ts: nowSec() });
      }
      if (path === "/api/auth/login" && method === "POST") {
        return handleLogin(request, env);
      }
      if (path === "/api/auth/forgot-password" && method === "POST") {
        return ok({ message: "\u05D0\u05DD \u05D4\u05DE\u05E9\u05EA\u05DE\u05E9 \u05E7\u05D9\u05D9\u05DD \u2014 \u05EA\u05D9\u05E9\u05DC\u05D7 \u05D4\u05D5\u05D3\u05E2\u05EA SMS" });
      }
      if (path === "/api/setup" && method === "POST") {
        return handleSetup(request, env);
      }
      const user = await getUser(request, env);
      if (!user) return unauthorized();
      if (path.startsWith("/api/admin/")) {
        if (user.role !== "smarta_admin") return forbidden();
        return handleAdmin(path, method, request, env, user, url);
      }
      return handleCommunity(path, method, request, env, user, url);
    } catch (e) {
      console.error("Unhandled error:", e.message, e.stack);
      return err("\u05E9\u05D2\u05D9\u05D0\u05EA \u05E9\u05E8\u05EA: " + e.message, 500);
    }
  }
};
async function handleSetup(request, env) {
  const existing = await env.smarta_db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'smarta_admin'").first().catch(() => ({ c: 1 }));
  if (existing.c > 0) {
    return err("Setup already completed", 403);
  }
  const b = await request.json().catch(() => ({}));
  if (!b.password || b.password.length < 8) {
    return err("password \u05D7\u05D9\u05D9\u05D1 \u05DC\u05D4\u05D9\u05D5\u05EA \u05DC\u05E4\u05D7\u05D5\u05EA 8 \u05EA\u05D5\u05D5\u05D9\u05DD");
  }
  const hash = await sha256hex(b.password);
  await env.smarta_db.prepare(`
    INSERT INTO users (id, first_name, last_name, role, username, password_hash, password_changed_at, active, created_at)
    VALUES ('smarta_admin_001', 'Smarta', 'Admin', 'smarta_admin', 'smarta_admin', ?, ?, 1, ?)
  `).bind(hash, nowSec(), nowSec()).run();
  return ok({ message: "smarta_admin \u05E0\u05D5\u05E6\u05E8 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4", username: "smarta_admin" });
}
__name(handleSetup, "handleSetup");
async function handleLogin(request, env) {
  const b = await request.json().catch(() => ({}));
  const { username, password } = b;
  if (!username || !password) return err("\u05D7\u05E1\u05E8\u05D9\u05DD \u05E9\u05D3\u05D5\u05EA");
  const user = await env.smarta_db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").bind(username).first();
  if (!user) return json({ error: "\u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9 \u05D0\u05D5 \u05E1\u05D9\u05E1\u05DE\u05D4 \u05E9\u05D2\u05D5\u05D9\u05D9\u05DD" }, 401);
  const hash = await sha256hex(password);
  if (hash !== user.password_hash) return json({ error: "\u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9 \u05D0\u05D5 \u05E1\u05D9\u05E1\u05DE\u05D4 \u05E9\u05D2\u05D5\u05D9\u05D9\u05DD" }, 401);
  let communityName = "";
  let features = {};
  if (user.community_id) {
    const s = await env.smarta_db.prepare("SELECT name, features_json FROM settlements WHERE id = ?").bind(user.community_id).first();
    communityName = s?.name || "";
    try {
      features = JSON.parse(s?.features_json || "{}");
    } catch (e) {
      features = {};
    }
  }
  const payload = {
    sub: user.id,
    role: user.role,
    community_id: user.community_id || null,
    name: `${user.first_name} ${user.last_name}`,
    community_name: communityName,
    features,
    exp: nowSec() + 60 * 60 * 24 * 30
    // 30 days
  };
  const token = await jwtSign(payload, env.JWT_SECRET);
  return json({
    token,
    role: user.role,
    name: payload.name,
    community_name: communityName,
    community_id: user.community_id || null
  });
}
__name(handleLogin, "handleLogin");
async function handleAdmin(path, method, request, env, user, url) {
  const db = env.smarta_db;
  if (path === "/api/admin/settlements") {
    if (method === "GET") {
      const { results } = await db.prepare(
        "SELECT * FROM settlements ORDER BY created_at DESC"
      ).all();
      return ok(results);
    }
    if (method === "POST") {
      const b = await request.json();
      if (!b.name) return err("name \u05E9\u05D3\u05D4 \u05D7\u05D5\u05D1\u05D4");
      const id = b.id || newId();
      await db.prepare(`
        INSERT INTO settlements (id, name, region, plan, status, contact, phone, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        b.name,
        b.region || "",
        b.plan || "basic",
        b.status || "active",
        b.contact || "",
        b.phone || "",
        nowSec()
      ).run();
      return ok({ id });
    }
  }
  const featuresMatch = path.match(/^\/api\/admin\/settlements\/([^/]+)\/features$/);
  if (featuresMatch && method === "PATCH") {
    const id = featuresMatch[1];
    const b = await request.json();
    if (!b.features || typeof b.features !== "object") return err("features \u05D7\u05D5\u05D1\u05D4");
    await db.prepare("UPDATE settlements SET features_json = ? WHERE id = ?").bind(JSON.stringify(b.features), id).run();
    return ok({ id });
  }
  const settlementMatch = path.match(/^\/api\/admin\/settlements\/([^/]+)$/);
  if (settlementMatch) {
    const id = settlementMatch[1];
    if (method === "PUT" || method === "POST") {
      const b = await request.json();
      await db.prepare(`
        UPDATE settlements
        SET name=?, region=?, plan=?, status=?, contact=?, phone=?
        WHERE id=?
      `).bind(
        b.name,
        b.region || "",
        b.plan || "basic",
        b.status || "active",
        b.contact || "",
        b.phone || "",
        id
      ).run();
      return ok({ id });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM settlements WHERE id = ?").bind(id).run();
      return ok({ deleted: id });
    }
    if (method === "GET") {
      const row = await db.prepare("SELECT * FROM settlements WHERE id = ?").bind(id).first();
      return row ? ok(row) : notFound();
    }
  }
  if (path === "/api/admin/lockers") {
    if (method === "GET") {
      const { results } = await db.prepare(
        "SELECT * FROM locker_configs ORDER BY created_at DESC"
      ).all();
      return ok(results.map((r) => ({ ...r, columns: JSON.parse(r.columns_json || "[]") })));
    }
    if (method === "POST") {
      const b = await request.json();
      if (!b.community_id) return err("community_id \u05D7\u05D5\u05D1\u05D4");
      const id = b.community_id;
      await db.prepare(`
        INSERT OR REPLACE INTO locker_configs
          (id, community_id, max_width, max_height, leg_height, tier, esp_id, columns_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        b.community_id,
        b.maxWidth || 120,
        b.maxHeight || 200,
        b.legHeight || 20,
        b.tier || "basic",
        b.esp_id || null,
        JSON.stringify(b.columns || []),
        nowSec(),
        nowSec()
      ).run();
      return ok({ id });
    }
  }
  const lockerMatch = path.match(/^\/api\/admin\/lockers\/([^/]+)$/);
  if (lockerMatch) {
    const id = lockerMatch[1];
    if (method === "GET") {
      const row = await db.prepare("SELECT * FROM locker_configs WHERE id = ?").bind(id).first();
      if (!row) return notFound();
      return ok({ ...row, columns: JSON.parse(row.columns_json || "[]") });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM locker_configs WHERE id = ?").bind(id).run();
      return ok({ deleted: id });
    }
    if (method === "PUT") {
      const b = await request.json();
      await db.prepare(`
        UPDATE locker_configs
        SET max_width=?, max_height=?, leg_height=?, tier=?, esp_id=?, columns_json=?, updated_at=?
        WHERE id=?
      `).bind(
        b.maxWidth || 120,
        b.maxHeight || 200,
        b.legHeight || 20,
        b.tier || "basic",
        b.esp_id || null,
        JSON.stringify(b.columns || []),
        nowSec(),
        id
      ).run();
      return ok({ id });
    }
  }
  if (path === "/api/admin/users") {
    if (method === "GET") {
      const commId = url.searchParams.get("community_id");
      let stmt;
      if (commId) {
        stmt = db.prepare(
          "SELECT id,first_name,last_name,role,community_id,username,phone,password_changed_at,active,created_at FROM users WHERE community_id = ? ORDER BY created_at DESC"
        ).bind(commId);
      } else {
        stmt = db.prepare(
          "SELECT id,first_name,last_name,role,community_id,username,phone,password_changed_at,active,created_at FROM users ORDER BY created_at DESC"
        );
      }
      const { results } = await stmt.all();
      return ok(results);
    }
    if (method === "POST") {
      const b = await request.json();
      if (!b.username || !b.password) return err("username \u05D5-password \u05D7\u05D5\u05D1\u05D4");
      const id = "local_" + Date.now();
      const hash = await sha256hex(b.password);
      await db.prepare(`
        INSERT INTO users (id, first_name, last_name, role, community_id, username, phone, password_hash, password_changed_at, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).bind(
        id,
        b.first_name || "",
        b.last_name || "",
        b.role || "community_manager",
        b.community_id || null,
        b.username,
        b.phone || null,
        hash,
        nowSec(),
        nowSec()
      ).run();
      return ok({ id });
    }
  }
  const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch) {
    const id = adminUserMatch[1];
    if (method === "POST" || method === "PUT") {
      const b = await request.json();
      if (b.password) {
        const hash = await sha256hex(b.password);
        await db.prepare(`
          UPDATE users
          SET first_name=?, last_name=?, phone=?, community_id=?, username=?, password_hash=?, password_changed_at=?
          WHERE id=?
        `).bind(
          b.first_name || "",
          b.last_name || "",
          b.phone || null,
          b.community_id || null,
          b.username,
          hash,
          nowSec(),
          id
        ).run();
      } else {
        await db.prepare(`
          UPDATE users SET first_name=?, last_name=?, phone=?, community_id=?, username=?
          WHERE id=?
        `).bind(
          b.first_name || "",
          b.last_name || "",
          b.phone || null,
          b.community_id || null,
          b.username,
          id
        ).run();
      }
      return ok({ id });
    }
    if (method === "DELETE") {
      const target = await db.prepare("SELECT role FROM users WHERE id = ?").bind(id).first();
      if (target && target.role === "smarta_admin") {
        return new Response(JSON.stringify({ error: "\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05DE\u05D7\u05D5\u05E7 \u05DE\u05E0\u05D4\u05DC Smarta" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
      return ok({ deleted: id });
    }
    if (method === "GET") {
      const row = await db.prepare(
        "SELECT id,first_name,last_name,role,community_id,username,phone,password_changed_at,active FROM users WHERE id=?"
      ).bind(id).first();
      return row ? ok(row) : notFound();
    }
  }
  const reminderMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/send-password-reminder$/);
  if (reminderMatch && method === "POST") {
    return ok({ sent: true, note: "Twilio integration pending" });
  }
  if (path === "/api/admin/faults" && method === "DELETE") {
    const b = await request.json().catch(() => ({}));
    if (!b.id) return err("id \u05D7\u05D5\u05D1\u05D4");
    await db.prepare("DELETE FROM cells WHERE id = ?").bind(b.id).run();
    return ok({ ok: true });
  }
  if (path === "/api/admin/faults/clear-all" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (b.community_id) {
      await db.prepare(`DELETE FROM cells WHERE community_id = ? AND status != 'empty'`).bind(b.community_id).run();
    } else {
      await db.prepare(`DELETE FROM cells WHERE status != 'empty'`).run();
    }
    return ok({ ok: true });
  }
  if (path === "/api/admin/faults" && method === "GET") {
    const commId = url.searchParams.get("community_id");
    const { results } = commId ? await db.prepare(`
          SELECT c.*, s.name AS community_name
          FROM cells c LEFT JOIN settlements s ON c.community_id = s.id
          WHERE c.community_id = ? AND c.status != 'empty'
          ORDER BY c.created_at DESC
        `).bind(commId).all() : await db.prepare(`
          SELECT c.*, s.name AS community_name
          FROM cells c LEFT JOIN settlements s ON c.community_id = s.id
          WHERE c.status != 'empty'
          ORDER BY c.created_at DESC
        `).all();
    return ok(results);
  }
  if (path === "/api/admin/onboarding" && method === "POST") {
    return handleOnboarding(request, env, db);
  }
  if (path === "/api/admin/impersonate" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const communityId = b.community_id;
    if (!communityId) return err("community_id \u05D7\u05D5\u05D1\u05D4");
    const sett = await db.prepare("SELECT id, name FROM settlements WHERE id = ?").bind(communityId).first();
    if (!sett) return notFound();
    const payload = {
      sub: user.sub,
      role: "community_manager",
      // routes to manager iframe
      community_id: communityId,
      community_name: sett.name,
      name: user.name + " (\u05DE\u05E0\u05D4\u05DC \u05E1\u05DE\u05E8\u05D8\u05D4)",
      impersonated_by: "smarta_admin",
      exp: nowSec() + 60 * 60 * 4
      // 4 hours
    };
    const token = await jwtSign(payload, env.JWT_SECRET);
    return ok({ token, community_id: communityId, community_name: sett.name });
  }
  return notFound();
}
__name(handleAdmin, "handleAdmin");
async function handleOnboarding(request, env, db) {
  const b = await request.json().catch(() => ({}));
  const comm = b.community || b;
  const settId = comm.id || b.id || newId();
  const plan = comm.plan || b.plan || "basic";
  await db.prepare(`
    INSERT OR REPLACE INTO settlements (id, name, region, plan, status, contact, phone, created_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    settId,
    comm.name || b.name || "\u05D9\u05E9\u05D5\u05D1 \u05D7\u05D3\u05E9",
    comm.region || b.region || "",
    plan,
    comm.contact || b.contact || "",
    comm.phone || b.phone || "",
    nowSec()
  ).run();
  if (b.locker) {
    const lk = b.locker;
    await db.prepare(`
      INSERT OR REPLACE INTO locker_configs
        (id, community_id, max_width, max_height, leg_height, tier, esp_id, columns_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      settId,
      settId,
      lk.maxWidth || 120,
      lk.maxHeight || 200,
      lk.legHeight || 20,
      plan,
      lk.esp_id || null,
      JSON.stringify(lk.columns || []),
      nowSec(),
      nowSec()
    ).run();
  }
  if (b.manager && b.manager.username && b.manager.password) {
    const mgr = b.manager;
    const mgrId = "local_" + Date.now();
    const hash = await sha256hex(mgr.password);
    await db.prepare(`
      INSERT OR REPLACE INTO users
        (id, first_name, last_name, role, community_id, username, phone, password_hash, password_changed_at, active, created_at)
      VALUES (?, ?, ?, 'community_manager', ?, ?, ?, ?, ?, 1, ?)
    `).bind(
      mgrId,
      mgr.first_name || "",
      mgr.last_name || "",
      settId,
      mgr.username,
      mgr.phone || null,
      hash,
      nowSec(),
      nowSec()
    ).run();
  }
  return ok({ id: settId, settlement_id: settId });
}
__name(handleOnboarding, "handleOnboarding");
async function handleCommunity(path, method, request, env, user, url) {
  const db = env.smarta_db;
  const communityId = user.community_id;
  if (!communityId) return forbidden();
  if (path === "/api/residents") {
    if (method === "GET") {
      const { results } = communityId ? await db.prepare("SELECT * FROM residents WHERE community_id = ? ORDER BY last_name").bind(communityId).all() : await db.prepare("SELECT * FROM residents ORDER BY last_name").all();
      return ok(results);
    }
    if (method === "POST") {
      const b = await request.json();
      if (!b.phone) return err("phone \u05D7\u05D5\u05D1\u05D4");
      const id = newId();
      await db.prepare(`
        INSERT INTO residents
          (id, first_name, last_name, phone, community_id, notify_method, active, created_at,
           id_number, street, house_number, notes,
           alt_first_name, alt_last_name, alt_id_number, alt_phone, alt_notify_method)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        b.first_name || "",
        b.last_name || "",
        b.phone,
        communityId,
        b.notify_method || "sms",
        nowSec(),
        b.id_number || null,
        b.street || null,
        b.house_number || null,
        b.notes || null,
        b.alt_first_name || null,
        b.alt_last_name || null,
        b.alt_id_number || null,
        b.alt_phone || null,
        b.alt_notify_method || null
      ).run();
      return ok({ id });
    }
  }
  const residentMatch = path.match(/^\/api\/residents\/([^/]+)$/);
  if (residentMatch) {
    const id = residentMatch[1];
    if (method === "PUT") {
      const b = await request.json();
      await db.prepare(`
        UPDATE residents
        SET first_name=?, last_name=?, phone=?, notify_method=?, active=?,
            id_number=?, street=?, house_number=?, notes=?,
            alt_first_name=?, alt_last_name=?, alt_id_number=?, alt_phone=?, alt_notify_method=?
        WHERE id=? AND community_id=?
      `).bind(
        b.first_name || "",
        b.last_name || "",
        b.phone,
        b.notify_method || "sms",
        b.active !== false ? 1 : 0,
        b.id_number || null,
        b.street || null,
        b.house_number || null,
        b.notes || null,
        b.alt_first_name || null,
        b.alt_last_name || null,
        b.alt_id_number || null,
        b.alt_phone || null,
        b.alt_notify_method || null,
        id,
        communityId
      ).run();
      return ok({ id });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM residents WHERE id = ? AND community_id = ?").bind(id, communityId).run();
      return ok({ deleted: id });
    }
    if (method === "GET") {
      const row = communityId ? await db.prepare("SELECT * FROM residents WHERE id=? AND community_id=?").bind(id, communityId).first() : await db.prepare("SELECT * FROM residents WHERE id=?").bind(id).first();
      return row ? ok(row) : notFound();
    }
  }
  if (path === "/api/packages/history") {
    const pkgSelect = `
      SELECT p.*,
        p.assigned_at as placed_at,
        (r.first_name || ' ' || r.last_name) as resident_name,
        r.phone as resident_phone
      FROM packages p LEFT JOIN residents r ON p.resident_id = r.id`;
    const { results } = communityId ? await db.prepare(pkgSelect + ` WHERE p.community_id = ? AND p.status = 'collected' ORDER BY p.collected_at DESC LIMIT 500`).bind(communityId).all() : await db.prepare(pkgSelect + ` WHERE p.status = 'collected' ORDER BY p.collected_at DESC LIMIT 500`).all();
    return ok(results);
  }
  if (path === "/api/packages") {
    if (method === "GET") {
      const status = url.searchParams.get("status") || "waiting";
      const pkgSelect = `
        SELECT p.*,
          p.assigned_at as placed_at,
          (r.first_name || ' ' || r.last_name) as resident_name,
          r.phone as resident_phone
        FROM packages p LEFT JOIN residents r ON p.resident_id = r.id`;
      const { results } = communityId ? await db.prepare(pkgSelect + ` WHERE p.community_id = ? AND p.status = ? ORDER BY p.assigned_at DESC`).bind(communityId, status).all() : await db.prepare(pkgSelect + ` WHERE p.status = ? ORDER BY p.assigned_at DESC`).bind(status).all();
      return ok(results);
    }
    if (method === "POST") {
      const b = await request.json();
      if (!b.cell_id) return err("cell_id \u05D7\u05D5\u05D1\u05D4");
      const id = newId();
      await db.prepare(`
        INSERT INTO packages (id, community_id, resident_id, cell_id, barcode, courier, status, lock_code, notes, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)
      `).bind(
        id,
        communityId,
        b.resident_id || null,
        b.cell_id,
        b.barcode || null,
        b.courier || "\u05D3\u05D5\u05D0\u05E8 \u05D9\u05E9\u05E8\u05D0\u05DC",
        b.lock_code || null,
        b.notes || null,
        nowSec()
      ).run();
      return ok({ id });
    }
  }
  const collectMatch = path.match(/^\/api\/packages\/([^/]+)\/collect$/);
  if (collectMatch && method === "POST") {
    const id = collectMatch[1];
    await db.prepare(`
      UPDATE packages SET status = 'collected', collected_at = ? WHERE id = ?
    `).bind(nowSec(), id).run();
    return ok({ collected: id });
  }
  const collectCellMatch = path.match(/^\/api\/packages\/collect-cell\/([^/]+)$/);
  if (collectCellMatch && method === "POST") {
    const cellId = collectCellMatch[1];
    const ts = nowSec();
    await db.prepare(`
      UPDATE packages SET status = 'collected', collected_at = ?
      WHERE community_id = ? AND cell_id = ? AND status = 'waiting'
    `).bind(ts, communityId, cellId).run();
    return ok({ collected_cell: cellId });
  }
  const deletePackageMatch = path.match(/^\/api\/packages\/([^/]+)$/);
  if (deletePackageMatch && method === "DELETE") {
    const id = deletePackageMatch[1];
    await db.prepare(`DELETE FROM packages WHERE id = ? AND community_id = ?`).bind(id, communityId).run();
    return ok({ deleted: id });
  }
  if (path === "/api/messages/send" && method === "POST") {
    const b = await request.json();
    if (!Array.isArray(b.messages) || !b.messages.length) return err("messages \u05D7\u05D5\u05D1\u05D4");
    const [settingsRow, lockerRow] = await Promise.all([
      db.prepare("SELECT msg_settings_json FROM settlements WHERE id = ?").bind(communityId).first(),
      db.prepare("SELECT tier FROM locker_configs WHERE community_id = ?").bind(communityId).first()
    ]);
    const msgDefaults = {
      msg_arrival: "\u05D4\u05D9\u05D9 {\u05E9\u05DD}! \u{1F4E6} \u05D4\u05D2\u05D9\u05E2\u05D4 \u05DC\u05DA \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DE-{\u05D7\u05D1\u05E8\u05D4}{\u05EA\u05D0}. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
      msg_reminder1: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u{1F44B} \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u2014 \u05D9\u05E9 \u05DC\u05DA \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05D0\u05E0\u05D0 \u05D0\u05E1\u05D5\u05E3 \u05D1\u05D4\u05E7\u05D3\u05DD. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
      msg_reminder2: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u26A0\uFE0F \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05E9\u05E0\u05D9\u05D9\u05D4 \u2014 \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05D0\u05E0\u05D0 \u05D0\u05E1\u05D5\u05E3 \u05D1\u05D4\u05E7\u05D3\u05DD. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
      msg_reminder3: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u{1F6A8} \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05E9\u05DC\u05D9\u05E9\u05D9\u05EA \u2014 \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05D0\u05E0\u05D0 \u05D0\u05E1\u05D5\u05E3 \u05D1\u05D4\u05E7\u05D3\u05DD. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
      msg_reminder4: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u26D4 \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05D0\u05D7\u05E8\u05D5\u05E0\u05D4 \u2014 \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05DC\u05DC\u05D0 \u05D0\u05D9\u05E1\u05D5\u05E3 \u05EA\u05D7\u05D5\u05D9\u05D1 \u05D1\u05E7\u05E0\u05E1. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!"
    };
    const s = { ...msgDefaults, ...JSON.parse(settingsRow?.msg_settings_json || "{}") };
    const isBasic = (lockerRow?.tier || "basic") === "basic";
    let sent = 0, failed = 0;
    for (const msg of b.messages) {
      const cellId = String(msg.cell_id);
      const type = msg.type;
      const pkg = await db.prepare(`
        SELECT p.id, p.cell_id, p.courier, p.assigned_at,
               r.first_name, r.phone, r.notify_method
        FROM packages p LEFT JOIN residents r ON p.resident_id = r.id
        WHERE p.community_id = ? AND p.cell_id = ?
          AND p.status NOT IN ('collected','confirmed')
        ORDER BY p.assigned_at DESC LIMIT 1
      `).bind(communityId, cellId).first();
      if (!pkg?.phone) {
        failed++;
        continue;
      }
      const templateKey = type === "arrival" ? "msg_arrival" : `msg_${type}`;
      const template = s[templateKey] || "";
      const cellSuffix = isBasic ? ` \u05D1\u05EA\u05D0 ${cellId}` : "";
      const days = Math.floor((Date.now() / 1e3 - (pkg.assigned_at || 0)) / 86400);
      const text = template.replace(/\{שם\}/g, pkg.first_name || "").replace(/\{חברה\}/g, pkg.courier || "").replace(/\{תא\}/g, cellSuffix).replace(/\{ימים\}/g, String(days)).replace(/ {2,}/g, " ").trim();
      const ok2 = await sendMessage(pkg.phone, text, pkg.notify_method || "sms");
      if (ok2) sent++;
      else failed++;
    }
    return ok({ sent, failed });
  }
  if (path === "/api/users") {
    if (method === "GET") {
      const { results } = communityId ? await db.prepare(
        "SELECT id,first_name,last_name,role,username,phone,email,active FROM users WHERE community_id = ? ORDER BY created_at DESC"
      ).bind(communityId).all() : await db.prepare(
        "SELECT id,first_name,last_name,role,username,phone,email,active FROM users ORDER BY created_at DESC"
      ).all();
      return ok(results);
    }
    if (method === "POST") {
      const b = await request.json();
      if (!b.username || !b.password) return err("username \u05D5-password \u05D7\u05D5\u05D1\u05D4");
      const id = "local_" + Date.now();
      const hash = await sha256hex(b.password);
      await db.prepare(`
        INSERT INTO users (id, first_name, last_name, role, community_id, username, phone, email, password_hash, password_changed_at, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).bind(
        id,
        b.first_name || "",
        b.last_name || "",
        b.role || "",
        communityId,
        b.username,
        b.phone || null,
        b.email || "",
        hash,
        nowSec(),
        nowSec()
      ).run();
      return ok({ id });
    }
  }
  const communityUserMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (communityUserMatch) {
    const id = communityUserMatch[1];
    if (method === "DELETE") {
      await db.prepare("DELETE FROM users WHERE id = ? AND community_id = ?").bind(id, communityId).run();
      return ok({ deleted: id });
    }
    if (method === "PATCH") {
      const b = await request.json();
      const sets = [];
      const vals = [];
      if (b.first_name !== void 0) {
        sets.push("first_name = ?");
        vals.push(b.first_name);
      }
      if (b.last_name !== void 0) {
        sets.push("last_name = ?");
        vals.push(b.last_name);
      }
      if (b.phone !== void 0) {
        sets.push("phone = ?");
        vals.push(b.phone || null);
      }
      if (b.email !== void 0) {
        sets.push("email = ?");
        vals.push(b.email || "");
      }
      if (b.role !== void 0) {
        sets.push("role = ?");
        vals.push(b.role);
      }
      if (b.password) {
        const hash = await sha256hex(b.password);
        sets.push("password_hash = ?", "password_changed_at = ?");
        vals.push(hash, nowSec());
      }
      if (!sets.length) return err("\u05D0\u05D9\u05DF \u05E9\u05D3\u05D5\u05EA \u05DC\u05E2\u05D3\u05DB\u05D5\u05DF");
      vals.push(id, communityId);
      await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND community_id = ?`).bind(...vals).run();
      return ok({ updated: id });
    }
  }
  if (path === "/api/cells" && method === "GET") {
    const lockerRow = communityId ? await db.prepare("SELECT columns_json FROM locker_configs WHERE community_id = ?").bind(communityId).first() : null;
    if (!lockerRow) return ok([]);
    const columns = JSON.parse(lockerRow.columns_json || "[]");
    const totalCells = columns.reduce((s, c) => s + (c.cells || 0), 0);
    if (!totalCells) return ok([]);
    const { results: pkgs } = await db.prepare(`
      SELECT p.cell_id, p.status,
        (r.first_name || ' ' || r.last_name) AS resident_name,
        r.phone AS resident_phone
      FROM packages p LEFT JOIN residents r ON p.resident_id = r.id
      WHERE p.community_id = ? AND p.status != 'collected'
    `).bind(communityId).all();
    const pkgMap = {};
    pkgs.forEach((p) => {
      if (!pkgMap[p.cell_id]) pkgMap[p.cell_id] = p;
    });
    const { results: faultRows } = await db.prepare(
      `SELECT cell_number, status, fault_note FROM cells WHERE community_id = ? AND status != 'empty'`
    ).bind(communityId).all();
    const faultMap = {};
    faultRows.forEach((c) => {
      faultMap[c.cell_number] = c;
    });
    const cells = [];
    for (let i = 1; i <= totalCells; i++) {
      const numStr = String(i);
      const pkg = pkgMap[numStr];
      const fault = faultMap[i];
      let status = "available", extra = {};
      if (fault) {
        status = fault.status === "faulty" ? "fault" : fault.status || "fault";
        extra.fault_note = fault.fault_note;
      } else if (pkg) {
        status = pkg.status === "waiting" || pkg.status === "occupied" ? "occupied" : pkg.status;
        extra.resident_name = pkg.resident_name;
        extra.resident_phone = pkg.resident_phone;
        extra.pkg_status = pkg.status;
      }
      cells.push({ id: numStr, number: i, status, ...extra });
    }
    return ok(cells);
  }
  if (path === "/api/cells/fault" && method === "POST") {
    const b = await request.json();
    const cellNum = parseInt(b.cell_id);
    if (!cellNum) return err("cell_id \u05D7\u05D5\u05D1\u05D4");
    await db.prepare(`CREATE TABLE IF NOT EXISTS cells (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      cell_number INTEGER NOT NULL,
      status TEXT DEFAULT 'empty',
      fault_note TEXT,
      is_shared_room INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )`).run();
    const cellId = communityId + "_cell_" + cellNum;
    await db.prepare(`
      INSERT OR REPLACE INTO cells (id, community_id, cell_number, status, fault_note, created_at)
      VALUES (?, ?, ?, 'faulty', ?, unixepoch())
    `).bind(cellId, communityId, cellNum, b.note || "").run();
    return ok({ ok: true });
  }
  if (path === "/api/cells/clear-fault" && method === "POST") {
    const b = await request.json();
    const cellNum = parseInt(b.cell_id);
    if (!cellNum) return err("cell_id \u05D7\u05D5\u05D1\u05D4");
    await db.prepare(`
      DELETE FROM cells WHERE community_id = ? AND cell_number = ?
    `).bind(communityId, cellNum).run();
    return ok({ ok: true });
  }
  if (path === "/api/settings/messages") {
    if (method === "GET") {
      const row = await db.prepare(
        "SELECT msg_settings_json FROM settlements WHERE id = ?"
      ).bind(communityId).first();
      let settings = {};
      try {
        settings = JSON.parse(row?.msg_settings_json || "{}");
      } catch (e) {
      }
      const defaults = {
        reminder1_days: 1,
        reminder2_days: 3,
        reminder3_days: 5,
        reminder4_days: 7,
        fine_days: 10,
        fine_amount: 20,
        msg_arrival: "\u05D4\u05D9\u05D9 {\u05E9\u05DD}! \u{1F4E6} \u05D4\u05D2\u05D9\u05E2\u05D4 \u05DC\u05DA \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DE-{\u05D7\u05D1\u05E8\u05D4}{\u05EA\u05D0}. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D0\u05EA \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
        msg_reminder1: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u{1F44B} \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u2014 \u05D9\u05E9 \u05DC\u05DA \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05D0\u05E0\u05D0 \u05D0\u05E1\u05D5\u05E3 \u05D1\u05D4\u05E7\u05D3\u05DD. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
        msg_reminder2: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u26A0\uFE0F \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05E9\u05E0\u05D9\u05D9\u05D4 \u2014 \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05D0\u05E0\u05D0 \u05D0\u05E1\u05D5\u05E3 \u05D1\u05D4\u05E7\u05D3\u05DD. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
        msg_reminder3: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u{1F6A8} \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05E9\u05DC\u05D9\u05E9\u05D9\u05EA \u2014 \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05D0\u05E0\u05D0 \u05D0\u05E1\u05D5\u05E3 \u05D1\u05D4\u05E7\u05D3\u05DD. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!",
        msg_reminder4: "\u05D4\u05D9\u05D9 {\u05E9\u05DD} \u26D4 \u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05D0\u05D7\u05E8\u05D5\u05E0\u05D4 \u2014 \u05D7\u05D1\u05D9\u05DC\u05D4 \u05DB\u05D1\u05E8 {\u05D9\u05DE\u05D9\u05DD} \u05D9\u05DE\u05D9\u05DD{\u05EA\u05D0}. \u05DC\u05DC\u05D0 \u05D0\u05D9\u05E1\u05D5\u05E3 \u05EA\u05D7\u05D5\u05D9\u05D1 \u05D1\u05E7\u05E0\u05E1. \u05DC\u05D0\u05D7\u05E8 \u05DE\u05E9\u05D9\u05DB\u05EA \u05D4\u05D7\u05D1\u05D9\u05DC\u05D4/\u05D5\u05EA \u05E0\u05D0 \u05DC\u05D0\u05E9\u05E8 \u05D1\u05D4\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05D4 1 \u05D1\u05DC\u05D1\u05D3. \u05EA\u05D5\u05D3\u05D4!"
      };
      return ok({ ...defaults, ...settings });
    }
    if (method === "PUT") {
      if (user.role !== "community_manager" && user.role !== "smarta_admin") return forbidden();
      const b = await request.json();
      const allowed = [
        "reminder1_days",
        "reminder2_days",
        "reminder3_days",
        "reminder4_days",
        "fine_days",
        "fine_amount",
        "msg_arrival",
        "msg_reminder1",
        "msg_reminder2",
        "msg_reminder3",
        "msg_reminder4"
      ];
      const clean = {};
      allowed.forEach((k) => {
        if (b[k] !== void 0) clean[k] = b[k];
      });
      await db.prepare("UPDATE settlements SET msg_settings_json = ? WHERE id = ?").bind(JSON.stringify(clean), communityId).run();
      return ok({ saved: true });
    }
  }
  if (path === "/api/locker" && method === "GET") {
    const row = communityId ? await db.prepare("SELECT * FROM locker_configs WHERE community_id = ?").bind(communityId).first() : null;
    if (!row) return notFound();
    return ok({ ...row, columns: JSON.parse(row.columns_json || "[]") });
  }
  return notFound();
}
__name(handleCommunity, "handleCommunity");

// ../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-uO6eQ3/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = src_default;

// ../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-uO6eQ3/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
