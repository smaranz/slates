const WIDTH_STORAGE_KEY = "document-panel-width";

export const DOCUMENT_PANEL_DEFAULT_WIDTH = 420;
export const DOCUMENT_PANEL_MIN_WIDTH = 320;
export const DOCUMENT_PANEL_MAX_WIDTH = 760;
export const DOCUMENT_PANEL_SNAP_THRESHOLD = 16;

export function clampDocumentPanelWidth(width: number) {
  return Math.min(
    DOCUMENT_PANEL_MAX_WIDTH,
    Math.max(DOCUMENT_PANEL_MIN_WIDTH, width),
  );
}

export function readDocumentPanelWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw == null) return DOCUMENT_PANEL_DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DOCUMENT_PANEL_DEFAULT_WIDTH;
    return clampDocumentPanelWidth(parsed);
  } catch {
    return DOCUMENT_PANEL_DEFAULT_WIDTH;
  }
}

export function persistDocumentPanelWidth(width: number) {
  try {
    localStorage.setItem(
      WIDTH_STORAGE_KEY,
      String(clampDocumentPanelWidth(width)),
    );
  } catch {
    // ignore
  }
}

/** Snap to the default width when the drag lands close to it. */
export function snapDocumentPanelWidth(width: number): number {
  const clamped = clampDocumentPanelWidth(width);
  if (
    Math.abs(clamped - DOCUMENT_PANEL_DEFAULT_WIDTH) <=
    DOCUMENT_PANEL_SNAP_THRESHOLD
  ) {
    return DOCUMENT_PANEL_DEFAULT_WIDTH;
  }
  return clamped;
}
