/* Which attachments are documents, and therefore go to the backend to be
   turned into Markdown (convex/attachmentMarkdown.ts) instead of riding as raw
   bytes nobody can read.

   The real format detection happens there, off the file's content signature —
   this is only the front door, answering "is it worth asking?" from the name
   and MIME type the browser hands us. Both are consulted because neither is
   reliable on its own: a `.docx` mailed around and re-saved can arrive as
   application/octet-stream, and a file the OS types correctly can arrive with
   no extension at all.

   The list is anydoc's supported formats, minus CSV — a spreadsheet is worth
   converting to a Markdown table, but a `.csv` is already text, and sending it
   as-is costs the model fewer tokens than the same rows in pipes. */

const DOCUMENT_EXTENSIONS = new Set([
  // Word
  "doc",
  "docm",
  "docx",
  // PowerPoint
  "pot",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  // Excel
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  // OpenDocument
  "odp",
  "ods",
  "odt",
  // The rest
  "epub",
  "pdf",
  "rtf",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/epub+zip",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/rtf",
]);

/** MIME types for the document extensions browsers don't recognise, folded
 *  into the composer's wider extension→MIME map. */
export const DOCUMENT_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  doc: "application/msword",
  docm: "application/vnd.ms-word.document.macroenabled.12",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  pdf: "application/pdf",
  pot: "application/vnd.ms-powerpoint",
  pps: "application/vnd.ms-powerpoint",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ppt: "application/vnd.ms-powerpoint",
  pptm: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rtf: "application/rtf",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Whether this file is a document the backend can read as Markdown. */
export function isExtractableDocument(type: string, name: string): boolean {
  const extension = name.includes(".")
    ? (name.split(".").pop()?.toLowerCase() ?? "")
    : "";
  return (
    DOCUMENT_MIME_TYPES.has(type.toLowerCase()) ||
    DOCUMENT_EXTENSIONS.has(extension)
  );
}
