import { Node, ReactNodeViewRenderer } from "@tiptap/react";
import katex from "katex";

import { MathNodeView } from "@whirl/components/editor/math-node-view";
import { registerMathParsing } from "@whirl/components/editor/markdown-it-math";

/**
 * Build the DOM TipTap serializes for `editor.getHTML()` (the Word/PDF export
 * path) and clipboard copy: a LaTeX-carrying wrapper with KaTeX rendered inside,
 * so exports show real math, falling back to the raw `$$…$$` source if KaTeX
 * can't parse it. The in-editor display is handled separately by the NodeView.
 */
function renderMathElement(latex: string, displayMode: boolean): HTMLElement {
  const tag = displayMode ? "div" : "span";
  const el = document.createElement(tag);
  el.setAttribute("data-type", displayMode ? "block-math" : "inline-math");
  el.setAttribute("data-latex", latex);
  try {
    el.innerHTML = katex.renderToString(latex || "", {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    el.textContent = `$$${latex}$$`;
  }
  return el;
}

const latexAttribute = {
  latex: {
    default: "",
    parseHTML: (element: HTMLElement) =>
      (element.getAttribute("data-latex") ?? "").trim(),
  },
};

/** Inline `$$…$$` math: an atomic, selectable inline node carrying raw LaTeX. */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ node }) {
    return renderMathElement(node.attrs.latex as string, false);
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`$$${node.attrs.latex}$$`);
        },
        parse: {
          setup(markdownit: any) {
            registerMathParsing(markdownit);
          },
        },
      },
    };
  },
});

/** Block `$$…$$` math: an atomic, centered display formula on its own line. */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },

  renderHTML({ node }) {
    return renderMathElement(node.attrs.latex as string, true);
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write("$$");
          state.ensureNewLine();
          state.write(node.attrs.latex);
          state.ensureNewLine();
          state.write("$$");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: any) {
            registerMathParsing(markdownit);
          },
        },
      },
    };
  },
});
