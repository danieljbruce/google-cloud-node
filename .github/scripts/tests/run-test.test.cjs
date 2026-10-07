// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {describe, it, beforeEach, afterEach} = globalThis;

const repoRoot = path.resolve(__dirname, '../../..');
const runTestPath = path.join(repoRoot, 'bin/run-test.cjs');
const rootMocharc = path.join(repoRoot, '.mocharc.cjs');
const {stripCommentsAndStrings, fileHasOnly, resolveTestArgs} = require(
  runTestPath,
);

describe('bin/run-test.cjs .only support', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-test-only-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  it('ignores .only inside comments and string literals', () => {
    const file = path.join(tmpDir, 'commented.js');
    fs.writeFileSync(
      file,
      [
        '// it.only("commented out", () => {});',
        '/* describe.only("block comment", () => {}); */',
        'const str = "it.only(\'in string\')";',
        'const tpl = `describe.only("in template")`;',
        'it("normal test with https://example.com//not-a-comment", () => {});',
      ].join('\n'),
    );
    assert.strictEqual(fileHasOnly(file), false);
    assert.ok(
      !stripCommentsAndStrings('const s = "it.only()";').includes('it.only'),
    );
  });

  it('detects it.only, describe.only, and compiled mocha_1.it.only calls', () => {
    const file1 = path.join(tmpDir, 'it-only.js');
    fs.writeFileSync(file1, 'it.only("exclusive", () => {});');
    assert.strictEqual(fileHasOnly(file1), true);

    const file2 = path.join(tmpDir, 'describe-only.js');
    fs.writeFileSync(
      file2,
      'mocha_1.describe.only("exclusive suite", () => {});',
    );
    assert.strictEqual(fileHasOnly(file2), true);
  });

  it('narrows target files and adds --no-parallel when .only is present', () => {
    const testDir = path.join(tmpDir, 'build/test');
    fs.mkdirSync(testDir, {recursive: true});
    fs.writeFileSync(
      path.join(testDir, 'a.js'),
      'describe("a", () => { it("t1", () => {}); });',
    );
    fs.writeFileSync(
      path.join(testDir, 'b.js'),
      'describe("b", () => { it.only("t2", () => {}); });',
    );

    const resolved = resolveTestArgs(
      ['--config', '../../.mocharc.cjs', '--parallel', 'build/test'],
      tmpDir,
    );
    assert.strictEqual(resolved.hasOnly, true);
    assert.deepStrictEqual(resolved.onlyFiles, [
      path.join('build', 'test', 'b.js'),
    ]);
    assert.ok(resolved.args.includes('--no-parallel'));
    assert.ok(!resolved.args.includes('--parallel'));
    assert.deepStrictEqual(resolved.args, [
      '--config',
      '../../.mocharc.cjs',
      '--no-parallel',
      path.join('build', 'test', 'b.js'),
    ]);
  });

  it('preserves original arguments when no test file contains .only', () => {
    const testDir = path.join(tmpDir, 'build/test');
    fs.mkdirSync(testDir, {recursive: true});
    fs.writeFileSync(
      path.join(testDir, 'a.js'),
      'describe("a", () => { it("t1", () => {}); });',
    );

    const inputArgs = ['--config', '../../.mocharc.cjs', 'build/test'];
    const resolved = resolveTestArgs(inputArgs, tmpDir);
    assert.strictEqual(resolved.hasOnly, false);
    assert.deepStrictEqual(resolved.onlyFiles, []);
    assert.deepStrictEqual(resolved.args, inputArgs);
  });

  it('executes only the .only test under Node.js even with parallel .mocharc.cjs', () => {
    const testDir = path.join(tmpDir, 'build/test');
    fs.mkdirSync(testDir, {recursive: true});
    fs.writeFileSync(
      path.join(testDir, 'other.js'),
      `
      describe('other file', () => {
        it('should not run', () => {
          throw new Error('other file should not run');
        });
      });
      `,
    );
    fs.writeFileSync(
      path.join(testDir, 'exclusive.js'),
      `
      describe('exclusive file', () => {
        it.only('runs exclusively', () => {});
        it('sibling test should not run', () => {
          throw new Error('sibling test should not run');
        });
      });
      `,
    );

    const res = spawnSync(
      process.execPath,
      [runTestPath, '--no-c8', '--config', rootMocharc, testDir],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {...process.env, JS_RUNTIME: 'node'},
      },
    );
    assert.strictEqual(
      res.status,
      0,
      `stderr: ${res.stderr}\nstdout: ${res.stdout}`,
    );
    assert.match(res.stdout, /1 passing/);
  });

  it('executes only the .only test under Bun when bun is available', function () {
    const bunCheck = spawnSync('bun', ['--version'], {encoding: 'utf8'});
    if (bunCheck.status !== 0) {
      this.skip();
      return;
    }

    const testDir = path.join(tmpDir, 'build/test');
    fs.mkdirSync(testDir, {recursive: true});
    fs.writeFileSync(
      path.join(testDir, 'other.js'),
      `
      throw new Error('other.js should not even be loaded when exclusive.js has .only');
      `,
    );
    fs.writeFileSync(
      path.join(testDir, 'exclusive.js'),
      `
      describe('exclusive bun suite', () => {
        it.only('runs exclusively in bun', () => {});
        it('sibling test should not run', () => {
          throw new Error('sibling test should not run');
        });
      });
      `,
    );

    const res = spawnSync(
      'bun',
      ['--bun', runTestPath, '--config', rootMocharc, testDir],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    assert.strictEqual(
      res.status,
      0,
      `stderr: ${res.stderr}\nstdout: ${res.stdout}`,
    );
    assert.match(res.stdout, /1 passing/);
  });
});
