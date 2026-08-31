"use client";

import type { CSSProperties, ReactNode } from "react";
import type { HistoryPoint, Tone } from "@/lib/types";

export function Badge({
  tone = "secondary",
  children,
  style,
}: {
  tone?: Tone;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span className={`badge badge--${tone}`} style={style}>
      {children}
    </span>
  );
}

export function Dot({ color, size = 8, radius = 2 }: { color: string; size?: number; radius?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        background: color,
      }}
    />
  );
}

export function Meter({ pct, color, flex }: { pct: number; color: string; flex?: string }) {
  return (
    <span className="meter" style={{ flex: flex ?? "0 0 120px" }}>
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </span>
  );
}

/**
 * Indeterminate ring, for work whose length Slates genuinely can't predict —
 * a submission drives a real browser through Schoology and takes as long as it
 * takes. Better an honest spinner than a progress bar reading from a guess.
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="spin"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const ICON = {
  search: "M15.4 15.4 L20.5 20.5",
  assignments:
    "M4 2h16v2H4zm0 18h16v2H4zM4 4h2v16H4zm14 0h2v16h-2zM8 7h8v2H8zm0 4h8v2H8zm0 4h5v2H8z",
  tonight: "M20.5 13.2A8.6 8.6 0 1 1 10.8 3.5a6.9 6.9 0 0 0 9.7 9.7z",
  grades: "M4 18h2v4H4zm5-6h2v10H9zm5-6h2v16h-2zm5-4h2v20h-2z",
  calendar: "M7 2h2v3H7V2zm8 0h2v3h-2V2zM3 6h18v15H3V6zm2 4v9h14v-9H5zm2 2h3v3H7v-3z",
  tutor: "M20 2H4v2h16zm0 14H6v2h14zm2-12h-2v12h2zM4 4H2v18h2zm2 14H4v2h2z",
  messages:
    "M2 4h20v16H2V4zm2 2v.01L12 12l8-5.99V6H4zm16 2.4-7.4 5.55a1 1 0 0 1-1.2 0L4 8.4V18h16V8.4z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-1.6-8h3.2l.4 2.6a7.9 7.9 0 0 1 1.9.8l2.2-1.5 2.3 2.3-1.5 2.2c.4.6.6 1.2.8 1.9l2.6.4v3.2l-2.6.4a7.9 7.9 0 0 1-.8 1.9l1.5 2.2-2.3 2.3-2.2-1.5c-.6.4-1.2.6-1.9.8l-.4 2.6h-3.2l-.4-2.6a7.9 7.9 0 0 1-1.9-.8l-2.2 1.5-2.3-2.3 1.5-2.2a7.9 7.9 0 0 1-.8-1.9l-2.6-.4v-3.2l2.6-.4c.2-.7.4-1.3.8-1.9L3.4 5.7l2.3-2.3 2.2 1.5c.6-.4 1.2-.6 1.9-.8z",
  chevronLeft: "M15 6l-6 6 6 6z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  file: "M6 2h9l5 5v15H6zm8 1.5V8h4.5z",
  sync: "M16 4h2v6h-2zm-2-2h2v2h-2zm0 2h2v8h-2zM4 8H2v5h2z",
  sync2: "M4 6h16v2H4zm4 14H6v-6h2zm2 2H8v-2h2zm0-2H8v-8h2zm10-4h2v-5h-2z",
  sync3: "M20 18H4v-2h16z",
  upload: "M11 2h2v12h-2zM7 6l5-5 5 5-1.4 1.4L13 4.8V14h-2V4.8L7.4 7.4z",
  uploadTray: "M4 14h2v6h12v-6h2v8H4z",
  send: "M11 20h2V4h-2zm2-12h2V6h-2zm2 2h2V8h-2zm2 2h2v-2h-2zm-6-4H9V6h2z",
  send2: "M15 10H7V8h8zm2 2H5v-2h12z",
  clockFace:
    "M10 2h4v2h-4zM8 6h2V4h4v2h2v2h2v2h2v6h-2v2h-2v2h-2v2h-4v-2H8v-2H6v-2H4v-6h2V8h2z",
  clockHands: "M11 7h2v6h-2zm2 6h4v2h-4z",
  external: "M10 4h10v10h-2V7.4l-8.3 8.3-1.4-1.4L16.6 6H10z M4 8h4v2H5v9h9v-3h2v5H4z",
  chevronDown: "M6 9h12l-6 6z",
  check: "M9.6 16.2 5.4 12l-1.4 1.4 5.6 5.6 12-12-1.4-1.4z",
  close: "M12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5z",
} as const;

export function Icon({
  path,
  size = 16,
  style,
  opacity,
}: {
  path: string | string[];
  size?: number;
  style?: CSSProperties;
  opacity?: number;
}) {
  const paths = Array.isArray(path) ? path : [path];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden
    >
      {paths.map((d, i) => (
        <path key={i} fill="currentColor" fillRule="evenodd" d={d} opacity={opacity} />
      ))}
    </svg>
  );
}

/** A brand mark drawn from a single currentColor path on a 24x24 viewBox. */
function BrandMark({ d, size, style }: { d: string; size: number; style?: CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden
    >
      <path fill="currentColor" d={d} />
    </svg>
  );
}

