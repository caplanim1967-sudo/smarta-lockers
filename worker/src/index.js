/**
 * Smarta Lockers — Cloudflare Workers API
 * Stack: Workers + D1 (SQLite)
 * Auth: JWT (HMAC-SHA256, no deps)
 */

// ─── RESPONSE HELPERS ────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
// ok() returns data directly (no wrapper) — frontends check for .error to detect failures
function ok(data)              { return json(data); }
function err(msg, status = 400){ return json({ error: msg }, status); }
function unauthorized()        { return err('Unauthorized', 401); }
function forbidden()           { return err('Forbidden', 403); }
function notFound()            { return err('Not found', 404); }

// ─── JWT (pure Web Crypto, no npm deps) ──────────────────────────────────────

// Encode any string (including Hebrew/Unicode) to base64url
function b64urlFromStr(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Encode raw buffer (signature bytes) to base64url
function b64urlFromBuf(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Decode base64url to UTF-8 string (handles Hebrew/Unicode correctly)
function b64urlToStr(str) {
  const binary = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// Decode base64url to raw bytes (for signature verification)
function b64urlToBytes(str) {
  const binary = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function jwtSign(payload, secret) {
  const header = b64urlFromStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64urlFromStr(JSON.stringify(payload));
  const data   = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64urlFromBuf(sig)}`;
}

async function jwtVerify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(data));
  if (!valid) return null;
  const payload = JSON.parse(b64urlToStr(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ─── CRYPTO HELPERS ──────────────────────────────────────────────────────────

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function newId()  { return crypto.randomUUID(); }
function nowSec() { return Math.floor(Date.now() / 1000); }

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────

async function getUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  return jwtVerify(auth.slice(7), env.JWT_SECRET);
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      // ── Public ──────────────────────────────────────────────
      if (path === '/api/health' && method === 'GET') {
        return ok({ status: 'ok', ts: nowSec() });
      }

      if (path === '/api/auth/login' && method === 'POST') {
        return handleLogin(request, env);
      }

      if (path === '/api/auth/forgot-password' && method === 'POST') {
        // Twilio integration pending
        return ok({ message: 'אם המשתמש קיים — תישלח הודעת SMS' });
      }

      // First-run setup (only if zero users exist)
      if (path === '/api/setup' && method === 'POST') {
        return handleSetup(request, env);
      }

      // ── Authenticated ────────────────────────────────────────
      const user = await getUser(request, env);
      if (!user) return unauthorized();

      // Admin routes
      if (path.startsWith('/api/admin/')) {
        if (user.role !== 'smarta_admin') return forbidden();
        return handleAdmin(path, method, request, env, user, url);
      }

      // Community routes (all other roles)
      return handleCommunity(path, method, request, env, user, url);

    } catch (e) {
      console.error('Unhandled error:', e.message, e.stack);
      return err('שגיאת שרת: ' + e.message, 500);
    }
  },
};

// ─── SETUP (first run only) ───────────────────────────────────────────────────

async function handleSetup(request, env) {
  const existing = await env.smarta_db
    .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'smarta_admin'")
    .first().catch(() => ({ c: 1 })); // fail-safe: if table doesn't exist yet, block

  if (existing.c > 0) {
    return err('Setup already completed', 403);
  }

  const b = await request.json().catch(() => ({}));
  if (!b.password || b.password.length < 8) {
    return err('password חייב להיות לפחות 8 תווים');
  }

  const hash = await sha256hex(b.password);
  await env.smarta_db.prepare(`
    INSERT INTO users (id, first_name, last_name, role, username, password_hash, password_changed_at, active, created_at)
    VALUES ('smarta_admin_001', 'Smarta', 'Admin', 'smarta_admin', 'smarta_admin', ?, ?, 1, ?)
  `).bind(hash, nowSec(), nowSec()).run();

  return ok({ message: 'smarta_admin נוצר בהצלחה', username: 'smarta_admin' });
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

async function handleLogin(request, env) {
  const b = await request.json().catch(() => ({}));
  const { username, password } = b;
  if (!username || !password) return err('חסרים שדות');

  const user = await env.smarta_db
    .prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .bind(username)
    .first();

  if (!user) return json({ error: 'שם משתמש או סיסמה שגויים' }, 401);

  const hash = await sha256hex(password);
  if (hash !== user.password_hash) return json({ error: 'שם משתמש או סיסמה שגויים' }, 401);

  let communityName = '';
  if (user.community_id) {
    const s = await env.smarta_db
      .prepare('SELECT name FROM settlements WHERE id = ?')
      .bind(user.community_id)
      .first();
    communityName = s?.name || '';
  }

  const payload = {
    sub:            user.id,
    role:           user.role,
    community_id:   user.community_id || null,
    name:           `${user.first_name} ${user.last_name}`,
    community_name: communityName,
    exp:            nowSec() + 60 * 60 * 24 * 30,  // 30 days
  };

  const token = await jwtSign(payload, env.JWT_SECRET);

  // Login returns flat (no "data" wrapper) — login.html checks data.token directly
  return json({
    token,
    role:           user.role,
    name:           payload.name,
    community_name: communityName,
    community_id:   user.community_id || null,
  });
}

// ─── ADMIN ROUTES (/api/admin/*) ──────────────────────────────────────────────

async function handleAdmin(path, method, request, env, user, url) {
  const db = env.smarta_db;

  // ── Settlements ──────────────────────────────────────────
  if (path === '/api/admin/settlements') {
    if (method === 'GET') {
      const { results } = await db.prepare(
        'SELECT * FROM settlements ORDER BY created_at DESC'
      ).all();
      return ok(results);
    }
    if (method === 'POST') {
      const b = await request.json();
      if (!b.name) return err('name שדה חובה');
      const id = b.id || newId();
      await db.prepare(`
        INSERT INTO settlements (id, name, region, plan, status, contact, phone, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, b.name, b.region || '', b.plan || 'basic',
        b.status || 'active', b.contact || '', b.phone || '', nowSec()).run();
      return ok({ id });
    }
  }

  const settlementMatch = path.match(/^\/api\/admin\/settlements\/([^/]+)$/);
  if (settlementMatch) {
    const id = settlementMatch[1];
    if (method === 'PUT' || method === 'POST') {
      const b = await request.json();
      await db.prepare(`
        UPDATE settlements
        SET name=?, region=?, plan=?, status=?, contact=?, phone=?
        WHERE id=?
      `).bind(b.name, b.region || '', b.plan || 'basic',
        b.status || 'active', b.contact || '', b.phone || '', id).run();
      return ok({ id });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM settlements WHERE id = ?').bind(id).run();
      return ok({ deleted: id });
    }
    if (method === 'GET') {
      const row = await db.prepare('SELECT * FROM settlements WHERE id = ?').bind(id).first();
      return row ? ok(row) : notFound();
    }
  }

  // ── Locker Configs ───────────────────────────────────────
  if (path === '/api/admin/lockers') {
    if (method === 'GET') {
      const { results } = await db.prepare(
        'SELECT * FROM locker_configs ORDER BY created_at DESC'
      ).all();
      return ok(results.map(r => ({ ...r, columns: JSON.parse(r.columns_json || '[]') })));
    }
    if (method === 'POST') {
      const b = await request.json();
      if (!b.community_id) return err('community_id חובה');
      const id = b.community_id; // locker id = community id (1:1)
      await db.prepare(`
        INSERT OR REPLACE INTO locker_configs
          (id, community_id, max_width, max_height, leg_height, tier, esp_id, columns_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, b.community_id, b.maxWidth || 120, b.maxHeight || 200,
        b.legHeight || 20, b.tier || 'basic', b.esp_id || null,
        JSON.stringify(b.columns || []), nowSec(), nowSec()).run();
      return ok({ id });
    }
  }

  const lockerMatch = path.match(/^\/api\/admin\/lockers\/([^/]+)$/);
  if (lockerMatch) {
    const id = lockerMatch[1];
    if (method === 'GET') {
      const row = await db.prepare('SELECT * FROM locker_configs WHERE id = ?').bind(id).first();
      if (!row) return notFound();
      return ok({ ...row, columns: JSON.parse(row.columns_json || '[]') });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM locker_configs WHERE id = ?').bind(id).run();
      return ok({ deleted: id });
    }
    if (method === 'PUT') {
      const b = await request.json();
      await db.prepare(`
        UPDATE locker_configs
        SET max_width=?, max_height=?, leg_height=?, tier=?, esp_id=?, columns_json=?, updated_at=?
        WHERE id=?
      `).bind(b.maxWidth || 120, b.maxHeight || 200, b.legHeight || 20,
        b.tier || 'basic', b.esp_id || null,
        JSON.stringify(b.columns || []), nowSec(), id).run();
      return ok({ id });
    }
  }

  // ── Users (admin manages all users) ─────────────────────
  if (path === '/api/admin/users') {
    if (method === 'GET') {
      const commId = url.searchParams.get('community_id');
      let stmt;
      if (commId) {
        stmt = db.prepare(
          'SELECT id,first_name,last_name,role,community_id,username,phone,password_changed_at,active,created_at FROM users WHERE community_id = ? ORDER BY created_at DESC'
        ).bind(commId);
      } else {
        stmt = db.prepare(
          'SELECT id,first_name,last_name,role,community_id,username,phone,password_changed_at,active,created_at FROM users ORDER BY created_at DESC'
        );
      }
      const { results } = await stmt.all();
      return ok(results);
    }
    if (method === 'POST') {
      const b = await request.json();
      if (!b.username || !b.password) return err('username ו-password חובה');
      const id   = 'local_' + Date.now();
      const hash = await sha256hex(b.password);
      await db.prepare(`
        INSERT INTO users (id, first_name, last_name, role, community_id, username, phone, password_hash, password_changed_at, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).bind(id, b.first_name || '', b.last_name || '',
        b.role || 'community_manager', b.community_id || null,
        b.username, b.phone || null, hash, nowSec(), nowSec()).run();
      return ok({ id });
    }
  }

  const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch) {
    const id = adminUserMatch[1];
    if (method === 'POST' || method === 'PUT') {
      const b = await request.json();
      if (b.password) {
        const hash = await sha256hex(b.password);
        await db.prepare(`
          UPDATE users
          SET first_name=?, last_name=?, phone=?, community_id=?, username=?, password_hash=?, password_changed_at=?
          WHERE id=?
        `).bind(b.first_name || '', b.last_name || '',
          b.phone || null, b.community_id || null,
          b.username, hash, nowSec(), id).run();
      } else {
        await db.prepare(`
          UPDATE users SET first_name=?, last_name=?, phone=?, community_id=?, username=?
          WHERE id=?
        `).bind(b.first_name || '', b.last_name || '',
          b.phone || null, b.community_id || null, b.username, id).run();
      }
      return ok({ id });
    }
    if (method === 'DELETE') {
      // הגנה: smarta_admin לא ניתן למחיקה
      const target = await db.prepare('SELECT role FROM users WHERE id = ?').bind(id).first();
      if (target && target.role === 'smarta_admin') {
        return new Response(JSON.stringify({ error: 'לא ניתן למחוק מנהל Smarta' }), {
          status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      return ok({ deleted: id });
    }
    if (method === 'GET') {
      const row = await db.prepare(
        'SELECT id,first_name,last_name,role,community_id,username,phone,password_changed_at,active FROM users WHERE id=?'
      ).bind(id).first();
      return row ? ok(row) : notFound();
    }
  }

  // Send password reminder SMS (Twilio — pending)
  const reminderMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/send-password-reminder$/);
  if (reminderMatch && method === 'POST') {
    return ok({ sent: true, note: 'Twilio integration pending' });
  }

  // ── Cell faults — all communities ────────────────────────
  if (path === '/api/admin/faults' && method === 'GET') {
    const commId = url.searchParams.get('community_id');
    const { results } = commId
      ? await db.prepare(`
          SELECT c.*, s.name AS community_name
          FROM cells c LEFT JOIN settlements s ON c.community_id = s.id
          WHERE c.community_id = ? AND c.status != 'empty'
          ORDER BY c.created_at DESC
        `).bind(commId).all()
      : await db.prepare(`
          SELECT c.*, s.name AS community_name
          FROM cells c LEFT JOIN settlements s ON c.community_id = s.id
          WHERE c.status != 'empty'
          ORDER BY c.created_at DESC
        `).all();
    return ok(results);
  }

  // ── Onboarding wizard (3-step) ───────────────────────────
  if (path === '/api/admin/onboarding' && method === 'POST') {
    return handleOnboarding(request, env, db);
  }

  // ── Impersonation — smarta_admin enters a community ──────
  if (path === '/api/admin/impersonate' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const communityId = b.community_id;
    if (!communityId) return err('community_id חובה');

    // Verify community exists
    const sett = await db.prepare('SELECT id, name FROM settlements WHERE id = ?')
      .bind(communityId).first();
    if (!sett) return notFound();

    // Generate a short-lived token scoped to the community
    const payload = {
      sub:            user.sub,
      role:           'community_manager',   // routes to manager iframe
      community_id:   communityId,
      community_name: sett.name,
      name:           user.name + ' (מנהל סמרטה)',
      impersonated_by: 'smarta_admin',
      exp:            nowSec() + 60 * 60 * 4,  // 4 hours
    };

    const token = await jwtSign(payload, env.JWT_SECRET);
    return ok({ token, community_id: communityId, community_name: sett.name });
  }

  return notFound();
}

async function handleOnboarding(request, env, db) {
  const b = await request.json().catch(() => ({}));

  // הלקוח שולח { community: {...}, locker: {...} } — תמיכה בשני פורמטים
  const comm = b.community || b;

  // Step 1: Create settlement
  const settId = comm.id || b.id || newId();
  const plan   = comm.plan || b.plan || 'basic';
  await db.prepare(`
    INSERT OR REPLACE INTO settlements (id, name, region, plan, status, contact, phone, created_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(settId, comm.name || b.name || 'ישוב חדש', comm.region || b.region || '',
    plan, comm.contact || b.contact || '', comm.phone || b.phone || '', nowSec()).run();

  // Step 2: Save locker config
  if (b.locker) {
    const lk = b.locker;
    await db.prepare(`
      INSERT OR REPLACE INTO locker_configs
        (id, community_id, max_width, max_height, leg_height, tier, esp_id, columns_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(settId, settId,
      lk.maxWidth || 120, lk.maxHeight || 200, lk.legHeight || 20,
      plan, lk.esp_id || null,
      JSON.stringify(lk.columns || []), nowSec(), nowSec()).run();
  }

  // Step 3: Create community manager
  if (b.manager && b.manager.username && b.manager.password) {
    const mgr  = b.manager;
    const mgrId = 'local_' + Date.now();
    const hash  = await sha256hex(mgr.password);
    await db.prepare(`
      INSERT OR REPLACE INTO users
        (id, first_name, last_name, role, community_id, username, phone, password_hash, password_changed_at, active, created_at)
      VALUES (?, ?, ?, 'community_manager', ?, ?, ?, ?, ?, 1, ?)
    `).bind(mgrId, mgr.first_name || '', mgr.last_name || '',
      settId, mgr.username, mgr.phone || null, hash, nowSec(), nowSec()).run();
  }

  return ok({ id: settId, settlement_id: settId });
}

// ─── COMMUNITY ROUTES (/api/residents, /api/packages, etc.) ──────────────────

async function handleCommunity(path, method, request, env, user, url) {
  const db          = env.smarta_db;
  const communityId = user.community_id;
  if (!communityId) return forbidden(); // smarta_admin אין לו community_id

  // ── Residents ────────────────────────────────────────────
  if (path === '/api/residents') {
    if (method === 'GET') {
      const { results } = communityId
        ? await db.prepare('SELECT * FROM residents WHERE community_id = ? ORDER BY last_name').bind(communityId).all()
        : await db.prepare('SELECT * FROM residents ORDER BY last_name').all();
      return ok(results);
    }
    if (method === 'POST') {
      const b = await request.json();
      if (!b.phone) return err('phone חובה');
      const id = newId();
      await db.prepare(`
        INSERT INTO residents
          (id, first_name, last_name, phone, community_id, notify_method, active, created_at,
           id_number, street, house_number, notes,
           alt_first_name, alt_last_name, alt_id_number, alt_phone, alt_notify_method)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, b.first_name || '', b.last_name || '',
        b.phone, communityId, b.notify_method || 'sms', nowSec(),
        b.id_number || null, b.street || null, b.house_number || null, b.notes || null,
        b.alt_first_name || null, b.alt_last_name || null,
        b.alt_id_number || null, b.alt_phone || null, b.alt_notify_method || null).run();
      return ok({ id });
    }
  }

  const residentMatch = path.match(/^\/api\/residents\/([^/]+)$/);
  if (residentMatch) {
    const id = residentMatch[1];
    if (method === 'PUT') {
      const b = await request.json();
      await db.prepare(`
        UPDATE residents
        SET first_name=?, last_name=?, phone=?, notify_method=?, active=?,
            id_number=?, street=?, house_number=?, notes=?,
            alt_first_name=?, alt_last_name=?, alt_id_number=?, alt_phone=?, alt_notify_method=?
        WHERE id=? AND community_id=?
      `).bind(b.first_name || '', b.last_name || '', b.phone,
        b.notify_method || 'sms', b.active !== false ? 1 : 0,
        b.id_number || null, b.street || null, b.house_number || null, b.notes || null,
        b.alt_first_name || null, b.alt_last_name || null,
        b.alt_id_number || null, b.alt_phone || null, b.alt_notify_method || null,
        id, communityId).run();
      return ok({ id });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM residents WHERE id = ? AND community_id = ?')
        .bind(id, communityId).run();
      return ok({ deleted: id });
    }
    if (method === 'GET') {
      const row = communityId
        ? await db.prepare('SELECT * FROM residents WHERE id=? AND community_id=?').bind(id, communityId).first()
        : await db.prepare('SELECT * FROM residents WHERE id=?').bind(id).first();
      return row ? ok(row) : notFound();
    }
  }

  // ── Packages ─────────────────────────────────────────────
  if (path === '/api/packages/history') {
    const pkgSelect = `
      SELECT p.*,
        p.assigned_at as placed_at,
        (r.first_name || ' ' || r.last_name) as resident_name,
        r.phone as resident_phone
      FROM packages p LEFT JOIN residents r ON p.resident_id = r.id`;
    const { results } = communityId
      ? await db.prepare(pkgSelect + ` WHERE p.community_id = ? AND p.status = 'collected' ORDER BY p.collected_at DESC LIMIT 500`).bind(communityId).all()
      : await db.prepare(pkgSelect + ` WHERE p.status = 'collected' ORDER BY p.collected_at DESC LIMIT 500`).all();
    return ok(results);
  }

  if (path === '/api/packages') {
    if (method === 'GET') {
      const status = url.searchParams.get('status') || 'waiting';
      const pkgSelect = `
        SELECT p.*,
          p.assigned_at as placed_at,
          (r.first_name || ' ' || r.last_name) as resident_name,
          r.phone as resident_phone
        FROM packages p LEFT JOIN residents r ON p.resident_id = r.id`;
      const { results } = communityId
        ? await db.prepare(pkgSelect + ` WHERE p.community_id = ? AND p.status = ? ORDER BY p.assigned_at DESC`).bind(communityId, status).all()
        : await db.prepare(pkgSelect + ` WHERE p.status = ? ORDER BY p.assigned_at DESC`).bind(status).all();
      return ok(results);
    }
    if (method === 'POST') {
      const b = await request.json();
      if (!b.cell_id) return err('cell_id חובה');
      const id = newId();
      await db.prepare(`
        INSERT INTO packages (id, community_id, resident_id, cell_id, barcode, courier, status, lock_code, notes, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)
      `).bind(id, communityId, b.resident_id || null, b.cell_id,
        b.barcode || null, b.courier || 'דואר ישראל',
        b.lock_code || null, b.notes || null, nowSec()).run();
      return ok({ id });
    }
  }

  const collectMatch = path.match(/^\/api\/packages\/([^/]+)\/collect$/);
  if (collectMatch && method === 'POST') {
    const id = collectMatch[1];
    await db.prepare(`
      UPDATE packages SET status = 'collected', collected_at = ? WHERE id = ?
    `).bind(nowSec(), id).run();
    return ok({ collected: id });
  }

  // סימון כל החבילות בתא כנאספו בבת אחת
  const collectCellMatch = path.match(/^\/api\/packages\/collect-cell\/([^/]+)$/);
  if (collectCellMatch && method === 'POST') {
    const cellId = collectCellMatch[1];
    const ts = nowSec();
    await db.prepare(`
      UPDATE packages SET status = 'collected', collected_at = ?
      WHERE community_id = ? AND cell_id = ? AND status = 'waiting'
    `).bind(ts, communityId, cellId).run();
    return ok({ collected_cell: cellId });
  }

  // מחיקת חבילה (בטעות / ביטול)
  const deletePackageMatch = path.match(/^\/api\/packages\/([^/]+)$/);
  if (deletePackageMatch && method === 'DELETE') {
    const id = deletePackageMatch[1];
    await db.prepare(`DELETE FROM packages WHERE id = ? AND community_id = ?`)
      .bind(id, communityId).run();
    return ok({ deleted: id });
  }

  // ── Community staff users ────────────────────────────────
  if (path === '/api/users') {
    if (method === 'GET') {
      const { results } = communityId
        ? await db.prepare(
            'SELECT id,first_name,last_name,role,username,phone,email,active FROM users WHERE community_id = ? ORDER BY created_at DESC'
          ).bind(communityId).all()
        : await db.prepare(
            'SELECT id,first_name,last_name,role,username,phone,email,active FROM users ORDER BY created_at DESC'
          ).all();
      return ok(results);
    }
    if (method === 'POST') {
      const b = await request.json();
      if (!b.username || !b.password) return err('username ו-password חובה');
      const id   = 'local_' + Date.now();
      const hash = await sha256hex(b.password);
      await db.prepare(`
        INSERT INTO users (id, first_name, last_name, role, community_id, username, phone, email, password_hash, password_changed_at, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).bind(id, b.first_name || '', b.last_name || '',
        b.role || '', communityId,
        b.username, b.phone || null, b.email || '', hash, nowSec(), nowSec()).run();
      return ok({ id });
    }
  }

  const communityUserMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (communityUserMatch) {
    const id = communityUserMatch[1];
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM users WHERE id = ? AND community_id = ?')
        .bind(id, communityId).run();
      return ok({ deleted: id });
    }
    if (method === 'PATCH') {
      const b = await request.json();
      const sets = [];
      const vals = [];
      if (b.first_name !== undefined) { sets.push('first_name = ?'); vals.push(b.first_name); }
      if (b.last_name  !== undefined) { sets.push('last_name = ?');  vals.push(b.last_name);  }
      if (b.phone      !== undefined) { sets.push('phone = ?');      vals.push(b.phone || null); }
      if (b.email      !== undefined) { sets.push('email = ?');      vals.push(b.email || ''); }
      if (b.role       !== undefined) { sets.push('role = ?');       vals.push(b.role);       }
      if (b.password) {
        const hash = await sha256hex(b.password);
        sets.push('password_hash = ?', 'password_changed_at = ?');
        vals.push(hash, nowSec());
      }
      if (!sets.length) return err('אין שדות לעדכון');
      vals.push(id, communityId);
      await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND community_id = ?`)
        .bind(...vals).run();
      return ok({ updated: id });
    }
  }

  // ── Cells status (locker_config + packages + faults) ────────
  if (path === '/api/cells' && method === 'GET') {
    // 1. לוקר קונפיג — כמה תאים יש בסה"כ
    const lockerRow = communityId
      ? await db.prepare('SELECT columns_json FROM locker_configs WHERE community_id = ?').bind(communityId).first()
      : null;
    if (!lockerRow) return ok([]);
    const columns = JSON.parse(lockerRow.columns_json || '[]');
    const totalCells = columns.reduce((s, c) => s + (c.cells || 0), 0);
    if (!totalCells) return ok([]);

    // 2. חבילות פעילות (לא נאספו)
    const { results: pkgs } = await db.prepare(`
      SELECT p.cell_id, p.status,
        (r.first_name || ' ' || r.last_name) AS resident_name,
        r.phone AS resident_phone
      FROM packages p LEFT JOIN residents r ON p.resident_id = r.id
      WHERE p.community_id = ? AND p.status != 'collected'
    `).bind(communityId).all();
    const pkgMap = {};
    pkgs.forEach(p => { if (!pkgMap[p.cell_id]) pkgMap[p.cell_id] = p; });

    // 3. תאים עם תקלה / מנוטרלים
    const { results: faultRows } = await db.prepare(
      `SELECT cell_number, status, fault_note FROM cells WHERE community_id = ? AND status != 'empty'`
    ).bind(communityId).all();
    const faultMap = {};
    faultRows.forEach(c => { faultMap[c.cell_number] = c; });

    // 4. בניית רשימה מאוחדת
    const cells = [];
    for (let i = 1; i <= totalCells; i++) {
      const numStr = String(i);
      const pkg   = pkgMap[numStr];
      const fault = faultMap[i];
      let status = 'available', extra = {};
      if (fault) {
        status = fault.status === 'faulty' ? 'fault' : (fault.status || 'fault');
        extra.fault_note = fault.fault_note;
      } else if (pkg) {
        status = (pkg.status === 'waiting' || pkg.status === 'occupied') ? 'occupied' : pkg.status;
        extra.resident_name  = pkg.resident_name;
        extra.resident_phone = pkg.resident_phone;
        extra.pkg_status     = pkg.status;
      }
      cells.push({ id: numStr, number: i, status, ...extra });
    }
    return ok(cells);
  }

  // ── Cell faults ──────────────────────────────────────────
  if (path === '/api/cells/fault' && method === 'POST') {
    const b = await request.json();
    const cellNum = parseInt(b.cell_id);
    if (!cellNum) return err('cell_id חובה');
    // ── הבטח קיום הטבלה (migration safety net) ──────────────
    await db.prepare(`CREATE TABLE IF NOT EXISTS cells (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      cell_number INTEGER NOT NULL,
      status TEXT DEFAULT 'empty',
      fault_note TEXT,
      is_shared_room INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )`).run();
    // ID דטרמיניסטי: communityId_cell_N
    const cellId = communityId + '_cell_' + cellNum;
    await db.prepare(`
      INSERT OR REPLACE INTO cells (id, community_id, cell_number, status, fault_note, created_at)
      VALUES (?, ?, ?, 'faulty', ?, unixepoch())
    `).bind(cellId, communityId, cellNum, b.note || '').run();
    return ok({ ok: true });
  }

  if (path === '/api/cells/clear-fault' && method === 'POST') {
    const b = await request.json();
    const cellNum = parseInt(b.cell_id);
    if (!cellNum) return err('cell_id חובה');
    await db.prepare(`
      DELETE FROM cells WHERE community_id = ? AND cell_number = ?
    `).bind(communityId, cellNum).run();
    return ok({ ok: true });
  }

  // ── Locker config (read for community) ───────────────────
  if (path === '/api/locker' && method === 'GET') {
    const row = communityId
      ? await db.prepare('SELECT * FROM locker_configs WHERE community_id = ?').bind(communityId).first()
      : null;
    if (!row) return notFound();
    return ok({ ...row, columns: JSON.parse(row.columns_json || '[]') });
  }

  return notFound();
}
