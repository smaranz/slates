"use client";

import { FileCard } from "./HostFile";

/**
 * Files the tutor actually produced, offered where it said it made them.
 *
 * One row per file rather than a single "download" link: a reply can write a
 * document and the chart that goes in it, and a student needs to be able to
 * tell which is which before opening either.
 *
 * They live on the host, so on the Mac app Open saves a copy into Downloads ›
 * Slates and opens it in its own app; the system browser a plain link would
 * open isn't paired with the host.
 */
export default function OutputFiles({ files }: { files: { name: string; size: number }[] }) {
  if (!files.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
      {files.map((file) => (
        <FileCard key={file.name} url={`/api/tutor/files?name=${encodeURIComponent(file.name)}`} name={file.name} size={file.size} />
      ))}
    </div>
  );
}
