/**
 * The campaign background job: a small loop in this process. The work is in the database (members waiting for a
 * draft, campaigns whose queue is on), so nothing depends on a timer surviving: after a restart the next pass picks
 * up where the rows say things stand, and leases keep two passes (or two processes) off the same row.
 *
 * Bounded on purpose: one draft at a time, one send at a time, a few of each per pass. It never runs under test.
 */
import { draftStep, sendStep } from "./service";

const PASS_MS = 30_000;
const DRAFTS_PER_PASS = 3;
const SENDS_PER_PASS = 3; // across campaigns: each campaign's own gap still applies to it

let timer: NodeJS.Timeout | null = null;
let running = false;
let again = false;

async function pass(): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  try {
    for (let i = 0; i < DRAFTS_PER_PASS; i++) { const r = await draftStep(); if (r === "idle" || r === "stopped") break; }
    for (let i = 0; i < SENDS_PER_PASS; i++) { const r = await sendStep(); if (r === "idle") break; }
  } finally {
    running = false;
    if (again) { again = false; setTimeout(() => void pass(), 1_000).unref?.(); }
  }
}

export const campaignRunner = {
  start(): void {
    if (timer || process.env.NODE_ENV === "test") return;
    timer = setInterval(() => void pass(), PASS_MS);
    timer.unref?.();
  },
  /** Run a pass now (after "Prepare drafts" or "Start sending"), without waiting for the next one. */
  kick(): void {
    if (process.env.NODE_ENV === "test") return;
    setTimeout(() => void pass(), 50).unref?.();
  },
};
