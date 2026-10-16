import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertApplicationTitleFont } from './macos-runtime.mjs';

const requested = { weight: '700' };
const face = { familyName: '蘋方-簡', postScriptName: 'PingFangSC-Semibold', isCustomFont: false, glyphCount: 17 };
for (const familyName of ['蘋方-簡', '苹方-简', 'PingFang SC']) {
  test(`accept actual Semibold glyphs with ${familyName} family`, () => {
    assertApplicationTitleFont(requested, [{ ...face, familyName }]);
  });
}
test('accept Bold PostScript face for requested 700', () => {
  assertApplicationTitleFont(requested, [{ ...face, postScriptName: 'PingFangSC-Bold' }]);
});
test('accept weight-specific localized fallback when CDP omits PostScript name', () => {
  assertApplicationTitleFont(requested, [{ ...face, postScriptName: '', familyName: '蘋方-簡 中粗體' }]);
});
for (const [label, patch] of [
  ['zero glyphs', { glyphCount: 0 }],
  ['wrong font despite matching family', { postScriptName: 'Arial-BoldMT' }],
  ['wrong weight', { postScriptName: 'PingFangSC-Regular' }],
  ['wrong regional face', { postScriptName: 'PingFangTC-Semibold' }],
  ['custom font impersonating system face', { isCustomFont: true }],
  ['ambiguous bare family without face', { postScriptName: '' }],
]) test(`reject ${label}`, () => {
  assert.throws(() => assertApplicationTitleFont(requested, [{ ...face, ...patch }]));
});
test('reject changed CSS weight even with the expected actual face', () => {
  assert.throws(() => assertApplicationTitleFont({ weight: '400' }, [face]));
});
test('reject missing platform font records', () => {
  assert.throws(() => assertApplicationTitleFont(requested, []));
});
