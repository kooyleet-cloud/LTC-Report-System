-- 1. Table for Caregiver/Admin accounts (staffs)
DROP TABLE IF EXISTS staffs;
CREATE TABLE staffs (
  username TEXT PRIMARY KEY,
  fullname TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cg'
);

-- Seed initial admin and caregiver accounts
INSERT INTO staffs (username, fullname, password, role) VALUES ('admin', 'ผู้ดูแลระบบสูงสุด (Admin)', 'admin1234', 'admin');
INSERT INTO staffs (username, fullname, password, role) VALUES ('cg01', 'สมศรี มีสุข (CG)', 'cg1234', 'cg');

-- 2. Table for LTC visit logs (visits)
DROP TABLE IF EXISTS visits;
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  patientTitle TEXT NOT NULL,
  patientFirstname TEXT NOT NULL,
  patientLastname TEXT NOT NULL,
  patientAge INTEGER NOT NULL,
  addressNo TEXT NOT NULL,
  addressMoo TEXT,
  addressSubdistrict TEXT NOT NULL,
  addressDistrict TEXT NOT NULL,
  addressProvince TEXT NOT NULL,
  addressZip TEXT NOT NULL,
  visitDate TEXT NOT NULL,
  visitTimeStart TEXT NOT NULL,
  visitTimeEnd TEXT NOT NULL,
  visitDuration INTEGER NOT NULL,
  careDetails TEXT NOT NULL,
  careActivities TEXT,
  bpSystolic INTEGER NOT NULL,
  bpDiastolic INTEGER NOT NULL,
  bpAnalysis TEXT NOT NULL,
  healthSymptoms TEXT,
  healthProblems TEXT,
  requestedItems TEXT,
  healthRemarks TEXT,
  cgTitle TEXT,
  cgFirstname TEXT NOT NULL,
  cgLastname TEXT,
  cgUsername TEXT NOT NULL,
  gpsLat TEXT,
  gpsLng TEXT,
  photos TEXT, -- Stores base64 attached PDF/Files JSON array
  lastUpdated TEXT NOT NULL
);

-- 3. Table for system log tracking (logs)
DROP TABLE IF EXISTS logs;
CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user TEXT NOT NULL,
  event TEXT NOT NULL,
  target TEXT
);
