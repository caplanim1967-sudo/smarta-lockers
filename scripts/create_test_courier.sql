INSERT OR IGNORE INTO users (id, first_name, last_name, role, courier_company_id, username, phone, password_hash, password_changed_at, active, created_at)
SELECT
  'test-courier-zita-01',
  'דוד', 'לוי',
  'courier',
  '5c10fefb-b741-4338-8425-40ddcfd3a95c',
  '0521111222_z',
  '0521111222',
  password_hash,
  password_changed_at,
  1,
  unixepoch()
FROM users WHERE username='0521111222';
