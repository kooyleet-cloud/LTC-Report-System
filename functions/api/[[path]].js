export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Set up CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Helper to return JSON responses
  const jsonResponse = (data, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  };

  // Helper to check if DB is bound
  if (!env.DB) {
    return jsonResponse({
      status: 'error',
      message: 'Cloudflare D1 Database binding "DB" is missing. Please bind your D1 database to the name "DB" under Pages -> Settings -> Functions -> D1 database bindings.'
    }, 500);
  }

  // ระบบตรวจสอบและสร้างตารางข้อมูลในคลาวด์ D1 อัตโนมัติ (Auto Schema Migration)
  try {
    const tableCheck = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='visits'"
    ).first();
    
    if (!tableCheck) {
      const schemaSql = `
        CREATE TABLE IF NOT EXISTS staffs (username TEXT PRIMARY KEY, fullname TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cg');
        INSERT OR IGNORE INTO staffs (username, fullname, password, role) VALUES ('admin', 'ผู้ดูแลระบบสูงสุด (Admin)', 'admin1234', 'admin');
        INSERT OR IGNORE INTO staffs (username, fullname, password, role) VALUES ('cg01', 'สมศรี มีสุข (CG)', 'cg1234', 'cg');
        CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, patientTitle TEXT NOT NULL, patientFirstname TEXT NOT NULL, patientLastname TEXT NOT NULL, patientAge INTEGER NOT NULL, addressNo TEXT NOT NULL, addressMoo TEXT, addressSubdistrict TEXT NOT NULL, addressDistrict TEXT NOT NULL, addressProvince TEXT NOT NULL, addressZip TEXT NOT NULL, visitDate TEXT NOT NULL, visitTimeStart TEXT NOT NULL, visitTimeEnd TEXT NOT NULL, visitDuration INTEGER NOT NULL, careDetails TEXT NOT NULL, careActivities TEXT, bpSystolic INTEGER NOT NULL, bpDiastolic INTEGER NOT NULL, bpAnalysis TEXT NOT NULL, healthSymptoms TEXT, healthProblems TEXT, requestedItems TEXT, healthRemarks TEXT, cgTitle TEXT, cgFirstname TEXT NOT NULL, cgLastname TEXT, cgUsername TEXT NOT NULL, gpsLat TEXT, gpsLng TEXT, photos TEXT, lastUpdated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, user TEXT NOT NULL, event TEXT NOT NULL, target TEXT);
      `;
      await env.DB.exec(schemaSql);
      console.log('Auto-created D1 database schemas successfully!');
    }
  } catch (dbError) {
    console.error('D1 auto-migration failed:', dbError);
    return jsonResponse({
      status: 'error',
      message: `Failed to initialize D1 database schema: ${dbError.message}`
    }, 500);
  }

  try {
    // 1. GET /api/getAllData
    if (path === '/api/getAllData' && method === 'GET') {
      // Fetch visits
      const visitsQuery = await env.DB.prepare(
        "SELECT * FROM visits ORDER BY visitDate DESC, lastUpdated DESC"
      ).all();
      
      const visits = (visitsQuery.results || []).map(r => {
        try {
          r.photos = r.photos ? JSON.parse(r.photos) : [];
        } catch (e) {
          r.photos = [];
        }
        return r;
      });

      // Fetch staffs
      const staffsQuery = await env.DB.prepare(
        "SELECT username, fullname, password, role FROM staffs ORDER BY username ASC"
      ).all();
      const staffs = staffsQuery.results || [];

      // Fetch logs
      const logsQuery = await env.DB.prepare(
        "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100"
      ).all();
      const logs = logsQuery.results || [];

      return jsonResponse({
        status: 'success',
        visits,
        staffs,
        logs
      });
    }

    // 2. POST /api/saveVisit
    if (path === '/api/saveVisit' && method === 'POST') {
      const rawVisit = await request.json();
      
      // Sanitizer to convert undefined or null properties to safe DB values
      const sanitize = (val, defaultVal = '') => (val === undefined || val === null) ? defaultVal : val;
      
      const v = {
        id: sanitize(rawVisit.id),
        patientTitle: sanitize(rawVisit.patientTitle),
        patientFirstname: sanitize(rawVisit.patientFirstname),
        patientLastname: sanitize(rawVisit.patientLastname),
        patientAge: sanitize(rawVisit.patientAge, 0),
        addressNo: sanitize(rawVisit.addressNo, '-'),
        addressMoo: sanitize(rawVisit.addressMoo),
        addressSubdistrict: sanitize(rawVisit.addressSubdistrict, '-'),
        addressDistrict: sanitize(rawVisit.addressDistrict, '-'),
        addressProvince: sanitize(rawVisit.addressProvince, '-'),
        addressZip: sanitize(rawVisit.addressZip, '-'),
        visitDate: sanitize(rawVisit.visitDate),
        visitTimeStart: sanitize(rawVisit.visitTimeStart, '00:00'),
        visitTimeEnd: sanitize(rawVisit.visitTimeEnd, '00:00'),
        visitDuration: sanitize(rawVisit.visitDuration, 0),
        careDetails: sanitize(rawVisit.careDetails),
        careActivities: sanitize(rawVisit.careActivities),
        bpSystolic: sanitize(rawVisit.bpSystolic, 120),
        bpDiastolic: sanitize(rawVisit.bpDiastolic, 80),
        bpAnalysis: sanitize(rawVisit.bpAnalysis, 'ปกติ'),
        healthSymptoms: sanitize(rawVisit.healthSymptoms),
        healthProblems: sanitize(rawVisit.healthProblems),
        requestedItems: sanitize(rawVisit.requestedItems),
        healthRemarks: sanitize(rawVisit.healthRemarks),
        cgTitle: sanitize(rawVisit.cgTitle),
        cgFirstname: sanitize(rawVisit.cgFirstname),
        cgLastname: sanitize(rawVisit.cgLastname),
        cgUsername: sanitize(rawVisit.cgUsername),
        gpsLat: sanitize(rawVisit.gpsLat),
        gpsLng: sanitize(rawVisit.gpsLng),
        photos: rawVisit.photos || [],
        lastUpdated: sanitize(rawVisit.lastUpdated, new Date().toISOString())
      };

      const photosStr = JSON.stringify(v.photos);

      const sql = `INSERT INTO visits (
        id, patientTitle, patientFirstname, patientLastname, patientAge,
        addressNo, addressMoo, addressSubdistrict, addressDistrict, addressProvince, addressZip,
        visitDate, visitTimeStart, visitTimeEnd, visitDuration,
        careDetails, careActivities, bpSystolic, bpDiastolic, bpAnalysis,
        healthSymptoms, healthProblems, requestedItems, healthRemarks,
        cgTitle, cgFirstname, cgLastname, cgUsername, gpsLat, gpsLng, photos, lastUpdated
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        patientTitle=excluded.patientTitle, patientFirstname=excluded.patientFirstname, patientLastname=excluded.patientLastname, patientAge=excluded.patientAge,
        addressNo=excluded.addressNo, addressMoo=excluded.addressMoo, addressSubdistrict=excluded.addressSubdistrict, addressDistrict=excluded.addressDistrict, addressProvince=excluded.addressProvince, addressZip=excluded.addressZip,
        visitDate=excluded.visitDate, visitTimeStart=excluded.visitTimeStart, visitTimeEnd=excluded.visitTimeEnd, visitDuration=excluded.visitDuration,
        careDetails=excluded.careDetails, careActivities=excluded.careActivities, bpSystolic=excluded.bpSystolic, bpDiastolic=excluded.bpDiastolic, bpAnalysis=excluded.bpAnalysis,
        healthSymptoms=excluded.healthSymptoms, healthProblems=excluded.healthProblems, requestedItems=excluded.requestedItems, healthRemarks=excluded.healthRemarks,
        cgTitle=excluded.cgTitle, cgFirstname=excluded.cgFirstname, cgLastname=excluded.cgLastname, cgUsername=excluded.cgUsername, gpsLat=excluded.gpsLat, gpsLng=excluded.gpsLng, photos=excluded.photos, lastUpdated=excluded.lastUpdated`;

      await env.DB.prepare(sql).bind(
        v.id, v.patientTitle, v.patientFirstname, v.patientLastname, v.patientAge,
        v.addressNo, v.addressMoo, v.addressSubdistrict, v.addressDistrict, v.addressProvince, v.addressZip,
        v.visitDate, v.visitTimeStart, v.visitTimeEnd, v.visitDuration,
        v.careDetails, v.careActivities, v.bpSystolic, v.bpDiastolic, v.bpAnalysis,
        v.healthSymptoms, v.healthProblems, v.requestedItems, v.healthRemarks,
        v.cgTitle, v.cgFirstname, v.cgLastname, v.cgUsername, v.gpsLat, v.gpsLng, photosStr, v.lastUpdated
      ).run();

      return jsonResponse({ status: 'success' });
    }

    // 3. POST /api/deleteVisit
    if (path === '/api/deleteVisit' && method === 'POST') {
      const { id } = await request.json();
      await env.DB.prepare("DELETE FROM visits WHERE id = ?").bind(id).run();
      return jsonResponse({ status: 'success' });
    }

    // 4. POST /api/saveStaff
    if (path === '/api/saveStaff' && method === 'POST') {
      const s = await request.json();
      const sql = `INSERT INTO staffs (username, fullname, password, role) 
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(username) DO UPDATE SET 
                   fullname=excluded.fullname, password=excluded.password, role=excluded.role`;
      await env.DB.prepare(sql).bind(
        s.username || '', 
        s.fullname || '', 
        s.password || '', 
        s.role || 'cg'
      ).run();
      return jsonResponse({ status: 'success' });
    }

    // 5. POST /api/deleteStaff
    if (path === '/api/deleteStaff' && method === 'POST') {
      const { username } = await request.json();
      await env.DB.prepare("DELETE FROM staffs WHERE username = ?").bind(username).run();
      return jsonResponse({ status: 'success' });
    }

    // 6. POST /api/saveLog
    if (path === '/api/saveLog' && method === 'POST') {
      const l = await request.json();
      const sql = `INSERT INTO logs (id, timestamp, user, event, target) VALUES (?, ?, ?, ?, ?)`;
      await env.DB.prepare(sql).bind(
        l.id || '', 
        l.timestamp || new Date().toISOString(), 
        l.user || '', 
        l.event || '', 
        l.target || ''
      ).run();
      return jsonResponse({ status: 'success' });
    }

    // 7. POST /api/clearLogs
    if (path === '/api/clearLogs' && method === 'POST') {
      await env.DB.prepare("DELETE FROM logs").run();
      return jsonResponse({ status: 'success' });
    }

    // 8. POST /api/sendLineNotify
    if (path === '/api/sendLineNotify' && method === 'POST') {
      const { token, message } = await request.json();
      if (!token || !message) {
        return jsonResponse({ status: 'error', message: 'โทเค็นหรือข้อความเว้นว่าง' }, 400);
      }

      const bodyParams = new URLSearchParams();
      bodyParams.append('message', message);

      const response = await fetch('https://notify-api.line.me/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${token}`
        },
        body: bodyParams.toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        return jsonResponse({ status: 'error', message: `LINE API Error: ${errText}` }, response.status);
      }

      return jsonResponse({ status: 'success' });
    }

    // Default 404 for other API routes
    return jsonResponse({ status: 'error', message: `API Endpoint "${path}" not found.` }, 404);

  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ status: 'error', message: error.message }, 500);
  }
}
