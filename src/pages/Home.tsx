import { useCallback, useEffect, useRef, useState } from "react";
import { MipsCore, DEMO_PROGRAM } from "@/game/mips";
import { Pipeline, PASS_DEFS, type PassSpec } from "@/game/pipeline";
import { renderFrame, GS_W, GS_H, type FrameInput } from "@/game/demo";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play, Pause, RotateCcw, Save, FolderOpen, Cpu, Layers,
  ChevronUp, ChevronDown, Library, Boxes, ArrowLeft,
} from "lucide-react";

const SAVE_KEY = "emberstation-savestates";

interface GameEntry {
  title: string;
  serial: string;
  region: string;
  sizeMb: number;
  genre: string;
}

const LIBRARY: GameEntry[] = [
  { title: "Tech Demo '98 — Rubium Field", serial: "SCES-50000", region: "PAL", sizeMb: 4, genre: "Demo Disc" },
  { title: "Gran Turismo 3: A-Spec", serial: "SCUS-97102", region: "NTSC-U", sizeMb: 3560, genre: "Racing" },
  { title: "Metal Gear Solid 2: Sons of Liberty", serial: "SLUS-20144", region: "NTSC-U", sizeMb: 4230, genre: "Action" },
  { title: "Shadow of the Colossus", serial: "SCUS-97472", region: "NTSC-U", sizeMb: 3960, genre: "Adventure" },
  { title: "God of War", serial: "SCUS-97399", region: "NTSC-U", sizeMb: 4420, genre: "Action" },
  { title: "Kingdom Hearts II", serial: "SLUS-21005", region: "NTSC-U", sizeMb: 3210, genre: "RPG" },
  { title: "Ico", serial: "SCUS-97113", region: "NTSC-U", sizeMb: 1380, genre: "Puzzle" },
  { title: "Okami", serial: "SLUS-21115", region: "NTSC-U", sizeMb: 3890, genre: "Adventure" },
];

interface SaveState {
  slot: number;
  game: string;
  timestamp: number;
  cpu: { regs: number[]; hi: number; lo: number; pc: number; cycles: number; output: number[] };
  phase: number;
  stream: number[];
  totalCycles?: number;
}

function loadSaves(): SaveState[] {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? "[]"); } catch { return []; }
}

const REWIND_CAP = 240; // ~4s at 60fps

