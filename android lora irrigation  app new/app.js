// ============================================
// Smart Irrigation — Core App Logic
// ============================================
(function () {
  'use strict';
  const APP_VERSION_CODE = 1, APP_VERSION_NAME = 'v1.0';
  const ALARM_DURATION_MS = 60000, HEARTBEAT_TIMEOUT_MS = 10000;
  const LONG_RUN_MS = 2 * 60 * 60 * 1000; // 2 hours
  let dbRefs = null;

  const state = {
    motorState: 'OFF', motorCommand: 'OFF', motorActual: 'UNKNOWN',
    
    phaseAvailable: null, phaseType: 'THREE_PHASE', prevPhaseAvailable: null,
    psrOk: null, psrRaw: 0, currentAmps: 0,
    lora: { rssi: 0, snr: 0 }, motorCurrent: null,
    alert: false, transmissionInterval: 3, isOnline: navigator.onLine,
    isSendingCommand: false, notificationsEnabled: true, vibrationEnabled: true,
    alertSound: 'default', customAlarmAudioUrl: null,
    lastLoraUpdate: Date.now(), loraLost: false,
    darkMode: localStorage.getItem('darkMode') === 'true',
    lang: localStorage.getItem('appLang') || 'en',
    alarmActive: false, alarmInterval: null, alarmTimeout: null,
    alarmStartTime: null, customAudioElement: null, vibrationInterval: null,
    lastHomeUpdate: 0, lastFieldUpdate: 0, homeOnline: false, fieldOnline: false, loraAlive: false,
    gatewayStatus: 'connected', fieldStatus: 'reachable', loraStatus: 'connected',
    deviceStatus: { home_esp32: 'offline', field_esp32: 'offline', field_lora: 'offline', home_lora: 'offline' },
    restartCooldowns: {}, pendingRestartDevice: null,
    remoteVersionCode: null, remoteVersionName: null,
    updateMessage: '', forceUpdate: false, apkUrl: '',
    currentUser: null, users: {}, pinInput: '',
    // Timer
    timerActive: false, timerRemaining: 0, timerDuration: 0, timerInterval: null,
    
    // Power Reminder
    powerReminderEnabled: false,
    // Analytics
    runtimeLedger: null, runtimeLoaded: false, runtimeSyncError: false, firebaseConnected: false,
    serverTimeOffset: 0, serverClockLoaded: false,
    motorActualLoaded: false, homeHeartbeatLoaded: false, fieldHeartbeatLoaded: false, sessionStart: 0,
    rssiHistory: [], snrHistory: [], currentHistory: [], livePowerHistory: [], signalRange: 30, currentRange: 'today', logs: [],
    // Command pipeline
    pendingCommand: null, commandId: null, commandOutcomeUnknown: false,
    // Schedule
    schedules: [], editingScheduleId: null,
    // Long run
    longRunAlerted: false, motorOnSince: 0, longRunNext: 0
  };

function isPhaseAvailableValue(value) {
    console.log('[PHASE DEBUG] Normalizing phase value:', value, 'type:', typeof value);

    if (value === true) return true;
    if (value === false) return false;

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();

        if (
            normalized === 'true' ||
            normalized === 'on' ||
            normalized === 'available' ||
            normalized === '1'
        ) {
            return true;
        }

        if (
            normalized === 'false' ||
            normalized === 'off' ||
            normalized === 'unavailable' ||
            normalized === '0'
        ) {
            return false;
        }
    }

    if (
        value &&
        typeof value === 'object' &&
        Object.prototype.hasOwnProperty.call(value, 'available')
    ) {
        return isPhaseAvailableValue(value.available);
    }

    return false;
}
  const isPhaseMissing = () => {
    const isAvail = isPhaseAvailableValue(state.phaseAvailable);
    console.log(
      "[PHASE DEBUG] isPhaseAvail:",
      isAvail,
      "raw:",
      state.phaseAvailable
    );
    return state.phaseAvailable !== null && state.phaseAvailable !== undefined && !isAvail;
  };

  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
  const dom = {};

  function debugLog(category, ...args) {
    console.log(`[${category}]`, ...args);
  }

  function cacheDom() {
    const ids = ['screen-select-user', 'screen-pin', 'screen-pin-setup', 'setup-pin-yes', 'setup-pin-no', 'screen-pin-create', 'create-pin-title', 'create-pin-desc', 'create-pin-dot-0', 'create-pin-dot-1', 'create-pin-dot-2', 'create-pin-dot-3', 'create-pin-error', 'pin-dot-0', 'pin-dot-1', 'pin-dot-2', 'pin-dot-3', 'app-wrapper', 'user-list', 'pin-user-name', 'pin-error', 'header-user-label', 'warning-banner', 'motor-btn', 'motor-btn-text', 'motor-btn-icon', 'motor-btn-spinner', 'motor-status-text', 'motor-status-dot', 'lora-rssi-value', 'lora-snr-value', 'signal-badge', 'signal-badge-text', 'lora-lost-banner', 'signal-lost-overlay', 'interval-slider', 'interval-value', 'alert-overlay', 'alert-dismiss', 'alert-remind', 'alarm-overlay', 'alarm-dismiss-btn', 'alarm-timer', 'alarm-ring', 'alarm-message', 'offline-banner', 'connection-dot', 'notif-toggle', 'vib-toggle', 'sound-select', 'custom-audio-input', 'custom-audio-name', 'custom-audio-row', 'test-notif-btn', 'dark-mode-toggle', 'lora-link-card', 'home-esp32-status-val', 'home-lora-status-val', 'field-esp32-status-val', 'field-lora-status-val', 'gateway-offline-warn', 'field-offline-warn', 'confirm-overlay', 'confirm-title', 'confirm-message', 'confirm-yes', 'confirm-no', 'update-overlay', 'update-title', 'update-message', 'update-download-btn', 'update-later-btn', 'force-update-overlay', 'force-update-msg', 'force-update-btn', 'check-update-btn', 'current-version-label', 'toast-container', 'lang-toggle-btn', 'logout-btn', 'settings-username', 'settings-device-id', 'cmd-status-bar', 'cmd-status-text', 'timer-inline', 'timer-countdown', 'timer-slider', 'timer-slider-val', 'timer-hours', 'timer-mins', 'timer-start-btn', 'timer-stop-btn', 'sched-time', 'sched-dur-hours', 'sched-dur-mins', 'sched-repeat', 'sched-add-btn', 'sched-list', 'sched-empty', 'sched-conflict', 'schedule-inline', 'schedule-next-text', 'usage-session', 'usage-today', 'usage-week', 'usage-month', 'rssi-chart', 'snr-chart', 'longrun-overlay', 'longrun-message', 'longrun-off-btn', 'longrun-keep-btn', 'cmd-actual-row', 'cmd-state', 'actual-state', 'current-state', 'change-pin-card', 'pin-current', 'pin-new', 'pin-confirm', 'pin-change-error', 'pin-change-success', 'pin-update-btn', 'current-live-val', 'current-avg-today', 'current-avg-week', 'current-chart', 'current-range-btns', 'signal-range-btns', 'security-settings-card', 'security-status-item', 'pin-lock-status-desc', 'ask-pin-item', 'ask-pin-toggle', 'enable-pin-btn-container', 'enable-pin-btn', 'disable-pin-btn-container', 'disable-pin-btn', 'pin-change-form', 'phase-status-indicator', 'phase-type-label', 'phase-status-text'];
    ids.forEach(id => { const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); dom[key] = document.getElementById(id); });
    // Explicitly cache pin dots (numeric suffix doesn't camelCase via regex)
    for (let i = 0; i < 4; i++) { dom['pinDot' + i] = document.getElementById('pin-dot-' + i); }
    dom.navItems = $$('.nav-item'); dom.tabViews = $$('.tab-view');
  }

  // ═══ LANGUAGE ═══
  function t(key) { return (i18n[state.lang] && i18n[state.lang][key]) || i18n.en[key] || key; }
  function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.getAttribute('data-i18n')); if (v) el.textContent = v; });
    if (dom.langToggleBtn) dom.langToggleBtn.textContent = state.lang === 'en' ? 'EN' : 'ML';
    if (state.currentUser) { dom.headerUserLabel.textContent = state.currentUser.name + "'s motor"; updateMotorUI(); updateLoraUI(); updateHeartbeatUI(); updateDeviceStatusUI(); }
  }

  // ═══ INIT ═══
  function init() { cacheDom(); applyTheme(); if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `${APP_VERSION_NAME} (build ${APP_VERSION_CODE})`; if (dom.langToggleBtn) dom.langToggleBtn.addEventListener('click', () => { state.lang = state.lang === 'en' ? 'ml' : 'en'; localStorage.setItem('appLang', state.lang); applyLanguage(); }); checkSavedUser(); }

  // ═══ AUTH ═══
  function showOnlyAuthScreen(screen) {
    [dom.screenSelectUser, dom.screenPin, dom.screenPinSetup, dom.screenPinCreate, dom.appWrapper].forEach(el => {
      if (el) el.classList.add('hidden');
    });
    if (screen) screen.classList.remove('hidden');
  }

  function checkSavedUser() {
    const saved = localStorage.getItem('irrigationUser');
    if (saved) {
      try {
        state.currentUser = JSON.parse(saved);
        if (state.currentUser.pinEnabled === true && state.currentUser.alwaysAskPin !== false) showPinScreen();
        else enterApp();
      } catch (e) {
        localStorage.removeItem('irrigationUser'); showUserSelection();
      }
    }
    else showUserSelection();
    applyLanguage();
  }

  function showUserSelection() { showOnlyAuthScreen(dom.screenSelectUser); fetchUsers(); }

  function fetchUsers() {
    dom.userList.innerHTML = `<div class="user-loading">${t('loading_users')}</div>`;
    if (typeof usersRef === 'undefined') { dom.userList.innerHTML = '<div class="user-error" style="text-align:center;padding:20px;color:var(--text-secondary);">Firebase not configured</div>'; return; }

    usersRef.once('value').then(s => {
      const d = s.val();
      if (d) { state.users = d; renderUserList(d); }
      else { dom.userList.innerHTML = '<div class="user-error" style="text-align:center;padding:20px;color:var(--text-secondary);">No users found</div>'; }
    }).catch(e => {
      dom.userList.innerHTML = `<div class="user-error" style="text-align:center;padding:20px;color:var(--color-red);">Failed to load users: ${e.message}</div>`;
    });
  }

  function renderUserList(users) {
    dom.userList.innerHTML = '';
    Object.keys(users).forEach(uid => { const u = users[uid]; const c = document.createElement('div'); c.className = 'user-card'; c.innerHTML = `<div class="user-avatar">${u.name.charAt(0).toUpperCase()}</div><div class="user-card-name">${u.name}</div>`; c.addEventListener('click', () => selectUser(uid, u)); dom.userList.appendChild(c); });
  }

  function selectUser(uid, u) {
    const deviceId = u.device_id || u.deviceId;
    console.log('[USER DEBUG] selected userId:', uid, 'resolved deviceId:', deviceId);
    state.currentUser = { userId: uid, name: u.name, deviceId: deviceId, pinEnabled: u.pin_enabled === true, pinCode: u.pin_code, alwaysAskPin: u.pin_on_start !== false, admin: u.admin === true };

    if (u.pin_enabled === true && u.pin_code) {
      showPinScreen();
    } else if (u.pin_enabled === false && u.pin_code === "DISABLED") {
      saveUserAndEnter();
    } else if (u.pin_enabled === false) {
      saveUserAndEnter();
    } else if (u.pin_enabled === undefined || u.pin_enabled === null || !u.pin_code) {
      showPinSetupScreen();
    } else {
      saveUserAndEnter();
    }
  }

  // ONBOARDING SETUP
  function showPinSetupScreen() {
    showOnlyAuthScreen(dom.screenPinSetup);
    
    if (!state.pinSetupInitialized) {
      state.pinSetupInitialized = true;
      if (dom.setupPinYes) dom.setupPinYes.addEventListener('click', () => { showPinCreateScreen('setup'); });
      if (dom.setupPinNo) dom.setupPinNo.addEventListener('click', async () => {
        state.currentUser.pinEnabled = false;
        state.currentUser.pinCode = 'DISABLED';
        state.currentUser.alwaysAskPin = false;
        if (typeof usersRef !== 'undefined') {
          try {
            await usersRef.child(state.currentUser.userId).update({ pin_enabled: false, pin_code: 'DISABLED', pin_on_start: false });
            saveUserAndEnter();
          } catch (e) {
            console.error('Firebase update failed', e);
            showToast('Failed to save security setting', 'error');
          }
        } else {
          saveUserAndEnter();
        }
      });
    }
  }

  let pinCreateMode = 'setup';
  let pinCreationStep = 'create';
  let firstPin = '';
  let currentPinInput = '';

  function showPinCreateScreen(mode) {
    pinCreateMode = mode;
    pinCreationStep = 'create';
    firstPin = '';
    currentPinInput = '';

    showOnlyAuthScreen(dom.screenPinCreate);

    if (dom.createPinTitle) dom.createPinTitle.textContent = t('create_pin_title') || 'Create PIN';
    if (dom.createPinDesc) dom.createPinDesc.textContent = t('create_pin_desc') || 'Enter a new 4-digit PIN';
    updateCreatePinDots(0);
    if (dom.createPinError) dom.createPinError.classList.add('hidden');
    setupCreatePinPad();
  }

  function setupCreatePinPad() {
    if (state.createPadInitialized) return;
    state.createPadInitialized = true;
    
    $$('.create-key').forEach(key => {
      key.addEventListener('click', async () => {
        const k = key.dataset.key;
        if (!k) return;
        
        if (k === 'del') {
          currentPinInput = currentPinInput.slice(0, -1);
          if (dom.createPinError) dom.createPinError.classList.add('hidden');
        } else if (currentPinInput.length < 4) {
          currentPinInput += k;
        }

        updateCreatePinDots(currentPinInput.length);

        if (currentPinInput.length === 4) {
          if (pinCreationStep === 'create') {
            firstPin = currentPinInput;
            pinCreationStep = 'confirm';
            currentPinInput = '';
            setTimeout(() => {
              if (dom.createPinTitle) dom.createPinTitle.textContent = t('confirm_pin_title') || 'Confirm PIN';
              if (dom.createPinDesc) dom.createPinDesc.textContent = t('confirm_pin_desc') || 'Enter your new PIN again';
              updateCreatePinDots(0);
            }, 300);
          } else if (pinCreationStep === 'confirm') {
            if (currentPinInput === firstPin) {
              // success
              state.currentUser.pinEnabled = true;
              state.currentUser.pinCode = currentPinInput;
              state.currentUser.alwaysAskPin = true;
              
              if (typeof usersRef !== 'undefined') {
                try {
                  await usersRef.child(state.currentUser.userId).update({ pin_enabled: true, pin_code: currentPinInput, pin_on_start: true });
                  if (pinCreateMode === 'setup') {
                    saveUserAndEnter();
                  } else {
                    // Update from settings
                    showToast('PIN updated successfully!', 'success');
                    enterApp();
                  }
                } catch (e) {
                  showToast('Failed to save PIN', 'error');
                }
              } else {
                if (pinCreateMode === 'setup') saveUserAndEnter();
                else enterApp();
              }
            } else {
              // mismatch
              if (dom.createPinError) {
                dom.createPinError.textContent = t('pin_mismatch') || 'PINs do not match. Try again.';
                dom.createPinError.classList.remove('hidden');
              }
              currentPinInput = '';
              setTimeout(() => { updateCreatePinDots(0); }, 300);
            }
          }
        }
      });
    });
  }

  function updateCreatePinDots(len) {
    for(let i=0; i<4; i++){
      const d = document.getElementById(`create-pin-dot-${i}`);
      if(d) d.classList.toggle('filled', i < len);
    }
  }


  let activePinInput = '';
  function showPinScreen() {
    showOnlyAuthScreen(dom.screenPin); activePinInput = ''; updatePinDots(0);
    if (dom.pinUserName) dom.pinUserName.textContent = t('welcome_back') + ', ' + state.currentUser.name;
    if (dom.pinError) dom.pinError.classList.add('hidden');
    setupPinPad();
  }

  function setupPinPad() {
    if (state.pinPadInitialized) return; state.pinPadInitialized = true;
    $$('#screen-pin .pin-key').forEach(key => {
      key.addEventListener('click', () => {
        const k = key.dataset.key; if (!k) return;
        if (k === 'del') { activePinInput = activePinInput.slice(0, -1); if (dom.pinError) dom.pinError.classList.add('hidden'); }
        else if (activePinInput.length < 4) { activePinInput += k; }
        updatePinDots(activePinInput.length);
        if (activePinInput.length === 4) {
          if (activePinInput === state.currentUser.pinCode) { saveUserAndEnter(); }
          else {
            if (dom.pinError) { dom.pinError.textContent = t('wrong_pin'); dom.pinError.classList.remove('hidden'); }
            activePinInput = ''; setTimeout(() => updatePinDots(0), 400);
          }
        }
      });
    });
  }
  function updatePinDots(len) { for (let i = 0; i < 4; i++) { const d = dom['pinDot' + i]; if (d) d.classList.toggle('filled', i < len); } }

  function saveUserAndEnter() { localStorage.setItem('irrigationUser', JSON.stringify(state.currentUser)); enterApp(); }

  function enterApp() { 
    console.log('[FIREBASE] Database initialized for user:', state.currentUser.name, 'deviceId:', state.currentUser.deviceId);
    showOnlyAuthScreen(dom.appWrapper); applyLanguage(); dbRefs = buildDbRefs(state.currentUser.deviceId); setupAll(); 
    
  }

  function setupAll() { setupTabNav(); setupMotorButton(); setupIntervalSlider(); setupAlertPopup(); setupAlarmSystem(); setupConfirmPopup(); setupDeviceRestartButtons(); setupUpdateSystem();  setupSettings(); setupNetworkListeners(); setupFirebaseListeners(); startLoraTimeoutChecker(); startHeartbeatChecker(); setupTimer(); setupSchedule(); setupAnalytics(); setupLongRunCheck(); }

  function logout() { localStorage.removeItem('irrigationUser'); if (dbRefs) { Object.values(dbRefs).forEach(r => { try { r.off(); } catch (e) { } }); dbRefs = null; } state.currentUser = null; location.reload(); }


  // ═══ THEME / TABS / NETWORK / TOAST ═══
  function applyTheme() { document.body.setAttribute('data-theme', state.darkMode ? 'dark' : 'light'); if (dom.darkModeToggle) dom.darkModeToggle.checked = state.darkMode; }
  function setupTabNav() { dom.navItems.forEach(item => item.addEventListener('click', () => { dom.navItems.forEach(n => n.classList.toggle('active', n.dataset.tab === item.dataset.tab)); dom.tabViews.forEach(v => v.classList.toggle('active', v.id === item.dataset.tab)); if (item.dataset.tab === 'tab-analytics') updateCharts(); })); }
  function setupNetworkListeners() { window.addEventListener('online', () => { state.isOnline = true; dom.offlineBanner.classList.remove('visible'); dom.connectionDot.classList.remove('offline'); }); window.addEventListener('offline', () => { state.isOnline = false; dom.offlineBanner.classList.add('visible'); dom.connectionDot.classList.add('offline'); }); if (!navigator.onLine) { dom.offlineBanner.classList.add('visible'); dom.connectionDot.classList.add('offline'); } }
  function showToast(msg, type) { const el = document.createElement('div'); el.className = 'toast ' + (type || 'info'); el.textContent = msg; dom.toastContainer.appendChild(el); setTimeout(() => { if (el.parentNode) el.remove(); }, 3200); }

  // ═══ FIREBASE LISTENERS ═══
  function setupFirebaseListeners() {
    if (!dbRefs) return;
    if (dbRefs.serverTimeOffset) dbRefs.serverTimeOffset.on('value', s => {
      const offset = s.val();
      if (typeof offset !== 'number' || !Number.isFinite(offset)) return;
      state.serverTimeOffset = offset;
      state.serverClockLoaded = true;
      updateHeartbeatUI();
      updateUsageUI();
    });
    if (dbRefs.motorCommand) dbRefs.motorCommand.on('value', s => { 
      const val = s.val();
      state.motorCommand = (val === 'ON' || val === 'START') ? 'ON' : 'OFF'; 
      updateMotorUI(); 
    });
    let initialMotorActual = true;
    if (dbRefs.motorActual) dbRefs.motorActual.on('value', s => { 
      const oldState = state.motorActual;
      state.motorActual = s.val() || 'UNKNOWN'; 
      state.motorActualLoaded = true;
      
      if (!initialMotorActual && oldState !== state.motorActual && state.motorActual !== 'UNKNOWN') {
        if (dbRefs.systemLogs) {
          const srcTag = state.lastSuccessfulSource ? ` (${state.lastSuccessfulSource})` : '';
          dbRefs.systemLogs.push({
            message: `Motor command: ${state.motorCommand} | Motor actual: ${state.motorActual}${srcTag}`,
            time: Date.now(),
            type: `motor_${state.motorActual.toLowerCase()}`
          });
        }
      }
      initialMotorActual = false;

      updateMotorUI(); 
      updateTimerUI(); 
      trackMotorRuntime(oldState);
      syncMotorRuntime(true);
      

    });
    // Read the legacy string status and its ID from the same snapshot.
    if (dbRefs.motor) dbRefs.motor.on('value', s => handleMotorCommandSnapshot(s.val()));
    if (dbRefs.phaseAvailable) {
      dbRefs.phaseAvailable.on('value', s => {
        console.log('[PHASE DEBUG] Listening to device:', state.currentUser.deviceId);
        const raw = s.val();
        console.log('[PHASE DEBUG] Firebase phase raw data:', raw);
        let phaseAvail = raw;
        if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'available')) {
          phaseAvail = raw.available;
        }
        const normalized = isPhaseAvailableValue(phaseAvail);
        console.log('[PHASE DEBUG] Normalized phaseAvailable:', normalized);
        state.phaseAvailable = raw == null ? null : normalized;
        console.log('[PHASE DEBUG] state.phaseAvailable set to:', state.phaseAvailable);
        updatePhaseUI();
        
        recordPowerPoint();
        updateCurrentAnalyticsUI();
      });
    }
    if (dbRefs.phaseType) {
      dbRefs.phaseType.on('value', s => { 
        console.log('[PHASE] Raw Firebase data (phaseType):', s.val());
        state.phaseType = s.val(); 
        updatePhaseUI(); 
      });
    }
    if (dbRefs.psrOk) dbRefs.psrOk.on('value', s => {
      const value = s.val();
      state.psrOk = value == null ? null : isPhaseAvailableValue(value);
      recordPowerPoint();
      updateCurrentAnalyticsUI();
    });
    if (dbRefs.psrRaw) dbRefs.psrRaw.on('value', s => { state.psrRaw = s.val(); });
    // FIX: Single consolidated currentAmps listener (was duplicated)
    if (dbRefs.currentAmps) dbRefs.currentAmps.on('value', s => { 
      const val = s.val();
      state.currentAmps = val || 0; 
      state.motorCurrent = val; 
      if (typeof updateCurrentAnalyticsUI === 'function') updateCurrentAnalyticsUI(); 
      updateMotorUI(); 
    });
    dbRefs.loraRssi.on('value', s => {
      state.lora.rssi = s.val() || 0;
      // Build RSSI history locally from live value changes
      const now = Date.now();
      if (state.rssiHistory.length === 0) {
        state.rssiHistory.push({ time: now - 24 * 60 * 60 * 1000, value: Number(state.lora.rssi) });
      }
      state.rssiHistory.push({ time: now, value: Number(state.lora.rssi) });
      const cutoff24h = now - 24 * 60 * 60 * 1000;
      while (state.rssiHistory.length > 0 && state.rssiHistory[0].time < cutoff24h) state.rssiHistory.shift();
      if (state.rssiHistory.length > 500) state.rssiHistory.splice(0, state.rssiHistory.length - 500);
      updateLoraUI(); updateSignalLostLockout(); updateCharts();
    });
    dbRefs.loraSnr.on('value', s => {
      state.lora.snr = s.val() || 0;
      // Build SNR history locally from live value changes
      const now = Date.now();
      if (state.snrHistory.length === 0) {
        state.snrHistory.push({ time: now - 24 * 60 * 60 * 1000, value: Number(state.lora.snr) });
      }
      state.snrHistory.push({ time: now, value: Number(state.lora.snr) });
      const cutoff24h = now - 24 * 60 * 60 * 1000;
      while (state.snrHistory.length > 0 && state.snrHistory[0].time < cutoff24h) state.snrHistory.shift();
      if (state.snrHistory.length > 500) state.snrHistory.splice(0, state.snrHistory.length - 500);
      updateLoraUI(); updateCharts();
    });

    // RSSI History - Validate time-series format
    dbRefs.rssiHistory.on('value', s => {
      if (!s.exists()) return;
      const tempRssi = [];
      s.forEach(c => {
        const d = c.val();
        if (d && typeof d === 'object' && d.time && d.value !== undefined) {
          tempRssi.push({ time: Number(d.time), value: Number(d.value) });
        }
      });
      if (tempRssi.length > 0) {
        state.rssiHistory = tempRssi;
        updateCharts();
      }
    });

    // SNR History - Validate time-series format
    dbRefs.snrHistory.on('value', s => {
      if (!s.exists()) return;
      const tempSnr = [];
      s.forEach(c => {
        const d = c.val();
        if (d && typeof d === 'object' && d.time && d.value !== undefined) {
          tempSnr.push({ time: Number(d.time), value: Number(d.value) });
        }
      });
      if (tempSnr.length > 0) {
        state.snrHistory = tempSnr;
        updateCharts();
      }
    });

    // Current History - Validate time-series format
    if (dbRefs.currentHistory) dbRefs.currentHistory.on('value', s => {
      const tempCurrent = [];
      s.forEach(c => {
        const d = c.val();
        if (d && typeof d === 'object' && d.time && d.value !== undefined) {
          tempCurrent.push({ time: Number(d.time), value: Number(d.value) });
        }
      });
      // Keep live observations separate so an older database snapshot cannot erase them.
      state.currentHistory = tempCurrent;
      updateCurrentAnalyticsUI();
    });
    if (dbRefs.systemLogs) {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      dbRefs.systemLogs.orderByChild('time').startAt(thirtyDaysAgo).on('value', s => {
        state.logs = [];
        s.forEach(child => {
          const l = child.val();
          if (l && l.time) state.logs.push({ id: child.key, ...l });
        });
        updateLogsUI();
      });
    }
    if (dbRefs.alert) dbRefs.alert.on('value', s => { state.alert = s.val() === true; if (state.alert) showAlertPopup(); });
    if (dbRefs.transmissionInterval) dbRefs.transmissionInterval.on('value', s => { const v = s.val(); if (v != null) { state.transmissionInterval = parseFloat(v); if (dom.intervalSlider) dom.intervalSlider.value = state.transmissionInterval; updateIntervalDisplay(); } });
    let lastFieldSeenRaw = null;
    if (dbRefs.fieldLastSeen) dbRefs.fieldLastSeen.on('value', s => {
      state.fieldHeartbeatLoaded = true;
      const val = s.val();
      if (val !== lastFieldSeenRaw && lastFieldSeenRaw !== null) {
        state.lastFieldUpdate = serverNow();
      } else if (lastFieldSeenRaw === null) {
        const norm = normalizeRuntimeTimestamp(val);
        if (norm > 0) state.lastFieldUpdate = norm;
      }
      lastFieldSeenRaw = val;
      updateHeartbeatUI();
    });
    let lastHomeSeenRaw = null;
    if (dbRefs.homeLastSeen) dbRefs.homeLastSeen.on('value', s => {
      state.homeHeartbeatLoaded = true;
      const val = s.val();
      if (val !== lastHomeSeenRaw && lastHomeSeenRaw !== null) {
        state.lastHomeUpdate = serverNow();
      } else if (lastHomeSeenRaw === null) {
        const norm = normalizeRuntimeTimestamp(val);
        if (norm > 0) state.lastHomeUpdate = norm;
      }
      lastHomeSeenRaw = val;
      updateHeartbeatUI();
    });
    ['statusHomeEsp32', 'statusFieldEsp32', 'statusFieldLora', 'statusHomeWifi'].forEach(k => { const dk = k.replace('status', '').replace(/([A-Z])/g, '_$1').toLowerCase().slice(1); if (dbRefs[k]) dbRefs[k].on('value', s => { state.deviceStatus[dk] = s.val() || 'offline'; updateDeviceStatusUI(); }); });
    dbRefs.appVersionCode.on('value', s => { state.remoteVersionCode = s.val(); checkForUpdate(); });
    dbRefs.appVersionName.on('value', s => { state.remoteVersionName = s.val(); });
    dbRefs.appUpdateMessage.on('value', s => { state.updateMessage = s.val() || ''; });
    dbRefs.appForceUpdate.on('value', s => { state.forceUpdate = s.val() === true; checkForUpdate(); });
    dbRefs.appApkUrl.on('value', s => { state.apkUrl = s.val() || ''; });
    if (dbRefs.webRuntime) dbRefs.webRuntime.on('value', s => {
      state.runtimeLedger = s.val();
      state.runtimeLoaded = true;
      updateSessionUI(); updateUsageUI(); syncMotorRuntime();
    }, () => { state.runtimeSyncError = true; updateUsageUI(); });
    if (dbRefs.firebaseConnected) dbRefs.firebaseConnected.on('value', s => {
      state.firebaseConnected = s.val() === true;
      updateHeartbeatUI();
      updateMotorUI();
      updateUsageUI(); syncMotorRuntime(true);
    });
    dbRefs.timerActive.on('value', s => { state.timerActive = s.val() === true; updateTimerUI(); });
    dbRefs.timerRemaining.on('value', s => { state.timerRemaining = s.val() || 0; updateTimerUI(); });
    dbRefs.timerDuration.on('value', s => { state.timerDuration = s.val() || 0; });

    // Note: schedules are loaded in setupSchedule() via schedulesRef


  }

  // exposing for features.js
  window._irr = { state, dom, dbRefs: () => dbRefs, t, showToast, startAlarm };

  // ═══ HEARTBEAT ═══
  function serverNow() { return Date.now() + state.serverTimeOffset; }
  function heartbeatFresh(timestamp, now = serverNow()) {
    // Allow a small NTP/network estimation difference, but never a far-future heartbeat.
    const age = now - timestamp;
    return state.serverClockLoaded && state.firebaseConnected && timestamp > 0 && age >= -5000 && age < 60000;
  }
  function connectionState() {
    const now = serverNow();
    const homeAlive = heartbeatFresh(state.lastHomeUpdate, now);
    const fieldAlive = heartbeatFresh(state.lastFieldUpdate, now);
    return { homeAlive, fieldAlive, loraAlive: homeAlive && fieldAlive };
  }
  function startHeartbeatChecker() { setInterval(updateHeartbeatUI, 1000); }
  function updateHeartbeatUI() {
    const { homeAlive, fieldAlive, loraAlive } = connectionState();

    // 2. Update state
    state.homeOnline = homeAlive;
    state.fieldOnline = fieldAlive;
    state.loraAlive = loraAlive;
    state.loraLost = !loraAlive; // Sync legacy flag

    // 3. Update LoRa Tab / Dashboard labels
    if (dom.homeEsp32StatusVal) {
      dom.homeEsp32StatusVal.textContent = homeAlive ? '🟢 Connected' : '🔴 Disconnected';
    }

    if (dom.homeLoraStatusVal) {
      dom.homeLoraStatusVal.textContent = loraAlive ? '🟢 Connected' : '⚫ Unreachable';
    }

    if (dom.fieldDeviceStatusVal) {
      dom.fieldDeviceStatusVal.textContent = loraAlive ? '🟢 Reachable' : '⚫ Unreachable';
    }

    // Update global banners/overlays
    updateSignalLostLockout();
    updateDeviceStatusUI();
    updateRestartButtonsState();
    syncMotorRuntime();
  }

  function updateSignalLostLockout() {
    if (state.loraLost) {
      dom.signalLostOverlay.classList.add('visible');
      const motorIsOn = (state.motorCommand === 'ON' || state.motorCommand === 'START' || state.motorActual === 'ON');
      dom.motorBtn.disabled = !motorIsOn;
    } else {
      dom.signalLostOverlay.classList.remove('visible');
      updateMotorUI();
    }
  }

  // ═══ PHASE / MOTOR / OVERRIDE ═══
  function renderPhaseStatus(isReachable = state.loraAlive) {
    const isLoaded = state.phaseAvailable !== null && state.phaseAvailable !== undefined;
    const isAvail = isPhaseAvailableValue(state.phaseAvailable);

    if (dom.phaseStatusIndicator) {
      dom.phaseStatusIndicator.classList.toggle('on', isReachable && isLoaded && isAvail);
      dom.phaseStatusIndicator.classList.toggle('off', !isReachable || (isLoaded && !isAvail));
    }
    
    if (dom.phaseTypeLabel) {
      const rawType = state.phaseType;
      const isThreePhase = String(rawType || '').trim().toUpperCase() === 'THREE_PHASE';
      dom.phaseTypeLabel.textContent = isThreePhase ? '3-Phase Power' : 'Power';
    }

    if (dom.phaseStatusText) {
      dom.phaseStatusText.removeAttribute('data-i18n');
      
      if (!isReachable) {
        dom.phaseStatusText.textContent = 'OFFLINE';
        dom.phaseStatusText.classList.remove('on');
        dom.phaseStatusText.classList.add('off');
      } else if (!isLoaded) {
        dom.phaseStatusText.textContent = 'CHECKING...';
        dom.phaseStatusText.classList.remove('on', 'off');
      } else if (isAvail) {
        const availText = (i18n[state.lang] && i18n[state.lang].power_available) || 'AVAILABLE';
        dom.phaseStatusText.textContent = availText;
        dom.phaseStatusText.classList.add('on');
        dom.phaseStatusText.classList.remove('off');
      } else {
        const unavailText = (i18n[state.lang] && i18n[state.lang].power_unavailable) || 'UNAVAILABLE';
        dom.phaseStatusText.textContent = unavailText;
        dom.phaseStatusText.classList.remove('on');
        dom.phaseStatusText.classList.add('off');
      }
    }

  }

  function updatePhaseUI() {
    const isAvail = isPhaseAvailableValue(state.phaseAvailable);
    renderPhaseStatus();

    // ═══ POWER RESTORATION DETECTION ═══
    const currentPhaseOK = isAvail;
    const prevPhaseOK = isPhaseAvailableValue(state.prevPhaseAvailable);

    // ONLY TRIGGER: Power restored (transition from missing → all available)
    if (state.powerReminderEnabled && !prevPhaseOK && currentPhaseOK) {
      startAlarm(t('power_restored') || '✅ POWER RESTORED', 15000);
      showToast('⚡ Power restored! Motor can run now.', 'success');
      state.powerReminderEnabled = false; // Auto-reset reminder
    }

    state.prevPhaseAvailable = state.phaseAvailable;

    // ═══ MOTOR / TIMER SAFETY ═══
    const miss = !isAvail;
    if (dom.warningBanner) dom.warningBanner.classList.toggle('hidden', !miss);
    if (miss && state.motorCommand === 'OFF') {
      if (dom.motorBtn) dom.motorBtn.disabled = true;
    } else if (!state.loraAlive && state.motorCommand !== 'START' && state.motorCommand !== 'ON' && state.motorActual !== 'ON') {
      if (dom.motorBtn) dom.motorBtn.disabled = true;
    } else {
      if (dom.motorBtn) dom.motorBtn.disabled = false;
    }

    // Auto-disable timer if phase missing
    if (miss && state.timerActive) {
      stopTimer();
      showToast('⚠ Timer disabled (phase missing)', 'warning');
    }

    // Update timer UI to reflect phase state
    updateTimerUI();

    // ═══ POWER REMINDER BUTTON ═══
    const prBtn = document.getElementById('power-reminder-btn');
    const prText = document.getElementById('power-reminder-text');
    if (prBtn) {
      if (miss) {
        prBtn.classList.remove('hidden');
        if (state.powerReminderEnabled) {
          prBtn.classList.replace('btn-warning', 'btn-secondary');
          prText.textContent = t('off_reminder') || "Off Reminder";
        } else {
          prBtn.classList.replace('btn-secondary', 'btn-warning');
          prText.textContent = t('set_reminder') || "Set Reminder";
        }
      } else {
        prBtn.classList.add('hidden');
      }
    }
  }

  function updateMotorUI() {
    const isCmdOn = state.pendingCommand 
        ? (state.pendingCommand === 'ON') 
        : (state.motorCommand === 'ON' || state.motorCommand === 'START');
    const isActualOn = state.motorActual === 'ON';
    
    // FIX: Show pending state when a command is in flight
    let statusText = 'Status Not Confirmed';
    if (!state.loraAlive) {
      statusText = 'Motor Unreachable (Offline)';
    } else if (state.commandOutcomeUnknown) {
      statusText = 'Command outcome unknown — check motor';
    } else if (state.pendingCommand) {
      // Command is actively pending — show transitional state
      statusText = state.pendingCommand === 'ON' ? 'Starting motor...' : 'Stopping motor...';
    } else if (state.motorActual !== 'UNKNOWN') {
      if (isCmdOn && isActualOn) statusText = t('motor_on') || 'Motor ON';
      else if (isCmdOn && !isActualOn) statusText = 'Starting / waiting for motor';
      else if (!isCmdOn && !isActualOn) statusText = t('motor_off') || 'Motor OFF';
      else if (!isCmdOn && isActualOn) statusText = 'Stopping / motor still running';
    }
    
    // FIX: Add anomaly detection - high current but motor reports OFF
    const currentIsHigh = state.motorCurrent != null && state.motorCurrent > 0.5;
    if (currentIsHigh && !isActualOn && !state.pendingCommand && state.loraAlive) {
      statusText += ' ⚠ Current anomaly detected';
      if (dbRefs && dbRefs.systemLogs) {
        dbRefs.systemLogs.push({ 
          message: `Motor anomaly: Current ${state.motorCurrent.toFixed(2)}A but motor/actual = OFF`, 
          time: Date.now(), 
          type: 'motor_anomaly',
          severity: 'warning'
        });
      }
    }
    
    dom.motorStatusText.textContent = statusText;

    // Turn off the dot if offline, otherwise show actual state
    const displayDotOn = state.loraAlive && isActualOn;
    dom.motorStatusDot.classList.toggle('on', displayDotOn);
    dom.motorStatusDot.classList.toggle('off', !displayDotOn);
    
    // Update button styling based on actual state, but button is disabled if offline anyway
    const offerStop = isActualOn || state.commandOutcomeUnknown;
    dom.motorBtn.classList.toggle('turn-on', !offerStop);
    dom.motorBtn.classList.toggle('turn-off', offerStop);
    dom.motorBtnText.textContent = offerStop ? t('turn_motor_off') : t('turn_motor_on');
    dom.motorBtnIcon.textContent = '⏻';
    
    // FIX: Only clear spinner/sending state if no command is pending
    if (!state.pendingCommand) {
      dom.motorBtnSpinner.classList.add('hidden');
      state.isSendingCommand = false;
    }

    if (dom.cmdActualRow) {
      dom.cmdActualRow.classList.remove('hidden');
      if (dom.cmdState) dom.cmdState.textContent = isCmdOn ? 'ON' : 'OFF';
      if (dom.actualState) {
        if (!state.loraAlive) {
          dom.actualState.textContent = 'OFFLINE';
        } else {
          dom.actualState.textContent = state.motorActual === 'UNKNOWN' ? 'Waiting confirmation' : (isActualOn ? 'ON' : 'OFF');
        }
      }
      if (dom.currentState) {
        if (!state.loraAlive) {
          dom.currentState.textContent = '-- A';
        } else if (state.motorCurrent == null || state.motorCurrent === '' || isNaN(state.motorCurrent)) {
          dom.currentState.textContent = '-- A';
        } else {
          dom.currentState.textContent = Number(state.motorCurrent).toFixed(2) + ' A';
        }
      }
    }

    if (!state.firebaseConnected) { dom.motorBtn.disabled = true; return; }
    if (state.commandOutcomeUnknown) { dom.motorBtn.disabled = false; return; }
    if (state.loraAlive === false) { 
      const motorIsOn = (state.motorCommand === 'ON' || state.motorCommand === 'START' || state.motorActual === 'ON');
      dom.motorBtn.disabled = !motorIsOn;
      return; 
    }
    if (state.pendingCommand || state.isSendingCommand) { dom.motorBtn.disabled = true; return; }
    dom.motorBtn.disabled = false;
    const currentPhaseOK = isPhaseAvailableValue(state.phaseAvailable);
    if (!currentPhaseOK && !isActualOn) dom.motorBtn.disabled = true;
  }

  function setupMotorButton() {
    dom.motorBtn.addEventListener('click', () => {
      if (state.commandOutcomeUnknown) { issueMotorCommand('STOP', 'manual'); return; }
      if (state.isSendingCommand || state.loraLost || !state.loraAlive || state.pendingCommand) return;
      const currentPhaseOK = isPhaseAvailableValue(state.phaseAvailable);
      if (!currentPhaseOK && state.motorActual !== 'ON') { showAlertPopup(); return; }
      issueMotorCommand(state.motorActual === 'ON' ? 'STOP' : 'START', 'manual');
    });
    const prBtn = document.getElementById('power-reminder-btn');
    if (prBtn) {
      prBtn.addEventListener('click', () => {
        const miss = isPhaseMissing();
        if (miss) {
          state.powerReminderEnabled = !state.powerReminderEnabled;
          if (state.powerReminderEnabled) {
            showToast('✓ Reminder armed — waiting for power to return', 'info');
          } else {
            showToast('Reminder cancelled', 'info');
          }
          updatePhaseUI();
        } else {
          showToast('Power is already ON', 'info');
        }
      });
    }
  }


  // ═══ LORA ═══
  function updateLoraUI() { 
    if (dom.loraRssiValue) dom.loraRssiValue.textContent = state.loraAlive ? state.lora.rssi : '—'; 
    if (dom.loraSnrValue) dom.loraSnrValue.textContent = state.loraAlive ? state.lora.snr : '—'; 
    const rssi = state.lora.rssi; 
    let q, b, c; 
    
    if (!state.loraAlive) { 
      q = t('signal_lost'); b = 'lost'; c = 'var(--color-red)'; 
    } else if (rssi > -90) { 
      q = t('signal_good'); b = 'good'; c = 'var(--color-green)'; 
    } else if (rssi >= -110) { 
      q = t('signal_medium'); b = 'medium'; c = 'var(--color-orange)'; 
    } else { 
      q = t('signal_poor'); b = 'poor'; c = 'var(--color-red)'; 
    } 
    
    if (dom.signalBadge) dom.signalBadge.className = 'signal-badge ' + b; 
    if (dom.signalBadgeText) dom.signalBadgeText.textContent = q; 
    if (dom.loraRssiValue) dom.loraRssiValue.style.color = c; 
    dom.loraLostBanner.classList.toggle('visible', !state.loraAlive); 
  }
  
  function startLoraTimeoutChecker() {
    // Heartbeat checker handles all connection state logic via updateHeartbeatUI
  }
  function setupIntervalSlider() { if (!dom.intervalSlider) return; dom.intervalSlider.value = state.transmissionInterval; updateIntervalDisplay(); dom.intervalSlider.addEventListener('input', () => { state.transmissionInterval = parseFloat(dom.intervalSlider.value); updateIntervalDisplay(); }); dom.intervalSlider.addEventListener('change', () => { if (dbRefs) dbRefs.transmissionInterval.set(state.transmissionInterval); }); }
  function updateIntervalDisplay() { if (dom.intervalValue) dom.intervalValue.textContent = state.transmissionInterval + 's'; }

  // ═══ MOTOR COMMAND PIPELINE ═══
  
  // Home uses an initial transmission plus three 5-second retries, with
  // Firebase polling/status traffic in between. Timeout is uncertainty, not OFF.
  const COMMAND_TIMEOUT_MS = 45000;
  let commandTimeoutTimer = null;

  function logCommand(entry) {
    if (!dbRefs || !dbRefs.systemLogs) return;
    try {
      Promise.resolve(dbRefs.systemLogs.push(entry)).catch(error => debugLog('LOG_ERROR', error.message));
    } catch (error) { debugLog('LOG_ERROR', error.message); }
  }

  async function performAtomicCommandUpdate(command, commandId, status, source) {
    const deviceId = state.currentUser && state.currentUser.deviceId;
    if (!deviceId) throw new Error('No device selected');
    // Home accepts both ON/OFF and START/STOP. update creates missing fields
    // after an import and preserves motor/actual and existing timer data.
    await database.ref(`devices/${deviceId}/motor`).update({
      command: command === 'START' ? 'ON' : 'OFF',
      command_id: commandId,
      command_status: status,
      command_status_id: commandId,
      command_source: source,
      command_timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  }

  async function issueMotorCommand(command, source = "manual") {
    command = String(command).trim().toUpperCase();
    if (command === 'ON') command = 'START';
    if (command === 'OFF') command = 'STOP';
    if (!['START', 'STOP'].includes(command)) throw new Error('Invalid motor command');
    if (state.pendingCommand && !(state.commandOutcomeUnknown && command === 'STOP')) {
      showToast('Wait for the previous command to finish!', 'warning');
      return false;
    }
    if (!dbRefs || !state.currentUser || !state.currentUser.deviceId || !state.firebaseConnected) {
      showCmdStatus('Command not sent: Firebase is disconnected or no device is selected.', 'error');
      return false;
    }

    const commandId = `WEB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.pendingCommand = command === 'START' ? 'ON' : 'OFF';
    state.commandId = commandId;
    state.commandSource = source;
    state.commandOutcomeUnknown = false;
    state.isSendingCommand = true;
    dom.motorBtnSpinner.classList.remove('hidden');
    updateMotorUI();
    showCmdStatus('Saving command to Firebase...', '');
    // Start before awaiting: an SDK write can remain queued if the connection drops.
    scheduleCommandTimeout();
    try {
      await performAtomicCommandUpdate(command, commandId, 'pending', source);
      logCommand({message: `Motor ${command} requested by ${source}`, time: Date.now(),
        type: 'motor_command', action: command, status: 'requested', command_id: commandId, source});
      // A controller response can arrive before the write promise resolves.
      if (state.commandId === commandId && state.pendingCommand && !state.commandOutcomeUnknown) {
        showCmdStatus('Command saved — waiting for Home ESP32...', '');
      }
      return true;
    } catch (error) {
      if (state.commandId === commandId) {
        clearPendingCommand();
        showCmdStatus(`Command not sent: ${error.message || error.code || 'Firebase write failed'}`, 'error');
      }
      return false;
    }
  }

  function scheduleCommandTimeout() {
    if (commandTimeoutTimer) clearTimeout(commandTimeoutTimer);
    commandTimeoutTimer = setTimeout(() => {
      if (!state.pendingCommand || !state.commandId) return;
      state.commandOutcomeUnknown = true;
      state.isSendingCommand = false;
      dom.motorBtnSpinner.classList.add('hidden');
      showCmdStatus('No controller response — outcome unknown. Check Home ESP32; STOP is available.', 'error');
      logCommand({message: `Command response timeout (${state.commandSource})`, time: Date.now(),
        type: 'command_unknown', command_id: state.commandId});
      // Keep the ID for a late ACK. Never retry START or assume the motor is OFF.
      updateMotorUI();
    }, COMMAND_TIMEOUT_MS);
  }

  function handleMotorCommandSnapshot(value) {
    const motor = value || {};
    const status = motor.command_status || 'idle';
    state.motorCommandStatus = status;
    handleCommandStatus(typeof status === 'string'
      ? {command_id: motor.command_status_id || motor.command_id, result: status} : status);
  }

  function handleCommandStatus(statusVal) {
    debugLog('ACK', `Status/ACK received: ${JSON.stringify(statusVal)}`);
    
    let status = typeof statusVal === 'string' ? statusVal : 'idle';
    let ackCmdId = null;
    let ackResult = null;
    
    if (typeof statusVal === 'object' && statusVal !== null) {
       ackCmdId = statusVal.command_id;
       ackResult = statusVal.result; 
       status = ackResult || statusVal.command_status || 'idle';
    }

    // Ignore initial/old statuses. The attached Home uses a string status;
    // setupFirebaseListeners pairs that value with its sibling command_id.
    if (!state.commandId || ackCmdId !== state.commandId) return;
    if (state.commandOutcomeUnknown && ['pending', 'sending'].includes(status)) return;

    if (status === 'sending') {
      showCmdStatus(t('sending_command') || 'Sending command...', '');
    } else if (status === 'pending') {
      showCmdStatus('Command pending — waiting for controller...', '');
    } else if (status === 'done' || status === 'failed' || status === 'RELAY_ERROR' || status === 'NVS_ERROR' || status === 'BUSY' || status === 'invalid') {
      if (commandTimeoutTimer) { clearTimeout(commandTimeoutTimer); commandTimeoutTimer = null; }
      
      if (status === 'done') {
        // FIX: Show transitional message — don't claim motor is ON/OFF until motor/actual confirms
        showCmdStatus('Command acknowledged — verifying motor...', 'success');
        state.lastSuccessfulSource = state.commandSource;
        logCommand({ message: `Command acknowledged (${state.commandSource})`, time: Date.now(), type: 'command_success', command_id: state.commandId });
      } else {
        const errorReason = status === 'failed' ? 'Timeout/Connection' : status;
        showCmdStatus(`Command failed: ${errorReason}`, 'error');
        logCommand({ message: `Command failed: ${errorReason} (${state.commandSource})`, time: Date.now(), type: 'command_failed', command_id: state.commandId });
      }
      
      clearPendingCommand();
      setTimeout(() => { if (!state.pendingCommand) dom.cmdStatusBar.classList.add('hidden'); }, 3000);
    } else if (status === 'idle') {
      // On page load, if status is idle and no pending command, just hide the bar
      if (!state.pendingCommand) {
        dom.cmdStatusBar.classList.add('hidden');
      }
    }
  }

  function clearPendingCommand() { 
    state.pendingCommand = null; 
    state.commandId = null; 
    state.commandOutcomeUnknown = false;
    state.isSendingCommand = false; 
    if (commandTimeoutTimer) { clearTimeout(commandTimeoutTimer); commandTimeoutTimer = null; }
    dom.motorBtnSpinner.classList.add('hidden');
    dom.motorBtn.disabled = false;
    updateMotorUI();
  }

  function showCmdStatus(text, type) { 
    dom.cmdStatusBar.classList.remove('hidden', 'success', 'error'); 
    if (type) dom.cmdStatusBar.classList.add(type); 
    dom.cmdStatusText.textContent = text; 
  }

  // ═══ TIMER ═══
  
  function setupTimer() {
    dom.timerSlider = document.getElementById('timer-slider');
    dom.timerSliderVal = document.getElementById('timer-val');
    dom.timerHoursInput = document.getElementById('timer-hours-input');
    dom.timerMinsInput = document.getElementById('timer-mins-input');
    dom.timerStartBtn = document.getElementById('timer-start-btn');
    dom.timerStopBtn = document.getElementById('timer-stop-btn');
    dom.timerCountdownDisplay = document.getElementById('timer-countdown-display');
    dom.timerCountdownText = document.getElementById('timer-countdown-text');
    dom.timerProgressBar = document.getElementById('timer-progress-bar');
    
    function updateInputsFromSlider() {
      const val = parseInt(dom.timerSlider.value) || 0;
      if (dom.timerSliderVal) dom.timerSliderVal.textContent = val;
      if (dom.timerHoursInput) dom.timerHoursInput.value = Math.floor(val / 60);
      if (dom.timerMinsInput) dom.timerMinsInput.value = val % 60;
    }

    function updateSliderFromInputs() {
      const h = parseInt(dom.timerHoursInput.value) || 0;
      const m = parseInt(dom.timerMinsInput.value) || 0;
      const totalMins = Math.min(180, Math.max(1, (h * 60) + m)); // Clamp between 1 and 180
      if (dom.timerSlider) dom.timerSlider.value = totalMins;
      if (dom.timerSliderVal) dom.timerSliderVal.textContent = totalMins;
    }

    if (dom.timerSlider) {
      dom.timerSlider.addEventListener('input', updateInputsFromSlider);
    }
    
    if (dom.timerHoursInput) {
      dom.timerHoursInput.addEventListener('input', updateSliderFromInputs);
      dom.timerHoursInput.addEventListener('change', updateSliderFromInputs);
    }
    
    if (dom.timerMinsInput) {
      dom.timerMinsInput.addEventListener('input', updateSliderFromInputs);
      dom.timerMinsInput.addEventListener('change', updateSliderFromInputs);
    }
    
    if (dom.timerStartBtn) dom.timerStartBtn.addEventListener('click', startTimer);
    if (dom.timerStopBtn) dom.timerStopBtn.addEventListener('click', stopTimer);
    
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(timerTick, 1000);
  }

  function startTimer() {
    const miss = isPhaseMissing();
    if (miss) { showToast(t('cannot_start_phase') || 'Cannot start timer: Phase missing', 'error'); return; }
    if (!state.loraAlive) { showToast(t('cannot_start_lora') || 'Cannot start timer: LoRa link down', 'error'); return; }

    const m = parseInt(dom.timerSlider.value);
    const ms = m * 60 * 1000;
    const now = Date.now();

    state.timerActive = true; 
    state.timerDuration = ms; 
    state.timerStartTime = null; 
    state.timerEndTime = null; 
    state.timerRemaining = ms;
    state.timerStopping = false;

    if (dbRefs) {
      dbRefs.timerDuration.set(ms); 
      dbRefs.timerStartTime.set(null); 
      dbRefs.timerEndTime.set(null); 
      dbRefs.timerRemaining.set(ms); 
      dbRefs.timerActive.set(true);
    }

    issueMotorCommand('START', 'timer');
    updateTimerUI();
    showToast(`Timer started for ${m} minutes. Waiting for motor ON...`, 'success');
  }

  function stopTimer() {
    state.timerActive = false; 
    state.timerRemaining = 0;
    if (dbRefs) { 
      dbRefs.timerActive.set(false); 
      dbRefs.timerRemaining.set(0); 
    }
    issueMotorCommand('STOP', 'timer');
    updateTimerUI();
    showToast('Timer stopped', 'info');
  }

  function timerTick() {
    if (state.timerStopping) {
      // Waiting for motor to turn off
      if (state.motorActual === 'OFF') {
        state.timerStopping = false;
        state.timerActive = false;
        state.timerRemaining = 0;
        state.timerEndTime = null;
        if (dbRefs) {
          dbRefs.timerActive.set(false);
          dbRefs.timerRemaining.set(0);
          dbRefs.timerEndTime.set(null);
        }
        updateTimerUI();
      }
      return;
    }

    if (!state.timerActive) return;

    if (!state.timerEndTime) {
      // Waiting for motor to physically turn on
      if (state.motorActual === 'ON') {
        const now = Date.now();
        state.timerStartTime = now;
        state.timerEndTime = now + state.timerDuration;
        if (dbRefs) {
          dbRefs.timerStartTime.set(state.timerStartTime);
          dbRefs.timerEndTime.set(state.timerEndTime);
        }
        updateTimerUI();
      }
      return;
    }

    const now = Date.now();
    const remain = Math.max(0, state.timerEndTime - now);

    if (remain === 0) {
      state.timerStopping = true; 
      issueMotorCommand('STOP', 'timer_end');
      showToast('Timer completed. Stopping motor...', 'success');
      updateTimerUI();
    } else {
      state.timerRemaining = remain;
      if (dbRefs && Math.random() < 0.1) dbRefs.timerRemaining.set(remain); 
      updateTimerUI();
    }
  }

  function updateTimerUI() {
    const act = state.timerActive;
    const sView = document.getElementById('timer-setting-view');
    const aView = document.getElementById('timer-active-view');
    
    if (sView) sView.classList.toggle('hidden', act);
    if (aView) aView.classList.toggle('hidden', !act);

    if (act && dom.timerCountdownDisplay) {
      if (state.timerStopping) {
        dom.timerCountdownDisplay.textContent = '00:00:00';
        if (dom.timerCountdownText) dom.timerCountdownText.textContent = 'Waiting for motor OFF...';
        if (dom.timerProgressBar) dom.timerProgressBar.style.width = '0%';
      } else if (!state.timerEndTime) {
        dom.timerCountdownDisplay.textContent = 'Wait...';
        if (dom.timerCountdownText) dom.timerCountdownText.textContent = 'Waiting for motor ON...';
        if (dom.timerProgressBar) dom.timerProgressBar.style.width = '100%';
      } else {
        const ts = Math.floor(state.timerRemaining / 1000);
        const h = Math.floor(ts / 3600), m = Math.floor((ts % 3600) / 60), s = ts % 60;
        dom.timerCountdownDisplay.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        if (dom.timerCountdownText) dom.timerCountdownText.textContent = `${Math.ceil(ts / 60)} minutes remaining`;
        if (dom.timerProgressBar && state.timerDuration) {
          const pct = Math.max(0, Math.min(100, (state.timerRemaining / state.timerDuration) * 100));
          dom.timerProgressBar.style.width = pct + '%';
        }
      }
    }

    const phaseMissing = isPhaseMissing();
    const sect = document.querySelector('.timer-section');
    if (sect) { 
      sect.style.opacity = phaseMissing ? '0.5' : '1'; 
      sect.style.pointerEvents = phaseMissing ? 'none' : 'auto'; 
    }
  }

  // ═══ MULTI-SCHEDULE ═══
  function setupSchedule() {
    if (dom.schedAddBtn) dom.schedAddBtn.addEventListener('click', addSchedule);
    if (dbRefs && dbRefs.schedulesRef) {
      dbRefs.schedulesRef.on('value', snap => {
        state.schedules = [];
        snap.forEach(child => { state.schedules.push({ id: child.key, ...child.val() }); });
        renderScheduleCards();
      });
    }
    if (state.scheduleInterval) clearInterval(state.scheduleInterval);
    state.scheduleInterval = setInterval(checkSchedules, 1000); 
    checkSchedules();
  }

  function addSchedule() {
    const time = dom.schedTime.value || '06:00';
    const durH = parseInt(dom.schedDurHours.value) || 0, durM = parseInt(dom.schedDurMins.value) || 0;
    if (durH === 0 && durM === 0) { showToast('Set duration > 0', 'error'); return; }
    const repeat = dom.schedRepeat.checked;
    const sched = { start_time: time, duration_hours: durH, duration_minutes: durM, repeat, running: false, remaining: 0 };
    // Conflict detection
    if (hasConflict(sched)) { dom.schedConflict.classList.remove('hidden'); setTimeout(() => dom.schedConflict.classList.add('hidden'), 4000); return; }
    if (state.editingScheduleId) {
      const idx = state.schedules.findIndex(s => s.id === state.editingScheduleId);
      if (idx >= 0) state.schedules[idx] = { ...state.schedules[idx], ...sched };
      if (dbRefs) dbRefs.schedulesRef.child(state.editingScheduleId).update(sched);
      state.editingScheduleId = null; dom.schedAddBtn.textContent = t('add_schedule');
    } else {
      const id = 'sched_' + Date.now();
      sched.id = id;
      state.schedules.push(sched);
      if (dbRefs) dbRefs.schedulesRef.child(id).set(sched);
    }
    renderScheduleCards();
    showToast(t('schedule_saved'), 'success');
  }

  function hasConflict(newSched) {
    const newStart = timeToMin(newSched.start_time), newEnd = newStart + newSched.duration_hours * 60 + newSched.duration_minutes;
    return state.schedules.some(s => {
      if (s.id === state.editingScheduleId) return false;
      const sStart = timeToMin(s.start_time), sEnd = sStart + s.duration_hours * 60 + s.duration_minutes;
      return newStart < sEnd && newEnd > sStart;
    });
  }

  function timeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

  function editSchedule(id) {
    const s = state.schedules.find(x => x.id === id); if (!s) return;
    dom.schedTime.value = s.start_time; dom.schedDurHours.value = s.duration_hours; dom.schedDurMins.value = s.duration_minutes; dom.schedRepeat.checked = s.repeat;
    state.editingScheduleId = id; dom.schedAddBtn.textContent = t('save_schedule');
    dom.schedAddBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function deleteSchedule(id) {
    if (!confirm(t('confirm_delete'))) return;
    state.schedules = state.schedules.filter(s => s.id !== id);
    if (dbRefs) dbRefs.schedulesRef.child(id).remove();
    renderScheduleCards();
  }

  function renderScheduleCards() {
    if (!dom.schedList) return;
    dom.schedList.innerHTML = '';
    dom.schedEmpty.classList.toggle('hidden', state.schedules.length > 0);
    state.schedules.forEach(s => {
      const card = document.createElement('div');
      card.className = 'sched-card' + (s.running ? ' running' : '');
      const durText = (s.duration_hours > 0 ? s.duration_hours + ' hr ' : '') + s.duration_minutes + ' min';
      const repeatText = s.repeat ? 'Daily' : t('one_time');
      let statusHtml = '';
      if (s.stopping) {
        statusHtml = `<div class="sched-card-status">Stopping / Waiting for motor OFF...</div>`;
      } else if (s.running) {
        if (!s.end_timestamp) {
           statusHtml = `<div class="sched-card-status">Running - Waiting for motor ON...</div>`;
        } else if (s.remaining > 0) {
           const rm = Math.floor(s.remaining / 60), rs = s.remaining % 60;
           statusHtml = `<div class="sched-card-status">${t('running_remaining') || 'Running ('} ${rm}:${rs.toString().padStart(2, '0')})</div>`;
        }
      }
      card.innerHTML = `<div class="sched-card-info"><span class="sched-dot"></span>${s.start_time} • ${durText} • ${repeatText}</div>${statusHtml}<div class="sched-card-actions"><button class="sched-edit-btn" data-id="${s.id}">${t('edit')}</button><button class="sched-del-btn" data-id="${s.id}">${t('delete_btn')}</button></div>`;
      card.querySelector('.sched-edit-btn').addEventListener('click', () => editSchedule(s.id));
      card.querySelector('.sched-del-btn').addEventListener('click', () => deleteSchedule(s.id));
      dom.schedList.appendChild(card);
    });
    updateScheduleInline();
  }

  function updateScheduleInline() {
    if (!dom.scheduleInline) return;
    const next = state.schedules.find(s => !s.running);
    dom.scheduleInline.classList.toggle('hidden', !next);
    if (next && dom.scheduleNextText) dom.scheduleNextText.textContent = `${t('next_schedule')}: ${next.start_time}`;
  }

  function checkSchedules() {
    const now = new Date(), hm = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const nowMs = Date.now();
    let uiNeedsUpdate = false;

    state.schedules.forEach(s => {
      if (s.stopping) {
        // WAITING FOR MOTOR OFF
        if (state.motorActual === 'OFF') {
          s.stopping = false;
          s.running = false;
          s.remaining = 0;
          s.end_timestamp = null;
          
          if (!s.repeat) {
            state.schedules = state.schedules.filter(x => x.id !== s.id);
            if (dbRefs) dbRefs.schedulesRef.child(s.id).remove();
          } else if (dbRefs) {
            dbRefs.schedulesRef.child(s.id).update({ running: false, remaining: 0, end_timestamp: null, stopping: false });
          }
          uiNeedsUpdate = true;
        }
      } else if (s.running) {
        
        if (!s.end_timestamp) {
          // WAITING FOR MOTOR ON
          if (state.motorActual === 'ON') {
            s.end_timestamp = nowMs + (s.remaining * 1000);
            if (dbRefs) dbRefs.schedulesRef.child(s.id).update({ end_timestamp: s.end_timestamp });
            uiNeedsUpdate = true;
          }
        } else if (s.remaining > 0) {
          // RUNNING
          // If motor is OFF and we have more than 5 seconds left, it was manually interrupted.
          if (state.motorActual === 'OFF' && s.remaining > 5) {
            s.running = false;
            s.remaining = 0;
            s.end_timestamp = null;
            showToast('Schedule stopped — Motor OFF manually', 'warning');
            if (!s.repeat) {
              state.schedules = state.schedules.filter(x => x.id !== s.id);
              if (dbRefs) dbRefs.schedulesRef.child(s.id).remove();
            } else if (dbRefs) {
              dbRefs.schedulesRef.child(s.id).update({ running: false, remaining: 0, end_timestamp: null });
            }
            uiNeedsUpdate = true;
          } else {
            // Countdown using absolute timestamps
            const remainingSecs = Math.max(0, Math.round((s.end_timestamp - nowMs) / 1000));
            if (s.remaining !== remainingSecs) {
              s.remaining = remainingSecs;
              uiNeedsUpdate = true;
            }

            if (s.remaining === 0) {
              // SCHEDULE COMPLETE
              issueMotorCommand('STOP', 'schedule');
              showToast(t('timer_completed') || 'Schedule time completed', 'success');
              
              s.stopping = true; // Wait for motor to actually turn off before cleaning up
              if (dbRefs) {
                dbRefs.schedulesRef.child(s.id).update({ stopping: true });
              }
              uiNeedsUpdate = true;
            }
          }
        }
      } else if (hm === s.start_time && s._last_trigger_hm !== hm) {
        // TRIGGER SCHEDULE
        s._last_trigger_hm = hm;
        const totalSec = (s.duration_hours * 60 + s.duration_minutes) * 60;
        s.running = true; 
        s.end_timestamp = null;
        s.stopping = false;
        s.remaining = totalSec;
        issueMotorCommand('START', 'schedule'); 
        showToast(t('schedule_triggered') || 'Schedule Triggered', 'info');
        if (dbRefs) dbRefs.schedulesRef.child(s.id).update({ running: true, remaining: totalSec, end_timestamp: null, stopping: false });
        uiNeedsUpdate = true;
      }
    });

    if (uiNeedsUpdate) {
      renderScheduleCards();
      updateMotorUI();
    }
  }

  // ═══ ANALYTICS ═══
  let currentChart, rssiChart, snrChart;
  function setupAnalytics() {
    setupLogControls();
    if (dom.currentChart) currentChart = new MiniChart(dom.currentChart, { label: '3-Phase Power', unit: '1=ON, 0=OFF', lineColor: '#ff9800', fillColor: 'rgba(255,152,0,0.08)', dotColor: '#ff9800', minY: 0, maxY: 1 });
    if (dom.rssiChart) rssiChart = new MiniChart(dom.rssiChart, { label: 'RSSI', unit: 'dBm', lineColor: '#2979ff', warnThreshold: -110 });
    if (dom.snrChart) snrChart = new MiniChart(dom.snrChart, { label: 'SNR', unit: 'dB', lineColor: '#00c853', dotColor: '#00c853', fillColor: 'rgba(0,200,83,0.08)' });

    if (dom.currentRangeBtns) {
      dom.currentRangeBtns.querySelectorAll('.chart-range-btn').forEach(btn => btn.addEventListener('click', () => {
        dom.currentRangeBtns.querySelectorAll('.chart-range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        const r = btn.dataset.range;
        state.currentRange = (r === 'today' || r === 'yesterday') ? r : parseInt(r);
        updateCurrentAnalyticsUI();
      }));
    }
    if (dom.signalRangeBtns) {
      dom.signalRangeBtns.querySelectorAll('.chart-range-btn').forEach(btn => btn.addEventListener('click', () => {
        dom.signalRangeBtns.querySelectorAll('.chart-range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        state.signalRange = parseInt(btn.dataset.range); updateCharts();
      }));
    }
    setInterval(() => { updateSessionUI(); updateUsageUI(); }, 1000);
    updateSessionUI(); updateUsageUI();
    window.addEventListener('resize', updateCharts);
    updateCharts();
  }

  function addSignalPoint(type, value) {
    const arr = type === 'rssi' ? state.rssiHistory : state.snrHistory;
    arr.push({ time: Date.now(), value: Number(value) });

    // Limit to last 24 hours ~ 1000-2000 points
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    while (arr.length > 0 && arr[0].time < cutoff) arr.shift();

    // Cap at 500 entries max
    if (arr.length > 500) arr.splice(0, arr.length - 500);
  }

  function updateCharts() {
    updateCurrentAnalyticsUI();
    if (!rssiChart || !snrChart) return;
    const cutoff = Date.now() - state.signalRange * 60 * 1000;

    // Validate data format before display
    const validRssi = state.rssiHistory.filter(d => d && d.time && typeof d.value === 'number').map(d => ({ ...d, time: d.time < 1e11 ? d.time * 1000 : d.time }));
    const validSnr = state.snrHistory.filter(d => d && d.time && typeof d.value === 'number').map(d => ({ ...d, time: d.time < 1e11 ? d.time * 1000 : d.time }));

    const filteredRssi = validRssi.filter(d => d.time >= cutoff);
    if (filteredRssi.length === 1) filteredRssi.unshift({ time: cutoff, value: filteredRssi[0].value });
    rssiChart.setData(filteredRssi);
    
    const filteredSnr = validSnr.filter(d => d.time >= cutoff);
    if (filteredSnr.length === 1) filteredSnr.unshift({ time: cutoff, value: filteredSnr[0].value });
    snrChart.setData(filteredSnr);
  }

  function recordPowerPoint() {
    const available = state.psrOk !== null ? state.psrOk : state.phaseAvailable;
    if (available == null) return;
    const now = Date.now();
    // Preserve all of yesterday as well as today, without inventing past readings.
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    state.livePowerHistory = state.livePowerHistory.filter(d => d.time >= start.getTime());
    state.livePowerHistory.push({ time: now, value: available ? 1 : 0 });
  }

  function updateCurrentAnalyticsUI() {
    const available = state.psrOk !== null ? state.psrOk : state.phaseAvailable;
    if (dom.currentLiveVal) {
      dom.currentLiveVal.textContent = available == null ? '—' : available ? '⚡ Available' : '⛔ Unavailable';
      dom.currentLiveVal.style.color = available == null ? 'var(--text-secondary)' : available ? 'var(--color-green)' : 'var(--color-red, #ff1744)';
    }

    if (!currentChart) return;

    let cutoff = 0;
    let ceiling = Infinity;
    if (state.currentRange === 'today') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      cutoff = now.getTime();
    } else if (state.currentRange === 'yesterday') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      ceiling = todayStart.getTime();
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      cutoff = yesterdayStart.getTime();
    } else {
      cutoff = Date.now() - state.currentRange * 60 * 60 * 1000;
    }

    // Validate data format and normalize time before filtering
    const validCurrent = [...state.currentHistory, ...state.livePowerHistory]
      .filter(d => d && Number.isFinite(d.time) && d.time > 0 && (d.value === 0 || d.value === 1))
      .map(d => ({ 
        time: (d.time < 1e11 ? d.time * 1000 : d.time), 
        value: d.value 
      }))
      .sort((a, b) => a.time - b.time);
    const filtered = validCurrent.filter(d => d.time >= cutoff && d.time < ceiling);
    currentChart.setData(filtered);
  }

  function normalizeRuntimeTimestamp(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    if (typeof value === 'string' && !value.trim()) return 0;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    const timestamp = number < 1e11 ? number * 1000 : number;
    // Keep valid timestamps even before clock sync arrives. Check freshness at use time,
    // otherwise a slow phone permanently discards a perfectly current ESP heartbeat.
    return timestamp >= Date.UTC(2020, 0, 1) && timestamp < Date.UTC(3000, 0, 1) ? timestamp : 0;
  }

  function trackMotorRuntime(previousActual) {
    if (state.motorActual === 'ON' && !state.motorOnSince) {
      state.motorOnSince = Date.now();
      // An initial ON snapshot is not evidence that the motor just started.
      state.sessionStart = previousActual === 'OFF' && state.loraAlive ? Date.now() : 0;
      state.longRunAlerted = false;
      state.longRunNext = Date.now() + LONG_RUN_MS;
    } else if (state.motorActual !== 'ON') {
      state.motorOnSince = 0;
      state.sessionStart = 0;
      state.longRunAlerted = false;
    }
    updateSessionUI();
  }

  function runtimeFieldReachable(now = serverNow()) {
    return heartbeatFresh(state.lastHomeUpdate, now) && heartbeatFresh(state.lastFieldUpdate, now);
  }

  let runtimeInFlight = false, lastRuntimeSync = 0;
  async function syncMotorRuntime(force = false) {
    // Coalesce the actual-state and heartbeat callbacks from the same Firebase update.
    await Promise.resolve();
    const ref = dbRefs && dbRefs.webRuntime;
    if (!ref || !state.runtimeLoaded || !state.motorActualLoaded || !state.homeHeartbeatLoaded ||
        !state.fieldHeartbeatLoaded || !state.firebaseConnected || !state.serverClockLoaded || runtimeInFlight) return;
    const now = serverNow();
    const online = runtimeFieldReachable(now);
    if (!force && now - lastRuntimeSync < (online ? 5000 : 60000)) return;
    const observation = { now, at: state.lastFieldUpdate, online, on: state.motorActual === 'ON' };
    lastRuntimeSync = now;
    runtimeInFlight = true;
    try {
      // Server retries merge concurrent tabs against the latest shared checkpoint.
      const result = await ref.transaction(current => {
        const next = RuntimeTracker.update(current, observation);
        return JSON.stringify(current) === JSON.stringify(next) ? undefined : next;
      }, undefined, false);
      if (ref !== (dbRefs && dbRefs.webRuntime)) return;
      state.runtimeLedger = result.snapshot.val();
      state.runtimeSyncError = false;
    } catch (error) {
      state.runtimeSyncError = true;
      console.error('Runtime sync failed:', error);
    } finally {
      runtimeInFlight = false;
      updateSessionUI(); updateUsageUI();
    }
  }

  function updateSessionUI() {
    if (!dom.usageSession) return;
    const now = serverNow();
    if (!runtimeFieldReachable(now)) {
      dom.usageSession.textContent = 'OFFLINE';
    } else if (state.motorActual === 'OFF') {
      dom.usageSession.textContent = '0:00';
    } else if (state.motorActual === 'ON') {
      const checkpoint = state.runtimeLedger && state.runtimeLedger.checkpoint;
      const start = checkpoint && now - checkpoint.at < RuntimeTracker.MAX_GAP_MS ? RuntimeTracker.sessionStart(state.runtimeLedger) : 0;
      if (!start || start > now) {
        dom.usageSession.textContent = '—';
      } else {
        const seconds = Math.floor((now - start) / 1000);
        dom.usageSession.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      }
    } else {
      dom.usageSession.textContent = '—';
    }
  }

  function updateUsageUI() {
    const totals = RuntimeTracker.summarize(state.runtimeLedger, serverNow());
    for (const [period, value, element] of [
      ['today', totals.today, dom.usageToday],
      ['week', totals.week, dom.usageWeek],
      ['month', totals.month, dom.usageMonth]
    ]) {
      if (element) element.textContent = state.runtimeLoaded ? `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m` : '—';
    }
    const note = document.getElementById('usage-data-note');
    if (note) note.textContent = t(state.runtimeSyncError ? 'usage_sync_failed' :
      !state.runtimeLoaded ? 'usage_loading' : !state.firebaseConnected ? 'usage_disconnected' : 'usage_tracking_note');
  }
  let logsDeleting = false;

  function setupLogControls() {
    const deleteAll = document.getElementById('delete-all-logs-btn');
    const deleteOld = document.getElementById('delete-old-logs-btn');
    if (deleteAll) deleteAll.onclick = () => deleteSystemLogs('all');
    if (deleteOld) deleteOld.onclick = () => deleteSystemLogs('old');
  }

  async function deleteSystemLogs(mode) {
    if (logsDeleting || !['all', 'old'].includes(mode)) return;
    const status = document.getElementById('log-action-status');
    const report = message => { if (status) status.textContent = message; };
    const logsRef = dbRefs && dbRefs.systemLogs;
    if (!logsRef || !navigator.onLine) {
      report(t('logs_connection_required'));
      return;
    }

    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const deviceId = state.currentUser && state.currentUser.deviceId;
    const message = t(mode === 'all' ? 'confirm_delete_all_logs' : 'confirm_delete_old_logs');
    if (!confirm(message.replace('{device}', deviceId || '—'))) return;

    const buttons = ['delete-all-logs-btn', 'delete-old-logs-btn'].map(id => document.getElementById(id)).filter(Boolean);
    logsDeleting = true;
    buttons.forEach(button => { button.disabled = true; });
    report(t('deleting_logs'));

    try {
      if (mode === 'all') {
        await logsRef.remove();
        report(t('all_logs_deleted'));
      } else {
        // Query the database, including logs outside the displayed 30-day window.
        const snapshot = await logsRef.orderByChild('time').startAt(0).endAt(cutoff - 1).once('value');
        const updates = {};
        snapshot.forEach(child => {
          const log = child.val();
          // Preserve entries whose age cannot be established.
          if (log && typeof log.time === 'number' && Number.isFinite(log.time) && log.time > 0 && log.time < cutoff) {
            updates[child.key] = null;
          }
        });
        const count = Object.keys(updates).length;
        if (count === 0) {
          report(t('no_old_logs'));
          return;
        }
        await logsRef.update(updates);
        report(t('old_logs_deleted').replace('{count}', count));
      }
      // The existing Firebase listener refreshes the list and event totals.
    } catch (error) {
      report(`${t('logs_delete_failed')} ${error.message || ''}`.trim());
    } finally {
      logsDeleting = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function updateLogsUI() {
    const logList = document.getElementById('log-list');
    if (!logList) return;
    if (!state.logs || state.logs.length === 0) {
      logList.innerHTML = `<div class="log-empty" data-i18n="no_logs">${t('no_logs') || 'No events logged yet'}</div>`;
      return;
    }

    const sortedLogs = state.logs.sort((a, b) => (b.time || 0) - (a.time || 0));
    
    let commands = 0, success = 0, failed = 0;
    sortedLogs.forEach(l => {
      const m = (l.message || '').toLowerCase();
      if (m.includes('motor command:')) commands++;
      if (m.includes('successful')) success++;
      if (m.includes('failed')) failed++;
    });

    const summaryHtml = `
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color);">
        <strong>Last 30 Days</strong><br>
        Total Events: ${sortedLogs.length} &bull; Commands: ${commands} &bull; Successful: ${success} &bull; Failed: ${failed}
      </div>
    `;

    const html = sortedLogs.map(l => {
      const time = l.time ? Number(l.time) : null;
      let timeStr = '--:--';
      let dateStr = '';
      
      if (time && !isNaN(time)) {
        const d = new Date(time);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        if (d.toDateString() === today.toDateString()) {
          dateStr = 'Today';
        } else if (d.toDateString() === yesterday.toDateString()) {
          dateStr = 'Yesterday';
        } else {
          dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      const msg = l.message || 'No message';
      let icon = '🔵';
      let color = 'var(--text-primary)';
      
      const ml = msg.toLowerCase();
      if (ml.includes('started') || ml.includes('successful')) {
        icon = '🟢';
      } else if (ml.includes('failed')) {
        icon = '🔴'; color = 'var(--color-red)';
      } else if (ml.includes('stopped') || ml.includes('motor command:')) {
        icon = '📤';
      } else if (ml.includes('acknowledged')) {
        icon = '✔️';
      }

      return `
        <div class="log-item" style="padding:10px 0; border-bottom:1px solid var(--border-color); display: flex; align-items: flex-start; gap: 10px;">
          <div style="font-size: 16px; padding-top: 2px;">${icon}</div>
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 13px; color: var(--text-secondary); margin-bottom: 2px;">
              ${timeStr}
            </div>
            <div style="font-size: 14px; color: ${color}; line-height: 1.4;">
              ${msg}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); opacity: 0.8; margin-top: 2px;">
              ${dateStr}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    logList.innerHTML = summaryHtml + html;
  }

  // ═══ LONG RUN ALERT ═══
  function setupLongRunCheck() {
    // FIX: Use motorActual (actual physical state) not motorState (which is never updated)
    setInterval(() => { if (state.motorActual === 'ON' && state.motorOnSince && !state.longRunAlerted && Date.now() >= state.longRunNext) { state.longRunAlerted = true; showLongRunAlert(); } }, 30000);
  }

  function showLongRunAlert() {
    const hrs = ((Date.now() - state.motorOnSince) / 3600000).toFixed(1);
    dom.longrunMessage.textContent = `${t('motor_long_run_msg')} ${hrs} ${t('hours')}`;
    dom.longrunOverlay.classList.add('visible');
    startAlarm(t('motor_long_run_title'), 15000);
    dom.longrunOffBtn.onclick = () => { dom.longrunOverlay.classList.remove('visible'); stopAlarm(); issueMotorCommand('STOP', 'system'); };
    dom.longrunKeepBtn.onclick = () => {
      dom.longrunOverlay.classList.remove('visible'); stopAlarm();
      state.longRunAlerted = false;
      state.longRunNext = Date.now() + LONG_RUN_MS;
    };
  }

  // ═══ DEVICE RESTART ═══
  function updateDeviceStatusUI() {
    const { homeAlive, fieldAlive, loraAlive } = connectionState();

    // 1. Update LoRa Tab device status display (consistency with Dashboard)
    if (dom.homeEsp32StatusVal) {
      dom.homeEsp32StatusVal.textContent = homeAlive ? '🟢 Connected' : '🔴 Disconnected';
    }
    if (dom.homeLoraStatusVal) {
      dom.homeLoraStatusVal.textContent = loraAlive ? '🟢 Connected' : '⚫ Unreachable';
    }
    if (dom.fieldEsp32StatusVal) {
      dom.fieldEsp32StatusVal.textContent = loraAlive ? '🟢 Reachable' : '⚫ Unreachable';
    }
    // Refresh the power display on heartbeat changes, even when phase data stays unchanged.
    renderPhaseStatus(loraAlive);
    if (dom.fieldLoraStatusVal) {
      dom.fieldLoraStatusVal.textContent = loraAlive ? '🟢 Reachable' : '⚫ Unreachable';
    }

    // 2. Update device restart buttons - disable based on connection state
    $$('.device-restart-btn').forEach(btn => {
      const d = btn.dataset.device;
      const isRestarting = state.restartCooldowns[d];
      let disabled = isRestarting;

      // Gateway offline: disable all restarts
      if (!homeAlive) {
        disabled = true;
        btn.title = 'Cannot restart: Gateway offline';
      }
      // LoRa offline: disable field device restart only
      else if (!loraAlive && (d === 'field_esp32' || d === 'field_lora')) {
        disabled = true;
        btn.title = 'Cannot restart: LoRa link unavailable';
      } else {
        btn.title = '';
      }

      btn.disabled = disabled;
    });

    // 3. Update warning banners
    if (dom.gatewayOfflineWarn) {
      dom.gatewayOfflineWarn.classList.toggle('hidden', homeAlive);
    }
    if (dom.fieldOfflineWarn) {
      dom.fieldOfflineWarn.classList.toggle('hidden', homeAlive || fieldAlive);
    }

    // 4. Update LoRa link card color
    if (dom.loraLinkCard) {
      dom.loraLinkCard.className = 'card lora-link-card ' + (!homeAlive ? 'error' : (!loraAlive ? 'warn' : ''));
    }

    // 5. Update warning banner for signal loss
    if (dom.warningBanner) {
      if (!loraAlive) {
        dom.warningBanner.classList.remove('hidden');
        dom.warningBanner.querySelector('[data-i18n]').textContent = t('lora_lost_reachable_warn');
      } else {
        // If LoRa is back, check if phase missing warning should be there instead
        const miss = isPhaseMissing();
        dom.warningBanner.classList.toggle('hidden', !miss);
        if (miss) dom.warningBanner.querySelector('[data-i18n]').textContent = t('phase_missing_warn');
      }
    }
  }
  function setupDeviceRestartButtons() {
    // Keep legacy .device-restart-btn support for any remaining buttons
    $$('.device-restart-btn').forEach(btn => btn.addEventListener('click', () => showConfirmPopup(btn.dataset.device, btn.dataset.label)));

    // ─── Home ESP32 Restart ───
    const homeBtn = document.getElementById('restart-home-btn');
    const homeBtnText = document.getElementById('restart-home-btn-text');
    const homeSpinner = document.getElementById('restart-home-spinner');

    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        updateHeartbeatUI();
        if (homeBtn.disabled) return;
        if (!state.homeOnline) {
          showToast('Cannot restart: Home ESP32 is offline', 'error');
          return;
        }
        if (!confirm('Restart Home ESP32? The gateway will be unavailable for ~15 seconds.')) return;
        updateHeartbeatUI();
        if (homeBtn.disabled) return;
        if (dbRefs && dbRefs.restartHomeEsp32) {
          dbRefs.restartHomeEsp32.set(true);
          setRestartUIState('home', true);
          showToast('Restart command sent to Home ESP32...', 'warning');
          // Start watching Firebase for false (confirmation of reboot)
          listenForRestartComplete('home');
        }
      });
    }

    // ─── Field ESP32 Restart ───
    const fieldBtn = document.getElementById('restart-field-btn');
    const fieldBtnText = document.getElementById('restart-field-btn-text');
    const fieldSpinner = document.getElementById('restart-field-spinner');

    if (fieldBtn) {
      fieldBtn.addEventListener('click', () => {
        updateHeartbeatUI();
        if (fieldBtn.disabled) return;
        if (!state.homeOnline) {
          showToast('Cannot restart: Home ESP32 must be online', 'error');
          return;
        }
        if (!state.loraAlive) {
          showToast('Cannot restart: LoRa link is down', 'error');
          return;
        }
        if (!confirm('Restart Field ESP32? The field controller will be unavailable for ~15 seconds.')) return;
        updateHeartbeatUI();
        if (fieldBtn.disabled) return;
        if (dbRefs && dbRefs.restartFieldEsp32) {
          dbRefs.restartFieldEsp32.set(true);
          setRestartUIState('field', true);
          showToast('Restart command sent to Field ESP32...', 'warning');
          listenForRestartComplete('field');
        }
      });
    }
  }

  function setRestartUIState(device, isRestarting) {
    const btn = document.getElementById(`restart-${device}-btn`);
    const btnText = document.getElementById(`restart-${device}-btn-text`);
    const spinner = document.getElementById(`restart-${device}-spinner`);
    if (!btn) return;
    if (btnText) btnText.classList.toggle('hidden', isRestarting);
    if (spinner) spinner.classList.toggle('hidden', !isRestarting);
    updateRestartButtonsState();
  }

  const restartListeners = {};
  function listenForRestartComplete(device) {
    // Clear any existing listener for this device
    if (restartListeners[device]) {
      restartListeners[device].off('value', restartListeners[device]._cb);
      delete restartListeners[device];
    }

    const refKey = device === 'home' ? 'restartHomeEsp32' : 'restartFieldEsp32';
    const ref = dbRefs && dbRefs[refKey];
    if (!ref) return;

    // Safety fallback: always clear after 60s regardless
    const fallback = setTimeout(() => {
      setRestartUIState(device, false);
      if (restartListeners[device]) {
        restartListeners[device].off('value', restartListeners[device]._cb);
        delete restartListeners[device];
      }
      showToast(`${device === 'home' ? 'Home' : 'Field'} ESP32 restart timed out — check device`, 'warning');
    }, 60000);

    const cb = (s) => {
      const val = s.val();
      // When ESP32 has restarted it sets this back to false
      if (val === false || val === null) {
        clearTimeout(fallback);
        ref.off('value', cb);
        delete restartListeners[device];
        setRestartUIState(device, false);
        showToast(`✅ ${device === 'home' ? 'Home' : 'Field'} ESP32 restarted successfully!`, 'success');
      }
    };
    restartListeners[device] = ref;
    restartListeners[device]._cb = cb;
    ref.on('value', cb);
  }

  function updateRestartButtonsState() {
    const homeBtn = document.getElementById('restart-home-btn');
    const fieldBtn = document.getElementById('restart-field-btn');
    const homeStatus = document.getElementById('home-restart-status');
    const fieldStatus = document.getElementById('field-restart-status');

    // ── Home ESP32 button ──
    if (homeBtn) {
      const isRestarting = homeBtn.querySelector('#restart-home-spinner') && !homeBtn.querySelector('#restart-home-spinner').classList.contains('hidden');
      homeBtn.disabled = isRestarting || !state.homeOnline;
    }
    if (homeStatus) {
      if (state.homeOnline) {
        homeStatus.textContent = '🟢 Online — ready to restart';
        homeStatus.style.color = 'var(--color-green)';
      } else {
        homeStatus.textContent = '🔴 Home ESP32 is offline';
        homeStatus.style.color = 'var(--color-red)';
      }
    }

    // ── Field ESP32 button ──
    if (fieldBtn) {
      const isRestarting = fieldBtn.querySelector('#restart-field-spinner') && !fieldBtn.querySelector('#restart-field-spinner').classList.contains('hidden');
      fieldBtn.disabled = isRestarting || !state.homeOnline || !state.loraAlive;
    }
    if (fieldStatus) {
      if (!state.homeOnline) {
        fieldStatus.textContent = '🔴 Home ESP32 is offline — cannot reach field';
        fieldStatus.style.color = 'var(--color-red)';
      } else if (!state.loraAlive) {
        fieldStatus.textContent = '🔴 Field ESP32 is offline (LoRa down)';
        fieldStatus.style.color = 'var(--color-red)';
      } else {
        fieldStatus.textContent = '🟢 Online — ready to restart';
        fieldStatus.style.color = 'var(--color-green)';
      }
    }
  }

  // ═══ CONFIRM / ALERT / ALARM ═══
  function setupConfirmPopup() { dom.confirmNo.addEventListener('click', hideConfirmPopup); dom.confirmYes.addEventListener('click', () => { const d = state.pendingRestartDevice; if (d) executeRestart(d); hideConfirmPopup(); }); dom.confirmOverlay.addEventListener('click', e => { if (e.target === dom.confirmOverlay) hideConfirmPopup(); }); }
  function showConfirmPopup(device, label) { state.pendingRestartDevice = device; dom.confirmMessage.textContent = `${t('confirm_restart_msg')} ${label}?`; dom.confirmOverlay.classList.add('visible'); }
  function hideConfirmPopup() { dom.confirmOverlay.classList.remove('visible'); state.pendingRestartDevice = null; }
  function executeRestart(device) { const refMap = { home_esp32: 'restartHomeEsp32', field_esp32: 'restartFieldEsp32', field_lora: 'restartFieldLora', home_lora: 'restartHomeLora' }; const lbl = { home_esp32: t('home_esp32'), field_esp32: t('field_esp32'), field_lora: t('field_lora'), home_lora: t('home_lora') }; if (dbRefs && refMap[device]) dbRefs[refMap[device]].set(true); showToast(`${t('restarting_toast')} ${lbl[device] || device}...`, 'warning'); state.restartCooldowns[device] = true; updateDeviceStatusUI(); setTimeout(() => { delete state.restartCooldowns[device]; updateDeviceStatusUI(); }, 10000); if (!dbRefs) { state.deviceStatus[device] = 'restarting'; updateDeviceStatusUI(); setTimeout(() => { state.deviceStatus[device] = 'online'; updateDeviceStatusUI(); showToast(`${lbl[device] || device} ${t('back_online')}`, 'success'); }, 5000); } }

  function setupAlertPopup() { if (dom.alertDismiss) dom.alertDismiss.addEventListener('click', hideAlertPopup); if (dom.alertRemind) dom.alertRemind.addEventListener('click', () => { hideAlertPopup(); startAlarm(t('phase_reminder_msg')); }); dom.alertOverlay.addEventListener('click', e => { if (e.target === dom.alertOverlay) hideAlertPopup(); }); }
  function showAlertPopup() { dom.alertOverlay.classList.add('visible'); }
  function hideAlertPopup() { dom.alertOverlay.classList.remove('visible'); }

  // ═══ ALARM/REMINDER ═══
  let alarmOsc = [], alarmCtx = null, alarmLoop = null;
  function setupAlarmSystem() { if (dom.alarmDismissBtn) dom.alarmDismissBtn.addEventListener('click', stopAlarm); }
  function startAlarm(message, duration) {
    if (state.alarmActive) return; state.alarmActive = true; state.alarmStartTime = Date.now(); const dur = duration || ALARM_DURATION_MS;
    if (dom.alarmMessage) dom.alarmMessage.textContent = message || t('phase_reminder_msg'); dom.alarmOverlay.classList.add('visible'); if (dom.alarmRing) dom.alarmRing.classList.add('ringing');
    if (state.vibrationEnabled && navigator.vibrate) { state.vibrationInterval = setInterval(() => navigator.vibrate([500, 200, 500]), 2200); navigator.vibrate([500, 200, 500]); }
    playAlarmSound(); updateAlarmTimer(); state.alarmInterval = setInterval(updateAlarmTimer, 1000); state.alarmTimeout = setTimeout(stopAlarm, dur);
  }
  function stopAlarm() { state.alarmActive = false; dom.alarmOverlay.classList.remove('visible'); if (dom.alarmRing) dom.alarmRing.classList.remove('ringing'); if (navigator.vibrate) navigator.vibrate(0); if (state.vibrationInterval) { clearInterval(state.vibrationInterval); state.vibrationInterval = null; } stopAlarmSound(); if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval = null; } if (state.alarmTimeout) { clearTimeout(state.alarmTimeout); state.alarmTimeout = null; } }
  function updateAlarmTimer() { if (!state.alarmStartTime || !dom.alarmTimer) return; const rem = Math.max(0, ALARM_DURATION_MS - (Date.now() - state.alarmStartTime)); const s = Math.ceil(rem / 1000); dom.alarmTimer.textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; if (rem <= 0) stopAlarm(); }
  function playAlarmSound() { if (state.alertSound === 'custom' && state.customAlarmAudioUrl) { try { if (state.customAudioElement) state.customAudioElement.pause(); const a = new Audio(state.customAlarmAudioUrl); a.loop = true; a.volume = 1.0; a.play().catch(() => { state.alertSound = 'default'; playAlarmSound(); }); state.customAudioElement = a; } catch (e) { } return; } try { alarmCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } playBurst(); alarmLoop = setInterval(() => { if (!state.alarmActive) { clearInterval(alarmLoop); return; } playBurst(); }, 2500); }
  function playBurst() { if (!alarmCtx || !state.alarmActive) return; const now = alarmCtx.currentTime, tp = state.alertSound; if (tp === 'siren') { for (let i = 0; i < 4; i++) { const o = alarmCtx.createOscillator(), g = alarmCtx.createGain(); o.connect(g); g.connect(alarmCtx.destination); o.type = 'sawtooth'; const s = now + i * 0.5; o.frequency.setValueAtTime(400, s); o.frequency.linearRampToValueAtTime(1200, s + 0.25); o.frequency.linearRampToValueAtTime(400, s + 0.5); g.gain.setValueAtTime(0.25, s); g.gain.linearRampToValueAtTime(0, s + 0.5); o.start(s); o.stop(s + 0.5); alarmOsc.push(o); } } else if (tp === 'bell') { for (let i = 0; i < 8; i++) { const o = alarmCtx.createOscillator(), g = alarmCtx.createGain(); o.connect(g); g.connect(alarmCtx.destination); o.type = 'sine'; const s = now + i * 0.25; o.frequency.setValueAtTime(1400, s); g.gain.setValueAtTime(0.3, s); g.gain.exponentialRampToValueAtTime(0.01, s + 0.12); o.start(s); o.stop(s + 0.15); alarmOsc.push(o); } } else { for (let i = 0; i < 3; i++) { const s = now + i * 0.7; const o1 = alarmCtx.createOscillator(), g1 = alarmCtx.createGain(); o1.connect(g1); g1.connect(alarmCtx.destination); o1.type = 'square'; o1.frequency.setValueAtTime(880, s); g1.gain.setValueAtTime(0.15, s); g1.gain.linearRampToValueAtTime(0, s + 0.3); o1.start(s); o1.stop(s + 0.3); const o2 = alarmCtx.createOscillator(), g2 = alarmCtx.createGain(); o2.connect(g2); g2.connect(alarmCtx.destination); o2.type = 'square'; o2.frequency.setValueAtTime(660, s + 0.35); g2.gain.setValueAtTime(0.15, s + 0.35); g2.gain.linearRampToValueAtTime(0, s + 0.65); o2.start(s + 0.35); o2.stop(s + 0.65); alarmOsc.push(o1, o2); } } }
  function stopAlarmSound() { alarmOsc.forEach(o => { try { o.stop(); } catch (e) { } }); alarmOsc = []; if (alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; } if (alarmCtx) { try { alarmCtx.close(); } catch (e) { } alarmCtx = null; } if (state.customAudioElement) { state.customAudioElement.pause(); state.customAudioElement = null; } }

  // ═══ UPDATE ═══
  function setupUpdateSystem() { if (dom.checkUpdateBtn) dom.checkUpdateBtn.addEventListener('click', () => { if (!dbRefs) { showToast(t('firebase_not_configured'), 'warning'); return; } showToast(t('checking_updates'), 'info'); dbRefs.appVersionCode.once('value', s => { state.remoteVersionCode = s.val(); checkForUpdate(true); }); }); if (dom.updateDownloadBtn) dom.updateDownloadBtn.addEventListener('click', downloadUpdate); if (dom.updateLaterBtn) dom.updateLaterBtn.addEventListener('click', () => dom.updateOverlay.classList.remove('visible')); if (dom.forceUpdateBtn) dom.forceUpdateBtn.addEventListener('click', downloadUpdate); }
  function checkForUpdate(manual) { if (state.remoteVersionCode == null) return; if (state.remoteVersionCode > APP_VERSION_CODE) { if (state.forceUpdate) { dom.forceUpdateOverlay.classList.remove('hidden'); if (dom.forceUpdateMsg) dom.forceUpdateMsg.textContent = state.updateMessage || t('must_update'); } else { dom.updateTitle.textContent = t('update_available'); dom.updateMessage.textContent = state.updateMessage || `Version ${state.remoteVersionName || 'new'}`; dom.updateOverlay.classList.add('visible'); } } else if (manual) showToast(t('up_to_date'), 'success'); }
  function downloadUpdate() { if (state.apkUrl) { window.open(state.apkUrl, '_blank'); showToast(t('download_started'), 'info'); } else showToast(t('no_download_url'), 'error'); }


  function setupSettings() {
    if (dom.settingsUsername) dom.settingsUsername.textContent = state.currentUser.name || '—';
    if (dom.settingsDeviceId) dom.settingsDeviceId.textContent = state.currentUser.deviceId || '—';
    if (dom.darkModeToggle) dom.darkModeToggle.addEventListener('change', () => { state.darkMode = !state.darkMode; localStorage.setItem('darkMode', state.darkMode); applyTheme(); });
    if (dom.notifToggle) { dom.notifToggle.checked = state.notificationsEnabled; dom.notifToggle.addEventListener('change', () => { state.notificationsEnabled = dom.notifToggle.checked; }); }
    if (dom.vibToggle) { dom.vibToggle.checked = state.vibrationEnabled; dom.vibToggle.addEventListener('change', () => { state.vibrationEnabled = dom.vibToggle.checked; }); }
    if (dom.soundSelect) dom.soundSelect.addEventListener('change', () => { state.alertSound = dom.soundSelect.value; if (dom.customAudioRow) dom.customAudioRow.classList.toggle('hidden', state.alertSound !== 'custom'); });
    if (dom.customAudioInput) dom.customAudioInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) { state.customAlarmAudioUrl = URL.createObjectURL(f); if (dom.customAudioName) dom.customAudioName.textContent = f.name; } });
    if (dom.testNotifBtn) dom.testNotifBtn.addEventListener('click', () => startAlarm(t('test_reminder_msg')));
    if (dom.logoutBtn) dom.logoutBtn.addEventListener('click', logout);

    updateSecuritySettingsUI();

    if (dom.enablePinBtn) dom.enablePinBtn.addEventListener('click', () => { showPinCreateScreen('enable'); });
    if (dom.disablePinBtn) dom.disablePinBtn.addEventListener('click', promptDisablePin);

    if (dom.askPinToggle) {
      dom.askPinToggle.addEventListener('change', e => {
        state.currentUser.alwaysAskPin = e.target.checked;
        localStorage.setItem('irrigationUser', JSON.stringify(state.currentUser));
        if (typeof usersRef !== 'undefined') {
          usersRef.child(state.currentUser.userId).update({ pin_on_start: e.target.checked });
        }
      });
    }

    if (dom.pinUpdateBtn) {
      dom.pinUpdateBtn.addEventListener('click', () => {
        const curr = dom.pinCurrent.value;
        const newP = dom.pinNew.value;
        const conf = dom.pinConfirm.value;
        dom.pinChangeError.classList.add('hidden');
        dom.pinChangeSuccess.classList.add('hidden');
        if (curr !== state.currentUser.pinCode) { dom.pinChangeError.textContent = t('wrong_pin') || 'Wrong PIN'; dom.pinChangeError.classList.remove('hidden'); return; }
        if (newP.length !== 4) { dom.pinChangeError.textContent = "PIN must be 4 digits"; dom.pinChangeError.classList.remove('hidden'); return; }
        if (newP !== conf) { dom.pinChangeError.textContent = "New PIN and Confirm PIN do not match"; dom.pinChangeError.classList.remove('hidden'); return; }

        state.currentUser.pinCode = newP;
        localStorage.setItem('irrigationUser', JSON.stringify(state.currentUser));
        if (typeof usersRef !== 'undefined') {
          usersRef.child(state.currentUser.userId).update({ pin_code: newP });
        }
        dom.pinCurrent.value = ''; dom.pinNew.value = ''; dom.pinConfirm.value = '';
        dom.pinChangeSuccess.classList.remove('hidden');
        setTimeout(() => dom.pinChangeSuccess.classList.add('hidden'), 3000);
      });
    }
  }

  function updateSecuritySettingsUI() {
    if (!state.currentUser) return;
    const isEnabled = state.currentUser.pinEnabled === true;

    if (dom.pinLockStatusDesc) {
      dom.pinLockStatusDesc.textContent = isEnabled ? 'Enabled' : 'Disabled';
      dom.pinLockStatusDesc.style.color = isEnabled ? 'var(--color-green)' : 'var(--color-orange)';
    }

    if (dom.askPinItem) dom.askPinItem.classList.toggle('hidden', !isEnabled);
    if (dom.pinChangeForm) dom.pinChangeForm.classList.toggle('hidden', !isEnabled);

    if (dom.enablePinBtnContainer) dom.enablePinBtnContainer.classList.toggle('hidden', isEnabled);
    if (dom.disablePinBtnContainer) dom.disablePinBtnContainer.classList.toggle('hidden', !isEnabled);

    if (dom.askPinToggle) dom.askPinToggle.checked = state.currentUser.alwaysAskPin !== false;
  }

  function promptDisablePin() {
    const p = prompt("Enter your current 4-digit PIN to disable security:");
    if (p === null) return;
    if (p === state.currentUser.pinCode) {
      state.currentUser.pinEnabled = false;
      localStorage.setItem('irrigationUser', JSON.stringify(state.currentUser));
      if (typeof usersRef !== 'undefined') {
        usersRef.child(state.currentUser.userId).update({ pin_enabled: false });
      }
      updateSecuritySettingsUI();
      showToast('PIN Lock Disabled', 'success');
    } else {
      showToast('Incorrect PIN', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
