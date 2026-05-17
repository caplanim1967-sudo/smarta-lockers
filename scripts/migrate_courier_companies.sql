-- מיגרציה: חברות שילוח
CREATE TABLE IF NOT EXISTS courier_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS courier_company_access (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  granted_by TEXT,
  created_at INTEGER,
  UNIQUE(company_id, community_id)
);

-- הוסף עמודה courier_company_id לטבלת users (אם עוד לא קיימת)
ALTER TABLE users ADD COLUMN courier_company_id TEXT;
