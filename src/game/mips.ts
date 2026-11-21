// R5900-lite: a didactic subset of the Emotion Engine's MIPS-III core.
// Real EE runs at 294/147 MHz with 128-bit MMI multimedia ops; here we
// implement the scalar MIPS-III integer subset so the plugin interface and
// interpreter loop are exercised for real.

export interface CpuState {
  regs: Uint32Array; // 32 GPRs, r0 pinned to 0
  hi: number;
  lo: number;
  pc: number;
  cycles: number;
  running: boolean;
  output: number[]; // values written via the syscall trap
}

export type Opcode =
  | "addi" | "addiu" | "andi" | "ori" | "xori" | "lui" | "slti" | "sltiu"
  | "lw" | "sw" | "lb" | "sb" | "beq" | "bne" | "blez" | "bgtz"
  | "j" | "jal" | "jr"
  | "add" | "addu" | "sub" | "subu" | "and" | "or" | "xor" | "nor"
  | "sll" | "srl" | "sra" | "slt" | "sltu" | "mult" | "div" | "mfhi" | "mflo" | "syscall";

export interface Instruction {
  op: Opcode;
  rd?: number; rs?: number; rt?: number;
  imm?: number; shamt?: number; addr?: number;
  label?: string;  // defines this instruction's address
  target?: string; // references another instruction's label (branches/jumps)
}

function assemble(program: Instruction[]): Uint32Array {
  const labels = new Map<string, number>();
  program.forEach((ins, i) => { if (ins.label) labels.set(ins.label, i * 4); });
  const out = new Uint32Array(program.length);
  const R = (f: number, rs: number, rt: number, rd: number, sh: number, fn: number) =>
    (f << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (sh << 6) | fn;
  const I = (f: number, rs: number, rt: number, imm: number) =>
    (f << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff);
  const J = (f: number, t: number) => (f << 26) | (t & 0x3ffffff);

  program.forEach((ins, i) => {
    // branch offsets are PC-relative to the delay slot (index of next insn)
    const BRANCH = new Set(["beq", "bne", "blez", "bgtz"]);
    const ref = ins.target ?? ins.label;
    const imm = ins.imm ?? (ref != null
      ? BRANCH.has(ins.op)
        ? (labels.get(ref)! - (i + 1) * 4) | 0
        : labels.get(ref)!
      : 0);
    let w = 0;
    switch (ins.op) {
      case "addi": w = I(0x08, ins.rs!, ins.rt!, imm); break;
      case "addiu": w = I(0x09, ins.rs!, ins.rt!, imm); break;
      case "andi": w = I(0x0c, ins.rs!, ins.rt!, imm); break;
      case "ori": w = I(0x0d, ins.rs!, ins.rt!, imm); break;
      case "xori": w = I(0x0e, ins.rs!, ins.rt!, imm); break;
      case "lui": w = I(0x0f, 0, ins.rt!, imm); break;
      case "slti": w = I(0x0a, ins.rs!, ins.rt!, imm); break;
      case "sltiu": w = I(0x0b, ins.rs!, ins.rt!, imm); break;
      case "lw": w = I(0x23, ins.rs!, ins.rt!, imm); break;
      case "sw": w = I(0x2b, ins.rs!, ins.rt!, imm); break;
      case "lb": w = I(0x20, ins.rs!, ins.rt!, imm); break;
      case "sb": w = I(0x28, ins.rs!, ins.rt!, imm); break;
      case "beq": w = I(0x04, ins.rs!, ins.rt!, imm); break;
      case "bne": w = I(0x05, ins.rs!, ins.rt!, imm); break;
      case "blez": w = I(0x06, ins.rs!, 0, imm); break;
      case "bgtz": w = I(0x07, ins.rs!, 0, imm); break;
      case "j": w = J(0x02, ins.addr ?? imm); break;
      case "jal": w = J(0x03, ins.addr ?? imm); break;
      case "add": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x20); break;
      case "addu": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x21); break;
      case "sub": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x22); break;
      case "subu": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x23); break;
      case "and": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x24); break;
      case "or": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x25); break;
      case "xor": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x26); break;
      case "nor": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x27); break;
      case "slt": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x2a); break;
      case "sltu": w = R(0, ins.rs!, ins.rt!, ins.rd!, 0, 0x2b); break;
      case "sll": w = R(0, 0, ins.rt!, ins.rd!, ins.shamt!, 0x00); break;
      case "srl": w = R(0, 0, ins.rt!, ins.rd!, ins.shamt!, 0x02); break;
      case "sra": w = R(0, 0, ins.rt!, ins.rd!, ins.shamt!, 0x03); break;
      case "mult": w = R(0, ins.rs!, ins.rt!, 0, 0, 0x18); break;
      case "div": w = R(0, ins.rs!, ins.rt!, 0, 0, 0x1a); break;
      case "mfhi": w = R(0, 0, 0, ins.rd!, 0, 0x10); break;
      case "mflo": w = R(0, 0, 0, ins.rd!, 0, 0x12); break;
      case "syscall": w = R(0, 0, 0, 0, 0, 0x0c); break;
      case "jr": w = R(0, ins.rs!, 0, 0, 0, 0x08); break;
    }
    out[i] = w >>> 0;
  });
  return out;
}

