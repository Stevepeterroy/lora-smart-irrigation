# Changelog

## v1.3.0 — 18 November 2026

- Publish the working `lora irrigation final` snapshot: restored Home and full Field motor-controller sketches, web dashboard, and Android v1.3 sources.
- Replace the previous LED-only Field stub with the supplied full motor-controller code.
- Include bundled Firebase web libraries and existing data freshness/loading tests.
- Keep deployment values in ignored `secrets.h` and `firebase-config.local.js` files, with examples in source control.
- Add Netlify configuration generation from browser-only configuration and an Android web-asset staging command.
- Exclude APKs, native generated assets, build caches, private configuration, and signing material.

This version publishes the folder requested by the owner. It does not substitute firmware from `final esp lora irrigation`, and it retains the timing behavior of the restored sketches.
