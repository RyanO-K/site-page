// Unit tests for the post-login return path validator. The rejection cases are
// open-redirect defence: a browser treats "//evil.com" and "/\evil.com" as
// absolute URLs to another origin, even though both start with a slash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, DEFAULT_RETURN } from '../dist/auth-return.js';

test('accepts a same-site absolute path', () => {
  assert.equal(safeReturnPath('/board/'), '/board/');
  assert.equal(safeReturnPath('/board/?x=1'), '/board/?x=1');
  assert.equal(safeReturnPath('/'), '/');
});

test('rejects protocol-relative and absolute URLs', () => {
  assert.equal(safeReturnPath('//evil.com'), DEFAULT_RETURN);
  assert.equal(safeReturnPath('/\\evil.com'), DEFAULT_RETURN);
  assert.equal(safeReturnPath('https://evil.com'), DEFAULT_RETURN);
  assert.equal(safeReturnPath('evil.com'), DEFAULT_RETURN);
});

test('rejects missing, non-string and over-long input', () => {
  assert.equal(safeReturnPath(undefined), DEFAULT_RETURN);
  assert.equal(safeReturnPath(null), DEFAULT_RETURN);
  assert.equal(safeReturnPath(''), DEFAULT_RETURN);
  assert.equal(safeReturnPath(42), DEFAULT_RETURN);
  assert.equal(safeReturnPath('/' + 'a'.repeat(200)), DEFAULT_RETURN);
});

test('the default is the homepage projects anchor', () => {
  assert.equal(DEFAULT_RETURN, '/#projects');
});
