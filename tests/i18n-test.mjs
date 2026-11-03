// English (js/i18n.js, the default) and Bahasa Melayu (js/i18n-ms.js, loaded
// on demand) must have exactly the same keys and the same {placeholders}.
// Run: node tests/i18n-test.mjs
import assert from 'assert';
import { STRINGS } from '../js/i18n.js';
import ms from '../js/i18n-ms.js';

const en = STRINGS.en;
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const onlyEn = Object.keys(en).filter((k) => !(k in ms));
const onlyMs = Object.keys(ms).filter((k) => !(k in en));
assert.deepStrictEqual([onlyEn, onlyMs], [[], []], 'keys differ');
const bad = Object.keys(en).filter((k) => vars(en[k]) !== vars(ms[k]));
assert.deepStrictEqual(bad, [], 'placeholders differ');
console.log(`ok   ${Object.keys(en).length} keys in both languages, placeholders match`);
