import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhoto, analyzeText, NoFoodError, parseAnalysis, reviseAnalysis, setFoodReader, type ReadInput } from "./analyze";

// What the vision model says is checked the way CalAi checked it before it
// reaches the log. The model is a fake here, so nothing is spent.

test("a fenced reply with numbers as strings still reads", () => {
  const a = parseAnalysis('Here you go:\n```json\n{"kind":"meal","name":"Grilled chicken salad","servingDescription":"1 bowl (~300 g)","confidence":"0.9","healthScore":8,"ingredients":["grilled chicken","romaine","tomato"],"calories":"420","protein":38,"carbs":18,"fat":21,"fiber":6,"sugar":7,"sodium":"640"}\n```');
  assert.equal(a.name, "Grilled chicken salad");
  assert.equal(a.per.calories, 420);
  assert.equal(a.per.sodium, 640);
  assert.equal(a.confidence, 0.9);
  assert.equal(a.needsCheck, false);
  assert.deepEqual(a.ingredients, ["grilled chicken", "romaine", "tomato"]);
});

test("a count of identical items comes back as servings of one", () => {
  const cookies = parseAnalysis('{"name":"Chocolate chip cookie","servingDescription":"1 cookie (~30 g)","servings":3,"calories":150,"protein":2,"carbs":20,"fat":7}');
  assert.equal(cookies.servings, 3);
  assert.equal(cookies.per.calories, 150);
  assert.equal(parseAnalysis('{"name":"Chicken burrito bowl","calories":650,"protein":40,"carbs":70,"fat":22}').servings, 1);
});

test("a made-up name is replaced and flagged", () => {
  const a = parseAnalysis('{"name":"Ice cream shower","calories":200,"protein":3,"carbs":24,"fat":10}');
  assert.equal(a.name, "Ice cream scoop");
  assert.equal(a.needsCheck, true);
});

test("a plate's calories are capped and reconciled with its macros", () => {
  const slice = parseAnalysis('{"name":"Pepperoni pizza slice","confidence":0.9,"calories":900,"protein":12,"carbs":34,"fat":13}');
  assert.ok(slice.per.calories <= 450);
  assert.equal(slice.needsCheck, true);
});

test("a nutrition label's numbers are kept exactly as printed", () => {
  const label = parseAnalysis('{"kind":"label","name":"Protein bar","brand":"RXBAR","servingDescription":"1 bar (52 g)","confidence":0.95,"calories":210,"protein":12,"carbs":23,"fat":9,"barcode":"0857777004056"}');
  assert.equal(label.kind, "label");
  assert.equal(label.per.calories, 210);
  assert.equal(label.barcode, "0857777004056");
  assert.equal(label.brand, "RXBAR");
});

test("a photo with no food says so", () => {
  assert.throws(() => parseAnalysis('{"kind":"none","name":"","calories":0}'), NoFoodError);
  assert.throws(() => parseAnalysis("I can't see any food here."), /Couldn’t read/);
});

test("the ingredients come from the name when the model lists none", () => {
  const a = parseAnalysis('{"name":"Rice with beans and salsa","calories":420,"protein":14,"carbs":80,"fat":5}');
  assert.deepEqual(a.ingredients, ["rice", "beans", "salsa"]);
});

test("photos, descriptions and corrections all go to the reader with the schema", async () => {
  const calls: ReadInput[] = [];
  setFoodReader(async (input) => {
    calls.push(input);
    return '{"kind":"meal","name":"Oatmeal with berries","servingDescription":"1 bowl","confidence":0.8,"calories":300,"protein":9,"carbs":54,"fat":6}';
  });
  try {
    const photo = await analyzePhoto(new Uint8Array([1, 2, 3]), "image/jpeg", "half the bowl");
    assert.equal(photo.name, "Oatmeal with berries");
    assert.equal(calls[0]!.image?.mediaType, "image/jpeg");
    assert.match(calls[0]!.prompt, /Nutrition Facts/);
    assert.match(calls[0]!.prompt, /half the bowl/);

    await analyzeText("oatmeal with blueberries");
    assert.equal(calls[1]!.image, undefined);
    assert.match(calls[1]!.prompt, /Meal: oatmeal with blueberries/);

    const label = { ...photo, kind: "label" as const };
    const revised = await reviseAnalysis(label, "it was a double serving");
    assert.equal(revised.kind, "label");
    assert.match(calls[2]!.prompt, /Correction: it was a double serving/);
  } finally {
    setFoodReader(null);
  }
});