const sx16 = (v: number) => (v << 16) >> 16;

export class MipsCore {
  state: CpuState;
  code: Uint32Array;
  mem = new Uint8Array(4096);
  static readonly name = "ee-interp v0.1 (MIPS-III interpreter core)";

  constructor(program: Instruction[]) {
    this.code = assemble(program);
    this.state = {
      regs: new Uint32Array(32),
      hi: 0, lo: 0, pc: 0, cycles: 0, running: true, output: [],
    };
  }

  reset() {
    this.state.regs.fill(0);
    this.state.hi = 0; this.state.lo = 0; this.state.pc = 0;
    this.state.cycles = 0; this.state.running = true; this.state.output = [];
    this.mem.fill(0);
  }

  /** Execute n instructions; returns false when halted. */
  step(n: number): boolean {
    const s = this.state;
    for (let k = 0; k < n && s.running; k++) {
      const idx = s.pc >>> 2;
      if (idx >= this.code.length) { s.running = false; break; }
      const w = this.code[idx];
      s.pc = (s.pc + 4) >>> 0;
      s.cycles++;
      this.exec(w >>> 0);
      s.regs[0] = 0;
    }
    return s.running;
  }

  private exec(w: number) {
    const s = this.state, r = s.regs;
    const op = w >>> 26, rs = (w >>> 21) & 31, rt = (w >>> 16) & 31,
      rd = (w >>> 11) & 31, sh = (w >>> 6) & 31, fn = w & 63, imm = sx16(w);
    const branch = (take: boolean, off: number) => { if (take) s.pc = (s.pc + off) >>> 0; };
    switch (op) {
      case 0x00:
        switch (fn) {
          case 0x00: r[rd] = r[rt] << sh; break;
          case 0x02: r[rd] = r[rt] >>> sh; break;
          case 0x03: r[rd] = r[rt] >> sh; break;
          case 0x08: s.pc = r[rs] >>> 0; break;
          case 0x0c: s.output.push(r[4] >>> 0); s.running = false; break;
          case 0x10: r[rd] = s.hi; break;
          case 0x12: r[rd] = s.lo; break;
          case 0x18: {
            const a = BigInt(r[rs] | 0) * BigInt(r[rt] | 0);
            s.lo = Number(a & 0xffffffffn) >>> 0;
            s.hi = Number((a >> 32n) & 0xffffffffn) >>> 0;
            s.cycles += 3; // mult latency
            break;
          }
          case 0x1a: {
            const b = r[rt] | 0;
            if (b !== 0) { s.lo = ((r[rs] | 0) / b) | 0; s.hi = ((r[rs] | 0) % b) | 0; }
            s.cycles += 3;
            break;
          }
          case 0x20: case 0x21: r[rd] = (r[rs] + r[rt]) >>> 0; break;
          case 0x22: case 0x23: r[rd] = (r[rs] - r[rt]) >>> 0; break;
          case 0x24: r[rd] = r[rs] & r[rt]; break;
          case 0x25: r[rd] = r[rs] | r[rt]; break;
          case 0x26: r[rd] = r[rs] ^ r[rt]; break;
          case 0x27: r[rd] = ~(r[rs] | r[rt]); break;
          case 0x2a: r[rd] = (r[rs] | 0) < (r[rt] | 0) ? 1 : 0; break;
          case 0x2b: r[rd] = (r[rs] >>> 0) < (r[rt] >>> 0) ? 1 : 0; break;
        }
        break;
      case 0x02: s.pc = ((s.pc & 0xf0000000) | ((w & 0x3ffffff) << 2)) >>> 0; break;
      case 0x03: r[31] = s.pc; s.pc = ((s.pc & 0xf0000000) | ((w & 0x3ffffff) << 2)) >>> 0; break;
      case 0x04: branch(r[rs] === r[rt], imm); s.cycles++; break;
      case 0x05: branch(r[rs] !== r[rt], imm); s.cycles++; break;
      case 0x06: branch((r[rs] | 0) <= 0, imm); s.cycles++; break;
      case 0x07: branch((r[rs] | 0) > 0, imm); s.cycles++; break;
      case 0x08: case 0x09: r[rt] = (r[rs] + imm) >>> 0; break;
      case 0x0a: r[rt] = (r[rs] | 0) < imm ? 1 : 0; break;
      case 0x0b: r[rt] = (r[rs] >>> 0) < (imm >>> 0) ? 1 : 0; break;
      case 0x0c: r[rt] = r[rs] & (imm & 0xffff); break;
      case 0x0d: r[rt] = r[rs] | (imm & 0xffff); break;
      case 0x0e: r[rt] = r[rs] ^ (imm & 0xffff); break;
      case 0x0f: r[rt] = (w & 0xffff) << 16; break;
      case 0x20: r[rt] = ((this.mem[(r[rs] + imm) & 4095] << 24) >> 24) >>> 0; break;
      case 0x23: {
        const a = (r[rs] + imm) & 4095;
        r[rt] = (this.mem[a] | (this.mem[(a + 1) & 4095] << 8) |
          (this.mem[(a + 2) & 4095] << 16) | (this.mem[(a + 3) & 4095] << 24)) >>> 0;
        break;
      }
      case 0x28: this.mem[(r[rs] + imm) & 4095] = r[rt] & 0xff; break;
      case 0x2b: {
        const a = (r[rs] + imm) & 4095;
        this.mem[a] = r[rt] & 0xff; this.mem[(a + 1) & 4095] = (r[rt] >>> 8) & 0xff;
        this.mem[(a + 2) & 4095] = (r[rt] >>> 16) & 0xff; this.mem[(a + 3) & 4095] = (r[rt] >>> 24) & 0xff;
        break;
      }
    }
  }
}

