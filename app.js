/**
 * ระบบรายงานการดูแลระยะยาว LTC (Long Term Care)
 * Core Application Script - Vanilla JS - v1.3.1 (Cloud D1 Active)
 */

class LTCIndexedDB {
  constructor() {
    this.dbName = 'LTC_Database';
    this.dbVersion = 1;
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('visits')) {
          db.createObjectStore('visits', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  getAllVisits() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not initialized'));
      }
      const transaction = this.db.transaction(['visits'], 'readonly');
      const store = transaction.objectStore('visits');
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  saveVisit(visit) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not initialized'));
      }
      const transaction = this.db.transaction(['visits'], 'readwrite');
      const store = transaction.objectStore('visits');
      const request = store.put(visit);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  deleteVisit(id) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not initialized'));
      }
      const transaction = this.db.transaction(['visits'], 'readwrite');
      const store = transaction.objectStore('visits');
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  clearAll() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not initialized'));
      }
      const transaction = this.db.transaction(['visits'], 'readwrite');
      const store = transaction.objectStore('visits');
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }
}

class LTCApplication {
  constructor() {
    // Application State
    this.state = {
      currentUser: null,
      visits: [],
      staffs: [],
      logs: [],
      dbDriver: 'local', // 'local' or 'sheets'
      sheetsUrl: '',
      lineToken: '',
      lineGroupId: '',
      currentPhotos: [], // Array of base64 compressed images
      currentCarePlanPhotos: [], // Array of base64 files for care plan modal
      selectedVisitId: null,
      currentView: 'dashboard',
      chartVisitsTime: null,
      chartVisitsCG: null,
      qrScanner: null,
      leafletMap: null,
      leafletMarker: null,
      activeVisitChartType: 'monthly'
    };

    // Default Configuration
    this.defaultStaffs = [
      { username: 'admin', fullname: 'ผู้ดูแลระบบสูงสุด (Admin)', password: 'admin1234', role: 'admin' },
      { username: 'cg01', fullname: 'สมศรี มีสุข (CG)', password: 'cg1234', role: 'cg' },
      { username: 'cg02', fullname: 'สมชาย รักดี (CG)', password: 'cg1234', role: 'cg' }
    ];

    // Bind methods to prevent this context loss
    this.init = this.init.bind(this);
  }

  /**
   * เริ่มต้นโปรแกรม
   */
  async init() {
    this.localDB = new LTCIndexedDB();
    try {
      await this.localDB.open();
      // Migration from LocalStorage to IndexedDB
      const oldVisitsRaw = localStorage.getItem('ltc_local_visits');
      if (oldVisitsRaw) {
        try {
          const oldVisits = JSON.parse(oldVisitsRaw);
          for (const visit of oldVisits) {
            await this.localDB.saveVisit(visit);
          }
          localStorage.removeItem('ltc_local_visits');
          console.log('Migrated visits to IndexedDB successfully!');
        } catch (e) {
          console.error('Migration failed:', e);
        }
      }
    } catch (err) {
      console.error('Failed to initialize IndexedDB:', err);
    }

    this.loadConfig();
    this.initTheme();
    this.setupEventListeners();
    
    // ตั้งค่ารายการตัวเลือกเวลาแบบกำหนดเอง
    this.populateTimeSelects();
    
    // ตั้งค่ารหัสผ่านเริ่มต้นหากเปิดใช้งานครั้งแรก
    this.initializeDefaultStaffs();
    
    // รันการตรวจสอบ Diagnostics หลังบ้าน
    this.runSystemDiagnostics();
    
    // โหลดข้อมูลตาม Driver ที่ตั้งค่าไว้
    await this.syncData();

    // ตรวจสอบเซสชันผู้ใช้งาน
    this.checkSession();
    
    // ตั้งค่ารายการตัวเลือกปีในตัวกรอง (พ.ศ.)
    this.populateYearFilter();
  }

