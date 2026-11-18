# Security and private configuration

Deployment Wi-Fi values and Firebase gateway credentials belong in ignored `secrets.h`. Firebase browser configuration belongs in ignored `firebase-config.local.js`, or in the `FIREBASE_WEB_CONFIG` deployment environment variable used by the Netlify build.

The browser's configuration is necessarily readable by visitors after deployment. It is not a substitute for Firebase authentication and database/storage authorization rules. The client PIN feature does not replace backend authorization. Never include a gateway legacy token, service-account private key, Wi-Fi password or Android signing key in browser configuration.

APKs, firmware binaries, local SDK configuration, dependency directories, generated native web assets and signing material are excluded because build artifacts may contain configuration values. Configuration examples contain placeholders only.

If a credential was exposed elsewhere, removing it from a Git snapshot does not revoke it. Do not post credentials in public issues.