/** Demo program: computes the Fibonacci sequence, squares each value via mult,
 *  and streams results to the "GS FIFO" through the syscall trap. */
export const DEMO_PROGRAM: Instruction[] = [
  { op: "addiu", rs: 0, rt: 8, imm: 0 },   // t0 = 0 (fib n-2)
  { op: "addiu", rs: 0, rt: 9, imm: 1 },   // t1 = 1 (fib n-1)
  { op: "addiu", rs: 0, rt: 10, imm: 8 },  // t2 = iterations
  { op: "addiu", rs: 0, rt: 11, imm: 64 }, // t3 = scratch address
  { op: "addu", rs: 8, rt: 9, rd: 12, label: "loop" }, // t4 = fib sum
  { op: "mult", rs: 12, rt: 12 },          // lo = sum^2
  { op: "mflo", rd: 4 },                   // a0 = sum^2  -> GS packet
  { op: "sw", rs: 11, rt: 4, imm: 0 },     // DMA to scratchpad
  { op: "addu", rs: 0, rt: 9, rd: 8 },     // t0 = t1
  { op: "addu", rs: 0, rt: 12, rd: 9 },    // t1 = t4
  { op: "addiu", rs: 10, rt: 10, imm: -1 },
  { op: "bne", rs: 10, rt: 0, target: "loop" },
  { op: "addiu", rs: 0, rt: 2, imm: 1 },   // exit code 1 (sentinel)
  { op: "syscall", label: "halt" },
];