export function OpenAILogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z"
    />
  );
}

export function AnthropicLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"
    />
  );
}

export function XaiLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"
    />
  );
}

export function CursorLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
    />
  );
}

export function DeepSeekLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"
    />
  );
}

export function ZaiLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M12.606 1.806l-1.677 2.388c-0.258 0.374-0.697 0.606-1.161 0.606h-9.162V1.794C0.594 1.806 12.606 1.806 12.606 1.806zM24 1.806L9.6 22.206 0 22.206 14.4 1.806zM11.394 22.206l1.69-2.4c0.258-0.374 0.697-0.606 1.161-0.606h9.149v3.006H11.394z"
    />
  );
}

export function QwenLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z"
    />
  );
}

export function GeminiLogo({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <BrandMark
      size={size}
      style={style}
      d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
    />
  );
}

export function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0, color: "var(--muted)" }}
      aria-hidden
    >
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.4 15.4 L20.5 20.5" />
      </g>
    </svg>
  );
}

export function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <g fill="currentColor">
        <path d={ICON.clockFace} opacity=".28" />
        <path d={ICON.clockHands} />
      </g>
    </svg>
  );
}

/** Grade-over-time sparkline, ported from the design's lineChart(). */
export function LineChart({
  points,
  color,
}: {
  points: HistoryPoint[];
  color: string;
}) {
  if (!points.length) return null;

  const W = 760;
  const H = 150;
  const pad = 26;
  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals) - 3;
  const hi = Math.max(...vals) + 3;
  const span = hi - lo || 1;

  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);

  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: 150, display: "block", overflow: "visible" }}
    >
      {[0, 0.5, 1].map((t, i) => (
        <line
          key={`g${i}`}
          x1={pad}
          x2={W - pad}
          y1={pad + t * (H - pad * 2)}
          y2={pad + t * (H - pad * 2)}
          stroke="oklch(1 0 0 / 0.06)"
          strokeWidth={1}
        />
      ))}
      <path d={area} fill={color} opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle
          key={`c${i}`}
          cx={x(i)}
          cy={y(p.v)}
          r={3.5}
          fill="var(--surface)"
          stroke={color}
          strokeWidth={2}
        />
      ))}
      {points.map((p, i) => (
        <text
          key={`t${i}`}
          x={x(i)}
          y={H - 6}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize={11}
        >
          {p.d}
        </text>
      ))}
      {points.map((p, i) => (
        <text
          key={`v${i}`}
          x={x(i)}
          y={y(p.v) - 10}
          textAnchor="middle"
          fill="var(--text-2)"
          fontSize={11}
          fontWeight={600}
        >
          {p.v}%
        </text>
      ))}
    </svg>
  );
}

export function Avatar({
  src,
  name,
  size,
}: {
  src: string | null;
  name: string;
  size: number;
}) {
  const initial = (name.trim()[0] || "S").toUpperCase();
  const font = size >= 80 ? 32 : size >= 40 ? 16 : 12;

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: 9999,
        background: "var(--sunken)",
        color: size >= 80 ? "var(--muted)" : "var(--text)",
        fontSize: font,
        fontWeight: 600,
        boxShadow: "var(--shadow-sunken)",
      }}
    >
      {src ? (
        // User-uploaded data URL — next/image can't optimize these.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initial
      )}
    </span>
  );
}

export function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      style={{
        position: "relative",
        width: 40,
        height: 24,
        flexShrink: 0,
        borderRadius: 9999,
        border: 0,
        cursor: "pointer",
        background: on ? "var(--good)" : "oklch(0.42 0 0)",
        transition: "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 19 : 3,
          width: 18,
          height: 18,
          borderRadius: 9999,
          background: "oklch(0.98 0 0)",
          transition: "left .15s",
        }}
      />
    </button>
  );
}
