// The two message catalogs agree with each other and with the review table in
// docs/translations.md (every key, the exact texts, the placeholders).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const en = JSON.parse(read("../../extension/_locales/en/messages.json"));
const ar = JSON.parse(read("../../extension/_locales/ar/messages.json"));
const placeholders = (text) => (text.match(/\$[A-Z_]+\$/g) ?? []).sort();

test("the Arabic catalog has exactly the English keys, in the same order, with the same placeholders", () => {
  assert.deepEqual(Object.keys(ar), Object.keys(en));
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(ar[key].message), placeholders(en[key].message), key);
    assert.deepEqual(Object.keys(ar[key].placeholders ?? {}), Object.keys(en[key].placeholders ?? {}), key);
  }
});

test("the store summary fits the Chrome Web Store limit in both languages", () => {
  for (const catalog of [en, ar]) assert.ok([...catalog.extension_description.message].length <= 132);
});

test("docs/translations.md lists every key with the catalogs' exact texts", () => {
  const rows = new Map();
  for (const line of read("../../docs/translations.md").split("\n")) {
    const match = /^\| `(\w+)` \| (.*?) \| <div dir="rtl">(.*?)<\/div> \| (.*) \|$/.exec(line);
    if (match) rows.set(match[1], { en: match[2], ar: match[3] });
  }
  assert.deepEqual([...rows.keys()], Object.keys(en));
  for (const [key, row] of rows) {
    assert.equal(row.en, en[key].message, key);
    assert.equal(row.ar, ar[key].message, key);
  }
});
