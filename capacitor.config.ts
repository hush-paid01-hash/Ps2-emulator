import type { CapacitorConfig } from "@capacitor/cli";

/**
 * EmberStation — Capacitor configuration.
 *
 * The web build in `dist/` is wrapped in a native iOS WKWebView shell.
 * See BUILD_IOS.md for how to open the generated Xcode project.
 */
const config: CapacitorConfig = {
  appId: "com.emberstation.emulator",
  appName: "EmberStation",
  webDir: "dist",
  backgroundColor: "#0b0e17",
  loggingBehavior: "production",

  ios: {
    // the web content is full-screen (status bar overlays it) and we add
    // matching CSS safe-area padding — so let WKWebView NOT auto-inset,
    // otherwise the notch/status-bar spacing would be applied twice
    contentInset: "never",
    backgroundColor: "#0b0e17",
    // the app is a fixed-shell emulator UI; disable link previews & zoom
    allowsLinkPreview: false,
    zoomEnabled: false,
    scrollEnabled: false,
    // render the mobile (not desktop) site
    preferredContentMode: "mobile",
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 900,
      backgroundColor: "#0b0e17",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK", // light glyphs over the dark UI
      backgroundColor: "#0b0e17",
      overlaysWebView: true,
    },
  },
};

export default config;