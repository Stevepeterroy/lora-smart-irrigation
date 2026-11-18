# Publication checks — v1.3.0, 18 November 2026

Published source is based on the requested Desktop folder `lora irrigation final`. The separate `final esp lora irrigation` latency changes are not substituted into this snapshot.

- The full supplied Field motor-controller sketch replaces the earlier LED-only stub.
- Both Home and Field compile for ESP32 Dev Module with the installed Arduino ESP32 core 3.3.13. Home is compiled using placeholder configuration supplied through `secrets.h`.
- Fourteen JavaScript tests pass across both app variants and the new configuration generator.
- Gitleaks reports no findings on the sanitized publication tree and Git history.
- An additional exact-match check verifies that the 12 deployment configuration values extracted locally are absent from tracked source; no values are recorded in this report.
- The Field control code is unchanged from the attached working source. App logic is unchanged apart from insignificant whitespace; configuration loading and build setup are externalized.
- APKs, firmware images, private config files, SDK paths, signing files, build caches and generated native web assets are excluded.
- Netlify config generation accepts browser SDK fields only; tests verify that extra private-token/password fields are not written to web configuration.
- The original working folder is left unchanged. No live motor commands were sent, and no board was flashed during publication verification.

Git tag `v1.3.0` identifies this source snapshot. The Android app keeps its existing v1.3/build 4 identity; no replacement APK is included in this public source publication.
