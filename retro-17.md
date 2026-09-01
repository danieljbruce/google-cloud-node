# Retro: Issue #17 - Migrate `@google-cloud/spanner-driver` to Jest

## 1. Executive Summary
Issue #17 requested migrating the `@google-cloud/spanner-driver` package from the legacy Mocha, Sinon, and c8 test ecosystem to Jest, following the blueprint established in pull request [#9218](https://github.com/googleapis/google-cloud-node/pull/9218) (migrating `@google-cloud/paginator` to Jest).

All 8 unit test suites (138 test cases) and the system test suite have been fully migrated to Jest and `ts-jest`. Full build compilation (`npm run compile`), linting (`npm run lint`), code coverage collection (`npm test`), and system test execution (`npm run system-test`) have been verified and pass cleanly.

---

## 2. Changes Made

### A. Infrastructure & Dependency Swap
* **Removed Legacy Test Dependencies**:
  * `mocha` (`^11.1.0`)
  * `@types/mocha` (`^10.0.10`)
  * `sinon` (`^21.0.3`)
  * `@types/sinon` (`^17.0.4`)
  * `c8` (`^10.1.3`)
* **Installed Jest Dependencies**:
  * `jest` (`^29.7.0`)
  * `ts-jest` (`^29.4.12`)
  * `@types/jest` (`^29.5.14`)

### B. Configuration Files
* **Created `jest.config.js`**:
  * Configured `ts-jest` modern transform with `tsconfig.json`.
  * Added `moduleNameMapper` (`'^(\\.{1,2}/.*)\\.js$': '$1'`) to resolve TypeScript ESM relative imports containing `.js` extensions directly to their TypeScript source files.
  * Configured `testMatch` (`['<rootDir>/test/**/*_test.ts', '<rootDir>/system-test/**/*.ts']`) and enabled `clearMocks: true`.
  * Included the standard Google Apache 2.0 license header.
* **Cleaned Up Legacy Configs**:
  * Removed `.mocharc.cjs`.
  * Removed `.c8rc.json`.
  * Fixed `handwritten/spanner-driver/.eslintrc.json` extends path to point to `./node_modules/gts`.

### C. Package Scripts Alignment (`package.json`)
* Replaced `"test:esm"`, `"test:cjs"`, and composite `"test"` commands with `"test": "jest test/unit --coverage"`.
* Updated `"system-test"` to `"jest system-test"`.
* Retained `"test:pg-suite": "node test/pg-suite/run_pg_suite.cjs"` for standalone PostgreSQL test runner.

### D. Interoperability & Source Updates
* Updated protobuf import in `src/lib/pg/types.ts`, `src/lib/codec.ts`, `test/unit/mock_native.ts`, and `test/unit/codec_test.ts` from `import pkg from '@google-cloud/spanner-api/build/protos/protos.js'` to `import * as pkg from '@google-cloud/spanner-api/build/protos/protos.js'` with robust fallback resolution (`pkg.google || pkg.default?.google || pkg.default`) ensuring seamless runtime execution across both ESM and CommonJS/ts-jest execution environments.

### E. Test Suite Migration
Migrated all test files to native Jest matchers and lifecycle hooks:
* `test/unit/pg_utilities_test.ts`
* `test/unit/errors_test.ts`
* `test/unit/config_test.ts`
* `test/unit/query_test.ts`
* `test/unit/codec_test.ts`
* `test/unit/types_test.ts`
* `test/unit/client_test.ts`
* `test/unit/pool_test.ts`
* `test/unit/mock_native.ts`
* `system-test/driver.ts`

Key test transformations included:
* Replacing `assert.strictEqual(a, b)` with `expect(a).toBe(b)`.
* Replacing `assert.deepStrictEqual(a, b)` with `expect(a).toEqual(b)`.
* Replacing `assert.ok(a)` with `expect(a).toBeTruthy()` / `expect(a).toBeDefined()`.
* Replacing `assert.match(str, regex)` with `expect(str).toMatch(regex)`.
* Replacing `assert.throws(fn)` with `expect(fn).toThrow()`.
* Replacing `sinon.stub(obj, 'meth').callsFake(...)` with `jest.spyOn(obj, 'meth').mockImplementation(...)`.
* Converting Mocha hooks (`before`, `after`, `this.timeout`) in `system-test/driver.ts` to Jest (`beforeAll`, `afterAll`, `jest.setTimeout`).
* Wrapping asynchronous `done()` callback assertions in `try / catch` blocks with error routing to `done(e)` to prevent hanging test suites.

---

## 3. Verification & Results

1. **TypeScript Build (`npm run compile`)**:
   * ESM (`tsc -p .`) and CommonJS (`tsc -p ./tsconfig.cjs.json`) compiled successfully without any diagnostics or errors.
2. **Linting (`npm run lint`)**:
   * `gts check` passed with zero errors and zero warnings.
3. **Unit Tests & Coverage (`npm test`)**:
   * **Test Suites**: 8 passed, 8 total
   * **Tests**: 138 passed, 138 total
   * **Statements**: 90.72%
   * **Branches**: 76.43%
   * **Functions**: 84.24%
   * **Lines**: 92.69%
4. **System Tests (`npm run system-test`)**:
   * Executed and cleanly skipped without failure in the absence of live GCP credentials.

---

## 4. Key Learnings & Takeaways
* **NodeNext ESM / Jest Module Mapping**: Projects configured with `"module": "nodenext"` use `.js` extension specifiers in TypeScript imports. `jest.config.js` requires `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` so that `ts-jest` resolves these paths directly to `.ts` source files without requiring pre-compilation.
* **CJS Protobuf Interoperability**: Protobuf bundles compiled to CommonJS lack default exports; using namespace imports (`import * as pkg`) with fallback object extraction provides unified compatibility between native ESM execution and ts-jest execution.
