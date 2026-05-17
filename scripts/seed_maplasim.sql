-- ניקוי TST-01 הישן
DELETE FROM residents WHERE community_id = 'TST-01';
DELETE FROM users WHERE community_id = 'TST-01';
DELETE FROM settlements WHERE id = 'TST-01';

-- ── מפלסים Basic (MPL-B) ──────────────────────────────────────────────────────

INSERT INTO settlements (id, name, region, plan, status, features_json, msg_settings_json)
VALUES (
  'MPL-B', 'מפלסים', 'מרכז', 'basic', 'active',
  '{"courier_enabled":true,"sms_enabled":true}',
  '{"reminder1_days":2,"reminder2_days":4,"reminder3_days":6,"reminder4_days":8,"fine_days":11,"fine_amount":5,"msg_arrival":"היי {שם}! הגיעה לך חבילה בתא {תא}, קוד: {קוד}. תודה!","msg_arrival_multi":"היי {שם}! הגיעו לך {כמות} חבילות בתא {תא}, קוד: {קוד}. תודה!","msg_arrival_premium":"היי {שם}! הגיעה לך חבילה בלוקר. התקשר לאיסוף. תודה!","msg_arrival_multi_premium":"היי {שם}! הגיעו לך {כמות} חבילות בלוקר. התקשר לאיסוף. תודה!","msg_reminder1":"היי {שם}! תזכורת — יש לך חבילה כבר {ימים} ימים{תא}. אנא אסוף בהקדם. תודה!","msg_reminder2":"היי {שם}! תזכורת שנייה — חבילה כבר {ימים} ימים{תא}. אנא אסוף בהקדם. תודה!","msg_reminder3":"היי {שם}! תזכורת שלישית — חבילה כבר {ימים} ימים{תא}. אנא אסוף בהקדם. תודה!","msg_reminder4":"היי {שם}! תזכורת אחרונה — חבילה כבר {ימים} ימים{תא}. ללא איסוף תחויב בקנס. תודה!"}'
);

INSERT INTO locker_configs (id, community_id, max_width, max_height, leg_height, tier, esp_id, columns_json)
VALUES (
  'MPL-B', 'MPL-B', 120, 200, 10, 'basic', NULL,
  '[{"width":40,"depth":30,"cells":6,"cellHeights":[50,30,20,20,30,40]},{"width":40,"depth":30,"cells":6,"cellHeights":[50,30,20,20,30,40]},{"width":40,"depth":30,"cells":6,"cellHeights":[50,30,20,20,30,40]}]'
);

INSERT INTO cells (id, community_id, cell_number, status) VALUES
  ('MPL-B_cell_1',  'MPL-B', 1,  'empty'),
  ('MPL-B_cell_2',  'MPL-B', 2,  'empty'),
  ('MPL-B_cell_3',  'MPL-B', 3,  'empty'),
  ('MPL-B_cell_4',  'MPL-B', 4,  'empty'),
  ('MPL-B_cell_5',  'MPL-B', 5,  'empty'),
  ('MPL-B_cell_6',  'MPL-B', 6,  'empty'),
  ('MPL-B_cell_7',  'MPL-B', 7,  'empty'),
  ('MPL-B_cell_8',  'MPL-B', 8,  'empty'),
  ('MPL-B_cell_9',  'MPL-B', 9,  'empty'),
  ('MPL-B_cell_10', 'MPL-B', 10, 'empty'),
  ('MPL-B_cell_11', 'MPL-B', 11, 'empty'),
  ('MPL-B_cell_12', 'MPL-B', 12, 'empty'),
  ('MPL-B_cell_13', 'MPL-B', 13, 'empty'),
  ('MPL-B_cell_14', 'MPL-B', 14, 'empty'),
  ('MPL-B_cell_15', 'MPL-B', 15, 'empty'),
  ('MPL-B_cell_16', 'MPL-B', 16, 'empty'),
  ('MPL-B_cell_17', 'MPL-B', 17, 'empty'),
  ('MPL-B_cell_18', 'MPL-B', 18, 'empty');

INSERT INTO residents (id, community_id, first_name, last_name, phone, notify_method, active) VALUES
  ('mpl-b-res-001', 'MPL-B', 'משה',  'קפלן',   '0522497446', 'sms',      1),
  ('mpl-b-res-002', 'MPL-B', 'יעל',  'קפלן',   '0529211223', 'sms',      1),
  ('mpl-b-res-003', 'MPL-B', 'דוד',  'כהן',    '0505556666', 'whatsapp', 1),
  ('mpl-b-res-004', 'MPL-B', 'נועה', 'אברהם',  '0581112223', 'whatsapp', 1),
  ('mpl-b-res-005', 'MPL-B', 'רינה', 'גולן',   '0533334444', 'whatsapp', 1);

