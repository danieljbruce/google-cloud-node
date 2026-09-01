# Retrospective: Issue #4 - Migrate BigQuery Package to Jest

## Summary
Migrated `@google-cloud/bigquery` (`handwritten/bigquery`) from Mocha, Sinon, c8, and Proxyquire to Jest with `ts-jest`, following the pattern established in PR #9218.

## Changes Made
1. **Package Configuration & Dependencies (`handwritten/bigquery/package.json`)**:
   - Replaced test dependencies (`mocha`, `@types/mocha`, `sinon`, `@types/sinon`, `proxyquire`, `@types/proxyquire`, `c8`, `nise`) with `jest`, `@types/jest`, `ts-jest`.
   - Updated `scripts.test` to `"jest --coverage"`.
   - Removed `.mocharc.js` and `.nycrc`.
   - Added `coverage/` to `.gitignore`.
2. **Jest Configuration (`handwritten/bigquery/jest.config.js`)**:
   - Created `jest.config.js` with preset `ts-jest` and `testEnvironment: 'node'`.
   - Configured `moduleNameMapper` to map `../../package.json` to `<rootDir>/package.json`.
   - Configured `testPathIgnorePatterns` to ignore `build/`, `node_modules/`, and `system-test/`.
3. **TypeScript Configuration (`handwritten/bigquery/tsconfig.json`)**:
   - Updated `include` to exclude `system-test/*.ts` (cloud credential-dependent integration tests) so unit tests and source compile cleanly with `tsc`.
4. **Test Suite Conversions (8 Test Files, 537 Total Tests)**:
   - `test/bigquery.ts` (193 tests, 189 passed, 4 skipped)
   - `test/table.ts` (182 tests, 182 passed)
   - `test/dataset.ts` (70 tests, 70 passed)
   - `test/job.ts` (32 tests, 32 passed)
   - `test/rowQueue.ts` (20 tests, 20 passed)
   - `test/model.ts` (17 tests, 17 passed)
   - `test/rowBatch.ts` (15 tests, 15 passed)
   - `test/routine.ts` (5 tests, 5 passed)

## Technical Highlights & Patterns
- **Module Mocking**: Replaced `proxyquire` with hoisted `jest.mock()` declarations for `@google-cloud/common`, `@google-cloud/promisify`, `@google-cloud/paginator`, and internal class modules (`./table`, `./dataset`, `./job`).
- **Spies and Stubs**: Converted `sandbox.stub()` / `sinon.stub()` to `jest.spyOn()` / `jest.fn()`, mapping `.resolves()`, `.rejects()`, `.returns()`, and `.callsFake()` to Jest equivalents.
- **Fake Timers**: Migrated Sinon fake timers to `jest.useFakeTimers()`, `jest.advanceTimersByTimeAsync()`, and `jest.runAllTimersAsync()`.
- **Assertions**: Converted Node `assert` (`assert.strictEqual`, `assert.deepStrictEqual`, `assert.rejects`, `assert.throws`, `assert.ifError`) to Jest matchers (`toBe`, `toEqual`, `rejects.toThrow`, `toThrow`, `toBeFalsy`).

## Verification
- Unit test run: `npx jest test --runInBand --forceExit --testTimeout=10000` -> **8 passed, 8 total (533 passed, 4 skipped, 0 failed)** in 6.05s.
- Coverage run: `npm test -- --forceExit --testTimeout=10000` -> **93.12% Statements, 91.99% Branch, 85.15% Functions, 93.14% Lines**.
- Build compilation: `npm run compile` -> **0 errors**.
