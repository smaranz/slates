import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, tool, type ToolSet } from "ai";

import { browserMcp, ensureBrowser } from "./browser";

/**
 * The agents' browser as AI SDK tools, for a helper that isn't a Cursor
 * agent: the tutor's API-backed models. Same Chrome, same sign-ins, same
 * Computer view to watch or take over in.
 *
 * Playwright's MCP server only starts when a browser tool is first called,
 * so a turn that never browses costs nothing; the list of tools is read once
 * per process and kept.
 */

/** Looking, clicking and typing. Not uploading the PC's files or running scripts in a page. */
export const BROWSER_ALLOWED = new Set([
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_select_option",
  "browser_fill_form",
  "browser_hover",
  "browser_wait_for",
  "browser_tabs",
  "browser_take_screenshot",
  "browser_handle_dialog",
]);

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

const state = globalThis as typeof globalThis & { __slatesBrowserToolList?: Promise<McpTool[]> };

async function connect(outputDir: string): Promise<Client> {
  const server = browserMcp(outputDir);
  if (!server) throw new Error("The browser isn't installed on the host.");
  const client = new Client({ name: "slates", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: server.command, args: server.args, stderr: "ignore" }));
  return client;
}

function toolList(outputDir: string): Promise<McpTool[]> {
  state.__slatesBrowserToolList ??= (async () => {
    const client = await connect(outputDir);
    try {
      return (await client.listTools()).tools.filter((entry) => BROWSER_ALLOWED.has(entry.name)) as McpTool[];
    } finally {
      await client.close().catch(() => {});
    }
  })().catch((error: unknown) => {
    state.__slatesBrowserToolList = undefined;
    throw error;
  });
  return state.__slatesBrowserToolList;
}

export interface BrowserSession {
  tools: ToolSet;
  close(): Promise<void>;
}

/**
 * Null when the browser can't be offered on this host. `images` is whether
 * the provider takes a picture inside a tool result: OpenAI does, and Gemini
 * through OpenRouter refuses the whole request over one. Without it there's
 * no screenshot tool, since the page snapshot already carries the text.
 */
export async function browserTools(options: { outputDir: string; images: boolean }): Promise<BrowserSession | null> {
  if (!browserMcp()) return null;
  let list: McpTool[];
  try {
    list = (await toolList(options.outputDir)).filter((entry) => options.images || entry.name !== "browser_take_screenshot");
  } catch {
    return null;
  }

  let client: Promise<Client> | null = null;
  const open = () =>
    (client ??= (async () => {
      await ensureBrowser();
      return connect(options.outputDir);
    })().catch((error: unknown) => {
      client = null;
      throw error;
    }));

  const tools: ToolSet = {};
  for (const entry of list) {
    tools[entry.name] = tool({
      description: entry.description,
      inputSchema: jsonSchema(entry.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (args) => {
        const result = await (await open()).callTool({ name: entry.name, arguments: (args ?? {}) as Record<string, unknown> });
        const content = (Array.isArray(result.content) ? result.content : []) as McpContent[];
        const text = content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
        if (result.isError) throw new Error(text || "The browser couldn't do that.");
        const images = content
          .filter((part) => part.type === "image" && part.data)
          .map((part) => ({ data: part.data!, mediaType: part.mimeType || "image/png" }));
        return { text, images };
      },
      // A model that can't take pictures gets the page as text only.
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [
          { type: "text", text: output.text || "Done." },
          ...(options.images ? output.images.map((image) => ({ type: "file" as const, data: { type: "data" as const, data: image.data }, mediaType: image.mediaType })) : []),
        ],
      }),
    });
  }

  return {
    tools,
    close: async () => {
      const pending = client;
      client = null;
      const connected = await pending?.catch(() => null);
      await connected?.close().catch(() => {});
    },
  };
}
