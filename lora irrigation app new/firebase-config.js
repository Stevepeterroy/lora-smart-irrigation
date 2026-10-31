// ============================================
// Firebase Configuration — Smart Irrigation App
// ============================================

const firebaseConfig = window.IRRIGATION_FIREBASE_CONFIG;
if (!firebaseConfig) throw new Error("Configure firebase-config.local.js before starting the app.");

firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const storage = firebase.storage();


// ── Static refs ──
const usersRef = database.ref('users');

// ── Build device-scoped refs ──
function buildDbRefs(deviceId) {
  console.log('[FIREBASE DEBUG] Building DB refs for deviceId:', deviceId);
  const d = (path) => database.ref(`devices/${deviceId}/${path}`);
  return {
    // Motor
    motor: d('motor'),
    motorCommand: d('motor/command'),
    commandId: d('motor/command_id'),
    motorCommandStatus: d('motor/command_status'),
    commandSource: d('motor/command_source'),
    commandTimestamp: d('motor/command_timestamp'),
    motorActual: d('motor/actual'),

    // Current
    currentAmps: d('current/amps'),

    // Phase
    phaseAvailable: d('phase/available'),
    phaseType: d('phase/type'),

    // PSR
    psrOk: d('psr/ok'),
    psrRaw: d('psr/raw'),

    // LoRa
    loraRssi: d('lora/rssi'),
    loraSnr: d('lora/snr'),
    fieldLastSeen: d('lora/field_last_seen'),

    // Status
    statusHomeEsp32: d('status/home_esp32'),
    statusHomeLora: d('status/home_lora'),
    statusHomeWifi: d('status/home_wifi'),
    homeLastSeen: d('status/home_last_seen'),
    statusFieldEsp32: d('status/field_esp32'),
    statusFieldLora: d('status/field_lora'),

    // Analytics
    currentHistory: d('analytics/current_history'),
    rssiHistory: d('analytics/rssi_history'),
    snrHistory: d('analytics/snr_history'),
    
    // Logs
    systemLogs: d('logs'),



    // Auto Timer Mode
    timerActive: d('motor/timer_active'),
    timerDuration: d('motor/timer_duration'),
    timerStartTime: d('motor/timer_start_time'),
    timerEndTime: d('motor/timer_end_time'),
    timerRemaining: d('motor/timer_remaining'),

    // Motor Runtime Analytics (keep if app relies on it internally via Firebase)
    runtimeToday: d('analytics/runtime_today'),
    runtimeWeek: d('analytics/runtime_week'),
    runtimeMonth: d('analytics/runtime_month'),
    webRuntime: d('analytics/web_runtime'),
    firebaseConnected: database.ref('.info/connected'),
    serverTimeOffset: database.ref('.info/serverTimeOffset'),
    lastOnTime: d('motor/last_on_time'),

    // Alerts & overrides
    alert: d('alert/active'),
    alertMessage: d('alert/message'),
    auxStatus: d('aux/status'),
    manualOverride: d('manual_override'),
    transmissionInterval: d('settings/transmission_interval'),

    // Scheduling (keep if app relies on it internally via Firebase)
    scheduleEnabled: d('schedule/enabled'),
    scheduleTime: d('schedule/time'),
    scheduleAction: d('schedule/action'),
    scheduleRepeat: d('schedule/repeat_daily'),
    schedulesRef: d('schedules'),

    // Device restart control
    restartHomeEsp32: d('control/restart_home_esp32'),
    restartHomeLora: d('control/restart_home_lora'),
    restartFieldEsp32: d('control/restart_field_esp32'),
    restartFieldLora: d('control/restart_field_lora'),
    restartFieldDevice: d('control/restart_field_device'),

    // App update (global)
    appVersionCode: database.ref('app/version_code'),
    appVersionName: database.ref('app/version_name'),
    appUpdateMessage: database.ref('app/update_message'),
    appForceUpdate: database.ref('app/force_update'),
    appApkUrl: database.ref('app/apk_url')
  };
}
