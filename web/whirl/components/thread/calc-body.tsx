import { IconAlertTriangle } from "@tabler/icons-react";

import { KatexFormula } from "@whirl/components/math/katex-formula";
import type { CalcItem, MessagePhase } from "@whirl/lib/messages";

function prettyNumber(value: string) {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const fraction = trimmed.split(".")[1] ?? "";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.min(fraction.length, 10),
  }).format(Number(trimmed));
}

function Expression({ calc }: { calc: CalcItem }) {
  if (!calc.expression) return null;
  if (calc.needsLatex && calc.expressionTex) {
    return <KatexFormula tex={calc.expressionTex} className="text-muted-foreground" />;
  }
  return (
    <span className="font-mono text-[13px] text-muted-foreground">
      {calc.expression.replace(/\s*\*\s*/g, " × ").replace(/\s*\/\s*/g, " ÷ ")}
    </span>
  );
}

function Result({ calc, className }: { calc: CalcItem; className?: string }) {
  if (calc.needsLatex && calc.resultTex && !/^-?\d+(\.\d+)?$/.test(calc.result ?? "")) {
    return <KatexFormula tex={calc.resultTex} className={className} />;
  }
  return <span className={className}>{prettyNumber(calc.result ?? "")}</span>;
}

function isCalcItem(item: unknown): item is CalcItem {
  return Boolean(item && typeof item === "object" && !("url" in item));
}

export function CalcBody({ phase }: { phase: MessagePhase }) {
  const items = (phase.items ?? []).filter(isCalcItem);
  if (items.length) {
    return (
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <div key={`${item.expression}-${index}`} className="flex items-baseline justify-between gap-4 py-2">
            <span className="flex min-w-0 flex-wrap items-baseline gap-2">
              {item.label && <strong className="text-[13px]">{item.label}</strong>}
              <Expression calc={item} />
            </span>
            {item.error ? (
              <span className="text-xs text-amber-700 dark:text-amber-300">Error</span>
            ) : (
              <Result calc={item} className="shrink-0 text-sm font-semibold" />
            )}
          </div>
        ))}
      </div>
    );
  }
  if (phase.error) {
    return (
      <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
        <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>Couldn’t compute that ({phase.error})</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Expression calc={phase} />
      <Result calc={phase} className="text-2xl font-semibold tracking-tight" />
    </div>
  );
}
