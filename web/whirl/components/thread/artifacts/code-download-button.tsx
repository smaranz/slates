"use client";

import { IconDownload } from "@tabler/icons-react";

import { downloadCodeFile } from "@whirl/lib/document-export";

export function CodeDownloadButton({
  fileName,
  content,
}: {
  fileName: string;
  content: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Download ${fileName}`}
      title={`Download ${fileName}`}
      onClick={() => downloadCodeFile(fileName, content)}
      className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-2.5 text-primary-foreground transition-[background-color,scale] duration-150 hover:bg-(--primary-hover) active:scale-[0.97]"
    >
      <IconDownload size={14} stroke={2} />
      <span className="text-[12px]/4 font-medium">Download</span>
    </button>
  );
}
