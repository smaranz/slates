import fs from "node:fs";
const body = fs.readFileSync("body.json", "utf8");
const t = Date.now();
const res = await fetch("http://localhost:3001/api/study/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
const text = await res.text();
fs.writeFileSync("out.json", text);
console.log("HTTP", res.status, "in", ((Date.now() - t) / 1000).toFixed(1), "s");
console.log(text.slice(0, 400));
