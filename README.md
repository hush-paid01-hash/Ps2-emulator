# EmberStation

A different kind of PS2 emulator, built as a **React + TypeScript + Vite** web app
and shipped to **iOS** with **Capacitor** (native `WKWebView` shell).

- **Real MIPS-III interpreter core** (`src/game/mips.ts`) runs a demo program and
  drives the visuals through its `syscall` "DMA" trap.
- **Composable GS post-processing pipeline** (`src/game/pipeline.ts`) — WebGL2
  shader passes (upscale → scanlines → chroma → bloom → grade) that can be
  toggled, reordered and tuned live.
- **Rewind** — a rolling ring buffer of GS frames you can scrub.
- **Save states** in `localStorage`.

## Web development

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # typecheck + production build into dist/
npm run preview
```

## iOS

See [`BUILD_IOS.md`](./BUILD_IOS.md). In short:

```bash
npm run build
npx cap add ios      # first time only
npx cap sync ios
npx cap open ios     # opens Xcode (macOS only)
```

The production build is also an installable **PWA** (manifest + apple-touch-icon),
so it can be added to an iPhone home screen without a Mac.

## GitHub Actions

`.github/workflows/build.yml` builds both targets on every push / PR:

- **web** (ubuntu) — `npm ci && npm run build`, uploads `dist/`
- **ios** (macos) — generates the Xcode project, compiles a simulator `.app`
  (no signing required), uploads it as an artifact

## Notes

- The demo runs real EE (MIPS-III) code; commercial PS2 games need a legally
  dumped BIOS + ISO, which are not bundled.
- iOS requires iOS 15+ for WebGL2.
- The shadcn/ui primitives used are in `src/components/ui`. Add more with
  `npx shadcn@latest add <component>`.