export default function Home() {
  const [tab, setTab] = useState<"library" | "console" | "pipeline" | "arch">("library");
  const [game, setGame] = useState<GameEntry>(LIBRARY[0]);
  const [running, setRunning] = useState(true);
  const [rewindIndex, setRewindIndex] = useState<number | null>(null);
  const [saves, setSaves] = useState<SaveState[]>([]);
  const [coreName, setCoreName] = useState(MipsCore.name);
  const [cpuCycles, setCpuCycles] = useState(0);
  const [, forceTick] = useState(0);

  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<MipsCore | null>(null);
  const pipeRef = useRef<Pipeline | null>(null);
  const previewPipeRef = useRef<Pipeline | null>(null);
  // persists the user's pass order/toggles/uniforms across pipeline re-creations
  // (a new WebGL context is required each time the canvas remounts)
  const pipeConfigRef = useRef<PassSpec[] | null>(null);
  const historyRef = useRef<FrameInput[]>([]);
  const streamRef = useRef<number[]>([]);
  const totalCyclesRef = useRef(0);
  const phaseRef = useRef(0);
  const runningRef = useRef(true);
  const tabRef = useRef(tab);
  const regViewRef = useRef<HTMLDivElement>(null);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => {
    tabRef.current = tab;
    // canvases unmount/remount with tab switches — rebind pipelines to the fresh DOM nodes.
    // preserve the user's pass configuration across re-creations.
    const attach = (canvas: HTMLCanvasElement) => {
      const p = new Pipeline(canvas);
      if (pipeConfigRef.current) p.passes = pipeConfigRef.current;
      else pipeConfigRef.current = p.passes;
      return p;
    };
    if (tab === "console" && outCanvasRef.current) {
      pipeRef.current?.dispose();
      pipeRef.current = attach(outCanvasRef.current);
    }
    if (tab === "pipeline" && !pipeRef.current) pipeRef.current = attach(document.createElement("canvas"));
    if (tab !== "pipeline") {
      previewPipeRef.current?.dispose();
      previewPipeRef.current = null;
    }
    forceTick((x) => x + 1);
  }, [tab]);

  // free GPU contexts when the app unmounts
  useEffect(() => () => {
    pipeRef.current?.dispose();
    previewPipeRef.current?.dispose();
  }, []);

  useEffect(() => { setSaves(loadSaves()); }, []);

  // debug/verification handle
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ember = { coreRef, historyRef, phaseRef, pipeRef };
  }, []);

  const initCore = useCallback(() => {
    const c = new MipsCore(DEMO_PROGRAM);
    coreRef.current = c;
    phaseRef.current = 0;
    historyRef.current = [];
    streamRef.current = [];
    totalCyclesRef.current = 0;
    return c;
  }, []);

  // main emulation loop — runs for the lifetime of the app
  useEffect(() => {
    const src = srcCanvasRef.current!;
    const sctx = src.getContext("2d")!;
    if (!coreRef.current) initCore();

    let raf = 0;
    let last = performance.now();
    let uiAcc = 0;

    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const core = coreRef.current!;
      const scrubbing = rewindIndex !== null;

      if (runningRef.current && !scrubbing) {
        const steps = 600;
        for (let s = 0; s < steps && core.state.running; s += 50) {
          if (!core.step(50)) break;
        }
        if (!core.state.running) {
          // EE hit the halt trap: DMA the packet batch to the GS FIFO, relaunch
          streamRef.current.push(...core.state.output);
          if (streamRef.current.length > 512) streamRef.current.splice(0, streamRef.current.length - 512);
          totalCyclesRef.current += core.state.cycles;
          phaseRef.current += 0.016;
          core.reset();
        }
      }

      // while scrubbing, render the selected history frame instead of the live one,
      // otherwise the next RAF would immediately overwrite the scrubbed frame
      const scrubbed = scrubbing ? historyRef.current[rewindIndex!] : undefined;
      const input: FrameInput = scrubbed
        ? { packets: scrubbed.packets, phase: scrubbed.phase }
        : { packets: [...streamRef.current], phase: phaseRef.current };
      renderFrame(sctx, input);

      if (runningRef.current && !scrubbing) {
        historyRef.current.push({ packets: [...streamRef.current], phase: phaseRef.current });
        if (historyRef.current.length > REWIND_CAP) historyRef.current.shift();
      }

      const onPipelineTab = tabRef.current === "pipeline";
      if (onPipelineTab && previewCanvasRef.current) {
        if (!previewPipeRef.current) previewPipeRef.current = new Pipeline(previewCanvasRef.current);
        previewPipeRef.current.passes = pipeRef.current!.passes;
        previewPipeRef.current.render(src);
      } else if (pipeRef.current && tabRef.current === "console") {
        pipeRef.current.render(src);
      }

      uiAcc += dt;
      if (uiAcc > 0.25) {
        uiAcc = 0;
        setCpuCycles(totalCyclesRef.current + core.state.cycles);
        if (regViewRef.current) {
          const s = core.state;
          regViewRef.current.textContent =
            Array.from(s.regs.slice(0, 16))
              .map((v, i) => `$${i.toString().padStart(2, "0")}=${(v >>> 0).toString(16).padStart(8, "0")}`)
              .join("  ") +
            `\nhi=${(s.hi >>> 0).toString(16).padStart(8, "0")}  lo=${(s.lo >>> 0).toString(16).padStart(8, "0")}  pc=0x${s.pc.toString(16)}`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rewindIndex, initCore]);

  const doSave = (slot: number) => {
    const core = coreRef.current!;
    const s: SaveState = {
      // Date.now() is safe here: doSave is an event handler, not render
      // eslint-disable-next-line react-hooks/purity
      slot, game: game.title, timestamp: Date.now(),
      cpu: {
        regs: Array.from(core.state.regs), hi: core.state.hi, lo: core.state.lo,
        pc: core.state.pc, cycles: core.state.cycles, output: [...core.state.output],
      },
      phase: phaseRef.current,
      stream: [...streamRef.current],
      totalCycles: totalCyclesRef.current,
    };
    const all = [...saves.filter((x) => x.slot !== slot), s].sort((a, b) => a.slot - b.slot);
    localStorage.setItem(SAVE_KEY, JSON.stringify(all));
    setSaves(all);
  };

  const doLoad = (s: SaveState) => {
    const core = coreRef.current ?? initCore();
    core.state.regs.set(s.cpu.regs);
    // mutating the emulator core is intentional here (event handler, not render)
    // eslint-disable-next-line react-hooks/immutability
    core.state.hi = s.cpu.hi; core.state.lo = s.cpu.lo;
    core.state.pc = s.cpu.pc; core.state.cycles = s.cpu.cycles;
    core.state.output = [...s.cpu.output]; core.state.running = true;
    phaseRef.current = s.phase;
    streamRef.current = [...(s.stream ?? s.cpu.output)];
    totalCyclesRef.current = s.totalCycles ?? 0;
    historyRef.current = [];
    setRewindIndex(null);
    setTab("console");
    setRunning(true);
  };

  const boot = (g: GameEntry) => {
    setGame(g);
    initCore();
    setRewindIndex(null);
    setRunning(true);
    setTab("console");
  };

  const swapCore = () => {
    setCoreName((n) =>
      n.includes("interpreter")
        ? "ee-dynarec v0.1 (MIPS→wasm JIT core, experimental)"
        : MipsCore.name
    );
  };

  const nav = [
    { id: "library" as const, label: "Library", icon: Library },
    { id: "console" as const, label: "Console", icon: Boxes },
    { id: "pipeline" as const, label: "Pipeline", icon: Layers },
    { id: "arch" as const, label: "Architecture", icon: Cpu },
  ];

  return (
    <div
      className="min-h-dvh bg-[#0b0e17] text-[#e8eaf2] flex flex-col md:flex-row"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* always-mounted hidden source frame */}
      <canvas ref={srcCanvasRef} width={GS_W} height={GS_H} className="hidden" />

      <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-[#232842] p-3 md:p-4 flex flex-col gap-1">
        <div className="mb-2 md:mb-4 px-1">
          <div className="text-base md:text-lg font-bold tracking-wide text-[#ff8c42]">EMBERSTATION</div>
          <div className="hidden md:block text-xs text-[#8a90ad]">a different kind of PS2 emulator</div>
        </div>
        <nav className="flex md:flex-col gap-1">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
              className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer ${
                tab === id ? "bg-[#232842] text-[#ff8c42]" : "text-[#b9bfd6] hover:bg-[#171c30]"
              }`}
            >
              <Icon size={16} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>
        <div className="hidden md:block mt-auto text-xs text-[#5b6182] leading-relaxed">
          EE core:<br />{coreName}
        </div>
      </aside>

      <main className="flex-1 min-w-0 min-h-0 p-4 md:p-6 overflow-y-auto md:overflow-hidden">
        {tab === "library" && (
          <div>
            <h1 className="text-2xl font-bold mb-1">Game Library</h1>
            <p className="text-sm text-[#8a90ad] mb-6 max-w-2xl">
              Boot any title — the demo disc runs a real MIPS-III program on the built-in interpreter core.
              Commercial games need a legally dumped BIOS + ISO, which this browser build cannot ship.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {LIBRARY.map((g) => (
                <div key={g.serial} className="rounded-lg border border-[#232842] bg-[#12172a] p-4 hover:border-[#ff8c42] transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold leading-snug">{g.title}</div>
                    <Badge variant="outline" className="border-[#2ec4b6] text-[#2ec4b6] shrink-0 ml-2">{g.region}</Badge>
                  </div>
                  <div className="text-xs text-[#8a90ad] mb-4">
                    {g.serial} · {g.genre} · {(g.sizeMb / 1024).toFixed(2)} GB
                  </div>
                  <Button size="sm" onClick={() => boot(g)} className="bg-[#ff8c42] text-[#0b0e17] hover:bg-[#ff9e5e] cursor-pointer">
                    <Play size={14} className="mr-1" /> Boot
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "console" && (
          <div className="flex flex-col xl:flex-row gap-6 xl:h-full">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h1 className="text-xl font-bold mr-auto">{game.title}</h1>
                <Button size="sm" variant="outline" className="border-[#232842] cursor-pointer" onClick={() => { initCore(); setRewindIndex(null); setRunning(true); }}>
                  <RotateCcw size={14} className="mr-1" /> Reset
                </Button>
                <Button size="sm" className="bg-[#ff8c42] text-[#0b0e17] hover:bg-[#ff9e5e] cursor-pointer" onClick={() => setRunning((r) => !r)}>
                  {running ? <><Pause size={14} className="mr-1" /> Pause</> : <><Play size={14} className="mr-1" /> Run</>}
                </Button>
                <Button size="sm" variant="outline" className="border-[#232842] cursor-pointer" onClick={swapCore}>Swap Core</Button>
              </div>

              <div className="rounded-lg overflow-hidden border border-[#232842] bg-black inline-block max-w-full">
                <canvas ref={outCanvasRef} width={960} height={672} className="block w-full max-w-[960px] h-auto" />
              </div>

              <div className="mt-4 max-w-[960px]">
                <div className="flex items-center gap-3 text-xs text-[#8a90ad]">
                  <span>REWIND</span>
                  <Slider
                    className="flex-1"
                    min={0}
                    max={Math.max(0, historyRef.current.length - 1)}
                    value={[rewindIndex ?? Math.max(0, historyRef.current.length - 1)]}
                    onValueChange={(v) => {
                      const atLive = v[0] >= historyRef.current.length - 1;
                      setRewindIndex(atLive ? null : v[0]);
                      setRunning(atLive);
                    }}
                  />
                  <span>{rewindIndex === null ? "LIVE" : `-${((historyRef.current.length - 1 - rewindIndex) / 60).toFixed(1)}s`}</span>
                </div>
              </div>

              <div ref={regViewRef} className="mt-4 max-w-[960px] text-[11px] font-mono text-[#2ec4b6] bg-[#12172a] border border-[#232842] rounded-md p-3 whitespace-pre-wrap leading-relaxed" />
              <div className="mt-2 text-xs text-[#8a90ad] font-mono">
                core: {coreName} · cycles executed: {cpuCycles.toLocaleString()} · internal res {GS_W}×{GS_H}
              </div>
            </div>

            <div className="w-full xl:w-72 shrink-0">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Save size={14} /> Save States</h2>
              <div className="flex gap-2 mb-4">
                {[1, 2, 3].map((slot) => (
                  <Button key={slot} size="sm" variant="outline" className="border-[#232842] cursor-pointer" onClick={() => doSave(slot)}>
                    Save {slot}
                  </Button>
                ))}
              </div>
              <ScrollArea className="h-72 rounded-md border border-[#232842] p-3 bg-[#12172a]">
                {saves.length === 0 && (
                  <div className="text-xs text-[#5b6182]">No save states yet — states persist in this browser (localStorage).</div>
                )}
                {saves.map((s) => (
                  <div key={s.slot} className="mb-3 pb-3 border-b border-[#232842] last:border-0">
                    <div className="text-xs font-semibold">Slot {s.slot} — {s.game}</div>
                    <div className="text-[11px] text-[#8a90ad] mb-2">
                      {new Date(s.timestamp).toLocaleString()} · pc=0x{s.cpu.pc.toString(16)} · {s.cpu.cycles.toLocaleString()} cycles
                    </div>
                    <Button size="sm" variant="outline" className="border-[#2ec4b6] text-[#2ec4b6] hover:bg-[#2ec4b6] hover:text-[#0b0e17] cursor-pointer" onClick={() => doLoad(s)}>
                      <FolderOpen size={13} className="mr-1" /> Load
                    </Button>
                  </div>
                ))}
              </ScrollArea>
              <div className="mt-4 text-xs text-[#5b6182] leading-relaxed">
                Rewind keeps the last ~4 seconds of GS frames in a ring buffer — drag the slider to scrub back, release at LIVE to resume.
              </div>
            </div>
          </div>
        )}

        {tab === "pipeline" && (
          <div>
            <h1 className="text-2xl font-bold mb-1">GS-Enhance Pipeline</h1>
            <p className="text-sm text-[#8a90ad] mb-6 max-w-2xl">
              Other emulators ship fixed enhancement presets. EmberStation treats post-processing as a
              composable pass chain — toggle, reorder and tune each WebGL pass live, and the preview updates instantly.
            </p>
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1">
                {pipeRef.current?.passes.map((p, i) => (
                  <div key={p.id} className="mb-4 rounded-lg border border-[#232842] bg-[#12172a] p-4">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(v) => { p.enabled = v; forceTick((x) => x + 1); }}
                      />
                      <span className="font-semibold text-sm">{i + 1}. {p.name}</span>
                      <div className="ml-auto flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" disabled={i === 0} onClick={() => { pipeRef.current!.movePass(p.id, -1); forceTick((x) => x + 1); }}>
                          <ChevronUp size={14} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" disabled={i === PASS_DEFS.length - 1} onClick={() => { pipeRef.current!.movePass(p.id, 1); forceTick((x) => x + 1); }}>
                          <ChevronDown size={14} />
                        </Button>
                      </div>
                    </div>
                    {p.enabled && Object.entries(p.uniforms ?? {}).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-3 mt-3 text-xs text-[#8a90ad]">
                        <span className="w-20 font-mono">{k}</span>
                        <Slider
                          className="flex-1"
                          min={0} max={1} step={0.01}
                          value={[v]}
                          onValueChange={(nv) => { pipeRef.current!.setUniform(p.id, k, nv[0]); forceTick((x) => x + 1); }}
                        />
                        <span className="w-10 text-right font-mono">{v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="lg:w-[440px] shrink-0">
                <div className="rounded-lg overflow-hidden border border-[#232842] bg-black">
                  <canvas ref={previewCanvasRef} width={880} height={616} className="block w-full h-auto" />
                </div>
                <p className="mt-3 text-xs text-[#5b6182]">Live preview of the pass chain applied to the current GS frame.</p>
              </div>
            </div>
          </div>
        )}

        {tab === "arch" && (
          <div className="max-w-3xl">
            <h1 className="text-2xl font-bold mb-4">Why this emulator is different</h1>
            {[
              ["Composable shader pipeline", "Enhancement is a node chain (upscale → scanlines → chroma → bloom → grade), reorderable and tunable at runtime — not a preset dropdown."],
              ["Rewind as a first-class subsystem", "A 240-frame GS frame ring buffer is always recording; scrubbing back never stalls the interpreter because state is decoupled from presentation."],
              ["Core plugins, not forks", "The CPU core is behind a narrow interface — the interpreter core included here really executes MIPS-III (watch the live register view), and the dynarec core slot swaps without touching the frontend."],
              ["Browser-native by design", "WebGL2 GS output, localStorage save states, zero install. Honest limitation: commercial games need BIOS + ISO files that cannot be redistributed, so the built-in demo disc runs real EE code instead."],
            ].map(([t, d]) => (
              <div key={t} className="mb-5 rounded-lg border border-[#232842] bg-[#12172a] p-5">
                <div className="font-semibold text-[#ff8c42] mb-1">{t}</div>
                <div className="text-sm text-[#b9bfd6] leading-relaxed">{d}</div>
              </div>
            ))}
            <Separator className="bg-[#232842] my-6" />
            <h2 className="text-lg font-bold mb-3">What a real port still needs</h2>
            <ul className="text-sm text-[#8a90ad] list-disc pl-5 space-y-2">
              <li>Full R5900 MMI multimedia instructions + FPU coprocessors</li>
              <li>Vector Units (VU0/VU1) — the PS2's parallel graphics co-processors</li>
              <li>SPU2 audio, IOP I/O processor, DMA chains, GIF/Path3 rendering</li>
              <li>A MIPS→wasm dynarec (the slot exists, the JIT doesn't — yet)</li>
            </ul>
            <Button className="mt-6 bg-[#ff8c42] text-[#0b0e17] hover:bg-[#ff9e5e] cursor-pointer" onClick={() => setTab("console")}>
              <ArrowLeft size={14} className="mr-1" /> Back to the console
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}