import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeBareLatexInJson,
  mathParts,
  normalizeLatex,
  prepareMathHtml,
  prepareMathMarkdown,
  restoreEatenLatex,
} from "./math-text";
import { parseTutorQuiz } from "./tutor-quiz";

test("escapes LaTeX backslashes that JSON would eat or reject", () => {
  const broken = String.raw`{"prompt":"In $\triangle ABC$, $A = 40^\circ$, $c \approx 7$"}`;
  const parsed = JSON.parse(escapeBareLatexInJson(broken)) as { prompt: string };
  assert.equal(parsed.prompt, String.raw`In $\triangle ABC$, $A = 40^\circ$, $c \approx 7$`);
});

test("leaves a real newline in an explanation alone", () => {
  const raw = '{"explanation":"Use the law of sines.\\nThen solve."}';
  const repaired = escapeBareLatexInJson(raw);
  assert.equal(JSON.parse(repaired).explanation, "Use the law of sines.\nThen solve.");
});

test("already-escaped LaTeX is left as a single control word after parse", () => {
  const raw = '{"prompt":"$\\\\frac{a}{b}$"}';
  const parsed = JSON.parse(escapeBareLatexInJson(raw)) as { prompt: string };
  assert.equal(parsed.prompt, "$\\frac{a}{b}$");
});

test("restores a triangle that JSON.parse already turned into a tab", () => {
  const eaten = "In $\triangle ABC$";
  assert.equal(restoreEatenLatex(eaten), "In $\\triangle ABC$");
});

test("normalizeLatex fills in macros the model wrote as English", () => {
  assert.equal(normalizeLatex("triangle ABC"), "\\triangle ABC");
  assert.equal(normalizeLatex("40^circ"), "40^\\circ");
  assert.equal(normalizeLatex("m^(2)"), "m^{2}");
  assert.equal(normalizeLatex("c \\approx 7.24"), "c \\approx 7.24");
});

test("prepareMathMarkdown accepts MathJax delimiters and bare macros", () => {
  assert.equal(prepareMathMarkdown("In \\(\\triangle ABC\\)"), "In $\\triangle ABC$");
  // The bare quantity is prose; only the exponent is notation. See the
  // percentage test below for why a lone number no longer gets typeset.
  assert.equal(prepareMathMarkdown("Area is $14.7$ m$^(2)$"), "Area is 14.7 m$^{2}$");
});

/*
 * A model wraps percentages and plain numbers in dollars constantly. KaTeX
 * then sets them in Computer Modern at its own size and baseline, so "87%"
 * jumps out of the sentence it belongs to — a reply about a grade ends up
 * looking like a worksheet. There is no notation in a percentage to render.
 */
test("prepareMathMarkdown leaves inert numbers and percentages as prose", () => {
  assert.equal(prepareMathMarkdown("You scored $87\\%$ on it."), "You scored 87% on it.");
  assert.equal(prepareMathMarkdown("That is $87%$ overall."), "That is 87% overall.");
  assert.equal(prepareMathMarkdown("Only $5$ left."), "Only 5 left.");
  assert.equal(prepareMathMarkdown("About $1,200$ people."), "About 1,200 people.");
  assert.equal(prepareMathMarkdown("It fell $-3.5$ points."), "It fell -3.5 points.");
});

test("prepareMathMarkdown still typesets anything with real notation", () => {
  assert.equal(prepareMathMarkdown("Solve $x^2$."), "Solve $x^2$.");
  assert.equal(prepareMathMarkdown("Lift $C_L$."), "Lift $C_L$.");
  assert.equal(prepareMathMarkdown("Turn $90^\\circ$."), "Turn $90^\\circ$.");
  assert.equal(prepareMathMarkdown("Rate $3\\%$ of $x$."), "Rate 3% of $x$.");
  assert.equal(prepareMathMarkdown("$$87\\%$$"), "\n\n$$\n87\\%\n$$\n\n");
});

test("prepareMathMarkdown keeps subscripts and escapes a leftover dollar", () => {
  assert.equal(prepareMathMarkdown("Lift $C_L$ and $a_1$."), "Lift $C_L$ and $a_1$.");
  assert.equal(prepareMathMarkdown("The height is $h = "), "The height is \\$h = ");
  assert.equal(prepareMathMarkdown("It costs $5 and $10."), "It costs \\$5 and \\$10.");
});

test("prepareMathMarkdown puts display maths on its own lines", () => {
  assert.equal(prepareMathMarkdown("See $$x^2$$ here"), "See \n\n$$\nx^2\n$$\n\n here");
});

test("mathParts does not typeset a price range", () => {
  const parts = mathParts("It costs $5 and $10.");
  assert.deepEqual(
    parts.filter((p) => p.type === "math"),
    []
  );
});

test("mathParts typesets a law-of-sines prompt", () => {
  const parts = mathParts("In $\\triangle ABC$, $a = 8$, and $A = 40^\\circ$.");
  const maths = parts.filter((p) => p.type === "math").map((p) => p.value);
  assert.deepEqual(maths, ["\\triangle ABC", "a = 8", "A = 40^\\circ"]);
});

test("prepareMathHtml unwraps MathJax script tags", () => {
  assert.equal(
    prepareMathHtml('<p><script type="math/tex">\\frac{a}{b}</script></p>'),
    "<p>$\\frac{a}{b}$</p>"
  );
  assert.equal(
    prepareMathHtml('<script type="math/tex; mode=display">x^2</script>'),
    "$$x^2$$"
  );
});

test("parseTutorQuiz survives unescaped LaTeX in the block", () => {
  // One backslash before triangle / circ — the way a model writes LaTeX in JSON.
  const fromModel = `Here you go.
[[quiz]]
{"title":"Law of Sines","questions":[{"type":"mcq","prompt":"In $\\triangle ABC$, $A=40^\\circ$.","choices":["two triangles","exactly one"],"answer":0}]}
[[/quiz]]`;
  const { quiz } = parseTutorQuiz(fromModel);
  assert.ok(quiz);
  assert.match(quiz!.questions[0].prompt, /\\triangle ABC/);
  assert.match(quiz!.questions[0].prompt, /40\^\\circ/);
});
