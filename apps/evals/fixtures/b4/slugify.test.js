'use strict';
const assert = require('node:assert');
const slugify = require('./slugify');
assert.strictEqual(slugify('Hello World'), 'hello-world');
assert.strictEqual(slugify('  Hello   World  '), 'hello-world');
console.log('ok');
