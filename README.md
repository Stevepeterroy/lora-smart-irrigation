# LoRa Smart Irrigation

An ESP32 and LoRa irrigation prototype with a Firebase-connected dashboard and an Android wrapper. The home gateway relays motor commands over LoRa and records acknowledged field status separately from requested motor state.

## Engineering highlights

- ESP32 gateway with Wi-Fi, Firebase Realtime Database and 433 MHz LoRa.
- Command identifiers, acknowledgments, retries and field-offline timeouts.
- Dashboard controls, runtime analytics, scheduling and multilingual interface.
- Android packaging through Capacitor.

## Architecture

```text
Web / Android dashboard ↔ Firebase ↔ Home ESP32 ↔ LoRa ↔ Field controller ↔ Motor
```

## Source layout

- `HOME_ESP32_FINAL_COMPATIBLE/`: home gateway sketch and private configuration template.
- `field_esp32_motor_controller_fixed/`: supplied field sketch; currently only an LED initialization stub.
- `lora irrigation app new/`: browser app.
- `android lora irrigation  app new/`: Android-capable app and native project.

## Setup

1. Copy `HOME_ESP32_FINAL_COMPATIBLE/secrets.example.h` to `secrets.h` beside the sketch and supply your own Wi-Fi/Firebase values. Install the ESP32 Arduino core and the WiFi, Firebase ESP Client and LoRa libraries required by the includes. Verify the wiring and local radio rules before powering hardware.
2. In either app directory, copy `firebase-config.local.example.js` to `firebase-config.local.js` and supply a separate Firebase project configuration. Serve that directory with `python3 -m http.server 8080`.
3. Configure Firebase authentication and database/storage authorization rules before connecting real equipment. Client-side PIN controls do not replace backend authorization. The gateway currently uses legacy Firebase authentication; use a separate development project and replace it with scoped authentication before deployment.
4. For Android, run `npm ci` in the Android app directory. Stage the web assets into `www/`, run `npx cap sync android`, then build with Android Studio. APKs and generated web assets are intentionally excluded.

## Tests

```sh
node --test "lora irrigation app new/tests/analytics.test.cjs"
node --test "android lora irrigation  app new/tests/analytics.test.cjs"
```

## Prototype status

The supplied field sketch does not implement motor control or LoRa reception. This snapshot therefore does not reproduce a complete working irrigation system. No hardware safety certification, range measurement or end-to-end validation is claimed. Use suitable electrical isolation, interlocks and supervised testing before any pump connection.

This public snapshot contains source and configuration templates. Deployment credentials, APKs, dependency directories and prior Git history are excluded.
