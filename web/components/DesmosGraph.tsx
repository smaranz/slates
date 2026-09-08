"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { TutorGraph } from "@/lib/tutor-graph";

declare global {
  interface Window {
    Desmos?: {
      GraphingCalculator: (
        el: HTMLElement,
        options?: Record<string, unknown>
      ) => {
        setExpression: (expr: { id: string; latex: string }) => void;
        destroy: () => void;
      };
    };
  }
}

const API_KEY = process.env.NEXT_PUBLIC_DESMOS_API_KEY;
const SCRIPT_SRC = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${API_KEY}`;

/**
 * Loaded once per page no matter how many graphs are on screen — Desmos ships
 * itself as a global script tag, not an npm package, so this is the one spot
 * that has to know whether it's already there or still loading.
 */
let scriptPromise: Promise<void> | null = null;

function loadDesmos(): Promise<void> {
  if (window.Desmos) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Desmos failed to load.")), { once: true });
    if (!existing) {
      script.src = SCRIPT_SRC;
      document.head.appendChild(script);
    }
  });
  return scriptPromise;
}

/**
 * A live, pannable Desmos graph — not a static plot, so a student can zoom in
 * on the part of the curve the question is actually about. Falls back to
 * printing the raw expressions if the API key isn't configured or the script
 * can't load, since that's still more useful than an empty box.
 */
export default function DesmosGraph({ graph, height = 320 }: { graph: TutorGraph; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(API_KEY ? null : "NEXT_PUBLIC_DESMOS_API_KEY is not set.");
  const reactId = useId();

  useEffect(() => {
    if (!API_KEY || !containerRef.current) return;
    let calculator: ReturnType<NonNullable<Window["Desmos"]>["GraphingCalculator"]> | null = null;
    let live = true;

    loadDesmos()
      .then(() => {
        if (!live || !containerRef.current || !window.Desmos) return;
        calculator = window.Desmos.GraphingCalculator(containerRef.current, {
          keypad: false,
          settingsMenu: false,
          expressionsCollapsed: false,
        });
        graph.expressions.forEach((latex, i) => {
          calculator!.setExpression({ id: `${reactId}-${i}`, latex });
        });
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Desmos failed to load.");
      });

    return () => {
      live = false;
      calculator?.destroy();
    };
    // `graph` is only ever set once per card — a new graph gets a new `key`
    // from the caller rather than re-running expressions into the same calculator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--warn)" }}>{error}</span>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-2)" }}>
          {graph.expressions.map((e, i) => (
            <li key={i} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {e}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        borderRadius: "var(--radius-xs)",
        overflow: "hidden",
        background: "#fff",
      }}
    />
  );
}
