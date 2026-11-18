# LoRa Smart Irrigation — v1.3.0

The working source snapshot from `lora irrigation final`, containing the Home gateway, full Field motor controller, web dashboard and Android v1.3 project. The Field code replaces the LED-only stub in the earlier GitHub snapshot.

This publication preserves the requested folder's control logic. It does not include the separate latency changes from `final esp lora irrigation`.

## Contents

- `HOME_ESP32_FINAL_COMPATIBLE/`: Home ESP32 firmware and private configuration example.
- `field_esp32_motor_controller_fixed/`: full Field firmware, current sensing, relay control and LoRa command handling.
- `lora irrigation app new/`: static website for Netlify or a local web server.
- `android lora irrigation  app new/`: web sources and Capacitor Android project.

## Home and Field configuration

Copy `HOME_ESP32_FINAL_COMPATIBLE/secrets.example.h` to `secrets.h` in the same directory. Fill in your own Wi-Fi and Firebase values. `secrets.h` is ignored by Git; the repository contains no deployment Wi-Fi password or gateway Firebase token.

Use the ESP32 Dev Module board preset and the LoRa and Firebase ESP Client libraries. Open each sketch from its own folder and upload it to the corresponding board. Wiring, calibration and current thresholds remain those of the supplied working sketches; publishing this snapshot does not itself fix their reporting latency.

## Website configuration

Copy the app's `firebase-config.local.example.js` to `firebase-config.local.js` and enter your Firebase web-app configuration. That local file is ignored. The browser config loader reads it before starting Firebase.

Run locally:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory "lora irrigation app new"
```

Open http://127.0.0.1:8080/.

For Netlify, connect this repository, add a build environment variable named `FIREBASE_WEB_CONFIG` containing your Firebase **web** configuration as JSON, and deploy. `netlify.toml` generates the ignored config file at build time and publishes only `lora irrigation app new`.

Browser Firebase configuration is visible to visitors after deployment. Moving it into build configuration keeps this deployment's values out of Git, but does not make browser code private. Protect data access with Firebase authentication and database/storage rules. Never put the gateway legacy token, Wi-Fi password, service-account key or signing key in `FIREBASE_WEB_CONFIG`.

## Android

Configure `firebase-config.local.js` in the Android app directory, then:

```sh
cd "android lora irrigation  app new"
npm ci
npm run sync:android
```

Build the native `android` project with Android Studio. Alternatively, with a local Android SDK and Java 21 configured, run `./gradlew assembleDebug` inside `android/`. Local SDK paths and signing files are not committed. Generated APKs and generated native web assets are excluded because they can embed deployment configuration.

## Tests and publication verification

```sh
node --test "android lora irrigation  app new/tests/"*.test.cjs
node --test tests/*.test.cjs
```

See `PUBLICATION.md` for the checks performed on this version. Credentials must be configured locally before deployment; no live motor commands were issued for publication tests.
