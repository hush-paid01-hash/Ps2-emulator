// Generates a shared Xcode scheme for the Capacitor "App" target.
// Capacitor 8's project template no longer ships a shared scheme, but
// `xcodebuild -scheme App -derivedDataPath ...` requires one.
// Run after `npx cap add ios`. Safe to re-run.
// Usage: node scripts/make-scheme.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const projDir = "ios/App/App.xcodeproj";
const pbxPath = `${projDir}/project.pbxproj`;
if (!existsSync(pbxPath)) {
  console.error(`✗ ${pbxPath} not found — run \`npx cap add ios\` first`);
  process.exit(1);
}

const pbx = readFileSync(pbxPath, "utf8");

// find the PBXNativeTarget block whose name is "App" and read its 24-hex id
const blocks = pbx.split(/\n\t\t(?=[A-F0-9]{24} )/);
const target = blocks.find(
  (b) => /isa = PBXNativeTarget;/.test(b) && /\bname = App;/.test(b)
);
if (!target) {
  console.error("✗ could not find the App target in project.pbxproj");
  process.exit(1);
}
const id = target.match(/^\s*([A-F0-9]{24})/)?.[1];
if (!id) {
  console.error("✗ could not read the App target id");
  process.exit(1);
}

const ref = (indent = "") =>
  `${indent}<BuildableReference
${indent}   BuildableIdentifier = "primary"
${indent}   BlueprintIdentifier = "${id}"
${indent}   BuildableName = "App.app"
${indent}   BlueprintName = "App"
${indent}   ReferencedContainer = "container:App.xcodeproj">
${indent}</BuildableReference>`;

const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1600"
   version = "1.3">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            ${ref("            ")}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         ${ref("         ")}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         ${ref("         ")}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`;

const schemeDir = `${projDir}/xcshareddata/xcschemes`;
mkdirSync(schemeDir, { recursive: true });
const schemePath = `${schemeDir}/App.xcscheme`;
writeFileSync(schemePath, scheme);
console.log(`✔ wrote ${schemePath} (target App, id ${id})`);