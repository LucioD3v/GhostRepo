// The pure parts of the preview. The DOM part (buildPreviewDocument) is covered
// in a real browser by scripts/e2e-web.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeInlineScript, inlineCssUrls, mimeFor, resolvePath, toBase64 } from '../web/src/preview.js';

const enc = (s) => new TextEncoder().encode(s);

test('resolvePath resolves relative references against the referencing file', () => {
  assert.equal(resolvePath('index.html', 'js/app.js'), 'js/app.js');
  assert.equal(resolvePath('index.html', './js/app.js'), 'js/app.js');
  assert.equal(resolvePath('css/site.css', '../img/bg.png'), 'img/bg.png');
  assert.equal(resolvePath('css/site.css', 'img/bg.png'), 'css/img/bg.png');
  assert.equal(resolvePath('index.html', '/js/app.js'), 'js/app.js');
  assert.equal(resolvePath('index.html', 'js/app.js?v=3#x'), 'js/app.js');
  assert.equal(resolvePath('index.html', 'my%20file.png'), 'my file.png');
});

test('resolvePath refuses anything that is not a file inside the project', () => {
  assert.equal(resolvePath('index.html', 'https://cdn.example.com/x.js'), null);
  assert.equal(resolvePath('index.html', '//cdn.example.com/x.js'), null);
  assert.equal(resolvePath('index.html', 'data:image/png;base64,AAAA'), null);
  assert.equal(resolvePath('index.html', 'javascript:alert(1)'), null);
  assert.equal(resolvePath('index.html', '#top'), null);
  assert.equal(resolvePath('index.html', ''), null);
  assert.equal(resolvePath('index.html', '../outside.js'), null);
  assert.equal(resolvePath('a/index.html', '../../outside.js'), null);
  assert.equal(resolvePath('index.html', '%E0%A4%A'), null);
});

test('mimeFor knows the web types and falls back safely', () => {
  assert.equal(mimeFor('a/b.PNG'), 'image/png');
  assert.equal(mimeFor('x.svg'), 'image/svg+xml');
  assert.equal(mimeFor('x.woff2'), 'font/woff2');
  assert.equal(mimeFor('noext'), 'application/octet-stream');
  assert.equal(mimeFor('x.unknown'), 'application/octet-stream');
});

test('toBase64 handles large inputs', () => {
  const big = new Uint8Array(100000).fill(65);
  assert.equal(Buffer.from(toBase64(big), 'base64').length, 100000);
  assert.equal(toBase64(enc('hi')), 'aGk=');
});

test('inlineCssUrls inlines project files and leaves everything else alone', () => {
  const files = new Map([['img/bg.png', new Uint8Array([1, 2, 3])]]);
  const css = [
    'a { background: url(img/bg.png); }',
    "b { background: url('img/bg.png') }",
    'c { background: url("https://cdn.example.com/x.png") }',
    'd { background: url(img/missing.png) }',
    'e { background: url(data:image/png;base64,AAAA) }',
  ].join('\n');
  const out = inlineCssUrls(css, 'style.css', files);
  const lines = out.split('\n');
  assert.ok(lines[0].includes('url("data:image/png;base64,AQID")'));
  assert.ok(lines[1].includes('url("data:image/png;base64,AQID")'));
  assert.equal(lines[2], 'c { background: url("https://cdn.example.com/x.png") }');
  assert.equal(lines[3], 'd { background: url(img/missing.png) }');
  assert.equal(lines[4], 'e { background: url(data:image/png;base64,AAAA) }');
});

test('inlineCssUrls resolves urls relative to the stylesheet', () => {
  const files = new Map([['css/img/bg.png', new Uint8Array([9])]]);
  assert.ok(inlineCssUrls('a{background:url(img/bg.png)}', 'css/site.css', files).includes('data:image/png;base64,CQ=='));
});

test('escapeInlineScript cannot be closed early by project code', () => {
  const out = escapeInlineScript('var s = "</script><script>alert(1)</script>"; <!-- x');
  assert.ok(!/<\/script/i.test(out));
  assert.ok(!out.includes('<!--'));
  assert.ok(out.includes('<\\/script'));
});
