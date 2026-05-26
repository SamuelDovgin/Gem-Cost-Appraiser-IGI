import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const match = html.match(/function normalizeClarity\(raw\) \{[\s\S]*?\n\}/);

assert.ok(match, 'normalizeClarity function should exist in index.html');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${match[0]}\nglobalThis.normalizeClarity = normalizeClarity;`, sandbox);

assert.equal(sandbox.normalizeClarity('INTERNALLY FLAWLESS'), 'IF');
assert.equal(sandbox.normalizeClarity('Clarity Grade Internally Flawless'), 'IF');
assert.equal(sandbox.normalizeClarity('VVS 2'), 'VVS2');
assert.equal(sandbox.normalizeClarity('VS1'), 'VS1');

console.log('IGI browser parser tests passed');
