'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const raw = process.env.FIREBASE_WEB_CONFIG;
if (!raw) throw new Error('Set FIREBASE_WEB_CONFIG to your Firebase WEB configuration JSON. Never use the Home gateway token.');
let config;
try { config = JSON.parse(raw); } catch { throw new Error('FIREBASE_WEB_CONFIG must be valid JSON.'); }
for (const key of ['apiKey', 'projectId', 'databaseURL', 'appId']) {
  if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error('Missing Firebase web configuration field: ' + key);
}
// Allow only browser SDK fields: never publish additional service credentials.
const allowed = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
const clean = Object.fromEntries(allowed.filter(key => typeof config[key] === 'string').map(key => [key, config[key]]));
const output = 'window.IRRIGATION_FIREBASE_CONFIG = ' + JSON.stringify(clean, null, 2) + ';\n';
for (const folder of ['lora irrigation app new', 'android lora irrigation  app new']) {
  fs.writeFileSync(path.join(root, folder, 'firebase-config.local.js'), output);
}
console.log('Generated ignored browser configuration files.');
