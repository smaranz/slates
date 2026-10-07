"use client";

/* Compiling a react artifact's module for the sandbox.
 *
 * Runs on the HOST, not in the frame: Sucrase is ~400KB and only needed the
 * moment an artifact renders, so it's lazily imported and shared across every
 * artifact on the page. Compiling here also means a syntax error is caught
 * somewhere we can show it, instead of a frame that mounts nothing and says
 * nothing.
 *
 * Output is CommonJS against the frame's tiny `require` shim (see
 * artifact-runtime/index.tsx) — `export default App` becomes
 * `exports.default = App`, which is what mount() reaches for.
 */

type SucraseModule = typeof import("sucrase");

let sucrasePromise: Promise<SucraseModule> | null = null;

function loadSucrase(): Promise<SucraseModule> {
  sucrasePromise ??= import("sucrase");
  return sucrasePromise;
}

/** Start fetching the compiler before it's needed (on card mount). */
export function warmJsxCompiler() {
  void loadSucrase().catch(() => {
    /* The real attempt reports the failure; this is only a head start. */
  });
}

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * A model writing JSX inevitably writes a fence around it sometimes. Strip one
 * rather than failing on it — the alternative is a card that shows a syntax
 * error for a module that is otherwise perfectly good.
 */
function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith("```")) return source;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\n?/, "");
  return withoutOpen.replace(/\n?```\s*$/, "");
}

export async function compileArtifactModule(
  source: string,
): Promise<CompileResult> {
  let sucrase: SucraseModule;
  try {
    sucrase = await loadSucrase();
  } catch {
    return {
      ok: false,
      error: "The artifact compiler couldn't load. Reload the page to retry.",
    };
  }

  try {
    const { code } = sucrase.transform(stripCodeFence(source), {
      transforms: ["jsx", "typescript", "imports"],
      jsxRuntime: "automatic",
      production: true,
    });
    return { ok: true, code };
  } catch (error) {
    /* Sucrase throws with a line/column already in the message — keep it, it's
       the only clue anyone gets about what went wrong. */
    return {
      ok: false,
      error: error instanceof Error ? error.message : "This module didn't compile.",
    };
  }
}
