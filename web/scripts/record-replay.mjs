// Record the live screen for offline playback: polls /api/state once a second and writes the frames to
// public/replay.json. Open /?replay=1 to play them back in a loop (no Atlas needed).
//
//   node scripts/record-replay.mjs [seconds=60] [url=http://localhost:3000/api/state] [out=public/replay.json]
import { writeFile } from "node:fs/promises";

const seconds = Number(process.argv[2] ?? 60);
const url = process.argv[3] ?? "http://localhost:3000/api/state";
const out = process.argv[4] ?? "public/replay.json";

const frames = [];
const started = Date.now();
while (Date.now() - started < seconds * 1000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) frames.push(await r.json());
    else console.error(`HTTP ${r.status}`);
  } catch (err) {
    console.error(`fetch failed: ${err.message}`);
  }
  process.stdout.write(`\rframes: ${frames.length}`);
  await new Promise((res) => setTimeout(res, Math.max(0, 1000 - (Date.now() - t0))));
}
await writeFile(out, JSON.stringify(frames));
console.log(`\nwrote ${frames.length} frames to ${out}`);
