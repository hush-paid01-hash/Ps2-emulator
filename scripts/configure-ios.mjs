// Patches the Capacitor-generated iOS Info.plist with project-specific settings.
// Run after `npx cap add ios` (and safe to re-run).
// Usage: node scripts/configure-ios.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const plistPath = "ios/App/App/Info.plist";
if (!existsSync(plistPath)) {
  console.error(`✗ ${plistPath} not found — run \`npx cap add ios\` first`);
  process.exit(1);
}

let xml = readFileSync(plistPath, "utf8");

// 1. the template declares the obsolete armv7 capability → require arm64
xml = xml.replace(/<string>armv7<\/string>/g, "<string>arm64</string>");

// 2. declare the app uses no non-exempt encryption (avoids export-compliance
//    prompts on every TestFlight/App Store upload)
if (!xml.includes("ITSAppUsesNonExemptEncryption")) {
  const insert =
    "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n";
  const idx = xml.lastIndexOf("</dict>");
  xml = xml.slice(0, idx) + insert + xml.slice(idx);
}

writeFileSync(plistPath, xml);
console.log("✔ patched ios/App/App/Info.plist (arm64, ITSAppUsesNonExemptEncryption=false)");