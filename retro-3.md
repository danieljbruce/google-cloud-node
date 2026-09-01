# Retrospective: Issue #3 - Migrate BigQuery to Jest

## Overview
Migrated `@google-cloud/bigquery` unit tests and infrastructure from Mocha, Sinon, and c8 to Jest and `ts-jest`, following the pattern established in the `@google-cloud/paginator` migration (PR #9224 / PR #9218).

## Key Changes
1. **Dependencies & Configuration**:
   - Removed `mocha`, `@types/mocha`, `sinon`, `@types/sinon`, `c8`, `codecov`, `nise`, `proxyquire`, `@types/proxyquire`.
   - Added `jest`, `ts-jest`, and `@types/jest`.
   - Created `jest.config.js` with `ts-jest` transform and `clearMocks: true`.
   - Removed `.mocharc.js` and `.nycrc`.
   - Updated `.gitignore` to ignore `coverage/`.
   - Updated `package.json` `"test"` script to `"jest --coverage"`.
   - Adjusted `tsconfig.json` to exclude system tests from the default compiler include list.

2. **Test Files Migrated**:
   - `test/rowBatch.ts` (15/15 tests passing)
   - `test/rowQueue.ts` (20/20 tests passing)
   - `test/routine.ts` (5/5 tests passing)
   - `test/model.ts` (20/20 tests passing)
   - `test/job.ts` (32/32 tests passing)
   - `test/dataset.ts` (70/70 tests passing)
   - `test/table.ts` (182/182 tests passing)
   - `test/bigquery.ts` (189/189 tests passing, 4 skipped)

3. **Technical Challenges & Solutions**:
   - **Mocking Strategy & Hoisting**: Replaced `proxyquire` module interception with top-level `jest.mock()` declarations and in-suite `jest.spyOn()` overrides.
   - **Fake Timers**: Replaced Sinon fake timers with Jest modern timer controls (`jest.useFakeTimers()`, `jest.advanceTimersByTimeAsync()`, `jest.runAllTimersAsync()`, `jest.useRealTimers()`).
   - **Assertion Matchers**: Converted `assert` assertions to Jest matchers (`expect(...).toBe()`, `expect(...).toEqual()`, `expect(...).toThrow()`, etc.).
   - **Promisify Behavior in Unit Tests**: Correctly matched proxyquire behavior where `promisifyAll` validation was tested without mutating class prototypes in unit test mocks.

## Verification
- Ran full test suite:
  `npx jest --forceExit --testTimeout=10000`
- Results: 8/8 test suites passed, 533 passed tests, 4 skipped, 0 failed.
- Ran TypeScript compilation:
  `npm run compile` (passed with code 0).