INSERT INTO users (id, first_name, last_name, role, community_id, username, password_hash, active) VALUES
  ('mpl-b-mgr',     'יעל',    'קפלן', 'community_manager', 'MPL-B', 'mgr_mpl_b',     'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1),
  ('mpl-b-mail',    'מפלסים', 'דואר', 'mail_manager',      'MPL-B', 'mail_mpl_b',    'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1),
  ('mpl-b-curmgr',  'שלמה',   'סיקס', 'courier_manager',   'MPL-B', 'curmgr_mpl_b',  'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1),
  ('mpl-b-courier', 'דוד',    'לוי',  'courier',            'MPL-B', '0521111222_b',  'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1);

-- ── מפלסים Premium (MPL-P) ────────────────────────────────────────────────────

INSERT INTO settlements (id, name, region, plan, status, features_json, msg_settings_json)
VALUES (
  'MPL-P', 'מפלסים', 'מרכז', 'premium', 'active',
  '{"courier_enabled":true,"sms_enabled":true}',
  '{"reminder1_days":2,"reminder2_days":4,"reminder3_days":6,"reminder4_days":8,"fine_days":11,"fine_amount":5,"msg_arrival":"היי {שם}! הגיעה לך חבילה בתא {תא}, קוד: {קוד}. תודה!","msg_arrival_multi":"היי {שם}! הגיעו לך {כמות} חבילות בתא {תא}, קוד: {קוד}. תודה!","msg_arrival_premium":"היי {שם}! הגיעה לך חבילה בלוקר. התקשר לאיסוף. תודה!","msg_arrival_multi_premium":"היי {שם}! הגיעו לך {כמות} חבילות בלוקר. התקשר לאיסוף. תודה!","msg_reminder1":"היי {שם}! תזכורת — יש לך חבילה כבר {ימים} ימים{תא}. אנא אסוף בהקדם. תודה!","msg_reminder2":"היי {שם}! תזכורת שנייה — חבילה כבר {ימים} ימים{תא}. אנא אסוף בהקדם. תודה!","msg_reminder3":"היי {שם}! תזכורת שלישית — חבילה כבר {ימים} ימים{תא}. אנא אסוף בהקדם. תודה!","msg_reminder4":"היי {שם}! תזכורת אחרונה — חבילה כבר {ימים} ימים{תא}. ללא איסוף תחויב בקנס. תודה!"}'
);

INSERT INTO locker_configs (id, community_id, max_width, max_height, leg_height, tier, esp_id, columns_json)
VALUES (
  'MPL-P', 'MPL-P', 120, 200, 10, 'premium', 'ESP-MPL-P',
  '[{"width":40,"depth":30,"cells":6,"cellHeights":[50,30,20,20,30,40]},{"width":40,"depth":30,"cells":6,"cellHeights":[50,30,20,20,30,40]},{"width":40,"depth":30,"cells":6,"cellHeights":[50,30,20,20,30,40]}]'
);

INSERT INTO cells (id, community_id, cell_number, status) VALUES
  ('MPL-P_cell_1',  'MPL-P', 1,  'empty'),
  ('MPL-P_cell_2',  'MPL-P', 2,  'empty'),
  ('MPL-P_cell_3',  'MPL-P', 3,  'empty'),
  ('MPL-P_cell_4',  'MPL-P', 4,  'empty'),
  ('MPL-P_cell_5',  'MPL-P', 5,  'empty'),
  ('MPL-P_cell_6',  'MPL-P', 6,  'empty'),
  ('MPL-P_cell_7',  'MPL-P', 7,  'empty'),
  ('MPL-P_cell_8',  'MPL-P', 8,  'empty'),
  ('MPL-P_cell_9',  'MPL-P', 9,  'empty'),
  ('MPL-P_cell_10', 'MPL-P', 10, 'empty'),
  ('MPL-P_cell_11', 'MPL-P', 11, 'empty'),
  ('MPL-P_cell_12', 'MPL-P', 12, 'empty'),
  ('MPL-P_cell_13', 'MPL-P', 13, 'empty'),
  ('MPL-P_cell_14', 'MPL-P', 14, 'empty'),
  ('MPL-P_cell_15', 'MPL-P', 15, 'empty'),
  ('MPL-P_cell_16', 'MPL-P', 16, 'empty'),
  ('MPL-P_cell_17', 'MPL-P', 17, 'empty'),
  ('MPL-P_cell_18', 'MPL-P', 18, 'empty');

INSERT INTO residents (id, community_id, first_name, last_name, phone, notify_method, active) VALUES
  ('mpl-p-res-001', 'MPL-P', 'משה',  'קפלן',   '0522497446', 'sms',      1),
  ('mpl-p-res-002', 'MPL-P', 'יעל',  'קפלן',   '0529211223', 'sms',      1),
  ('mpl-p-res-003', 'MPL-P', 'דוד',  'כהן',    '0505556666', 'whatsapp', 1),
  ('mpl-p-res-004', 'MPL-P', 'נועה', 'אברהם',  '0581112223', 'whatsapp', 1),
  ('mpl-p-res-005', 'MPL-P', 'רינה', 'גולן',   '0533334444', 'whatsapp', 1);

INSERT INTO users (id, first_name, last_name, role, community_id, username, password_hash, active) VALUES
  ('mpl-p-mgr',     'יעל',    'קפלן', 'community_manager', 'MPL-P', 'mgr_mpl_p',     'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1),
  ('mpl-p-mail',    'מפלסים', 'דואר', 'mail_manager',      'MPL-P', 'mail_mpl_p',    'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1),
  ('mpl-p-curmgr',  'שלמה',   'סיקס', 'courier_manager',   'MPL-P', 'curmgr_mpl_p',  'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1),
  ('mpl-p-courier', 'דוד',    'לוי',  'courier',            'MPL-P', '0521111222_p',  'a54c4e42f73c635f135a880fa554a4ccaa7ea510e0454376d8fa34c9f5210372', 1);
