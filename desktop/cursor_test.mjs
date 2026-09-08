import { configureCursorSdk, JsonlLocalAgentStore, Agent } from "@cursor/sdk";
import os from "node:os";
import path from "node:path";

configureCursorSdk({ local: { store: new JsonlLocalAgentStore(path.join(os.homedir(), ".slates", "cursor-agent-store")) } });

console.log("about to create agent...");
const agent = await Agent.create({ model: { id: "composer-2.5" } });
console.log("agent created OK");
const run = await agent.send({ text: "Reply with exactly one word: ok" }, { mode: "plan" });
const result = await run.wait();
console.log("run result status:", result.status);
agent.close();
process.exit(0);
