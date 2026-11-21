# Building EmberStation for iOS

EmberStation is a React + TypeScript + Vite app. The iOS app is produced with
**Capacitor**, which wraps the production web build (`dist/`) in a native
`WKWebView` shell. The same code also runs in a normal browser.

In CI, GitHub Actions generates and compiles the iOS project on a macOS runner
(see `.github/workflows/build.yml`). Locally you only need a Mac with Xcode.

---

## 1. Requirements

- **macOS** with **Xcode 16 or newer** (Capacitor 8)
- **Node.js 20+**
- A free Apple ID for the simulator, or a paid developer account for device/TestFlight
- CocoaPods is **not** required (Capacitor 8 uses Swift Package Manager; no Cordova plugins)

> An `.ipa` can only be produced on macOS with Xcode.

## 2. Build & run (local)

```bash
# 1. install JS dependencies
npm install

# 2. build the web app into dist/
npm run build

# 3. generate the iOS project (first time only) and sync assets/plugins
npx cap add ios
npx cap sync ios

# 4. open the Xcode project
npx cap open ios      # or: open ios/App/App.xcworkspace
```

In Xcode:

1. Select the **App** scheme and an **iPhone** simulator (or a connected device).
2. Press **⌘R** to build and run.
3. On a real device, set your signing team under
   `Signing & Capabilities → Team`, and make the bundle identifier unique
   (default `com.emberstation.emulator`).

### Live development with hot reload (optional)

```bash
npm run dev            # Vite dev server on http://localhost:3000
npx cap run ios        # opens Xcode
```

To point the native shell at the dev server, temporarily add to
`capacitor.config.ts`:

```ts
server: { url: "http://<your-mac-LAN-IP>:3000", cleartext: true }
```

then `npx cap sync ios`. Remove it before shipping.

## 3. GitHub Actions

- `.github/workflows/build.yml` runs on every push / PR:
  - **web** job (ubuntu) → `npm ci && npm run build`, uploads `dist/`
  - **ios** job (macos) → `cap add ios`, `cap sync ios`, then
    `xcodebuild ... -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`,
    uploads the compiled `App.app`
- `.github/workflows/pages.yml` deploys `dist/` to GitHub Pages on `main`/`master`.

The iOS job produces an **unsigned simulator build** — perfect for verifying
the native project compiles in CI. For a signed TestFlight/App Store build, add
your Apple signing certificate + provisioning profile as repository secrets and
replace the build step with `xcodebuild archive` + `-exportArchive`
(see Apple's "Exporting your app" docs).

## 4. Sideloading with Esign (unsigned IPA)

The `ios` job also uploads **`emberstation-unsigned-ipa`** — an **unsigned**
`Payload/App.app` IPA built for `iphoneos` (arm64, Release). It is intentionally
left unsigned so Esign can sign it on-device with your own certificate.

1. Download `EmberStation-unsigned.ipa` from the workflow run's **Artifacts**.
2. Open **Esign** → import the IPA.
3. Select your certificate + provisioning profile (Apple ID or paid dev account).
   - With a **free** Apple ID the profile is usually a wildcard App ID. If
     `com.emberstation.emulator` is not covered, change the bundle identifier in
     Esign (e.g. `com.yourname.emberstation`) to match the profile.
   - The device's UDID must be registered in the profile.
4. Sign & install. Free accounts: 7-day expiry, 3 apps per Apple ID.

Requirements: the iPhone must run **iOS 15+** (the GS pipeline uses WebGL2).

## 5. Distribution

- **TestFlight / App Store:** Xcode → **Product → Archive** → **Distribute App**.
- `ITSAppUsesNonExemptEncryption` is set to `false` in `Info.plist`, so you
  won't be prompted on every upload.

## 6. Regenerating icons & splash

```bash
npm run icons
```

Writes `public/icons/*` and, if `ios/` exists, overwrites the
`AppIcon.appiconset` and `Splash.imageset` PNGs.

## 7. What was changed for iOS

| Area | Change |
| --- | --- |
| Native shell | Capacitor (`@capacitor/core`, `cli`, `ios`) + `capacitor.config.ts` |
| Status bar | `@capacitor/status-bar` — light glyphs (`Style.Dark`) |
| Splash | `@capacitor/splash-screen` — auto-hides; dark launch storyboard |
| Safe areas | `viewport-fit=cover` + `env(safe-area-inset-*)` padding |
| Viewport height | `min-h-dvh` |
| Layout | Responsive: sidebar becomes a top bar on phones |
| Touch | `touch-action: manipulation`, no tap highlight/callout, no zoom, no rubber-band |
| PWA | Apple meta tags, web manifest, apple-touch-icon, dark theme-color |
| WebGL contexts | `Pipeline.dispose()` on tab switches (iOS caps WebGL contexts) |
| `Info.plist` | `arm64` capability, `ITSAppUsesNonExemptEncryption=false` |

## 8. iOS notes & limitations

- **WebGL2** (GS-Enhance pipeline) requires **iOS 15+**.
- The demo disc runs a real MIPS-III program; commercial PS2 games still need a
  legally dumped BIOS + ISO, which are not bundled.
- Save states persist in `localStorage`.