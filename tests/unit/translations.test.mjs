// The two message catalogs agree with each other and with the review table in
// docs/translations.md (every key, the exact texts, the placeholders).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const en = JSON.parse(read("../../extension/_locales/en/messages.json"));
const ar = JSON.parse(read("../../extension/_locales/ar/messages.json"));
const placeholders = (text) => (text.match(/\$[A-Z_]+\$|\{icon\}/g) ?? []).sort();

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

test("activation labels clearly name the action and the resulting state", () => {
  assert.equal(en.consent_accept.message, "Turn on Musicless");
  assert.equal(en.control_setup.message, "Turn on Musicless");
  assert.equal(en.done_heading.message, "Musicless is on");
  assert.equal(ar.consent_accept.message, "تفعيل Musicless");
  assert.equal(ar.control_setup.message, "تفعيل Musicless");
  assert.equal(ar.done_heading.message, "تم تفعيل Musicless");
});

test("popup helpers explain every video opened and preserve original-sound wording", () => {
  assert.equal(en.popup_default_on.message, "Music is removed from every video you open. Click {icon} in a video to restore its original sound.");
  assert.equal(en.popup_one_video.message, "Every video you open keeps its original sound. Click {icon} in a video to remove its music.");
  assert.equal(ar.popup_default_on.message, "تُزال الموسيقى من كل فيديو تفتحه. اضغط على {icon} في أي فيديو لاستعادة صوته الأصلي.");
  assert.equal(ar.popup_one_video.message, "كل فيديو تفتحه يحتفظ بصوته الأصلي. اضغط على {icon} في أي فيديو لإزالة موسيقاه.");
});
