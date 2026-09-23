import assert from "node:assert/strict";
import test from "node:test";

import { filesFromDataTransfer, sniffImageMediaType } from "./attachments";

test("sniffs a PNG header the way a Mac screenshot arrives", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(sniffImageMediaType(png), "image/png");
});

test("sniffs a JPEG header", () => {
  assert.equal(sniffImageMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
});

test("rejects bytes that are not an image", () => {
  assert.equal(sniffImageMediaType(Uint8Array.from([0x25, 0x50, 0x44, 0x46])), null);
});

test("reads a file off dataTransfer.items when files is empty", () => {
  const file = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "image.png", { type: "" });
  const data = {
    files: [] as unknown as FileList,
    items: [
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => file,
      },
    ],
    types: ["Files"],
  } as unknown as DataTransfer;

  const found = filesFromDataTransfer(data);
  assert.equal(found.length, 1);
  assert.equal(found[0], file);
});
