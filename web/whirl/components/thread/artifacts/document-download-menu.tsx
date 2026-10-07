"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Editor } from "@tiptap/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconChevronDown,
  IconDownload,
  IconFile,
  IconFileText,
  IconFileTypePdf,
} from "@tabler/icons-react";

import { getMarkdown } from "@whirl/components/editor/editor-markdown";
import {
  downloadDocx,
  downloadMarkdown,
  downloadPdf,
} from "@whirl/lib/document-export";

type ExportFormat = "markdown" | "docx" | "pdf";

const FORMATS: {
  format: ExportFormat;
  label: string;
  hint: string;
  icon: TablerIcon;
}[] = [
  { format: "markdown", label: "Markdown", hint: ".md", icon: IconFile },
  { format: "docx", label: "Word", hint: ".docx", icon: IconFileText },
  { format: "pdf", label: "PDF", hint: ".pdf", icon: IconFileTypePdf },
];

/**
 * The document panel's download control: a button that drops a small menu
 * to export the current editor contents as Markdown, Word, or PDF.
 */
export function DocumentDownloadMenu({
  editor,
  name,
}: {
  editor: Editor | null;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleExport = async (format: ExportFormat) => {
    setOpen(false);
    if (!editor) return;
    const markdown = getMarkdown(editor);
    const html = editor.getHTML();
    try {
      if (format === "markdown") downloadMarkdown(name, markdown);
      else if (format === "docx") await downloadDocx(name, html);
      else downloadPdf(name, html);
    } catch {
      // Swallow — a failed export shouldn't break the editor.
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Download document"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-primary pr-1.5 pl-2 text-primary-foreground transition-[background-color,scale] duration-150 hover:bg-(--primary-hover) active:scale-[0.97] ${
          open ? "bg-(--primary-hover)" : ""
        }`}
      >
        <IconDownload size={14} stroke={2} />
        <span className="text-[12px]/4 font-medium">Download</span>
        <IconChevronDown
          size={13}
          stroke={2.5}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
            className="raised absolute top-9 right-0 z-30 w-44 origin-top-right rounded-xl border border-border bg-popover p-1 shadow-lg"
          >
            {FORMATS.map(({ format, label, hint, icon }) => {
              const Glyph = icon;
              return (
                <button
                  key={format}
                  type="button"
                  role="menuitem"
                  onClick={() => void handleExport(format)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]/4 font-medium transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <Glyph
                    size={16}
                    stroke={2}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="flex-1">{label}</span>
                  <span className="text-[11px]/4 text-muted-foreground">
                    {hint}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
