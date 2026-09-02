// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {loggingUtils} from 'google-gax';

export interface FakeClock {
  tick(ms: number): void;
  restore(): void;
}

/**
 * Utilities for unit test code.
 *
 * @private
 */
export class TestUtils {
  /**
   * This helper should be used to enable fake timers for Jest.
   *
   * @param sandbox Optional legacy sandbox param for compatibility
   * @param now An optional date to set for "now"
   * @returns The clock object with tick and restore methods
   */
  static useFakeTimers(sandbox?: unknown, now?: number): FakeClock {
    if (now !== undefined) {
      jest.useFakeTimers({now: new Date(now)});
    } else {
      jest.useFakeTimers();
    }
    return {
      tick: (ms: number) => {
        jest.advanceTimersByTime(ms);
      },
      restore: () => {
        jest.useRealTimers();
      },
    };
  }
}

/**
 * Wrapper to hook the output of ad-hoc loggers (loggingUtils.AdhocDebugLogFunction),
 * because the sandbox will patch the wrong instance of the methods.
 *
 * @private
 */
export class FakeLog {
  fields?: loggingUtils.LogFields;
  args?: unknown[];
  called = false;
  log: loggingUtils.AdhocDebugLogFunction;
  listener: (lf: loggingUtils.LogFields, a: unknown[]) => void;

  constructor(log: loggingUtils.AdhocDebugLogFunction) {
    this.log = log;
    this.listener = (lf: loggingUtils.LogFields, a: unknown[]) => {
      this.fields = lf;
      this.args = a;
      this.called = true;
    };
    this.log.on('log', this.listener);
  }

  remove() {
    // This really ought to be properly exposed, but since it's not, we'll
    // do this for now to keep the tests from being leaky.
    const instance = (this.log as loggingUtils.AdhocDebugLogFunction).instance;
    instance.off('log', this.listener);
  }
}
