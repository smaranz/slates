/**
 * One-shot scrape for debugging. `npm run once -- --show` runs with a visible
 * browser so you can watch what it sees.
 */
import { scrape } from "./scrape.mjs";

const headless = !process.argv.includes("--show");

try {
  const { snapshot, stats, sample } = await scrape({ headless });
  console.log("\nstats:", stats);
  console.log("courses:", snapshot.courses.length);
  for (const c of snapshot.courses.slice(0, 12)) console.log("   ", c.id, "|", c.name);
  console.log("\nassignments:", snapshot.assignments.length);
  for (const a of snapshot.assignments.slice(0, 20)) {
    console.log(
      "   ",
      String(a.completed ? "done" : "open").padEnd(5),
      a.kind.padEnd(11),
      JSON.stringify(a.due || "").padEnd(44),
      a.title.slice(0, 46)
    );
  }
  console.log("\ngradebook courses with a %:", Object.keys(snapshot.gradebook).length);
  if (sample?.length) {
    console.log("\nsample raw rows (for selector tuning):");
    for (const s of sample) console.log("   ", s.slice(0, 160));
  }
  process.exit(0);
} catch (e) {
  console.error("\n  ✗", e.message, "\n");
  process.exit(1);
}
