# Retrospective - Issue #7: Migrate `handwritten/cloud-profiler` to Jest

## Overview
Migrated the `@google-cloud/profiler` package (`handwritten/cloud-profiler`) from Mocha, Sinon, and c8/nyc to Jest and ts-jest, mirroring the reference migration performed for `@google-cloud/paginator` in PR #9218 (#9224).

## Changes Implemented

1. **Configuration**:
   - Created `handwritten/cloud-profiler/jest.config.js` using `ts-jest` for TypeScript test transformation and `moduleNameMapper` for resolving package and fixture paths.
   - Removed legacy test configuration files `.mocharc.js` and `.nycrc`.
   - Updated `.gitignore` to ignore `coverage/` instead of `.coverage`.

2. **Package Dependencies & Scripts (`package.json`)**:
   - Replaced `mocha`, `@types/mocha`, `sinon`, `@types/sinon`, `c8`, `codecov` with `jest`, `ts-jest`, and `@types/jest`.
   - Updated test scripts: `"test": "jest --coverage"`, `"pretest": "npm run compile"`.
   - Removed legacy `"nyc"` block.

3. **Test Migration**:
   - `test/test-init-config.ts`: Converted from Mocha/Sinon to Jest test globals, `jest.spyOn`, and Jest matchers (`expect(x).toEqual(...)`, `expect(x).toBe(...)`, `expect(x).rejects.toThrow(...)`).
   - `test/test-profiler.ts`: Migrated all Sinon stubs and spies (`timeProfiler.start`, `timeProfiler.profile`, `heapProfiler.*`, `Math.random`, `common.ServiceObject.prototype.request`) to `jest.spyOn` and Jest matchers.
   - `system-test/test-start.ts`: Removed Mocha imports and migrated hooks to Jest (`beforeAll`, `afterAll`).

## Verification
- **TypeScript Compilation**: Ran `npm run compile` (`tsc -p .`) successfully with zero type errors.
- **Unit Tests**: Executed all unit tests with `NODE_OPTIONS="--experimental-vm-modules" npx jest --forceExit --testTimeout=10000`. All 59 tests passed successfully (2/2 test suites).