  async runSystemDiagnostics() {
    const diagDomain = document.getElementById('diag-domain-type');
    const diagApi = document.getElementById('diag-api-status');
    if (!diagDomain || !diagApi) return;

    const host = window.location.hostname;
    
    // 1. ตรวจสอบโดเมน
    if (host.includes('workers.dev')) {
      diagDomain.innerHTML = `<span class="text-rose-500 font-bold">Workers (${host}) ⚠️ ผิดประเภท (ห้ามใช้)</span>`;
    } else if (host.includes('pages.dev')) {
      diagDomain.innerHTML = `<span class="text-emerald-500 font-bold">Pages (${host}) ✅ ถูกต้อง</span>`;
    } else {
      diagDomain.innerHTML = `<span class="text-sky-400 font-bold">Localhost (${host})</span>`;
    }

    // 2. ทดสอบเรียก API หลังบ้าน
    try {
      const start = Date.now();
      const response = await fetch((this.apiBaseUrl || '') + '/api/getAllData');
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success') {
          diagApi.innerHTML = `<span class="text-emerald-500 font-bold">เชื่อมต่อคลาวด์ D1 สำเร็จ (${duration}ms) ✅</span>`;
        } else {
          diagApi.innerHTML = `<span class="text-rose-400">D1 ตอบกลับผิดพลาด: ${data.message || 'ไม่พบข้อความ'}</span>`;
        }
      } else {
        let errMsg = `เกิดข้อผิดพลาด (Status: ${response.status})`;
        try {
          const text = await response.text();
          if (text) {
            const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            errMsg = `${cleanText.substring(0, 70)}... (Status: ${response.status})`;
          }
        } catch (e) {}
        diagApi.innerHTML = `<span class="text-rose-500 font-bold">ล้มเหลว: ${errMsg} ❌</span>`;
      }
    } catch (err) {
      diagApi.innerHTML = `<span class="text-rose-500 font-bold">ล้มเหลว: ไม่สามารถส่งคำขอได้ (${err.message}) ❌</span>`;
    }
  }

  loadConfig() {
    const host = window.location.hostname;
    // หากเปิดผ่าน local file (เช่น file:///) หรือ localhost ให้ระบุ apiBaseUrl ไปยังโดเมนจริงบนคลาวด์
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '';
    this.apiBaseUrl = isLocalhost ? 'https://ltc-report-system-final.pages.dev' : '';

    const isCloudflareEnv = !isLocalhost;
    const defaultDriver = isCloudflareEnv ? 'cloudflare' : 'local';
    
    // หากเข้าใช้งานบน Cloudflare Pages หรือเปิดผ่านคอมพิวเตอร์ในเครื่องแต่ต่อคลาวด์ ให้เริ่มต้นด้วย Cloud D1 เสมอ
    const driver = isLocalhost ? 'cloudflare' : (isCloudflareEnv ? 'cloudflare' : (localStorage.getItem('ltc_db_driver') || defaultDriver));
    this.state.dbDriver = driver;

    const url = localStorage.getItem('ltc_sheets_url');
    if (url) {
      this.state.sheetsUrl = url;
    }

    const token = localStorage.getItem('ltc_line_token');
    if (token) this.state.lineToken = token;

    const groupId = localStorage.getItem('ltc_line_group');
    if (groupId) this.state.lineGroupId = groupId;

    // อัปเดต UI หน้าจอการเชื่อมต่อ
    const urlInput = document.getElementById('settings-sheets-url');
    if (urlInput) urlInput.value = this.state.sheetsUrl;

    const tokenInput = document.getElementById('settings-line-token');
    if (tokenInput) tokenInput.value = this.state.lineToken;

    const groupInput = document.getElementById('settings-line-group');
    if (groupInput) groupInput.value = this.state.lineGroupId;

    this.updateDBDriverUI();
    this.updateAppsScriptCodeBox();
  }

  /**
   * จัดการระบบธีม (Dark / Light)
   */
  initTheme() {
    const isDark = localStorage.getItem('ltc_dark_theme') === 'true';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('ltc_dark_theme', isDark);
    this.showToast('เปลี่ยนการแสดงผลเป็นโหมด ' + (isDark ? 'กลางคืน' : 'กลางวัน') + ' เรียบร้อย', 'info');
  }

  /**
   * เชื่อมโยง Event Listener กับอิลิเมนต์ต่างๆ
   */
  setupEventListeners() {
    // การเปลี่ยนมุมมอง (Desktop Sidebar)
    document.querySelectorAll('aside nav a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.getAttribute('data-view');
        this.switchView(view);
      });
    });

    // การเปลี่ยนมุมมอง (Mobile Bottom Nav)
    document.querySelectorAll('nav.md\\:hidden a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.getAttribute('data-view');
        this.switchView(view);
      });
    });

    // ดักการพิมพ์ค้นหาเพื่อทำการกรองข้อมูลตารางทันที (Realtime search)
    document.getElementById('search-patient-name').addEventListener('input', () => this.renderVisitsTable());
    document.getElementById('search-cg-name').addEventListener('input', () => this.renderVisitsTable());
    document.getElementById('filter-visit-date').addEventListener('change', () => this.renderVisitsTable());
    document.getElementById('filter-visit-month').addEventListener('change', () => this.renderVisitsTable());
    document.getElementById('filter-visit-year').addEventListener('change', () => this.renderVisitsTable());

    const searchCP = document.getElementById('search-careplan-patient');
    if (searchCP) {
      searchCP.addEventListener('input', () => this.renderCarePlanTable());
    }

    // ป้องกันการลากวางรูป
    const dropZone = document.getElementById('photo-upload-zone');
    if (dropZone) {
      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropZone.classList.add('bg-slate-200', 'dark:bg-slate-700/50');
        }, false);
      });
      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropZone.classList.remove('bg-slate-200', 'dark:bg-slate-700/50');
        }, false);
      });
      dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        this.processPhotos(files);
      });
    }
  }

  /**
   * ยืนยันการตั้งค่าเริ่มต้นผู้ใช้งานในระบบ
   */
  initializeDefaultStaffs() {
    const rawStaffs = localStorage.getItem('ltc_local_staffs');
    if (!rawStaffs) {
      localStorage.setItem('ltc_local_staffs', JSON.stringify(this.defaultStaffs));
      this.state.staffs = [...this.defaultStaffs];
    } else {
      this.state.staffs = JSON.parse(rawStaffs);
    }
  }

  /**
   * โหลด/ซิงค์ข้อมูลทั้งหมดจาก Driver ที่เลือก
   */
  async syncData() {
    this.showLoading(true, 'กำลังโหลดและเชื่อมโยงข้อมูลฐานข้อมูล...');
    
    try {
      if (this.state.dbDriver === 'local') {
        // ดึงจาก IndexedDB แทน Local Storage
        if (this.localDB) {
          this.state.visits = await this.localDB.getAllVisits();
        } else {
          this.state.visits = [];
        }
        
        const rawStaffs = localStorage.getItem('ltc_local_staffs');
        this.state.staffs = rawStaffs ? JSON.parse(rawStaffs) : [...this.defaultStaffs];
        
        const rawLogs = localStorage.getItem('ltc_local_logs');
        this.state.logs = rawLogs ? JSON.parse(rawLogs) : [];
        
        this.updateDBStatusUI('Local Database Mode', 'emerald');
      } else if (this.state.dbDriver === 'sheets') {
        if (!this.state.sheetsUrl) {
          this.showToast('กรุณากรอก URL ของ Google Apps Script ในหน้าตั้งค่าก่อนใช้งานโหมด Cloud', 'warning');
          this.state.dbDriver = 'local';
          this.updateDBDriverUI();
          this.showLoading(false);
          return this.syncData();
        }

        const response = await fetch(`${this.state.sheetsUrl}?action=getAllData`);
        if (!response.ok) throw new Error('ไม่สามารถเข้าถึงเซิร์ฟเวอร์ Google Sheets');
        
        const resData = await response.json();
        if (resData.status === 'success') {
          this.state.visits = resData.visits || [];
          this.state.staffs = resData.staffs || [];
          this.state.logs = resData.logs || [];
          this.updateDBStatusUI('Google Sheets Cloud Connected', 'emerald');
        } else {
          throw new Error(resData.message || 'โครงสร้างข้อมูล Google Sheets ผิดพลาด');
        }
      } else if (this.state.dbDriver === 'cloudflare') {
        const response = await fetch((this.apiBaseUrl || '') + '/api/getAllData');
        if (!response.ok) {
          let detailedMsg = `ไม่สามารถเข้าถึงเซิร์ฟเวอร์ Cloudflare API (Status: ${response.status})`;
          try {
            // ลองแปลงเป็น JSON เพื่อดึงข้อความ Error
            const errJson = await response.json();
            if (errJson && errJson.message) {
              detailedMsg = `${errJson.message} (Status: ${response.status})`;
            }
          } catch (e) {
            try {
              // หากไม่ใช่ JSON (เช่น หน้า HTML 404/500) ให้ดึงข้อความดิบมาแสดง 100 ตัวอักษรแรก
              const text = await response.text();
              if (text) {
                const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                detailedMsg = `${cleanText.substring(0, 120)}... (Status: ${response.status})`;
              }
            } catch (e2) {}
          }
          throw new Error(detailedMsg);
        }
        
        const resData = await response.json();
        if (resData.status === 'success') {
          this.state.visits = resData.visits || [];
          this.state.staffs = resData.staffs || [];
          this.state.logs = resData.logs || [];
          this.updateDBStatusUI('Cloudflare D1 Connected', 'emerald');
        } else {
          throw new Error(resData.message || 'โครงสร้างข้อมูล Cloudflare D1 ผิดพลาด');
        }
      }
    } catch (error) {
      console.error(error);
      this.showToast(`เกิดข้อผิดพลาดในการเชื่อมต่อคลาวด์ D1: ${error.message}`, 'error');
      
      // ล้างข้อมูลเพื่อความปลอดภัย และบล็อกการทำงานในโหมดโลคอล
      this.state.visits = [];
      this.state.staffs = [];
      this.state.logs = [];
      this.updateDBStatusUI('Cloud Connection Failed ❌', 'rose');
    } finally {
      this.showLoading(false);
      this.renderAllDataUI();
    }
  }

  /**
   * บันทึกข้อมูลลงฐานข้อมูลตามโหมดที่ทำงานอยู่
   */
  async saveData(type, recordOrId, actionType = 'save') {
    this.showLoading(true, 'กำลังบันทึกข้อมูลเข้าสู่ระบบ...');
    try {
      const keyName = type === 'staffs' ? 'username' : 'id';
      
      if (actionType === 'save') {
        const list = this.state[type];
        const keyValue = recordOrId[keyName];
        const idx = list.findIndex(item => item[keyName] === keyValue);
        if (idx !== -1) {
          list[idx] = recordOrId;
        } else {
          if (type === 'visits' || type === 'logs') {
            list.unshift(recordOrId);
          } else {
            list.push(recordOrId);
          }
        }
      } else if (actionType === 'delete') {
        this.state[type] = this.state[type].filter(item => item[keyName] !== recordOrId);
      }

      if (this.state.dbDriver === 'local') {
        if (type === 'visits') {
          if (this.localDB) {
            if (actionType === 'save') {
              await this.localDB.saveVisit(recordOrId);
            } else if (actionType === 'delete') {
              await this.localDB.deleteVisit(recordOrId);
            }
          }
        } else if (type === 'staffs') {
          localStorage.setItem('ltc_local_staffs', JSON.stringify(this.state.staffs));
        } else if (type === 'logs') {
          localStorage.setItem('ltc_local_logs', JSON.stringify(this.state.logs));
        }
        this.showToast('บันทึกข้อมูลเรียบร้อยแล้ว (Local DB)', 'success');
      } else if (this.state.dbDriver === 'sheets') {
        let dataPayload;
        if (actionType === 'delete') {
          dataPayload = type === 'staffs' ? { username: recordOrId } : { id: recordOrId };
        } else {
          dataPayload = recordOrId;
        }

        const payload = {
          action: actionType === 'delete' 
            ? `delete${type.slice(0,-1).charAt(0).toUpperCase() + type.slice(0,-1).slice(1)}` 
            : `save${type.slice(0,-1).charAt(0).toUpperCase() + type.slice(0,-1).slice(1)}`,
          data: dataPayload
        };

        await fetch(this.state.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        this.showToast('ส่งข้อมูลคำสั่งไปยังระบบคลาวด์เรียบร้อย', 'info');
        setTimeout(() => this.syncData(), 1500);
        return;
      } else if (this.state.dbDriver === 'cloudflare') {
        let url, payload;
        if (type === 'visits') {
          if (actionType === 'save') {
            url = '/api/saveVisit';
            payload = recordOrId;
          } else {
            url = '/api/deleteVisit';
            payload = { id: recordOrId };
          }
        } else if (type === 'staffs') {
          if (actionType === 'save') {
            url = '/api/saveStaff';
            payload = recordOrId;
          } else {
            url = '/api/deleteStaff';
            payload = { username: recordOrId };
          }
        } else if (type === 'logs') {
          if (actionType === 'save') {
            url = '/api/saveLog';
            payload = recordOrId;
          } else {
            url = '/api/clearLogs';
            payload = {};
          }
        }

        const response = await fetch((this.apiBaseUrl || '') + url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'เซิร์ฟเวอร์ Cloudflare ขัดข้อง');
        }

        const res = await response.json();
        if (res.status !== 'success') {
          throw new Error(res.message || 'บันทึกข้อมูลไม่สำเร็จ');
        }

        this.showToast('บันทึกข้อมูลผ่าน Cloudflare D1 สำเร็จ', 'success');
        this.syncData();
        return;
      }
      
      this.renderAllDataUI();
    } catch (error) {
      console.error(error);
      this.showToast(`บันทึกข้อมูลไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * เพิ่มประวัติการทำงาน (Audit Log)
   */
  async addAuditLog(eventText, targetInfo = '') {
    const logEntry = {
      id: 'log_' + Date.now(),
      timestamp: new Date().toISOString(),
      user: this.state.currentUser ? `${this.state.currentUser.fullname} (${this.state.currentUser.username})` : 'System/Guest',
      event: eventText,
      target: targetInfo
    };

    const newLogs = [logEntry, ...this.state.logs].slice(0, 100); // เก็บไว้สูงสุด 100 รายการเพื่อความเร็ว
    this.state.logs = newLogs;

    if (this.state.dbDriver === 'local') {
      localStorage.setItem('ltc_local_logs', JSON.stringify(newLogs));
      this.renderLogsTable();
    } else if (this.state.dbDriver === 'sheets') {
      try {
        await fetch(this.state.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify({ action: 'saveLog', data: logEntry })
        });
      } catch (e) {
        console.error('Failed to log to Google Sheets', e);
      }
    }
  }

  /**
   * บันทึกกิจกรรมระบบย้อนหลัง (ตัวช่วยเรียก)
   */
  logSystemActivity(user, action, text) {
    this.addAuditLog(action, text);
  }

  /**
   * ล้างประวัติ Log ทั้งหมด (แอดมินเท่านั้น)
   */
  async clearAuditLogs() {
    if (!confirm('คุณแน่ใจหรือไม่ที่จะลบประวัติการทำงานของระบบทั้งหมด? (ไม่สามารถกู้คืนได้)')) return;

    this.state.logs = [];
    if (this.state.dbDriver === 'local') {
      localStorage.setItem('ltc_local_logs', JSON.stringify([]));
      this.showToast('ลบประวัติกิจกรรมในระบบเรียบร้อยแล้ว', 'success');
      this.renderLogsTable();
    } else if (this.state.dbDriver === 'sheets') {
      this.showLoading(true, 'กำลังดำเนินการบนคลาวด์...');
      try {
        await fetch(this.state.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify({ action: 'clearLogs' })
        });
        this.showToast('ล้างประวัติการทำกิจกรรมบนคลาวด์สำเร็จ', 'success');
        setTimeout(() => this.syncData(), 1000);
      } catch (e) {
        this.showToast('ไม่สามารถสั่งการคลาวด์เพื่อลบ Logs', 'error');
      } finally {
        this.showLoading(false);
      }
    }
  }

  /**
   * ตรวจสอบเซสชันผู้ใช้งาน
   */
  checkSession() {
    const rawUser = sessionStorage.getItem('ltc_session_user') || localStorage.getItem('ltc_remembered_user');
    if (rawUser) {
      const user = JSON.parse(rawUser);
      // ตรวจสอบว่ายังมีตัวตนอยู่ในระบบหรือไม่
      const exist = this.state.staffs.find(s => s.username === user.username);
      if (exist) {
        this.state.currentUser = exist;
        this.onLoginSuccess();
        return;
      }
    }
    
    // หากไม่มีหรือเข้าสู่ระบบล้มเหลวให้แสดงหน้าล็อคอิน
    this.state.currentUser = null;
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('guest-container').classList.remove('hidden');
    this.switchGuestView('login');
  }

  /**
   * เมื่อเข้าสู่ระบบสำเร็จ
   */
  onLoginSuccess() {
    document.getElementById('guest-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    // ตั้งค่าสไตล์ข้อมูลผู้ใช้ใน Sidebar
    document.getElementById('user-name-desktop').textContent = this.state.currentUser.fullname;
    document.getElementById('user-role-desktop').textContent = this.state.currentUser.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'เจ้าหน้าที่ดูแล (CG)';
    
    // ปรับการย่อหน้าสัญลักษณ์ย่อตัวแทนชื่อ
    const nameInitials = this.state.currentUser.fullname.substring(0, 2);
    document.getElementById('user-avatar-desktop').textContent = nameInitials;

    // หากเป็น Admin ให้แสดงปุ่มเมนูจัดการเจ้าหน้าที่และ Log
    const adminLink = document.getElementById('nav-admin-link');
    const logsLink = document.getElementById('nav-logs-link');
    const careplanLink = document.getElementById('nav-careplan-link');
    const dbSettingsLink = document.getElementById('nav-db-settings-link');
    const mobileCareplanLink = document.getElementById('mobile-nav-careplan-link');
    const mobileAdminLink = document.getElementById('mobile-nav-admin-link');
    const mobileDbSettingsLink = document.getElementById('mobile-nav-db-settings-link');
    const mobileLogsLink = document.getElementById('mobile-nav-logs-link');
    const exportExcelBtn = document.getElementById('btn-export-excel');
    const addCarePlanBtn = document.getElementById('btn-add-careplan-new');
    
    if (this.state.currentUser.role === 'admin') {
      if (adminLink) adminLink.classList.remove('hidden');
      if (logsLink) logsLink.classList.remove('hidden');
      if (careplanLink) careplanLink.classList.remove('hidden');
      if (dbSettingsLink) dbSettingsLink.classList.remove('hidden');
      if (mobileCareplanLink) mobileCareplanLink.classList.remove('hidden');
      if (mobileAdminLink) mobileAdminLink.classList.remove('hidden');
      if (mobileDbSettingsLink) mobileDbSettingsLink.classList.remove('hidden');
      if (mobileLogsLink) mobileLogsLink.classList.remove('hidden');
      if (exportExcelBtn) exportExcelBtn.classList.remove('hidden');
      if (addCarePlanBtn) addCarePlanBtn.classList.remove('hidden');
    } else {
      if (adminLink) adminLink.classList.add('hidden');
      if (logsLink) logsLink.classList.add('hidden');
      if (careplanLink) careplanLink.classList.remove('hidden');
      if (dbSettingsLink) dbSettingsLink.classList.add('hidden');
      if (mobileCareplanLink) mobileCareplanLink.classList.remove('hidden');
      if (mobileAdminLink) mobileAdminLink.classList.add('hidden');
      if (mobileDbSettingsLink) mobileDbSettingsLink.classList.add('hidden');
      if (mobileLogsLink) mobileLogsLink.classList.add('hidden');
      if (exportExcelBtn) exportExcelBtn.classList.add('hidden');
      if (addCarePlanBtn) addCarePlanBtn.classList.add('hidden');
    }

    this.switchView('dashboard');
    this.addAuditLog('ผู้ใช้งานเข้าสู่ระบบ');
  }

  /**
   * ฟังก์ชันลงทะเบียนระบบสมาชิก / ล็อกอิน
   */
  handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('login-username').value.trim().toLowerCase();
    const pass = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;

    if (this.state.dbDriver === 'cloudflare' && (!this.state.staffs || this.state.staffs.length === 0)) {
      this.showToast('ไม่สามารถเข้าสู่ระบบได้ เนื่องจากระบบไม่ได้เชื่อมต่อกับระบบคลาวด์ D1', 'error');
      return;
    }

    // Ensure 'admin' user is always available with default password 'admin1234'
    const adminExists = this.state.staffs.some(s => s.username === 'admin');
    if (!adminExists) {
      this.state.staffs.push({ username: 'admin', fullname: 'ผู้ดูแลระบบสูงสุด (Admin)', password: 'admin1234', role: 'admin' });
    }

    const exist = this.state.staffs.find(s => s.username === user && s.password === pass);
    
    if (exist) {
      sessionStorage.setItem('ltc_session_user', JSON.stringify(exist));
      if (remember) {
        localStorage.setItem('ltc_remembered_user', JSON.stringify(exist));
      } else {
        localStorage.removeItem('ltc_remembered_user');
      }
      this.state.currentUser = exist;
      this.showToast('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ', 'success');
      this.onLoginSuccess();
    } else {
      this.showToast('รหัสเจ้าหน้าที่หรือรหัสผ่านไม่ถูกต้อง', 'error');
    }
  }

  handleRegister(e) {
    e.preventDefault();
    const user = document.getElementById('register-username').value.trim().toLowerCase();
    const name = document.getElementById('register-fullname').value.trim();
    const pass = document.getElementById('register-password').value;
    const role = document.getElementById('register-role').value;

    if (user.includes(' ') || user.length < 3) {
      this.showToast('รหัสเจ้าหน้าที่ต้องไม่มีช่องว่างและยาวมากกว่า 3 ตัวอักษร', 'warning');
      return;
    }

    if (pass.length < 4) {
      this.showToast('รหัสผ่านจำเป็นต้องมีความยาวอย่างน้อย 4 ตัวอักษรขึ้นไป', 'warning');
      return;
    }

    const exist = this.state.staffs.find(s => s.username === user);
    if (exist) {
      this.showToast('รหัสเจ้าหน้าที่นี้ถูกลงทะเบียนไว้ในระบบแล้ว', 'warning');
      return;
    }

    const newStaff = { username: user, fullname: name, password: pass, role: role };
    this.saveData('staffs', newStaff);
    this.showToast('สมัครสมาชิกเจ้าหน้าที่ใหม่สำเร็จแล้ว คุณสามารถเข้าสู่ระบบได้ทันที', 'success');
    this.switchGuestView('login');
    this.addAuditLog('ลงทะเบียนเจ้าหน้าที่ใหม่ผ่านระบบหน้าบ้าน', `${name} (${user})`);
  }

  handleForgotPassword(e) {
    e.preventDefault();
    const user = document.getElementById('forgot-username').value.trim().toLowerCase();
    const newPass = document.getElementById('forgot-new-password').value;
    const confirmPass = document.getElementById('forgot-confirm-password').value;

    if (newPass !== confirmPass) {
      this.showToast('การกรอกรหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน', 'warning');
      return;
    }

    if (newPass.length < 4) {
      this.showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร', 'warning');
      return;
    }

    const index = this.state.staffs.findIndex(s => s.username === user);
    if (index === -1) {
      this.showToast('ไม่พบรหัสเจ้าหน้าที่นี้ในระบบบันทึก', 'error');
      return;
    }

    const updatedStaff = { ...this.state.staffs[index], password: newPass };
    this.saveData('staffs', updatedStaff);
    this.showToast('รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าระบบด้วยรหัสผ่านใหม่', 'success');
    this.switchGuestView('login');
    this.addAuditLog('เจ้าหน้าที่ทำการเปลี่ยนรหัสผ่านผ่านระบบลืมรหัสผ่าน', user);
  }

  logout() {
    this.addAuditLog('ผู้ใช้งานออกจากระบบ');
    sessionStorage.removeItem('ltc_session_user');
    localStorage.removeItem('ltc_remembered_user');
    this.state.currentUser = null;
    
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('guest-container').classList.remove('hidden');
    this.switchGuestView('login');
  }

  /**
   * สลับระหว่างสกรีน Guest (Login / Register / Forgot)
   */
  switchGuestView(viewName) {
    document.querySelectorAll('.guest-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`guest-view-${viewName}`).classList.remove('hidden');
  }

  togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const container = input.closest('.relative');
    const icon = container ? container.querySelector('.toggle-password-icon') : null;

    if (input.type === 'password') {
      input.type = 'text';
      if (icon) {
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      }
    } else {
      input.type = 'password';
      if (icon) {
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    }
  }

  /**
   * สลับระหว่างมุมมองต่าง ๆ ในหน้าหลัก (Dashboard, Form, Admin, Config)
   */
  switchView(viewName) {
    // ปิดแผนที่และตัวสแกนกล้องเพื่อลดการประมวลผล
    this.stopQRScanner();

    // ซ่อนทุกหน้าจอ
    document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
    
    // แสดงหน้าจอที่เลือก
    const activePanel = document.getElementById(`view-${viewName}`);
    if (activePanel) activePanel.classList.remove('hidden');

    // ล้างและอัปเดตสไตล์ลิงก์แถบเมนูใน Sidebar
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('bg-white/10', 'border-l-4', 'border-secondary-500', 'pl-3');
      } else {
        link.classList.remove('bg-white/10', 'border-l-4', 'border-secondary-500', 'pl-3');
      }
    });

    // ล้างและอัปเดตแถบเมนูด้านล่างบนมือถือ
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('text-secondary-500', 'dark:text-secondary-400');
        link.classList.remove('text-slate-400', 'dark:text-slate-500');
      } else {
        link.classList.remove('text-secondary-500', 'dark:text-secondary-400');
        link.classList.add('text-slate-400', 'dark:text-slate-500');
      }
    });

    // ตั้งชื่อหัวเรื่องด้านบนบาร์
    const titles = {
      'dashboard': 'หน้าแรก & แผงสถิติรายงาน',
      'ltc-form': this.state.selectedVisitId ? 'แก้ไขรายงานการเยี่ยมบ้าน' : 'บันทึกข้อมูลเยี่ยมบ้านผู้รับบริการ',
      'careplan': 'ระบบจัดการและแนบเอกสาร Care plan',
      'admin': 'ระบบจัดการบัญชีเจ้าหน้าที่',
      'db-settings': 'ตั้งค่าเชื่อมโยงคลาวด์ & LINE Notify',
      'logs': 'ประวัติการดำเนินกิจกรรมในระบบ'
    };
    
    const displayTitle = document.getElementById('page-title-display');
    if (displayTitle) displayTitle.textContent = titles[viewName] || 'ยินดีต้อนรับ';

    this.state.currentView = viewName;

    // โหลดฟังก์ชันเฉพาะมุมมอง
    if (viewName === 'dashboard') {
      this.renderVisitsTable();
      this.renderCharts();
      this.updateStatsCards();
    } else if (viewName === 'careplan') {
      this.renderCarePlanTable();
    } else if (viewName === 'admin') {
      this.renderStaffList();
    } else if (viewName === 'logs') {
      this.renderLogsTable();
    } else if (viewName === 'ltc-form') {
      this.initFormMap();
    }
  }

  /**
   * แสดง / ซ่อน ตัวชี้วัดสถานะโหลดข้อมูล
   */
  showLoading(show, message = 'กำลังโหลดข้อมูล...') {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (overlay) {
      if (show) {
        text.textContent = message;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
      } else {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
      }
    }
  }

  /**
   * แจ้งเตือนสไลด์สั้นๆ (Toast Notification)
   */
  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'animate-fade-in flex items-center p-4 rounded-xl shadow-lg border text-sm font-semibold pointer-events-auto transition duration-300 transform translate-y-0';
    
    const icons = {
      'success': '<i class="fa-solid fa-circle-check text-emerald-500 text-lg mr-2.5 shrink-0"></i>',
      'error': '<i class="fa-solid fa-circle-xmark text-rose-500 text-lg mr-2.5 shrink-0"></i>',
      'warning': '<i class="fa-solid fa-triangle-exclamation text-amber-500 text-lg mr-2.5 shrink-0"></i>',
      'info': '<i class="fa-solid fa-circle-info text-blue-500 text-lg mr-2.5 shrink-0"></i>'
    };

    const bgColors = {
      'success': 'bg-white dark:bg-slate-900 border-emerald-100 dark:border-emerald-950 text-slate-800 dark:text-slate-100',
      'error': 'bg-white dark:bg-slate-900 border-rose-100 dark:border-rose-950 text-slate-800 dark:text-slate-100',
      'warning': 'bg-white dark:bg-slate-900 border-amber-100 dark:border-amber-950 text-slate-800 dark:text-slate-100',
      'info': 'bg-white dark:bg-slate-900 border-blue-100 dark:border-blue-950 text-slate-800 dark:text-slate-100'
    };

    toast.innerHTML = `
      <div class="flex items-center">
        ${icons[type] || ''}
        <span>${message}</span>
      </div>
      <button onclick="this.parentElement.remove()" class="ml-auto pl-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;

    toast.className += ' ' + (bgColors[type] || '');
    container.appendChild(toast);

    // ลบการแจ้งเตือนอัตโนมัติภายใน 4 วินาที
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /**
   * อัปเดตข้อมูลบน UI หน้าจอทั้งหมดหลังรีเฟรชข้อมูลสำเร็จ
   */
  renderAllDataUI() {
    this.updateStatsCards();
    if (this.state.currentView === 'dashboard') {
      this.renderVisitsTable();
      this.renderCharts();
    } else if (this.state.currentView === 'careplan') {
      this.renderCarePlanTable();
    } else if (this.state.currentView === 'admin') {
      this.renderStaffList();
    } else if (this.state.currentView === 'logs') {
      this.renderLogsTable();
    }
  }

  /**
   * จัดการระดับสถิติภาพรวมผู้รับบริการและการตรวจเยี่ยม
   */
  updateStatsCards() {
    const isAdmin = this.state.currentUser && this.state.currentUser.role === 'admin';
    const adminContainer = document.getElementById('stats-container-admin');
    const cgContainer = document.getElementById('stats-container-cg');

    if (isAdmin) {
      if (adminContainer) adminContainer.style.display = '';
      if (cgContainer) cgContainer.style.display = 'none';

      // 1. จำนวนผู้มีภาวะพึ่งพิง/Care plan (นับคนไม่ซ้ำกันที่มีการแนบไฟล์ใน photos)
      const patientsWithCarePlan = this.state.visits.filter(v => v.photos && v.photos.length > 0);
      const patientNames = patientsWithCarePlan.map(v => `${v.patientTitle}${v.patientFirstname} ${v.patientLastname}`);
      const uniquePatients = [...new Set(patientNames)].length;
      const statTotalPatients = document.getElementById('stat-total-patients');
      if (statTotalPatients) statTotalPatients.textContent = uniquePatients;

      // 2. จำนวนครั้งเยี่ยมทั้งหมด
      const statTotalVisits = document.getElementById('stat-total-visits');
      if (statTotalVisits) statTotalVisits.textContent = this.state.visits.length;

      // 3. เจ้าหน้าที่ทั้งหมด
      const statTotalStaff = document.getElementById('stat-total-staff');
      if (statTotalStaff) statTotalStaff.textContent = this.state.staffs.length;

      // 4. เยี่ยมวันนี้
      const todayStr = new Date().toISOString().split('T')[0];
      const todayVisits = this.state.visits.filter(v => v.visitDate === todayStr).length;
      const statDailyVisits = document.getElementById('stat-daily-visits');
      if (statDailyVisits) statDailyVisits.textContent = todayVisits;

      // 5. เยี่ยมเดือนนี้
      const currentMonthStr = todayStr.substring(0, 7); // yyyy-mm
      const monthlyVisits = this.state.visits.filter(v => v.visitDate && v.visitDate.substring(0, 7) === currentMonthStr).length;
      const statMonthlyVisits = document.getElementById('stat-monthly-visits');
      if (statMonthlyVisits) statMonthlyVisits.textContent = monthlyVisits;

      // 6. เยี่ยมปีงบประมาณนี้
      const currentYearStr = todayStr.substring(0, 4);
      const yearlyVisits = this.state.visits.filter(v => v.visitDate && v.visitDate.substring(0, 4) === currentYearStr).length;
      const statYearlyVisits = document.getElementById('stat-yearly-visits');
      if (statYearlyVisits) statYearlyVisits.textContent = yearlyVisits;
    } else {
      if (adminContainer) adminContainer.style.display = 'none';
      if (cgContainer) cgContainer.style.display = '';

      const myUsername = this.state.currentUser ? this.state.currentUser.username : '';
      const myVisits = this.state.visits.filter(v => v.cgUsername === myUsername);

      // 1. ผู้รับบริการในความดูแล (นับคนไม่ซ้ำจาก myVisits)
      const myPatientNames = myVisits.map(v => `${v.patientTitle}${v.patientFirstname} ${v.patientLastname}`);
      const uniqueMyPatients = [...new Set(myPatientNames)].length;
      const statCgPatients = document.getElementById('stat-cg-patients');
      if (statCgPatients) statCgPatients.textContent = uniqueMyPatients;

      // 2. จำนวนครั้ง / เดือน (visits in current month for this CG)
      const todayStr = new Date().toISOString().split('T')[0];
      const currentMonthStr = todayStr.substring(0, 7); // yyyy-mm
      const myMonthlyVisits = myVisits.filter(v => v.visitDate && v.visitDate.substring(0, 7) === currentMonthStr);
      const statCgVisitsMonth = document.getElementById('stat-cg-visits-month');
      if (statCgVisitsMonth) statCgVisitsMonth.textContent = myMonthlyVisits.length;

      // 3. จำนวนชั่วโมง / เดือน (sum of visitDuration in current month for this CG, converted to hours)
      const myMonthlyDurationMinutes = myMonthlyVisits.reduce((sum, v) => sum + (parseInt(v.visitDuration) || 0), 0);
      const myMonthlyDurationHours = parseFloat((myMonthlyDurationMinutes / 60).toFixed(1));
      const statCgHoursMonth = document.getElementById('stat-cg-hours-month');
      if (statCgHoursMonth) statCgHoursMonth.textContent = myMonthlyDurationHours;

      // 4. จำนวนครั้ง / ปี (visits in current year for this CG)
      const currentYearStr = todayStr.substring(0, 4); // yyyy
      const myYearlyVisitsCount = myVisits.filter(v => v.visitDate && v.visitDate.substring(0, 4) === currentYearStr).length;
      const statCgVisitsYear = document.getElementById('stat-cg-visits-year');
      if (statCgVisitsYear) statCgVisitsYear.textContent = myYearlyVisitsCount;
    }
  }

  /**
   * ค้นหาและสร้างรายการปีลงในตัวกรอง (พ.ศ.)
   */
  populateYearFilter() {
    const filterYear = document.getElementById('filter-visit-year');
    if (!filterYear) return;
    
    // ล้างตัวกรองปียกเว้นตัวเลือกแรก
    filterYear.innerHTML = '<option value="">ทุกปี</option>';
    
    // คัดกรองปี ค.ศ. ทั้งหมดจากข้อมูลรายงาน
    const years = this.state.visits.map(v => v.visitDate ? v.visitDate.substring(0, 4) : '').filter(y => y !== '');
    const uniqueYears = [...new Set(years)].sort((a,b) => b - a);
    
    uniqueYears.forEach(year => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = parseInt(year) + 543; // แปลงเป็น พ.ศ.
      filterYear.appendChild(option);
    });
  }

  /**
   * คำนวณช่วงเวลาการเยี่ยมและอัปเดตลง UI ฟอร์ม
   */
  calculateDuration() {
    const startInput = document.getElementById('visit-time-start').value;
    const endInput = document.getElementById('visit-time-end').value;
    const durationDisplay = document.getElementById('visit-duration-display');
    const durationMinutes = document.getElementById('visit-duration-minutes');

    if (!startInput || !endInput) {
      if (durationDisplay) durationDisplay.value = '';
      if (durationMinutes) durationMinutes.value = '0';
      return;
    }

    const [startH, startM] = startInput.split(':').map(Number);
    const [endH, endM] = endInput.split(':').map(Number);

    let diffMinutes = (endH * 60 + endM) - (startH * 60 + startM);

    if (diffMinutes < 0) {
      // ข้ามคืน (สมมติว่ามีการเยี่ยมสูงสุดไม่เกิน 24 ชั่วโมง)
      diffMinutes += 24 * 60;
    }

    const text = this.formatDurationText(diffMinutes);

    if (durationMinutes) {
      durationMinutes.value = diffMinutes;
    }

    if (durationDisplay) {
      durationDisplay.value = text;
      durationDisplay.setAttribute('title', text);
    }
  }

  /**
   * ระบบวิเคราะห์ระดับความดันโลหิตอัตโนมัติขณะกรอกข้อมูล
   */
  analyzeBloodPressure() {
    const systolic = parseInt(document.getElementById('bp-systolic').value);
    const diastolic = parseInt(document.getElementById('bp-diastolic').value);
    const resultCard = document.getElementById('bp-analysis-card');
    const resultText = document.getElementById('bp-analysis-text');

    if (isNaN(systolic) || isNaN(diastolic)) {
      resultCard.className = "bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 min-h-[42px]";
      resultText.textContent = "กรอกค่าเพื่อวิเคราะห์ความดัน";
      return;
    }

    let status = '';
    let alertClass = '';

    // ระบบวิเคราะห์ระดับความดันโลหิตตามแนวทางมาตรฐานสมาคมความดันโลหิตสูงแห่งประเทศไทย
    if (systolic >= 180 || diastolic >= 110) {
      status = 'ความดันสูงรุนแรงวิกฤต (ควรส่งต่อแพทย์ด่วน!)';
      alertClass = 'bg-red-500 text-white border-red-600 pulse-critical';
    } else if ((systolic >= 160 && systolic <= 179) || (diastolic >= 100 && diastolic <= 109)) {
      status = 'ความดันโลหิตสูง ระยะที่ 2 (ควรพบแพทย์)';
      alertClass = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900';
    } else if ((systolic >= 140 && systolic <= 159) || (diastolic >= 90 && diastolic <= 99)) {
      status = 'ความดันโลหิตสูง ระยะที่ 1 (เฝ้าระวังใกล้ชิด)';
      alertClass = 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900';
    } else if ((systolic >= 130 && systolic <= 139) || (diastolic >= 85 && diastolic <= 89)) {
      status = 'ความดันโลหิตค่อนข้างสูง (High-Normal)';
      alertClass = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900';
    } else if ((systolic >= 120 && systolic <= 129) || (diastolic >= 80 && diastolic <= 84)) {
      status = 'ความดันโลหิตปกติ';
      alertClass = 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-450 dark:border-green-900';
    } else if (systolic <= 80 || diastolic <= 60) {
      status = 'ความดันต่ำผิดปกติ (เฝ้าระวังอาการแสดงด่วน!)';
      alertClass = 'bg-blue-600 text-white border-blue-700 pulse-critical';
    } else {
      status = 'ความดันเริ่มต่ำ';
      alertClass = 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900';
    }

    resultCard.className = `border rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 min-h-[42px] transition-all duration-300 ${alertClass}`;
    resultText.textContent = `${status} (${systolic}/${diastolic} mmHg)`;
  }

  getBPLevelText(systolic, diastolic) {
    if (systolic >= 180 || diastolic >= 110) return 'ความดันสูงรุนแรงวิกฤต';
    if ((systolic >= 160 && systolic <= 179) || (diastolic >= 100 && diastolic <= 109)) return 'ความดันสูงระยะที่ 2';
    if ((systolic >= 140 && systolic <= 159) || (diastolic >= 90 && diastolic <= 99)) return 'ความดันสูงระยะที่ 1';
    if ((systolic >= 130 && systolic <= 139) || (diastolic >= 85 && diastolic <= 89)) return 'ค่อนข้างสูง';
    if ((systolic >= 120 && systolic <= 129) || (diastolic >= 80 && diastolic <= 84)) return 'ปกติ';
    if (systolic <= 80 || diastolic <= 60) return 'ความดันต่ำผิดปกติ';
    return 'ความดันเริ่มต่ำ';
  }

  getBPLevelBadge(systolic, diastolic) {
    const text = this.getBPLevelText(systolic, diastolic);
    let classes = '';
    
    if (text === 'ความดันสูงรุนแรงวิกฤต') classes = 'bg-red-500 text-white';
    else if (text === 'ความดันสูงระยะที่ 2') classes = 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300';
    else if (text === 'ความดันสูงระยะที่ 1') classes = 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    else if (text === 'ค่อนข้างสูง') classes = 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    else if (text === 'ปกติ') classes = 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    else if (text === 'ความดันต่ำผิดปกติ') classes = 'bg-blue-600 text-white';
    else if (text === 'ความดันเริ่มต่ำ') classes = 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300';
    else classes = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';

    return `<span class="px-2 py-0.5 rounded text-[11px] font-bold ${classes}">${text}</span>`;
  }

  /**
   * ดึงประเภทของไฟล์จาก Base64 string
   */
  getFileTypeFromBase64(base64) {
    if (!base64 || typeof base64 !== 'string') return { isImage: false, label: 'ไฟล์', icon: 'fa-file', color: 'text-slate-500' };
    if (base64.startsWith('data:image/')) {
      return { isImage: true, label: 'รูปภาพ', icon: 'fa-image', color: 'text-blue-500' };
    }
    if (base64.startsWith('data:application/pdf')) {
      return { isImage: false, label: 'เอกสาร PDF', icon: 'fa-file-pdf', color: 'text-rose-500' };
    }
    if (base64.startsWith('data:application/vnd.openxmlformats-officedocument.wordprocessingml') || base64.startsWith('data:application/msword')) {
      return { isImage: false, label: 'เอกสาร Word', icon: 'fa-file-word', color: 'text-blue-500' };
    }
    if (base64.startsWith('data:application/vnd.openxmlformats-officedocument.spreadsheetml') || base64.startsWith('data:application/vnd.ms-excel')) {
      return { isImage: false, label: 'เอกสาร Excel', icon: 'fa-file-excel', color: 'text-emerald-500' };
    }
    if (base64.startsWith('data:application/')) {
      return { isImage: false, label: 'ไฟล์เอกสาร', icon: 'fa-file-lines', color: 'text-slate-500' };
    }
    // Fallback for backward compatibility (assume image if not matching data:application)
    return { isImage: true, label: 'รูปภาพ', icon: 'fa-image', color: 'text-blue-500' };
  }

  /**
   * ดึงนามสกุลไฟล์จาก Base64 string
   */
  getFileExtensionFromBase64(base64) {
    if (!base64 || typeof base64 !== 'string') return 'bin';
    const match = base64.match(/^data:(.*);base64,/);
    if (!match) return 'bin';
    const mime = match[1];
    switch (mime) {
      case 'application/pdf': return 'pdf';
      case 'application/msword': return 'doc';
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx';
      case 'application/vnd.ms-excel': return 'xls';
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'xlsx';
      case 'image/jpeg': return 'jpg';
      case 'image/png': return 'png';
      case 'image/gif': return 'gif';
      case 'image/webp': return 'webp';
      default: return 'bin';
    }
  }

  /**
   * แปลง Base64 เป็น Blob URL เพื่อแก้ปัญหามองไม่เห็นไฟล์ PDF ใน iframe
   */
  base64ToBlobUrl(base64) {
    try {
      const parts = base64.split(';base64,');
      const contentType = parts[0].split(':')[1];
      const raw = window.atob(parts[1]);
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);
      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }
      const blob = new Blob([uInt8Array], { type: contentType });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error('Failed to convert base64 to Blob URL:', e);
      return base64; // fallback to data URL
    }
  }

  formatDurationText(minutes) {
    const minsVal = parseInt(minutes) || 0;
    if (minsVal <= 0) return '0 นาที';
    const hours = Math.floor(minsVal / 60);
    const mins = minsVal % 60;
    
    let text = '';
    if (hours > 0) text += `${hours} ชั่วโมง `;
    if (mins > 0 || hours === 0) text += `${mins} นาที`;
    return text.trim();
  }

  formatDurationShort(minutes) {
    const minsVal = parseInt(minutes) || 0;
    if (minsVal <= 0) return '0 น.';
    const hours = Math.floor(minsVal / 60);
    const mins = minsVal % 60;
    
    let text = '';
    if (hours > 0) text += `${hours} ชม. `;
    if (mins > 0) text += `${mins} น.`;
    return text.trim();
  }

  /**
   * อ่านไฟล์แบบ Asynchronous เป็น Base64 string
   */
  readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target.result);
      };
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * ระบบแนบรูปภาพ บีบอัดรูปภาพด้วย HTML5 Canvas
   */
  handlePhotoSelection(e) {
    const files = e.target.files;
    this.processPhotos(files);
  }

  async processPhotos(files) {
    if (this.state.currentPhotos.length + files.length > 3) {
      this.showToast('คุณสามารถแนบรูปภาพหรือไฟล์แนบรวมกันได้สูงสุดเพียง 3 ไฟล์เท่านั้น', 'warning');
      return;
    }

    this.showLoading(true, 'กำลังดำเนินการประมวลผลไฟล์...');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      const isImage = file.type.match('image.*');
      const isDoc = file.type === 'application/pdf' ||
                    file.type === 'application/msword' ||
                    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                    file.type === 'application/vnd.ms-excel' ||
                    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const ext = file.name.split('.').pop().toLowerCase();
      const isAllowedExt = ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext);

      if (!isImage && !isDoc && !isAllowedExt) {
        this.showToast(`ไม่รองรับไฟล์ประเภท .${ext} กรุณาแนบรูปภาพหรือไฟล์เอกสาร (PDF, Word, Excel)`, 'warning');
        continue;
      }

      const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
      if (file.size > MAX_FILE_SIZE) {
        this.showToast(`ไฟล์ ${file.name} มีขนาดใหญ่เกินไป (จำกัดไม่เกิน 4MB)`, 'warning');
        continue;
      }

      try {
        if (isImage) {
          const compressedBase64 = await this.compressImageFile(file);
          this.state.currentPhotos.push(compressedBase64);
        } else {
          const docBase64 = await this.readFileAsBase64(file);
          this.state.currentPhotos.push(docBase64);
        }
      } catch (err) {
        console.error(err);
        this.showToast(`เกิดความผิดพลาดในการประมวลผลไฟล์ ${file.name}`, 'error');
      }
    }

    this.showLoading(false);
    this.renderPhotoPreviews();
  }

  compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // กำหนดขนาดสูงสุดของรูปที่จะบีบอัด เพื่อให้อ่านตัวหนังสือบนเอกสารได้ชัดเจน (กว้าง/สูงไม่เกิน 2048px)
          const MAX_SIZE = 2048;
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // ส่งออกเป็น Base64 ที่คงความชัดเจนสูง (Quality = 0.9)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('โหลดไฟล์ภาพไม่สำเร็จ'));
        img.src = event.target.result;
      };
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ภาพ'));
      reader.readAsDataURL(file);
    });
  }

  removePhoto(index) {
    this.state.currentPhotos.splice(index, 1);
    this.renderPhotoPreviews();
    this.showToast('นำไฟล์แนบที่เลือกออกแล้ว', 'info');
  }

  renderPhotoPreviews() {
    const container = document.getElementById('photo-preview-container');
    if (!container) return;

    container.innerHTML = '';
    this.state.currentPhotos.forEach((base64, index) => {
      const fileType = this.getFileTypeFromBase64(base64);
      const card = document.createElement('div');
      card.className = 'relative group aspect-video bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center p-2';
      
      let previewHtml = '';
      if (fileType.isImage) {
        previewHtml = `<img src="${base64}" class="w-full h-full object-cover">`;
      } else {
        previewHtml = `
          <div class="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
            <i class="fa-solid ${fileType.icon} text-3xl ${fileType.color || ''} mb-1"></i>
            <span class="text-[10px] font-semibold text-center truncate w-full px-2">${fileType.label}</span>
          </div>
        `;
      }

      card.innerHTML = `
        ${previewHtml}
        <button type="button" onclick="app.removePhoto(${index})" class="absolute top-1.5 right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md transition">
          <i class="fa-solid fa-xmark"></i>
        </button>
      `;
      container.appendChild(card);
    });
  }

  /**
   * ระบบดึงพิกัด Geolocation & แผนที่ Leaflet (Open Source Map)
   */
  getCurrentLocation() {
    if (!navigator.geolocation) {
      this.showToast('เบราว์เซอร์หรืออุปกรณ์ของคุณไม่สนับสนุน Geolocation API', 'error');
      return;
    }

    this.showLoading(true, 'กำลังดึงพิกัด GPS จากดาวเทียมและเสาสัญญาณ...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        document.getElementById('gps-lat').value = lat.toFixed(6);
        document.getElementById('gps-lng').value = lng.toFixed(6);
        
        this.showLoading(false);
        this.showToast('ดึงพิกัด GPS สำเร็จและปักหมุดในแผนที่แล้ว', 'success');

        // อัปเดตแผนที่
        this.updateFormMap(lat, lng);
      },
      (error) => {
        this.showLoading(false);
        let msg = 'ไม่สามารถดึงตำแหน่งได้';
        if (error.code === 1) msg = 'กรุณาอนุญาตการเข้าถึงสิทธิ์ตำแหน่งอุปกรณ์ (Permission Denied)';
        this.showToast(msg, 'warning');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  initFormMap() {
    // ปิดแผนที่เก่าหากมีอยู่
    if (this.state.leafletMap) {
      this.state.leafletMap.remove();
      this.state.leafletMap = null;
    }

    const latVal = parseFloat(document.getElementById('gps-lat').value);
    const lngVal = parseFloat(document.getElementById('gps-lng').value);

    // หากมีข้อมูลพิกัดอยู่แล้ว (เช่น ตอนแก้ไขฟอร์ม) ให้วาดทันที
    if (!isNaN(latVal) && !isNaN(lngVal)) {
      this.updateFormMap(latVal, lngVal);
    }
  }

  updateFormMap(lat, lng) {
    const mapPlaceholder = document.getElementById('map-placeholder');
    if (mapPlaceholder) mapPlaceholder.classList.add('hidden');

    if (!this.state.leafletMap) {
      // สร้างแผนที่ Leaflet ตั้งจุดศูนย์กลางพิกัด
      this.state.leafletMap = L.map('form-map').setView([lat, lng], 15);
      
      // ดึงแผ่นแผนที่ดาวเทียมไฮบริด Google Maps (ดาวเทียม + ภาษาไทย)
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: '&copy; Google Maps'
      }).addTo(this.state.leafletMap);

      // ปักหมุดพิกัดเริ่มต้น
      this.state.leafletMarker = L.marker([lat, lng]).addTo(this.state.leafletMap);
    } else {
      // เลื่อนตำแหน่งแผนที่และหมุดไปยังตำแหน่งใหม่
      this.state.leafletMap.setView([lat, lng], 15);
      this.state.leafletMarker.setLatLng([lat, lng]);
    }
  }

  /**
   * ระบบสแกน QR Code เพื่อดึงข้อมูลผู้รับบริการด่วนเข้าสู่แบบฟอร์ม
   */
  showQRScannerModal() {
    document.getElementById('modal-qrcode-scanner').classList.remove('hidden');
    this.startQRScanner();
  }

  closeQRScannerModal() {
    document.getElementById('modal-qrcode-scanner').classList.add('hidden');
    this.stopQRScanner();
  }

  startQRScanner() {
    const errorMsg = document.getElementById('qr-error-msg');
    if (errorMsg) errorMsg.classList.add('hidden');

    try {
      this.state.qrScanner = new Html5Qrcode("qr-reader");
      
      const config = { fps: 10, qrbox: { width: 200, height: 200 } };
      
      this.state.qrScanner.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          this.handleQRScanSuccess(decodedText);
        },
        (errorMessage) => {
          // สัญญาณแสกนไม่ติด (ปล่อยผ่าน ไม่ต้องขัดจังหวะหน้าจอ)
        }
      ).catch(err => {
        console.error(err);
        if (errorMsg) errorMsg.classList.remove('hidden');
      });
    } catch (e) {
      console.error(e);
      if (errorMsg) errorMsg.classList.remove('hidden');
    }
  }

  stopQRScanner() {
    if (this.state.qrScanner) {
      this.state.qrScanner.stop().then(() => {
        this.state.qrScanner = null;
      }).catch(err => {
        console.error('Failed to stop scanner', err);
      });
    }
  }

  handleQRScanSuccess(text) {
    this.closeQRScannerModal();
    
    // ตรวจสอบโครงสร้างข้อความ QR Code แนะนำ
    // LTC-PATIENT:Title,Firstname,Lastname,Age,AddressNo,Moo,Subdistrict,District,Province,Zipcode
    if (text.startsWith('LTC-PATIENT:')) {
      const parts = text.replace('LTC-PATIENT:', '').split(',');
      if (parts.length >= 4) {
        document.getElementById('patient-title').value = parts[0] || '';
        document.getElementById('patient-firstname').value = parts[1] || '';
        document.getElementById('patient-lastname').value = parts[2] || '';
        document.getElementById('patient-age').value = parts[3] || '';
        
        // ข้อมูลที่อยู่เสริม
        if (parts[4]) document.getElementById('address-no').value = parts[4];
        if (parts[5]) document.getElementById('address-moo').value = parts[5];
        if (parts[6]) document.getElementById('address-subdistrict').value = parts[6];
        if (parts[7]) document.getElementById('address-district').value = parts[7];
        if (parts[8]) document.getElementById('address-province').value = parts[8];
        if (parts[9]) document.getElementById('address-zip').value = parts[9];

        this.showToast('ดึงข้อมูลผู้รับบริการจาก QR Code สำเร็จ!', 'success');
        this.addAuditLog('สแกนดึงข้อมูลผู้ป่วยผ่าน QR Code', `${parts[1]} ${parts[2]}`);
      } else {
        this.showToast('ข้อมูลผู้ป่วยใน QR Code รูปแบบไม่ถูกต้อง', 'warning');
      }
    } else {
      // กรณีเป็นข้อความธรรมดา ให้สุ่มเอาไปใส่ในช่องรายละเอียดหรือชื่อเพื่อความสะดวก
      this.showToast(`สแกนพบข้อความทั่วไป: ${text}`, 'info');
    }
  }

  /**
   * การส่งแบบฟอร์มการตรวจเยี่ยมบ้าน LTC
   */
  async handleFormSubmit(e) {
    e.preventDefault();

    // ล็อคปุ่มป้องกันการส่งซ้ำสองครั้ง
    const btnSubmit = document.getElementById('btn-submit-form');
    btnSubmit.disabled = true;

    try {
      const recordId = document.getElementById('form-record-id').value;
      const isEdit = recordId !== '';

      const newRecord = {
        id: isEdit ? recordId : 'rec_' + Date.now(),
        patientTitle: document.getElementById('patient-title').value,
        patientFirstname: document.getElementById('patient-firstname').value.trim(),
        patientLastname: document.getElementById('patient-lastname').value.trim(),
        patientAge: parseInt(document.getElementById('patient-age').value),
        
        addressNo: document.getElementById('address-no').value.trim(),
        addressMoo: document.getElementById('address-moo').value.trim(),
        addressSubdistrict: document.getElementById('address-subdistrict').value.trim(),
        addressDistrict: document.getElementById('address-district').value.trim(),
        addressProvince: document.getElementById('address-province').value.trim(),
        addressZip: document.getElementById('address-zip').value.trim(),

        visitDate: document.getElementById('visit-date').value,
        visitTimeStart: document.getElementById('visit-time-start').value,
        visitTimeEnd: document.getElementById('visit-time-end').value,
        visitDuration: parseInt(document.getElementById('visit-duration-minutes').value) || 0,

        careDetails: document.getElementById('care-details').value.trim(),
        careActivities: document.getElementById('care-activities').value.trim(),

        bpSystolic: parseInt(document.getElementById('bp-systolic').value),
        bpDiastolic: parseInt(document.getElementById('bp-diastolic').value),
        bpAnalysis: this.getBPLevelText(
          parseInt(document.getElementById('bp-systolic').value),
          parseInt(document.getElementById('bp-diastolic').value)
        ),

        healthSymptoms: document.getElementById('health-symptoms').value.trim(),
        healthProblems: document.getElementById('health-problems').value.trim(),
        requestedItems: document.getElementById('requested-items').value.trim(),
        healthRemarks: document.getElementById('health-remarks').value.trim(),

        cgTitle: this.state.currentUser.fullname.startsWith('นาย') ? 'นาย' : (this.state.currentUser.fullname.startsWith('นางสาว') ? 'นางสาว' : 'นาง'),
        cgFirstname: this.state.currentUser.fullname,
        cgLastname: '', // โหลดเต็มในชื่อแรก
        cgUsername: this.state.currentUser.username,

        gpsLat: document.getElementById('gps-lat').value,
        gpsLng: document.getElementById('gps-lng').value,
        photos: (() => {
          let merged = [...this.state.currentPhotos];
          if (isEdit) {
            const oldRecord = this.state.visits.find(v => v.id === recordId);
            if (oldRecord && oldRecord.photos) {
              const oldPdfs = oldRecord.photos.filter(p => !this.getFileTypeFromBase64(p).isImage);
              merged = [...merged, ...oldPdfs];
            }
          }
          return merged;
        })(),
        lastUpdated: new Date().toISOString()
      };

      await this.saveData('visits', newRecord);

      // บันทึกกิจกรรมระบบ
      this.addAuditLog(
        isEdit ? 'แก้ไขข้อมูลรายงานการตรวจเยี่ยมผู้ป่วย' : 'สร้างรายงานบันทึกการตรวจเยี่ยมผู้ป่วยใหม่',
        `${newRecord.patientFirstname} ${newRecord.patientLastname}`
      );

      // ส่งข้อความแจ้งเตือน LINE
      this.triggerLineNotification(newRecord, isEdit);

      this.backToDashboard();
      this.showToast('บันทึกรายงานผลเยี่ยมบ้านสำเร็จ!', 'success');
      this.populateYearFilter();

    } catch (err) {
      console.error(err);
      this.showToast('เกิดความผิดพลาดในการส่งข้อมูลรายงาน', 'error');
    } finally {
      btnSubmit.disabled = false;
    }
  }

  /**
   * เปิดระบบแจ้งเตือน LINE Bot (Messaging API)
   */
  async triggerLineNotification(record, isEdit) {
    if (!this.state.lineToken || !this.state.lineGroupId) return;

    const message = `
📌 [รายงานเยี่ยมบ้าน LTC - ${isEdit ? 'แก้ไข' : 'บันทึกใหม่'}]
👤 ผู้รับบริการ: ${record.patientTitle}${record.patientFirstname} ${record.patientLastname} (อายุ ${record.patientAge} ปี)
📅 วันที่เยี่ยม: ${this.formatThaiDate(record.visitDate)}
⏰ เวลา: ${record.visitTimeStart} - ${record.visitTimeEnd} น. (${this.formatDurationText(record.visitDuration)})
🩺 ความดันโลหิต: ${record.bpSystolic}/${record.bpDiastolic} mmHg (${record.bpAnalysis})
👨‍⚕️ ผู้เยี่ยมดูแล: ${record.cgFirstname}
📍 พิกัด GPS: ${record.gpsLat || 'ไม่ได้บันทึก'}, ${record.gpsLng || 'ไม่ได้บันทึก'}
${record.requestedItems ? `📦 สิ่งของที่ต้องการเพิ่ม: ${record.requestedItems}` : ''}
    `.trim();

    // 1. ส่งผ่าน Google Sheets Cloud Bridge
    if (this.state.dbDriver === 'sheets') {
      try {
        await fetch(this.state.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify({
            action: 'sendLineMessage',
            token: this.state.lineToken,
            to: this.state.lineGroupId,
            message: message
          })
        });
      } catch (e) {
        console.error('Failed to send LINE notification via Apps Script', e);
      }
    } else if (this.state.dbDriver === 'cloudflare') {
      try {
        await fetch((this.apiBaseUrl || '') + '/api/sendLineNotify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: this.state.lineToken,
            message: message
          })
        });
      } catch (e) {
        console.error('Failed to send LINE notification via Cloudflare', e);
      }
    } else {
      // 2. โหมด Local Storage ให้แจ้งเป็นจำลองในหน้าคอนโซลและ Toast (เนื่องจากติด CORS จากเบราว์เซอร์หากส่งตรง)
      console.log('%c[LINE BOT SIMULATION]', 'color: #06c755; font-weight: bold;', message);
      this.showToast('จำลองส่งข้อความ LINE Bot สำเร็จ (ดูเนื้อหาใน Log บราวเซอร์)', 'info');
    }
  }

  /**
   * ลบรายงานรายงานเยี่ยมบ้าน (แอดมินหรือ CG ผู้สร้างเท่านั้น)
   */
  async deleteVisitRecord(id) {
    const target = this.state.visits.find(v => v.id === id);
    if (!target) return;

    if (this.state.currentUser.role !== 'admin') {
      this.showToast('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลรายงานได้', 'warning');
      return;
    }

    if (!confirm(`คุณแน่ใจหรือไม่ที่จะลบรายงานข้อมูลการเยี่ยมของ "${target.patientFirstname} ${target.patientLastname}"? (ไม่สามารถกู้คืนข้อมูลนี้ได้)`)) {
      return;
    }

    // ลง Log
    this.addAuditLog('ลบรายงานบันทึกการตรวจเยี่ยมผู้ป่วย', `${target.patientFirstname} ${target.patientLastname}`);
    
    // บันทึกและซิงค์
    await this.saveData('visits', id, 'delete');
    this.showToast('ลบรายการบันทึกเรียบร้อยแล้ว', 'success');
  }

  /**
   * เปิดแบบฟอร์มบันทึกข้อมูลเยี่ยมบ้าน
   */
  openLTCForm(recordId = null) {
    if (recordId && this.state.currentUser.role !== 'admin') {
      this.showToast('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลรายงานได้', 'warning');
      return;
    }
    this.state.selectedVisitId = recordId;
    this.state.currentPhotos = [];
    
    const formElement = document.getElementById('ltc-form-element');
    formElement.reset();
    
    document.getElementById('form-record-id').value = recordId || '';
    document.getElementById('gps-lat').value = '';
    document.getElementById('gps-lng').value = '';
    document.getElementById('visit-duration-display').value = '';
    if (document.getElementById('visit-duration-minutes')) {
      document.getElementById('visit-duration-minutes').value = '0';
    }
    
    // ล้างตัวชี้วัดความดัน
    const bpCard = document.getElementById('bp-analysis-card');
    bpCard.className = "bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 min-h-[42px]";
    document.getElementById('bp-analysis-text').textContent = "กรอกค่าเพื่อวิเคราะห์ความดัน";

    const titleElement = document.getElementById('form-title');

    if (recordId) {
      // โหมดแก้ไข - ดึงข้อมูลเก่ามาใส่ฟอร์ม
      const record = this.state.visits.find(v => v.id === recordId);
      if (record) {
        titleElement.textContent = 'แก้ไขข้อมูลการเยี่ยมบ้านผู้สูงอายุ/ผู้ป่วย';
        
        document.getElementById('patient-title').value = record.patientTitle || '';
        document.getElementById('patient-firstname').value = record.patientFirstname || '';
        document.getElementById('patient-lastname').value = record.patientLastname || '';
        document.getElementById('patient-age').value = record.patientAge || '';

        document.getElementById('address-no').value = record.addressNo || '';
        document.getElementById('address-moo').value = record.addressMoo || '';
        document.getElementById('address-subdistrict').value = record.addressSubdistrict || '';
        document.getElementById('address-district').value = record.addressDistrict || '';
        document.getElementById('address-province').value = record.addressProvince || '';
        document.getElementById('address-zip').value = record.addressZip || '';

        document.getElementById('visit-date').value = record.visitDate || '';
        document.getElementById('visit-time-start').value = record.visitTimeStart || '';
        document.getElementById('visit-time-end').value = record.visitTimeEnd || '';
        
        const durationMinutes = record.visitDuration || 0;
        if (document.getElementById('visit-duration-minutes')) {
          document.getElementById('visit-duration-minutes').value = durationMinutes;
        }
        document.getElementById('visit-duration-display').value = this.formatDurationText(durationMinutes);

        document.getElementById('care-details').value = record.careDetails || '';
        document.getElementById('care-activities').value = record.careActivities || '';

        document.getElementById('bp-systolic').value = record.bpSystolic || '';
        document.getElementById('bp-diastolic').value = record.bpDiastolic || '';
        this.analyzeBloodPressure();

        document.getElementById('health-symptoms').value = record.healthSymptoms || '';
        document.getElementById('health-problems').value = record.healthProblems || '';
        document.getElementById('requested-items').value = record.requestedItems || '';
        document.getElementById('health-remarks').value = record.healthRemarks || '';

        document.getElementById('gps-lat').value = record.gpsLat || '';
        document.getElementById('gps-lng').value = record.gpsLng || '';

        this.state.currentPhotos = (record.photos || []).filter(p => this.getFileTypeFromBase64(p).isImage);
        this.renderPhotoPreviews();
        this.syncCustomTimeSelects();
      }
    } else {
      // โหมดบันทึกใหม่
      titleElement.textContent = 'บันทึกข้อมูลการเยี่ยมบ้านผู้สูงอายุ/ผู้ป่วย (LTC)';
      
      // ตั้งค่าวันที่ปัจจุบันให้อัตโนมัติ
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('visit-date').value = today;

      // ตั้งค่าเวลาปัจจุบันแบบกลมๆ
      const now = new Date();
      const HH = String(now.getHours()).padStart(2, '0');
      const MM = String(now.getMinutes()).padStart(2, '0');
      document.getElementById('visit-time-start').value = `${HH}:${MM}`;
      
      // สิ้นสุดฟอร์มออโต้ 30 นาทีถัดไป
      const end = new Date(now.getTime() + 30 * 60 * 1000);
      const endHH = String(end.getHours()).padStart(2, '0');
      const endMM = String(end.getMinutes()).padStart(2, '0');
      document.getElementById('visit-time-end').value = `${endHH}:${endMM}`;
      
      this.calculateDuration();
      this.renderPhotoPreviews();
      this.syncCustomTimeSelects();
    }

    this.switchView('ltc-form');
  }

  backToDashboard() {
    this.state.selectedVisitId = null;
    this.switchView('dashboard');
  }

  renderVisitsTable() {
    const tbody = document.getElementById('table-visits-body');
    const emptyState = document.getElementById('table-visits-empty');
    if (!tbody) return;

    tbody.innerHTML = '';

    const isAdmin = this.state.currentUser && this.state.currentUser.role === 'admin';

    // Hide/show other filters for CG
    const cgWrapper = document.getElementById('filter-cg-wrapper');
    const dateWrapper = document.getElementById('filter-date-wrapper');
    const timeWrapper = document.getElementById('filter-time-wrapper');

    if (isAdmin) {
      if (cgWrapper) cgWrapper.style.display = '';
      if (dateWrapper) dateWrapper.style.display = '';
      if (timeWrapper) timeWrapper.style.display = '';
    } else {
      if (cgWrapper) cgWrapper.style.display = 'none';
      if (dateWrapper) dateWrapper.style.display = 'none';
      if (timeWrapper) timeWrapper.style.display = 'none';
    }

    // Toggle table title and headers
    const tableTitle = document.getElementById('table-visits-title');
    if (tableTitle) {
      tableTitle.textContent = isAdmin ? 'รายชื่อบันทึกการเยี่ยมบ้าน LTC' : 'รายการผู้ป่วยทั้งหมด';
    }

    const headersRow = document.getElementById('table-visits-headers');
    if (headersRow) {
      if (isAdmin) {
        headersRow.innerHTML = `
          <th class="p-4 font-semibold">ชื่อผู้รับบริการ / อายุ</th>
          <th class="p-4 font-semibold">วันที่เยี่ยม</th>
          <th class="p-4 font-semibold">ช่วงเวลา (ระยะเวลา)</th>
          <th class="p-4 font-semibold">ความดันโลหิต</th>
          <th class="p-4 font-semibold">ผู้บันทึก (CG)</th>
          <th class="p-4 font-semibold text-right">การจัดการ</th>
        `;
      } else {
        headersRow.innerHTML = `
          <th class="p-4 font-semibold">ชื่อผู้รับบริการ / อายุ</th>
          <th class="p-4 font-semibold">วันที่เยี่ยม</th>
          <th class="p-4 font-semibold">ช่วงเวลา (ระยะเวลา)</th>
          <th class="p-4 font-semibold">ความดันโลหิต</th>
          <th class="p-4 font-semibold text-right">การจัดการ</th>
        `;
      }
    }

    // โหลดเงื่อนไขการค้นหา/ตัวกรอง
    const searchPat = document.getElementById('search-patient-name').value.trim().toLowerCase();
    const searchCG = document.getElementById('search-cg-name') ? document.getElementById('search-cg-name').value.trim().toLowerCase() : '';
    const filterDate = document.getElementById('filter-visit-date') ? document.getElementById('filter-visit-date').value : '';
    const filterMonth = document.getElementById('filter-visit-month') ? document.getElementById('filter-visit-month').value : '';
    const filterYear = document.getElementById('filter-visit-year') ? document.getElementById('filter-visit-year').value : '';

    const filtered = this.state.visits.filter(v => {
      // For CG accounts, show only their own visitation logs
      if (!isAdmin) {
        const myUsername = this.state.currentUser ? this.state.currentUser.username : '';
        if (v.cgUsername !== myUsername) return false;
      }

      // 1. ค้นหาผู้รับบริการ
      const fullName = `${v.patientTitle || ''}${v.patientFirstname || ''} ${v.patientLastname || ''}`.toLowerCase();
      if (searchPat && !fullName.includes(searchPat)) return false;

      if (isAdmin) {
        // 2. ค้นหาชื่อ CG
        const cgName = `${v.cgTitle || ''}${v.cgFirstname || ''} ${v.cgLastname || ''}`.toLowerCase();
        if (searchCG && !cgName.includes(searchCG)) return false;

        // 3. กรองวันที่แบบเฉพาะเจาะจง
        if (filterDate && v.visitDate !== filterDate) return false;

        // 4. กรองเดือน
        if (filterMonth && v.visitDate && v.visitDate.substring(5,7) !== filterMonth) return false;

        // 5. กรองปี
        if (filterYear && v.visitDate && v.visitDate.substring(0,4) !== filterYear) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    filtered.forEach(v => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition duration-150 border-b border-slate-100 dark:border-slate-800';

      const patientName = `${v.patientTitle} ${v.patientFirstname} ${v.patientLastname}`;
      const cgFullName = `${v.cgFirstname} ${v.cgLastname || ''}`;
      const photosCount = v.photos ? v.photos.length : 0;
      
      if (isAdmin) {
        tr.innerHTML = `
          <td class="p-4">
            <div class="font-bold text-slate-900 dark:text-white">${patientName}</div>
            <div class="text-xs text-slate-400">อายุ ${v.patientAge} ปี</div>
          </td>
          <td class="p-4 font-medium text-slate-600 dark:text-slate-300">
            ${this.formatThaiDate(v.visitDate)}
          </td>
          <td class="p-4">
            <div class="text-slate-900 dark:text-white font-medium">${v.visitTimeStart} - ${v.visitTimeEnd} น.</div>
            <div class="text-xs text-slate-400">${this.formatDurationShort(v.visitDuration)}</div>
          </td>
          <td class="p-4">
            <div class="font-semibold text-slate-700 dark:text-slate-300">${v.bpSystolic}/${v.bpDiastolic}</div>
            <div>${this.getBPLevelBadge(v.bpSystolic, v.bpDiastolic)}</div>
          </td>
          <td class="p-4 text-xs font-medium text-slate-600 dark:text-slate-300">
            ${cgFullName}
          </td>
          <td class="p-4 text-right space-x-1 whitespace-nowrap">
            <button onclick="app.showReportDetailModal('${v.id}')" title="ดูรายละเอียดแบบพิมพ์รายงาน" class="bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 p-2 rounded-lg transition"><i class="fa-regular fa-eye"></i></button>
            <button onclick="app.openLTCForm('${v.id}')" title="แก้ไขข้อมูลรายงาน" class="bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 p-2 rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="app.deleteVisitRecord('${v.id}')" title="ลบข้อมูลบันทึก" class="bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-455 p-2 rounded-lg transition"><i class="fa-regular fa-trash-can"></i></button>
          </td>
        `;
      } else {
        tr.innerHTML = `
          <td class="p-4">
            <div class="font-bold text-slate-900 dark:text-white">${patientName}</div>
            <div class="text-xs text-slate-400">อายุ ${v.patientAge} ปี</div>
          </td>
          <td class="p-4 font-medium text-slate-600 dark:text-slate-300">
            ${this.formatThaiDate(v.visitDate)}
          </td>
          <td class="p-4">
            <div class="text-slate-900 dark:text-white font-medium">${v.visitTimeStart} - ${v.visitTimeEnd} น.</div>
            <div class="text-xs text-slate-400">${this.formatDurationShort(v.visitDuration)}</div>
          </td>
          <td class="p-4">
            <div class="font-semibold text-slate-700 dark:text-slate-300">${v.bpSystolic}/${v.bpDiastolic}</div>
            <div>${this.getBPLevelBadge(v.bpSystolic, v.bpDiastolic)}</div>
          </td>
          <td class="p-4 text-right space-x-1 whitespace-nowrap">
            <button onclick="app.showReportDetailModal('${v.id}')" title="ดูรายละเอียดแบบพิมพ์รายงาน" class="bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 p-2 rounded-lg transition"><i class="fa-regular fa-eye"></i></button>
          </td>
        `;
      }

      tbody.appendChild(tr);
    });
  }

  renderCarePlanTable() {
    const tbody = document.getElementById('table-careplan-body');
    const emptyState = document.getElementById('table-careplan-empty');
    if (!tbody) return;

    tbody.innerHTML = '';

    const searchVal = document.getElementById('search-careplan-patient') 
      ? document.getElementById('search-careplan-patient').value.trim().toLowerCase() 
      : '';

    const isAdmin = this.state.currentUser && this.state.currentUser.role === 'admin';

    const filtered = this.state.visits.filter(v => {
      // 1. ค้นหาชื่อผู้ป่วย
      const fullName = `${v.patientTitle || ''}${v.patientFirstname || ''} ${v.patientLastname || ''}`.toLowerCase();
      if (searchVal && !fullName.includes(searchVal)) return false;

      // 2. กรองเฉพาะบันทึกการเยี่ยมที่มีการแนบไฟล์ PDF Care Plan เท่านั้น
      const hasPdf = (v.photos || []).some(p => !this.getFileTypeFromBase64(p).isImage);
      if (!hasPdf) {
        // ค้นหาว่าในประวัติของผู้ป่วยรายนี้มีเรคคอร์ดอื่นๆ ที่มี PDF แนบอยู่หรือไม่
        const hasMatchPdf = this.state.visits.some(pv => 
          pv.patientFirstname.trim().toLowerCase() === v.patientFirstname.trim().toLowerCase() &&
          pv.patientLastname.trim().toLowerCase() === v.patientLastname.trim().toLowerCase() &&
          (pv.photos || []).some(p => !this.getFileTypeFromBase64(p).isImage)
        );
        if (!hasMatchPdf) return false;
      }

      return true;
    });
    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    // ยุบรวมให้เหลือ 1 แถวต่อ 1 ผู้ป่วยที่ไม่ซ้ำกัน
    const uniquePatients = [];
    const seen = new Set();
    filtered.forEach(v => {
      const key = `${v.patientFirstname.trim().toLowerCase()}_${v.patientLastname.trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePatients.push(v);
      }
    });

    uniquePatients.forEach(v => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition duration-150 border-b border-slate-100 dark:border-slate-800';

      const patientName = `${v.patientTitle} ${v.patientFirstname} ${v.patientLastname}`;
      const cgFullName = `${v.cgFirstname} ${v.cgLastname || ''}`;
      const pdfsOnly = (() => {
        const direct = (v.photos || []).filter(p => !this.getFileTypeFromBase64(p).isImage);
        if (direct.length > 0) return direct;
        
        // ค้นหาเอกสาร Care plan ของผู้ป่วยรายนี้จากบันทึกการเยี่ยมอื่นๆ (เช่น แอดมินเป็นผู้อัปโหลดแยกต่างหาก)
        const match = this.state.visits.find(pv => 
          pv.patientFirstname.trim().toLowerCase() === v.patientFirstname.trim().toLowerCase() &&
          pv.patientLastname.trim().toLowerCase() === v.patientLastname.trim().toLowerCase() &&
          (pv.photos || []).some(p => !this.getFileTypeFromBase64(p).isImage)
        );
        return match ? match.photos.filter(p => !this.getFileTypeFromBase64(p).isImage) : [];
      })();

      // แสดงรายการไฟล์ย่อๆ
      let filesListHtml = '';
      if (pdfsOnly.length > 0) {
        pdfsOnly.forEach((base64, index) => {
          const fileType = this.getFileTypeFromBase64(base64);
          const ext = this.getFileExtensionFromBase64(base64);
          const filename = `careplan_${v.patientFirstname || 'patient'}_${index + 1}.${ext}`;
          filesListHtml += `
            <a href="${base64}" download="${filename}" class="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-1 rounded text-xs transition border border-slate-200 dark:border-slate-700 shadow-sm" title="${fileType.label}">
              <i class="fa-solid ${fileType.icon} ${fileType.color || ''}"></i>
              <span class="font-bold text-[10px] uppercase">${ext}</span>
            </a>
          `;
        });
      } else {
        filesListHtml = '<span class="text-xs text-slate-400 italic">ไม่มีไฟล์แนบ</span>';
      }

      const manageBtn = isAdmin ? `
        <div class="flex justify-end gap-1.5">
          <button onclick="app.openCarePlanModal('${v.id}')" title="จัดการไฟล์ Care plan" class="bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 p-2 rounded-lg transition"><i class="fa-solid fa-paperclip"></i></button>
          <button onclick="app.openNewCarePlanModal('${v.id}')" title="แก้ไขข้อมูลผู้ป่วย" class="bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 p-2 rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="app.deleteVisitRecord('${v.id}')" title="ลบข้อมูลบันทึก" class="bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-455 p-2 rounded-lg transition"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      ` : `
        <div class="flex justify-end gap-1.5">
          <button onclick="app.openCarePlanModal('${v.id}', true)" title="ดูไฟล์ Care plan" class="bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 p-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"><i class="fa-regular fa-eye"></i> ดูไฟล์</button>
        </div>
      `;

      tr.innerHTML = `
        <td class="p-4">
          <div class="font-bold text-slate-900 dark:text-white">${patientName}</div>
          <div class="text-xs text-slate-400">อายุ ${v.patientAge} ปี</div>
        </td>
        <td class="p-4 font-medium text-slate-600 dark:text-slate-300">
          ${this.formatThaiDate(v.visitDate)}
        </td>
        <td class="p-4 text-xs font-medium text-slate-600 dark:text-slate-300">
          ${cgFullName}
        </td>
        <td class="p-4 text-center space-x-1.5">
          ${filesListHtml}
        </td>
        <td class="p-4 text-right">
          ${manageBtn}
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  renderCharts() {
    if (typeof Chart === 'undefined') return;

    const isAdmin = this.state.currentUser && this.state.currentUser.role === 'admin';
    const chartsContainer = document.getElementById('charts-container');
    
    if (!isAdmin) {
      if (chartsContainer) chartsContainer.style.display = 'none';
      return;
    } else {
      if (chartsContainer) chartsContainer.style.display = '';
    }

    // 1. ดำเนินการสร้างข้อมูลสถิติรายเดือน / รายปี
    const visitCountsByMonth = {};
    const visitCountsByYear = {};
    const visitCountsByCG = {};

    this.state.visits.forEach(v => {
      if (!v.visitDate) return;
      const month = v.visitDate.substring(0, 7); // yyyy-mm
      const year = v.visitDate.substring(0, 4); // yyyy
      const cg = `${v.cgFirstname} ${v.cgLastname || ''}`;

      visitCountsByMonth[month] = (visitCountsByMonth[month] || 0) + 1;
      visitCountsByYear[year] = (visitCountsByYear[year] || 0) + 1;
      visitCountsByCG[cg] = (visitCountsByCG[cg] || 0) + 1;
    });

    // คัดแยกเรียงลำดับเดือน
    const sortedMonths = Object.keys(visitCountsByMonth).sort();
    const thaiMonthsLabel = sortedMonths.map(m => {
      const [y, mStr] = m.split('-');
      const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      return `${monthNames[parseInt(mStr)-1]} ${parseInt(y)+543}`;
    });

    const sortedYears = Object.keys(visitCountsByYear).sort();
    const thaiYearsLabel = sortedYears.map(y => parseInt(y) + 543);

    // --- กราฟที่ 1: สถิติการเยี่ยมตามวันเวลา (Bar/Line Chart) ---
    const ctxTime = document.getElementById('chart-visits-time').getContext('2d');
    if (this.state.chartVisitsTime) this.state.chartVisitsTime.destroy();

    const chartDataLabels = this.state.activeVisitChartType === 'monthly' ? thaiMonthsLabel : thaiYearsLabel;
    const chartDataValues = this.state.activeVisitChartType === 'monthly' 
      ? sortedMonths.map(m => visitCountsByMonth[m]) 
      : sortedYears.map(y => visitCountsByYear[y]);

    this.state.chartVisitsTime = new Chart(ctxTime, {
      type: 'bar',
      data: {
        labels: chartDataLabels.length > 0 ? chartDataLabels : ['ไม่มีข้อมูล'],
        datasets: [{
          label: 'จำนวนการลงเยี่ยมบ้าน (ครั้ง)',
          data: chartDataValues.length > 0 ? chartDataValues : [0],
          backgroundColor: '#0ea5e9', // ฟ้า
          borderRadius: 8,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });

    // --- กราฟที่ 2: อัตราการเยี่ยมของเจ้าหน้าที่ CG (Doughnut Chart) ---
    const ctxCG = document.getElementById('chart-visits-cg').getContext('2d');
    if (this.state.chartVisitsCG) this.state.chartVisitsCG.destroy();

    const cgLabels = Object.keys(visitCountsByCG);
    const cgValues = Object.values(visitCountsByCG);

    this.state.chartVisitsCG = new Chart(ctxCG, {
      type: 'doughnut',
      data: {
        labels: cgLabels.length > 0 ? cgLabels : ['ไม่มีข้อมูล'],
        datasets: [{
          data: cgValues.length > 0 ? cgValues : [1],
          backgroundColor: cgValues.length > 0 ? ['#1e3a8a', '#0ea5e9', '#3b82f6', '#f59e0b', '#10b981'] : ['#e2e8f0'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } }
        }
      }
    });
  }

  updateVisitChartType(type) {
    this.state.activeVisitChartType = type;
    
    const btnMonthly = document.getElementById('btn-chart-monthly');
    const btnYearly = document.getElementById('btn-chart-yearly');

    if (type === 'monthly') {
      btnMonthly.className = "px-3 py-1.5 rounded-md font-semibold bg-white dark:bg-slate-700 shadow-sm";
      btnYearly.className = "px-3 py-1.5 rounded-md font-semibold text-slate-500 dark:text-slate-400";
    } else {
      btnYearly.className = "px-3 py-1.5 rounded-md font-semibold bg-white dark:bg-slate-700 shadow-sm";
      btnMonthly.className = "px-3 py-1.5 rounded-md font-semibold text-slate-500 dark:text-slate-400";
    }

    this.renderCharts();
  }

  openFileViewer(base64, filename = '') {
    const titleEl = document.getElementById('file-viewer-title');
    const zoomControls = document.getElementById('file-viewer-zoom-controls');
    const bodyEl = document.getElementById('file-viewer-body');
    if (!bodyEl) return;

    this.state.fileViewerScale = 1;
    
    if (titleEl) {
      titleEl.textContent = `พรีวิวเอกสาร Care plan: ${filename || 'เอกสาร'}`;
    }

    const fileType = this.getFileTypeFromBase64(base64);

    if (fileType.isImage) {
      if (zoomControls) zoomControls.classList.remove('hidden');
      bodyEl.innerHTML = `
        <div class="flex items-center justify-center w-full h-full overflow-auto">
          <img id="file-viewer-img" src="${base64}" class="max-w-full max-h-[65vh] object-contain transition-transform duration-200 ease-out select-none pointer-events-none" style="transform: scale(1); transform-origin: center center; image-rendering: -webkit-optimize-contrast;">
        </div>
      `;
    } else if (base64.startsWith('data:application/pdf')) {
      if (zoomControls) zoomControls.classList.add('hidden');
      
      // ล้าง Blob URL เดิมถ้ามี
      if (this.state.currentFileViewerBlobUrl) {
        URL.revokeObjectURL(this.state.currentFileViewerBlobUrl);
      }
      
      const blobUrl = this.base64ToBlobUrl(base64);
      this.state.currentFileViewerBlobUrl = blobUrl;

      bodyEl.innerHTML = `
        <iframe src="${blobUrl}" class="w-full h-[65vh] rounded-lg border border-slate-700 bg-white" type="application/pdf"></iframe>
      `;
    } else {
      if (zoomControls) zoomControls.classList.add('hidden');
      bodyEl.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-center text-slate-300 space-y-4 w-full">
          <i class="fa-solid ${fileType.icon} text-6xl ${fileType.color || 'text-slate-400'}"></i>
          <div>
            <p class="font-bold text-sm text-white">${filename || 'เอกสาร Care plan'}</p>
            <p class="text-xs text-slate-400 mt-1">ไฟล์ประเภท Word / Excel ไม่สามารถพรีวิวในเบราว์เซอร์ได้โดยตรง</p>
          </div>
          <a href="${base64}" download="${filename}" class="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs py-2 px-5 rounded-lg transition shadow-md flex items-center gap-1.5 no-print">
            <i class="fa-solid fa-download"></i> ดาวน์โหลดเอกสารเพื่อเปิดอ่าน
          </a>
        </div>
      `;
    }

    document.getElementById('modal-file-viewer').classList.remove('hidden');
  }

  closeFileViewerModal() {
    document.getElementById('modal-file-viewer').classList.add('hidden');
    const bodyEl = document.getElementById('file-viewer-body');
    if (bodyEl) bodyEl.innerHTML = '';
    
    // คืนค่าหน่วยความจำ (Revoke) Blob URL เมื่อปิดโมดัล
    if (this.state.currentFileViewerBlobUrl) {
      URL.revokeObjectURL(this.state.currentFileViewerBlobUrl);
      this.state.currentFileViewerBlobUrl = null;
    }
  }

  /**
   * เปิดพอร์ทัลพิมพ์ / พิมพ์รายงานผลเยี่ยมรายบุคคล (Print Preview Modal)
   */
  showReportDetailModal(id) {
    const record = this.state.visits.find(v => v.id === id);
    if (!record) return;

    const modal = document.getElementById('modal-report-detail');
    const container = document.getElementById('report-print-content');

    const addressStr = `บ้านเลขที่ ${record.addressNo} ${record.addressMoo ? 'หมู่ที่ ' + record.addressMoo : ''} ตำบล/แขวง${record.addressSubdistrict} อำเภอ/เขต${record.addressDistrict} จังหวัด${record.addressProvince} ${record.addressZip}`;
    const formattedDate = this.formatThaiDate(record.visitDate);
    const photosList = record.photos || [];
    const imagePhotos = photosList.filter(p => this.getFileTypeFromBase64(p).isImage);
    const pdfPhotos = (() => {
      const directPdfs = photosList.filter(p => !this.getFileTypeFromBase64(p).isImage);
      if (directPdfs.length > 0) return directPdfs;
      
      // ค้นหาเอกสาร Care plan ของผู้ป่วยรายนี้จากบันทึกการเยี่ยมอื่นๆ (เช่น แอดมินเป็นผู้อัปโหลดแยกต่างหาก)
      const match = this.state.visits.find(v => 
        v.patientFirstname.trim().toLowerCase() === record.patientFirstname.trim().toLowerCase() &&
        v.patientLastname.trim().toLowerCase() === record.patientLastname.trim().toLowerCase() &&
        (v.photos || []).some(p => !this.getFileTypeFromBase64(p).isImage)
      );
      return match ? match.photos.filter(p => !this.getFileTypeFromBase64(p).isImage) : [];
    })();

    let photosHtml = '';

    // 1. Render Visit Photos section
    photosHtml += '<div class="mt-4"><h5 class="font-bold text-xs text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5"><i class="fa-solid fa-camera"></i> รูปภาพการลงเยี่ยมบ้าน</h5>';
    if (imagePhotos.length > 0) {
      photosHtml += '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 no-print">';
      imagePhotos.forEach((base64, index) => {
        const filename = `visit_photo_${record.patientFirstname || 'patient'}_${index + 1}.jpg`;
        photosHtml += `
          <div class="group relative aspect-video bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
            <img src="${base64}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 no-print">
              <button type="button" onclick="app.openFileViewer('${base64}', '${filename}')" class="bg-white hover:bg-slate-100 text-slate-800 rounded p-1.5 text-xs transition flex items-center gap-1"><i class="fa-regular fa-eye"></i> ดู</button>
              <a href="${base64}" download="${filename}" class="bg-slate-900/80 hover:bg-slate-900 text-white p-1.5 rounded-lg text-xs transition flex items-center gap-1 shadow-md">
                <i class="fa-solid fa-download"></i> ดาวน์โหลด
              </a>
            </div>
          </div>`;
      });
      photosHtml += '</div>';

      // พิมพ์รูปหน้ากระดาษ (A4 Print layout)
      photosHtml += '<div class="hidden print:flex flex-wrap gap-4 mt-2">';
      imagePhotos.forEach((base64) => {
        photosHtml += `<img src="${base64}" class="h-40 w-auto rounded border border-slate-400 object-cover">`;
      });
      photosHtml += '</div>';
    } else {
      photosHtml += '<p class="text-xs text-slate-400 italic">ไม่มีรูปภาพการลงเยี่ยมสำหรับรายงานนี้</p>';
    }
    photosHtml += '</div>';

    // 2. Render Care Plan PDFs section
    photosHtml += '<div class="mt-6"><h5 class="font-bold text-xs text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5"><i class="fa-solid fa-file-pdf"></i> เอกสารประกอบ Care plan</h5>';
    if (pdfPhotos.length > 0) {
      photosHtml += '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 no-print">';
      pdfPhotos.forEach((base64, index) => {
        const fileType = this.getFileTypeFromBase64(base64);
        const ext = this.getFileExtensionFromBase64(base64);
        const filename = `careplan_${record.patientFirstname || 'patient'}_${index + 1}.${ext}`;
        photosHtml += `
          <div class="flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm relative group min-h-[110px]">
            <i class="fa-solid ${fileType.icon} text-4xl ${fileType.color || 'text-slate-500'} mb-2"></i>
            <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate w-full text-center px-2">${fileType.label}</span>
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 no-print">
              <button type="button" onclick="app.openFileViewer('${base64}', '${filename}')" class="bg-white hover:bg-slate-100 text-slate-800 rounded p-1.5 text-xs transition flex items-center gap-1"><i class="fa-regular fa-eye"></i> ดู</button>
              <a href="${base64}" download="${filename}" class="bg-primary-900 dark:bg-secondary-500 hover:bg-primary-850 dark:hover:bg-secondary-600 text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm flex items-center gap-1">
                <i class="fa-solid fa-download"></i> ดาวน์โหลด
              </a>
            </div>
          </div>`;
      });
      photosHtml += '</div>';

      // พิมพ์ PDF หน้ากระดาษ (A4 Print layout)
      photosHtml += '<div class="hidden print:flex flex-wrap gap-4 mt-2">';
      pdfPhotos.forEach((base64) => {
        const fileType = this.getFileTypeFromBase64(base64);
        photosHtml += `
          <div class="h-16 w-48 rounded border border-slate-400 p-2 flex items-center gap-2 bg-slate-50">
            <i class="fa-solid ${fileType.icon} text-xl ${fileType.color || 'text-slate-500'}"></i>
            <div class="text-[9px] leading-tight">
              <p class="font-bold">ไฟล์แนบ Care plan</p>
              <p class="text-slate-500">${fileType.label}</p>
            </div>
          </div>`;
      });
      photosHtml += '</div>';
    } else {
      photosHtml += '<p class="text-xs text-slate-400 italic">ไม่มีเอกสาร PDF Care plan ประกอบรายงานนี้</p>';
    }
    photosHtml += '</div>';

    // สร้างลิงก์แผนที่ Google Maps หรือแสดงจุดพิกัด
    const mapsLinkHtml = (record.gpsLat && record.gpsLng)
      ? `<a href="https://www.google.com/maps/search/?api=1&query=${record.gpsLat},${record.gpsLng}" target="_blank" class="text-secondary-600 dark:text-secondary-400 font-semibold text-xs hover:underline flex items-center gap-1 mt-1 no-print">
          <i class="fa-solid fa-map-pin"></i> เปิดพิกัดบนแผนที่ Google Maps
         </a>
         <span class="hidden print:inline text-xs text-slate-600">(ตำแหน่งพิกัด GPS: ${record.gpsLat}, ${record.gpsLng})</span>`
      : '<span class="text-xs text-slate-400 italic">ไม่ได้ทำการระบุพิกัด GPS ไว้</span>';

    container.innerHTML = `
      <div class="print-title">
        แบบบันทึกรายงานการลงเยี่ยมบ้านผู้รับบริการการดูแลระยะยาว (LTC)
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 print-grid">
        <!-- ฝั่งซ้าย: ข้อมูลผู้ป่วย -->
        <div class="space-y-4 print-section">
          <h4 class="font-bold text-sm text-primary-900 border-b pb-1 flex items-center gap-2"><i class="fa-solid fa-circle-user text-xs"></i> ข้อมูลผู้รับบริการ</h4>
          <div class="text-sm space-y-2">
            <p><strong>ชื่อ-นามสกุล:</strong> ${record.patientTitle}${record.patientFirstname} ${record.patientLastname}</p>
            <p><strong>อายุ:</strong> ${record.patientAge} ปี</p>
            <p class="leading-relaxed"><strong>ที่อยู่ปัจจุบัน:</strong> ${addressStr}</p>
            <p><strong>พิกัดพิกัดแผนที่:</strong> ${mapsLinkHtml}</p>
          </div>
        </div>

        <!-- ฝั่งขวา: รายละเอียดการเยี่ยม -->
        <div class="space-y-4 print-section">
          <h4 class="font-bold text-sm text-primary-900 border-b pb-1 flex items-center gap-2"><i class="fa-solid fa-business-time text-xs"></i> รายละเอียดการตรวจเยี่ยม</h4>
          <div class="text-sm space-y-2">
            <p><strong>วันที่เข้าเยี่ยม:</strong> ${formattedDate}</p>
            <p><strong>เวลาเยี่ยม:</strong> ${record.visitTimeStart} ถึง ${record.visitTimeEnd} น. (รวม ${this.formatDurationText(record.visitDuration)})</p>
            <p><strong>ผู้ให้บริการดูแล (CG):</strong> ${record.cgFirstname} ${record.cgLastname || ''}</p>
          </div>
        </div>
      </div>

      <!-- รายละเอียดการให้บริการ -->
      <div class="space-y-4 print-section">
        <h4 class="font-bold text-sm text-primary-900 border-b pb-1 flex items-center gap-2"><i class="fa-solid fa-clipboard-check text-xs"></i> กิจกรรมการดูแลและผลการประเมิน</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 print-grid text-sm">
          <div>
            <p class="font-bold">รายละเอียดการให้การช่วยเหลือดูแล:</p>
            <p class="mt-1.5 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg min-h-[60px] whitespace-pre-line border border-slate-100 dark:border-slate-800">${record.careDetails}</p>
          </div>
          <div>
            <p class="font-bold">กิจกรรมที่ดำเนินการเพิ่มเติม/คำแนะนำ:</p>
            <p class="mt-1.5 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg min-h-[60px] whitespace-pre-line border border-slate-100 dark:border-slate-800">${record.careActivities || '-'}</p>
          </div>
        </div>
      </div>

      <!-- สัญญาณชีพ & ความดัน -->
      <div class="space-y-4 print-section">
        <h4 class="font-bold text-sm text-primary-900 border-b pb-1 flex items-center gap-2"><i class="fa-solid fa-heart-pulse text-xs"></i> ผลสัญญาณชีพและระดับความดันโลหิต</h4>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 print-grid text-sm">
          <div>
            <p><strong>ค่าความดันโลหิต:</strong> ${record.bpSystolic}/${record.bpDiastolic} mmHg</p>
          </div>
          <div>
            <p><strong>ผลการวิเคราะห์ระดับ:</strong> ${this.getBPLevelBadge(record.bpSystolic, record.bpDiastolic)}</p>
          </div>
          <div>
            <p><strong>อาการสำคัญล่าสุด:</strong> ${record.healthSymptoms || '-'}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 print-grid text-sm">
          <div>
            <p><strong>ปัญหาสุขภาพที่ตรวจพบเพิ่มเติม:</strong> ${record.healthProblems || '-'}</p>
          </div>
          <div>
            <p><strong>สิ่งของเครื่องใช้ที่ต้องการเพิ่มเติม:</strong> ${record.requestedItems || '-'}</p>
          </div>
        </div>
        <div>
          <p class="text-xs text-slate-500"><strong>หมายเหตุเพิ่มเติม:</strong> ${record.healthRemarks || '-'}</p>
        </div>
      </div>

      <!-- ส่วนรูปภาพแนบ -->
      <div class="space-y-2 print-section">
        <h4 class="font-bold text-sm text-primary-900 border-b pb-1 no-print">เอกสาร PDF Care plan ประกอบการเยี่ยม</h4>
        ${photosHtml}
      </div>

      <!-- ส่วนเซ็นลงนามผู้บันทึก (แสดงเฉพาะพิมพ์กระดาษ) -->
      <div class="hidden print:block print-sign-area">
        <div class="print-sign-box">
          ลงชื่อ............................................................<br>
          ( ${record.cgFirstname} ${record.cgLastname || ''} )<br>
          ตำแหน่ง เจ้าหน้าที่ผู้เยี่ยมบันทึก (CG)
        </div>
        <div class="print-sign-box">
          ลงชื่อ............................................................<br>
          ( ............................................................ )<br>
          ตำแหน่ง เจ้าหน้าที่รับรองข้อมูล/ผู้ดูแลระบบ
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
  }

  closeReportDetailModal() {
    document.getElementById('modal-report-detail').classList.add('hidden');
  }

  /**
   * จัดการหน้าต่างอัปโหลดและเปิดดูเอกสาร Care plan รายบุคคล
   */
  openCarePlanModal(visitId, viewOnly = false) {
    const record = this.state.visits.find(v => v.id === visitId);
    if (!record) {
      this.showToast('ไม่พบข้อมูลการเยี่ยมบ้านที่เลือก', 'error');
      return;
    }

    // Force view-only mode for non-admin users
    const isUserAdmin = this.state.currentUser && this.state.currentUser.role === 'admin';
    const activeViewOnly = !isUserAdmin || viewOnly;

    this.state.carePlanViewOnly = activeViewOnly;

    document.getElementById('careplan-visit-id').value = visitId;
    document.getElementById('careplan-patient-info').textContent = `ผู้รับบริการ: ${record.patientTitle}${record.patientFirstname} ${record.patientLastname} (อายุ ${record.patientAge} ปี) | วันเยี่ยม: ${this.formatThaiDate(record.visitDate)}`;

    // Set modal text and visibility
    const modalTitle = document.getElementById('careplan-modal-title');
    if (modalTitle) {
      modalTitle.textContent = activeViewOnly ? 'ค้นหา/ดูเอกสาร Care plan' : 'จัดการเอกสาร Care plan';
    }

    const uploadSection = document.getElementById('careplan-modal-upload-section');
    if (uploadSection) {
      uploadSection.style.display = activeViewOnly ? 'none' : '';
    }

    const saveBtn = document.getElementById('careplan-modal-save-btn');
    if (saveBtn) {
      saveBtn.style.display = activeViewOnly ? 'none' : '';
    }

    const cancelBtn = document.getElementById('careplan-modal-cancel-btn');
    if (cancelBtn) {
      cancelBtn.textContent = activeViewOnly ? 'ปิด' : 'ยกเลิก';
    }

    // คัดลอกรูป/ไฟล์ปัจจุบันลงใน State ชั่วคราวของโมดัล (กรองเอาเฉพาะไฟล์ที่ไม่ใช่รูปภาพ และสืบค้นข้ามบันทึกถ้าไม่มีโดยตรง)
    this.state.currentCarePlanPhotos = (() => {
      const direct = (record.photos || []).filter(p => !this.getFileTypeFromBase64(p).isImage);
      if (direct.length > 0) return direct;
      
      const match = this.state.visits.find(v => 
        v.patientFirstname.trim().toLowerCase() === record.patientFirstname.trim().toLowerCase() &&
        v.patientLastname.trim().toLowerCase() === record.patientLastname.trim().toLowerCase() &&
        (v.photos || []).some(p => !this.getFileTypeFromBase64(p).isImage)
      );
      return match ? match.photos.filter(p => !this.getFileTypeFromBase64(p).isImage) : [];
    })();

    this.renderCarePlanFiles();
    document.getElementById('modal-careplan-upload').classList.remove('hidden');
  }

  closeCarePlanModal() {
    document.getElementById('modal-careplan-upload').classList.add('hidden');
    document.getElementById('careplan-file-input').value = '';
    this.state.currentCarePlanPhotos = [];
  }
  zoomFileViewer(delta) {
    const el = document.getElementById('file-viewer-img');
    if (!el) return;
    this.state.fileViewerScale = (this.state.fileViewerScale || 1) + delta;
    this.state.fileViewerScale = Math.max(0.2, Math.min(5, this.state.fileViewerScale));
    el.style.transform = `scale(${this.state.fileViewerScale})`;
  }

  resetZoomFileViewer() {
    const el = document.getElementById('file-viewer-img');
    if (!el) return;
    this.state.fileViewerScale = 1;
    el.style.transform = 'scale(1)';
  }

  async handleCarePlanFileSelection(e) {
    const files = e.target.files;
    if (this.state.currentCarePlanPhotos.length + files.length > 3) {
      this.showToast('คุณสามารถแนบไฟล์เอกสาร PDF รวมกันได้สูงสุดเพียง 3 ไฟล์เท่านั้น', 'warning');
      return;
    }

    this.showLoading(true, 'กำลังดำเนินการประมวลผลไฟล์...');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop().toLowerCase();
      const isPdf = file.type === 'application/pdf' || ext === 'pdf';

      if (!isPdf) {
        this.showToast(`ไม่รองรับไฟล์ประเภท .${ext} กรุณาแนบไฟล์เอกสาร PDF เท่านั้น`, 'warning');
        continue;
      }

      const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
      if (file.size > MAX_FILE_SIZE) {
        this.showToast(`ไฟล์ ${file.name} มีขนาดใหญ่เกินไป (จำกัดไม่เกิน 4MB)`, 'warning');
        continue;
      }

      try {
        const docBase64 = await this.readFileAsBase64(file);
        this.state.currentCarePlanPhotos.push(docBase64);
      } catch (err) {
        console.error(err);
        this.showToast(`เกิดความผิดพลาดในการประมวลผลไฟล์ ${file.name}`, 'error');
      }
    }

    this.showLoading(false);
    this.renderCarePlanFiles();
    document.getElementById('careplan-file-input').value = '';
  }

  removeCarePlanFile(index) {
    this.state.currentCarePlanPhotos.splice(index, 1);
    this.renderCarePlanFiles();
    this.showToast('นำไฟล์แนบที่เลือกออกแล้ว', 'info');
  }

  renderCarePlanFiles() {
    const container = document.getElementById('careplan-files-container');
    if (!container) return;

    container.innerHTML = '';

    if (this.state.currentCarePlanPhotos.length === 0) {
      container.className = 'col-span-3 py-6 text-center text-slate-400 dark:text-slate-500 text-xs italic';
      container.innerHTML = 'ยังไม่มีเอกสาร PDF Care plan';
      return;
    }

    container.className = 'grid grid-cols-3 gap-3';
    this.state.currentCarePlanPhotos.forEach((base64, index) => {
      const fileType = this.getFileTypeFromBase64(base64);
      const ext = this.getFileExtensionFromBase64(base64);
      const filename = `careplan_${index + 1}.${ext}`;
      
      const card = document.createElement('div');
      card.className = 'relative group aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center p-2';

      let innerHtml = '';
      if (fileType.isImage) {
        innerHtml = `
          <img src="${base64}" class="w-full h-full object-cover">
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 no-print">
            <button type="button" onclick="app.openFileViewer('${base64}', '${filename}')" class="bg-white hover:bg-slate-100 text-slate-800 rounded p-1.5 text-xs transition" title="ดูเอกสาร PDF"><i class="fa-regular fa-eye"></i></button>
            <a href="${base64}" download="${filename}" class="bg-white hover:bg-slate-100 text-slate-800 rounded p-1.5 text-xs transition" title="ดาวน์โหลด"><i class="fa-solid fa-download"></i></a>
          </div>
        `;
      } else {
        innerHtml = `
          <i class="fa-solid ${fileType.icon} text-3xl ${fileType.color || ''} mb-1"></i>
          <span class="text-[10px] font-semibold text-center truncate w-full px-1">${fileType.label}</span>
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 no-print">
            <button type="button" onclick="app.openFileViewer('${base64}', '${filename}')" class="bg-white hover:bg-slate-100 text-slate-800 rounded p-1.5 text-xs transition" title="ดูเอกสาร PDF"><i class="fa-regular fa-eye"></i></button>
            <a href="${base64}" download="${filename}" class="bg-white hover:bg-slate-100 text-slate-800 rounded p-1.5 text-xs transition" title="ดาวน์โหลด"><i class="fa-solid fa-download"></i></a>
          </div>
        `;
      }

      const deleteBtnHtml = this.state.carePlanViewOnly 
        ? '' 
        : `<button type="button" onclick="app.removeCarePlanFile(${index})" class="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-md transition no-print"><i class="fa-solid fa-xmark"></i></button>`;

      card.innerHTML = `
        ${innerHtml}
        ${deleteBtnHtml}
      `;

      container.appendChild(card);
    });
  }

  async saveCarePlan() {
    const visitId = document.getElementById('careplan-visit-id').value;
    const record = this.state.visits.find(v => v.id === visitId);
    if (!record) {
      this.showToast('ไม่พบข้อมูลบันทึกที่อ้างอิง', 'error');
      return;
    }
    
    // อัปเดตรูป/ไฟล์แนบ (รักษาภาพลงเยี่ยมเดิมที่มีไว้)
    const existingImages = (record.photos || []).filter(p => this.getFileTypeFromBase64(p).isImage);
    record.photos = [...existingImages, ...this.state.currentCarePlanPhotos];

    try {
      // เรียก saveData ของตัวระบบหลักเพื่อจัดเก็บและซิงค์ข้อมูล
      await this.saveData('visits', record, 'save');
      
      // บันทึก Log กิจกรรม
      this.logSystemActivity(
        this.state.currentUser ? this.state.currentUser.username : 'system',
        'update_careplan',
        `จัดการไฟล์ Care plan ของผู้ป่วย ${record.patientTitle}${record.patientFirstname} ${record.patientLastname}`
      );

      this.closeCarePlanModal();
    } catch (err) {
      console.error(err);
      this.showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล Care plan', 'error');
    }
  }

  /**
   * เปิดหน้าต่างอัปโหลด Care plan สำหรับผู้ป่วยรายใหม่ (แบบระบุชื่อโดยตรง)
   */
  openNewCarePlanModal(visitId = null) {
    const titleEl = document.getElementById('modal-new-careplan-title');
    const idInput = document.getElementById('new-cp-visit-id');
    
    if (visitId) {
      const record = this.state.visits.find(v => v.id === visitId);
      if (!record) {
        this.showToast('ไม่พบข้อมูลบันทึกที่อ้างอิง', 'error');
        return;
      }
      
      if (titleEl) titleEl.textContent = 'แก้ไขข้อมูลเอกสาร Care plan';
      if (idInput) idInput.value = visitId;
      
      document.getElementById('new-cp-firstname').value = record.patientFirstname || '';
      document.getElementById('new-cp-lastname').value = record.patientLastname || '';
      document.getElementById('new-cp-age').value = record.patientAge || '';
      document.getElementById('new-cp-title').value = record.patientTitle || 'นาย';
      
      this.state.currentCarePlanPhotos = (record.photos || []).filter(p => !this.getFileTypeFromBase64(p).isImage);
    } else {
      if (titleEl) titleEl.textContent = 'แนบเอกสาร Care plan ใหม่';
      if (idInput) idInput.value = '';
      
      document.getElementById('new-cp-firstname').value = '';
      document.getElementById('new-cp-lastname').value = '';
      document.getElementById('new-cp-age').value = '';
      document.getElementById('new-cp-title').selectedIndex = 0;
      
      this.state.currentCarePlanPhotos = [];
    }
    
    document.getElementById('new-cp-file-input').value = '';
    this.renderNewCPFiles();
    document.getElementById('modal-new-careplan').classList.remove('hidden');
  }

  closeNewCarePlanModal() {
    document.getElementById('modal-new-careplan').classList.add('hidden');
    document.getElementById('new-cp-file-input').value = '';
    const idInput = document.getElementById('new-cp-visit-id');
    if (idInput) idInput.value = '';
    this.state.currentCarePlanPhotos = [];
  }

  async handleNewCPFileSelection(e) {
    const files = e.target.files;
    if (this.state.currentCarePlanPhotos.length + files.length > 3) {
      this.showToast('คุณสามารถแนบไฟล์เอกสาร PDF รวมกันได้สูงสุดเพียง 3 ไฟล์เท่านั้น', 'warning');
      return;
    }

    this.showLoading(true, 'กำลังดำเนินการประมวลผลไฟล์...');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop().toLowerCase();
      const isPdf = file.type === 'application/pdf' || ext === 'pdf';

      if (!isPdf) {
        this.showToast(`ไม่รองรับไฟล์ประเภท .${ext} กรุณาแนบไฟล์เอกสาร PDF เท่านั้น`, 'warning');
        continue;
      }

      const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
      if (file.size > MAX_FILE_SIZE) {
        this.showToast(`ไฟล์ ${file.name} มีขนาดใหญ่เกินไป (จำกัดไม่เกิน 4MB)`, 'warning');
        continue;
      }

      try {
        const docBase64 = await this.readFileAsBase64(file);
        this.state.currentCarePlanPhotos.push(docBase64);
      } catch (err) {
        console.error(err);
        this.showToast(`เกิดความผิดพลาดในการประมวลผลไฟล์ ${file.name}`, 'error');
      }
    }

    this.showLoading(false);
    this.renderNewCPFiles();
    document.getElementById('new-cp-file-input').value = '';
  }

  removeNewCPFile(index) {
    this.state.currentCarePlanPhotos.splice(index, 1);
    this.renderNewCPFiles();
    this.showToast('นำไฟล์แนบที่เลือกออกแล้ว', 'info');
  }

  renderNewCPFiles() {
    const container = document.getElementById('new-cp-files-container');
    if (!container) return;

    container.innerHTML = '';

    if (this.state.currentCarePlanPhotos.length === 0) {
      container.className = 'col-span-3 py-4 text-center text-slate-400 dark:text-slate-500 text-[11px] italic';
      container.innerHTML = 'ยังไม่มีไฟล์แนบที่เพิ่ม';
      return;
    }

    container.className = 'grid grid-cols-3 gap-2 mt-2';
    this.state.currentCarePlanPhotos.forEach((base64, index) => {
      const fileType = this.getFileTypeFromBase64(base64);
      const ext = this.getFileExtensionFromBase64(base64);
      
      const card = document.createElement('div');
      card.className = 'relative group aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center p-2';

      let innerHtml = '';
      if (fileType.isImage) {
        innerHtml = `<img src="${base64}" class="w-full h-full object-cover">`;
      } else {
        innerHtml = `
          <i class="fa-solid ${fileType.icon} text-2xl ${fileType.color || ''} mb-0.5"></i>
          <span class="text-[9px] font-semibold text-center truncate w-full px-0.5">${fileType.label}</span>
        `;
      }

      card.innerHTML = `
        ${innerHtml}
        <button type="button" onclick="app.removeNewCPFile(${index})" class="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-md transition no-print">
          <i class="fa-solid fa-xmark"></i>
        </button>
      `;

      container.appendChild(card);
    });
  }

  async handleNewCarePlanSubmit(e) {
    e.preventDefault();

    const visitId = document.getElementById('new-cp-visit-id') ? document.getElementById('new-cp-visit-id').value : '';
    const title = document.getElementById('new-cp-title').value;
    const firstname = document.getElementById('new-cp-firstname').value.trim();
    const lastname = document.getElementById('new-cp-lastname').value.trim();
    const age = parseInt(document.getElementById('new-cp-age').value.trim());

    if (!firstname || !lastname || isNaN(age)) {
      this.showToast('กรุณากรอกข้อมูลส่วนตัวผู้ป่วยให้ครบถ้วน', 'warning');
      return;
    }

    if (this.state.currentCarePlanPhotos.length === 0) {
      this.showToast('กรุณาทำการแนบไฟล์ PDF Care plan อย่างน้อย 1 ไฟล์', 'warning');
      return;
    }

    try {
      if (visitId) {
        // โหมดแก้ไข
        const record = this.state.visits.find(v => v.id === visitId);
        if (!record) {
          this.showToast('ไม่พบข้อมูลบันทึกที่แก้ไข', 'error');
          return;
        }

        record.patientTitle = title;
        record.patientFirstname = firstname;
        record.patientLastname = lastname;
        record.patientAge = age;
        const existingImages = (record.photos || []).filter(p => this.getFileTypeFromBase64(p).isImage);
        record.photos = [...existingImages, ...this.state.currentCarePlanPhotos];

        await this.saveData('visits', record, 'save');

        this.logSystemActivity(
          this.state.currentUser ? this.state.currentUser.username : 'system',
          'update_careplan',
          `แก้ไขข้อมูลและไฟล์ Care plan ของผู้ป่วย ${title}${firstname} ${lastname}`
        );
      } else {
        // โหมดเพิ่มใหม่
        const newRecord = {
          id: 'visit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          patientTitle: title,
          patientFirstname: firstname,
          patientLastname: lastname,
          patientAge: age,
          visitDate: new Date().toISOString().split('T')[0], // today's date
          visitTimeStart: '00:00',
          visitTimeEnd: '00:00',
          visitDuration: 0,
          bpSystolic: 120,
          bpDiastolic: 80,
          cgTitle: '',
          cgFirstname: this.state.currentUser ? this.state.currentUser.fullname.split(' ')[0] : 'Admin',
          cgLastname: this.state.currentUser ? (this.state.currentUser.fullname.split(' ')[1] || '') : '',
          cgUsername: this.state.currentUser ? this.state.currentUser.username : 'admin',
          photos: [...this.state.currentCarePlanPhotos], // base64 files
          careDetails: 'อัปโหลดเอกสาร Care plan โดยตรงผ่านระบบผู้ดูแลระบบ',
          careActivities: '',
          healthSymptoms: '',
          healthProblems: '',
          requestedItems: '',
          healthRemarks: '',
          addressNo: '-',
          addressMoo: '',
          addressSubdistrict: '-',
          addressDistrict: '-',
          addressProvince: '-',
          addressZip: '-',
          gpsLat: '',
          gpsLng: ''
        };

        await this.saveData('visits', newRecord, 'save');

        this.logSystemActivity(
          this.state.currentUser ? this.state.currentUser.username : 'system',
          'create_careplan',
          `แนบเอกสาร Care plan ใหม่ ให้แก่ผู้ป่วย ${title}${firstname} ${lastname}`
        );
      }

      this.closeNewCarePlanModal();
    } catch (err) {
      console.error(err);
      this.showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล Care plan', 'error');
    }
  }

  printCurrentReport() {
    window.print();
  }

  /**
   * ระบบลงบัญชีและจัดการสมาชิกแอดมิน / เจ้าหน้าที่ CG (Admin Screen)
   */
  renderStaffList() {
    const tbody = document.getElementById('table-staff-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const query = document.getElementById('search-staff-query').value.trim().toLowerCase();

    const filtered = this.state.staffs.filter(s => {
      return s.username.includes(query) || s.fullname.toLowerCase().includes(query);
    });

    filtered.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800';

      const roleBadge = s.role === 'admin' 
        ? '<span class="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 px-2 py-0.5 rounded text-xs font-semibold">แอดมิน / ผู้ดูแลระบบ</span>' 
        : '<span class="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded text-xs font-semibold">ผู้ดูแล CG</span>';

      // ป้องกันปุ่มลบหากเป็นบัญชีของตัวเอง
      const isSelf = s.username === this.state.currentUser.username;
      const deleteBtn = isSelf 
        ? `<span class="text-xs text-slate-400 italic p-2">บัญชีใช้งานปัจจุบัน</span>`
        : `<button onclick="app.deleteStaffAccount('${s.username}')" class="bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 p-2 rounded-lg transition"><i class="fa-regular fa-trash-can"></i></button>`;

      tr.innerHTML = `
        <td class="p-4 font-bold text-slate-900 dark:text-white">${s.username}</td>
        <td class="p-4 text-slate-700 dark:text-slate-300">${s.fullname}</td>
        <td class="p-4">${roleBadge}</td>
        <td class="p-4 text-right space-x-1">
          <button onclick="app.openEditStaffModal('${s.username}')" class="bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 p-2 rounded-lg transition"><i class="fa-solid fa-user-pen"></i></button>
          ${deleteBtn}
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  openAddStaffModal() {
    document.getElementById('modal-staff-title').textContent = 'เพิ่มและลงทะเบียนเจ้าหน้าที่ใหม่';
    document.getElementById('staff-form-mode').value = 'add';
    
    const uInput = document.getElementById('staff-form-username');
    uInput.readOnly = false;
    uInput.value = '';
    
    document.getElementById('staff-form-fullname').value = '';
    document.getElementById('staff-form-password').value = '';
    document.getElementById('staff-form-password-container').classList.remove('hidden');
    document.getElementById('staff-form-role').value = 'cg';

    document.getElementById('modal-staff-form').classList.remove('hidden');
  }

  openEditStaffModal(username) {
    const s = this.state.staffs.find(staff => staff.username === username);
    if (!s) return;

    document.getElementById('modal-staff-title').textContent = `แก้ไขข้อมูลเจ้าหน้าที่ (${username})`;
    document.getElementById('staff-form-mode').value = 'edit';
    
    const uInput = document.getElementById('staff-form-username');
    uInput.value = s.username;
    uInput.readOnly = true;

    document.getElementById('staff-form-fullname').value = s.fullname;
    // ซ่อนพาสเวิร์ดในโมดัลทั่วไป แต่เปิดให้แอดมินตั้งใหม่ได้จากอีกที่หรือให้ปล่อยเปลี่ยนตรงนี้
    document.getElementById('staff-form-password').value = s.password;
    document.getElementById('staff-form-role').value = s.role;

    document.getElementById('modal-staff-form').classList.remove('hidden');
  }

  closeStaffModal() {
    document.getElementById('modal-staff-form').classList.add('hidden');
  }

  async handleStaffFormSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('staff-form-mode').value;
    const user = document.getElementById('staff-form-username').value.trim().toLowerCase();
    const name = document.getElementById('staff-form-fullname').value.trim();
    const pass = document.getElementById('staff-form-password').value;
    const role = document.getElementById('staff-form-role').value;

    const staffData = { username: user, fullname: name, password: pass, role: role };

    if (mode === 'add') {
      const exist = this.state.staffs.find(s => s.username === user);
      if (exist) {
        this.showToast('รหัสผู้ใช้งานนี้มีอยู่ในระบบแล้ว', 'warning');
        return;
      }
      this.addAuditLog('ลงทะเบียนเจ้าหน้าที่ใหม่ผ่านส่วนแอดมิน', `${name} (${user})`);
    } else {
      this.addAuditLog('แก้ไขข้อมูลประวัติเจ้าหน้าที่ผ่านส่วนแอดมิน', `${name} (${user})`);
    }

    await this.saveData('staffs', staffData);
    this.closeStaffModal();
    this.showToast('ดำเนินการปรับปรุงรายชื่อเจ้าหน้าที่เรียบร้อยแล้ว', 'success');
  }

  async deleteStaffAccount(username) {
    if (username === this.state.currentUser.username) {
      this.showToast('ไม่ได้รับอนุญาตให้ลบบัญชีผู้ใช้ที่กำลังล็อกอินรันระบบปัจจุบันอยู่', 'error');
      return;
    }

    if (!confirm(`ยืนยันการลบบัญชีผู้ใช้งานเจ้าหน้าที่ "${username}" ออกจากระบบถาวร?`)) return;

    const target = this.state.staffs.find(s => s.username === username);
    this.addAuditLog('ลบบัญชีผู้ใช้งานระบบออก', target ? target.fullname : username);
    await this.saveData('staffs', username, 'delete');
    this.showToast('ลบบัญชีเจ้าหน้าที่ออกจากระบบเรียบร้อย', 'success');
  }

  /**
   * แก้ไขโปรไฟล์ผู้ใช้ปัจจุบัน
   */
  openProfileModal() {
    document.getElementById('profile-username').value = this.state.currentUser.username;
    document.getElementById('profile-fullname').value = this.state.currentUser.fullname;
    document.getElementById('profile-password').value = '';
    document.getElementById('modal-profile').classList.remove('hidden');
  }

  closeProfileModal() {
    document.getElementById('modal-profile').classList.add('hidden');
  }

  async handleProfileFormSubmit(e) {
    e.preventDefault();
    const user = this.state.currentUser.username;
    const name = document.getElementById('profile-fullname').value.trim();
    const pass = document.getElementById('profile-password').value;

    if (pass !== '') this.state.currentUser.password = pass;
    this.state.currentUser.fullname = name;
    
    // อัปเดตข้อมูลผู้ใช้ในเซสชันปัจจุบันทันที
    sessionStorage.setItem('ltc_session_user', JSON.stringify(this.state.currentUser));

    this.addAuditLog('แก้ไขข้อมูลประวัติส่วนตัวและรหัสผ่านด้วยตนเอง');
    await this.saveData('staffs', this.state.currentUser);
    this.closeProfileModal();
    this.showToast('ปรับปรุงข้อมูลประวัติผู้ใช้งานสำเร็จแล้ว', 'success');
    
    // รีเซ็ตค่าการแสดงผลบนหน้าจอหัวบาร์และ Sidebar
    this.onLoginSuccess();
  }

  /**
   * แสดงประวัติกิจกรรมในระบบ (System logs)
   */
  renderLogsTable() {
    const tbody = document.getElementById('table-logs-body');
    const empty = document.getElementById('table-logs-empty');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (this.state.logs.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    this.state.logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800';

      const thaiTime = new Date(log.timestamp).toLocaleString('th-TH');

      tr.innerHTML = `
        <td class="p-3 text-slate-500 font-mono">${thaiTime}</td>
        <td class="p-3 font-semibold text-slate-800 dark:text-slate-200">${log.user}</td>
        <td class="p-3 text-slate-700 dark:text-slate-300">${log.event}</td>
        <td class="p-3 font-medium text-secondary-600 dark:text-secondary-400">${log.target || '-'}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  /**
   * ระบบตั้งค่าฐานข้อมูล
   */
  updateDBDriverUI() {
    const cfBtn = document.getElementById('btn-toggle-cloudflare');
    
    if (this.state.dbDriver === 'sheets') {
      this.updateDBStatusUI('Google Sheets Connected', 'emerald');
      if (cfBtn) {
        cfBtn.textContent = 'เปิดใช้งานโหมด D1';
        cfBtn.className = 'bg-primary-900 dark:bg-secondary-500 hover:opacity-90 text-white font-bold text-xs py-2 px-4 rounded-lg shadow-sm transition';
      }
    } else if (this.state.dbDriver === 'cloudflare') {
      this.updateDBStatusUI('Cloudflare D1 Connected', 'emerald');
      if (cfBtn) {
        cfBtn.textContent = 'ปิดใช้งานโหมด D1 (กลับเป็น Local)';
        cfBtn.className = 'bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-2 px-4 rounded-lg shadow-sm transition';
      }
    } else {
      this.updateDBStatusUI('Local Database Mode', 'emerald');
      if (cfBtn) {
        cfBtn.textContent = 'เปิดใช้งานโหมด D1';
        cfBtn.className = 'bg-primary-900 dark:bg-secondary-500 hover:opacity-90 text-white font-bold text-xs py-2 px-4 rounded-lg shadow-sm transition';
      }
    }

    localStorage.setItem('ltc_db_driver', this.state.dbDriver);
  }

  toggleCloudflareMode() {
    if (this.state.dbDriver === 'cloudflare') {
      this.state.dbDriver = 'local';
      localStorage.setItem('ltc_db_driver', 'local');
      this.showToast('สลับไปใช้ฐานข้อมูลในเครื่องนี้ชั่วคราว (Local DB)', 'info');
    } else {
      this.state.dbDriver = 'cloudflare';
      localStorage.setItem('ltc_db_driver', 'cloudflare');
      this.state.sheetsUrl = '';
      const sheetsUrlInput = document.getElementById('settings-sheets-url');
      if (sheetsUrlInput) sheetsUrlInput.value = '';
      localStorage.removeItem('ltc_sheets_url');
      this.showToast('เปิดใช้งานโหมด Cloudflare D1 เรียบร้อย', 'success');
    }
    this.updateDBDriverUI();
    this.syncData();
  }

  updateDBStatusUI(text, color) {
    const bar = document.getElementById('db-status-bar');
    const txt = document.getElementById('db-status-text');
    if (!bar) return;

    txt.textContent = text;
    if (color === 'emerald') {
      bar.className = "hidden sm:flex items-center space-x-2 text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-100 dark:border-emerald-900";
    } else {
      bar.className = "hidden sm:flex items-center space-x-2 text-xs bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-450 px-2.5 py-1 rounded-full border border-rose-100 dark:border-rose-900";
    }
  }

  saveSheetsConnection() {
    const url = document.getElementById('settings-sheets-url').value.trim();
    if (url === '') {
      this.state.sheetsUrl = '';
      this.state.dbDriver = 'local';
      localStorage.removeItem('ltc_sheets_url');
      localStorage.setItem('ltc_db_driver', 'local');
      this.showToast('ยกเลิกการเชื่อมโยงคลาวด์ สลับไปใช้ฐานข้อมูลในเครื่องนี้ชั่วคราว', 'info');
    } else {
      this.state.sheetsUrl = url;
      this.state.dbDriver = 'sheets';
      localStorage.setItem('ltc_sheets_url', url);
      localStorage.setItem('ltc_db_driver', 'sheets');
      this.showToast('บันทึกการตั้งค่า Google Web App URL สำเร็จแล้ว', 'success');
    }
    this.updateDBDriverUI();
    this.syncData();
  }

  saveLineConfig() {
    const token = document.getElementById('settings-line-token').value.trim();
    const groupId = document.getElementById('settings-line-group').value.trim();
    this.state.lineToken = token;
    this.state.lineGroupId = groupId;
    localStorage.setItem('ltc_line_token', token);
    localStorage.setItem('ltc_line_group', groupId);
    
    if (token && groupId) {
      this.showToast('บันทึกการตั้งค่า LINE Bot (Messaging API) เรียบร้อย', 'success');
      this.addAuditLog('อัปเดตการตั้งค่า LINE Bot สำหรับการแจ้งเตือน');
    } else {
      this.showToast('ยกเลิกการส่งข้อความแจ้งเตือนผ่าน LINE', 'info');
    }
  }

  copyAppsScriptCode() {
    const box = document.getElementById('apps-script-code-box');
    box.select();
    document.execCommand('copy');
    this.showToast('คัดลอกโค้ด Apps Script ลงในคลิปบอร์ดแล้ว', 'success');
  }

  updateAppsScriptCodeBox() {
    const box = document.getElementById('apps-script-code-box');
    if (!box) return;

    box.value = `
// ==========================================
// 💡 GOOGLE APPS SCRIPT FOR GOOGLE SHEETS DB
// วางโค้ดนี้ใน Extensions -> Apps Script
// ==========================================

const CHANNEL_ACCESS_TOKEN = "ใส่_CHANNEL_ACCESS_TOKEN_ของบอทที่นี่";

function doGet(e) {
  const action = e.parameter.action;
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === 'getAllData') {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      visits: getSheetDataAsJson(sheet.getSheetByName('Visits')),
      staffs: getSheetDataAsJson(sheet.getSheetByName('Staffs')),
      logs: getSheetDataAsJson(sheet.getSheetByName('Logs'))
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  const contents = e.postData.contents;
  const postData = JSON.parse(contents);
  
  // 1. ตรวจสอบกรณี LINE Webhook สำหรับรับเหตุการณ์บอท
  if (postData.events && postData.events.length > 0) {
    handleLineWebhook(postData.events[0]);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // 2. คำขอจัดการฐานข้อมูลจากระบบ LTC
  const action = postData.action;
  const data = postData.data;
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  let targetSheet;
  if (action.includes('Visit')) targetSheet = sheet.getSheetByName('Visits');
  else if (action.includes('Staff')) targetSheet = sheet.getSheetByName('Staffs');
  else if (action.includes('Log')) targetSheet = sheet.getSheetByName('Logs');

  if (action === 'saveVisit' || action === 'saveStaff' || action === 'saveLog') {
    saveRecordToSheet(targetSheet, data);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'deleteVisit' || action === 'deleteStaff') {
    deleteRecordFromSheet(targetSheet, data.id || data.username);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'clearLogs') {
    targetSheet.clear();
    targetSheet.appendRow(['id', 'timestamp', 'user', 'event', 'target']);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'sendLineMessage') {
    sendLineMessageDirect(postData.token || CHANNEL_ACCESS_TOKEN, postData.to, postData.message);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleLineWebhook(event) {
  const replyToken = event.replyToken;
  if (!replyToken) return;

  let sourceId = "";
  if (event.source.type === 'group') sourceId = event.source.groupId;
  else if (event.source.type === 'room') sourceId = event.source.roomId;
  else if (event.source.type === 'user') sourceId = event.source.userId;

  if (event.type === 'join') {
    const welcome = "สวัสดีครับ ผมบอทแจ้งเตือน LTC ยินดีที่ได้เข้าร่วมกลุ่มครับ!\\n\\nพิมพ์คำว่า 'getid' เพื่อแสดงรหัสกลุ่มนี้สำหรับนำไปตั้งค่าระบบการแจ้งเตือนเยี่ยมบ้าน";
    replyLineMessage(CHANNEL_ACCESS_TOKEN, replyToken, welcome);
  } else if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim().toLowerCase();
    if (text === 'getid' || text === 'get id') {
      const reply = "รหัสกลุ่มของคุณคือ:\\n\\n" + sourceId + "\\n\\n💡 นำรหัสนี้ไปบันทึกในช่อง LINE Group ID หน้าตั้งค่าได้เลยครับ";
      replyLineMessage(CHANNEL_ACCESS_TOKEN, replyToken, reply);
    }
  }
}

function replyLineMessage(token, replyToken, messageText) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: messageText }]
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

function sendLineMessageDirect(token, to, messageText) {
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: to,
    messages: [{ type: 'text', text: messageText }]
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

function getSheetDataAsJson(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  
  const headers = rows[0];
  const data = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = row[j];
      if (headers[j] === 'photos' && typeof val === 'string') {
        val = val ? JSON.parse(val) : [];
      }
      obj[headers[j]] = val;
    }
    data.push(obj);
  }
  return data;
}

function saveRecordToSheet(sheet, data) {
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  
  const keyName = headers[0];
  const keyValue = data[keyName];
  
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == keyValue) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const rowValues = headers.map(h => {
    let val = data[h];
    if (h === 'photos' && Array.isArray(val)) {
      return JSON.stringify(val);
    }
    return val === undefined ? '' : val;
  });
  
  if (rowIndex !== -1) {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

function deleteRecordFromSheet(sheet, keyValue) {
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == keyValue) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}
    `.trim();
  }

  /**
   * ระบบส่งออกตารางข้อมูลเยี่ยมบ้านเป็นไฟล์ Excel/CSV (UTF-8 BOM สำหรับ Excel ไทย)
   */
  exportToExcel() {
    if (this.state.visits.length === 0) {
      this.showToast('ไม่พบข้อมูลที่จะใช้ทำการส่งออก', 'warning');
      return;
    }

    this.showToast('กำลังจัดการดาวน์โหลดข้อมูลตาราง Excel (CSV)...', 'info');

    // สร้างเนื้อหาไฟล์ CSV แบบระบุหัวตารางไทย
    const headers = [
      'รหัสการเยี่ยม', 'ชื่อผู้รับบริการ', 'อายุ', 'ที่อยู่', 'วันที่เยี่ยม', 
      'เวลาเริ่ม', 'เวลาสิ้นสุด', 'ระยะเวลา (นาที)', 'การช่วยเหลือดูแล', 'กิจกรรมเพิ่มเติม',
      'SYS/DIA (mmHg)', 'ระดับความดันโลหิต', 'อาการผู้ป่วย', 'ปัญหาที่พบ', 'ของที่ต้องการขอเพิ่ม', 'หมายเหตุ',
      'เจ้าหน้าที่ CG', 'พิกัด GPS'
    ];

    const rows = this.state.visits.map(v => {
      const fullAddress = `บ้านเลขที่ ${v.addressNo} ${v.addressMoo ? 'ม.' + v.addressMoo : ''} ต.${v.addressSubdistrict} อ.${v.addressDistrict} จ.${v.addressProvince} ${v.addressZip}`;
      const gps = v.gpsLat && v.gpsLng ? `${v.gpsLat},${v.gpsLng}` : '';
      return [
        v.id, `${v.patientTitle}${v.patientFirstname} ${v.patientLastname}`, v.patientAge, fullAddress, v.visitDate,
        v.visitTimeStart, v.visitTimeEnd, v.visitDuration, v.careDetails, v.careActivities,
        `${v.bpSystolic}/${v.bpDiastolic}`, v.bpAnalysis, v.healthSymptoms, v.healthProblems, v.requestedItems, v.healthRemarks,
        `${v.cgFirstname} ${v.cgLastname || ''}`, gps
      ];
    });

    // 1. เพิ่มโค้ด BOM (Byte Order Mark) เพื่อเปิดใน Excel แล้วอ่านภาษาไทยออกทันที (\uFEFF)
    let csvContent = '\uFEFF';
    
    // 2. แปลงอาร์เรย์แถวเป็น CSV String
    csvContent += [headers, ...rows].map(row => 
      row.map(val => {
        // หากมีเครื่องหมายฟันหนูหรือจุลภาคในเนื้อความให้ล้อมรอบด้วยเครื่องหมายฟันหนูคู่
        let cell = String(val === null || val === undefined ? '' : val).replace(/"/g, '""');
        if (cell.includes(',') || cell.includes('\n') || cell.includes('"')) {
          cell = `"${cell}"`;
        }
        return cell;
      }).join(',')
    ).join('\n');

    // 3. ทริกเกอร์ดึงดาวน์โหลด
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `LTC_Visits_Report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.addAuditLog('ดาวน์โหลดและส่งออกไฟล์ประวัติการเยี่ยมบ้านแบบตาราง CSV');
  }

  /**
   * ตัวช่วยจัดฟอร์แมตวันที่แบบไทย (เช่น 8 มิ.ย. 2569)
   */
  formatThaiDate(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;

    const y = parseInt(parts[0]) + 543;
    const m = parseInt(parts[1]);
    const d = parseInt(parts[2]);

    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    return `${d} ${thaiMonths[m - 1]} ${y}`;
  }

  populateTimeSelects() {
    const startH = document.getElementById('visit-time-start-h');
    const startM = document.getElementById('visit-time-start-m');
    const endH = document.getElementById('visit-time-end-h');
    const endM = document.getElementById('visit-time-end-m');

    if (!startH || !startM || !endH || !endM) return;

    startH.innerHTML = '';
    startM.innerHTML = '';
    endH.innerHTML = '';
    endM.innerHTML = '';

    for (let i = 0; i < 24; i++) {
      const val = String(i).padStart(2, '0');
      startH.add(new Option(val, val));
      endH.add(new Option(val, val));
    }

    for (let i = 0; i < 60; i++) {
      const val = String(i).padStart(2, '0');
      startM.add(new Option(val, val));
      endM.add(new Option(val, val));
    }
  }

  onCustomTimeChange() {
    const startH = document.getElementById('visit-time-start-h').value;
    const startM = document.getElementById('visit-time-start-m').value;
    const endH = document.getElementById('visit-time-end-h').value;
    const endM = document.getElementById('visit-time-end-m').value;

    document.getElementById('visit-time-start').value = `${startH}:${startM}`;
    document.getElementById('visit-time-end').value = `${endH}:${endM}`;

    this.calculateDuration();
  }

  syncCustomTimeSelects() {
    const startVal = document.getElementById('visit-time-start').value || '00:00';
    const endVal = document.getElementById('visit-time-end').value || '00:00';

    const [startH, startM] = startVal.split(':');
    const [endH, endM] = endVal.split(':');

    const shSelect = document.getElementById('visit-time-start-h');
    const smSelect = document.getElementById('visit-time-start-m');
    const ehSelect = document.getElementById('visit-time-end-h');
    const emSelect = document.getElementById('visit-time-end-m');

    if (shSelect && startH) shSelect.value = startH;
    if (smSelect && startM) smSelect.value = startM;
    if (ehSelect && endH) ehSelect.value = endH;
    if (emSelect && endM) emSelect.value = endM;
  }

  setQuickDuration(minutes) {
    const now = new Date();
    const startHH = String(now.getHours()).padStart(2, '0');
    const startMM = String(now.getMinutes()).padStart(2, '0');

    const endDate = new Date(now.getTime() + minutes * 60 * 1000);
    const endHH = String(endDate.getHours()).padStart(2, '0');
    const endMM = String(endDate.getMinutes()).padStart(2, '0');

    document.getElementById('visit-time-start-h').value = startHH;
    document.getElementById('visit-time-start-m').value = startMM;
    document.getElementById('visit-time-end-h').value = endHH;
    document.getElementById('visit-time-end-m').value = endMM;

    this.onCustomTimeChange();
  }
}

// เปิดการเริ่มต้นระบบเมื่อโหลดเอกสารสำเร็จ
const app = new LTCApplication();
window.addEventListener('DOMContentLoaded', app.init);
window.app = app; // ผูกไว้กับ window เพื่ออำนวยความสะดวกในการเรียกใช้บน UI
