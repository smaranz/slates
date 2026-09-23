import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

import MathText from "../components/MathText";
import QuizCard from "../components/QuizCard";
import TutorMarkdown from "../components/TutorMarkdown";

const PROMPT = "In $\\triangle ABC$, $a = 8$, $b = 10$, and $A = 40^\\circ$. How many triangles satisfy these measurements?";

test("MathText emits KaTeX, not dollar signs", () => {
  const html = renderToString(createElement(MathText, { text: PROMPT }));
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\$\\triangle/);
  assert.match(html, /triangle|△|&#9651;/i);
});

test("QuizCard typesets prompts and choices", () => {
  const html = renderToString(
    createElement(QuizCard, {
      quiz: {
        title: "PRE-CALCULUS H: LAW OF SINES",
        questions: [
          {
            type: "mcq",
            prompt: PROMPT,
            choices: ["two triangles", "$c \\approx 7.24$", "$14.7$ m$^(2)$", "No triangle"],
            answer: 1,
          },
        ],
      },
      busy: false,
      onSelect() {},
      onReveal() {},
      onRequestFeedback() {},
    })
  );
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\$c \\approx/);
  assert.doesNotMatch(html, /\$14\.7\$/);
});

test("TutorMarkdown typesets a chat reply", () => {
  const html = renderToString(
    createElement(TutorMarkdown, {
      text: "The height is $h = b \\sin A = 10 \\sin 40^\\circ$.",
      className: "prose--chat",
    })
  );
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\$h = /);
});

test("TutorMarkdown keeps a subscript instead of turning it into italic", () => {
  const html = renderToString(
    createElement(TutorMarkdown, {
      text: "The coefficient is $C_L$.",
      className: "prose--chat",
    })
  );
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<em>/);
  assert.doesNotMatch(html, /\$C_L\$/);
});
