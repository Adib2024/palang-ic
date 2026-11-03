// Bahasa Melayu (js/i18n.js) and English (js/i18n-en.js, loaded on demand)
// must have exactly the same keys and the same {placeholders}.
// Run: node tests/i18n-test.mjs
import assert from 'assert';
import { STRINGS } from '../js/i18n.js';
import en from '../js/i18n-en.js';

const ms = STRINGS.ms;
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const onlyMs = Object.keys(ms).filter((k) => !(k in en));
const onlyEn = Object.keys(en).filter((k) => !(k in ms));
assert.deepStrictEqual([onlyMs, onlyEn], [[], []], 'keys differ');
const bad = Object.keys(ms).filter((k) => vars(ms[k]) !== vars(en[k]));
assert.deepStrictEqual(bad, [], 'placeholders differ');
console.log(`ok   ${Object.keys(ms).length} keys in both languages, placeholders match`);
