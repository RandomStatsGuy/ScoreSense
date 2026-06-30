# ScoreSense mobile app (PWA + Android TWA)

## PWA (install from browser)

Production already ships a PWA via `vite-plugin-pwa` (`frontend/vite.config.js`).

- Users on Chrome/Edge/Android see an in-app **Install ScoreSense** banner (`frontend/src/InstallPrompt.jsx`).
- iOS: use Safari **Add to Home Screen** (no `beforeinstallprompt` on iOS).

## Android Play Store (Trusted Web Activity)

The repo includes a Bubblewrap manifest at [`mobile/twa/twa-manifest.json`](../mobile/twa/twa-manifest.json).

### 1. Install Bubblewrap CLI

```bash
npm install -g @bubblewrap/cli
```

### 2. Initialize / update the Android project

```bash
cd mobile/twa
bubblewrap init --manifest twa-manifest.json
# or, after the first init:
bubblewrap update
bubblewrap build
```

### 3. Generate signing key (first time only)

```bash
keytool -genkey -v -keystore android.keystore -alias scoresense -keyalg RSA -keysize 2048 -validity 10000
```

### 4. Asset links (required for TWA)

After building, get the SHA-256 fingerprint:

```bash
keytool -list -v -keystore android.keystore -alias scoresense
```

Copy the **SHA256** line (colon-separated) into production:

- FastAPI serves [`/.well-known/assetlinks.json`](https://app.fourthdownlabs.com/.well-known/assetlinks.json) from `app/api.py`.
- Replace `REPLACE_WITH_BUBBLEWRAP_SHA256` in that route with your fingerprint (uppercase, colons OK).
- Or set `TWA_SHA256_FINGERPRINT` in server `.env` (comma-separated for multiple certs).

Redeploy the API, then verify:

```bash
curl -s https://app.fourthdownlabs.com/.well-known/assetlinks.json
```

### 5. Play Console

1. Create an app with package name `com.fourthdownlabs.scoresense`.
2. Upload the Bubblewrap `.aab` from `bubblewrap build`.
3. Complete store listing (icon, screenshots, privacy policy URL).
4. Use **Digital Asset Links** verification in Play Console if prompted.

## Notes

- TWA wraps `https://app.fourthdownlabs.com` — no duplicate frontend bundle.
- API calls stay on `/api/*` (Workbox uses `NetworkOnly` for API routes).
- Do not commit `android.keystore` or Play signing secrets.
