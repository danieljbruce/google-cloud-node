// Copyright 2022 Google LLC
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

import {addToBucket, Throttler, awaitWithTimeout} from '../src/util';
import {Duration} from '../src';

describe('utils', () => {
  describe('Throttler', () => {
    it('does not allow too many calls through at once', () => {
      const throttler = new Throttler(300);
      let totalCalls = '';

      // This one should succeed.
      throttler.doMaybe(() => {
        totalCalls += 'FIRST';
      });

      // This one should fail.
      throttler.doMaybe(() => {
        totalCalls += 'SECOND';
      });

      // Simulate time passing.
      throttler.lastTime! -= 1000;

      // This one should succeed.
      throttler.doMaybe(() => {
        totalCalls += 'THIRD';
      });

      expect(totalCalls).toBe('FIRSTTHIRD');
    });
  });

  describe('addToBucket', () => {
    it('adds to a non-existent bucket', () => {
      const map = new Map<string, string[]>();
      addToBucket(map, 'a', 'b');
      expect(map.get('a')).toEqual(['b']);
    });

    it('adds to an existent bucket', () => {
      const map = new Map<string, string[]>();
      map.set('a', ['c']);
      addToBucket(map, 'a', 'b');
      expect(map.get('a')).toEqual(['c', 'b']);
    });
  });

  describe('awaitWithTimeout', () => {
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('handles non-timeout properly', async () => {
      jest.useFakeTimers({now: 0});
      let resolve = () => {};
      const testString = 'fooby';
      const testPromise = new Promise<string>(r => {
        resolve = () => r(testString);
      });
      setTimeout(resolve, 500);
      const awaitPromise = awaitWithTimeout(
        testPromise,
        Duration.from({seconds: 1}),
      );
      jest.advanceTimersByTime(500);

      const result = await awaitPromise;
      expect(result.returnedValue).toBe(testString);
      expect(result.exception).toBeUndefined();
      expect(result.timedOut).toBe(false);
    });

    it('handles non-timeout errors properly', async () => {
      jest.useFakeTimers({now: 0});
      let reject = () => {};
      const testString = 'fooby';
      const testPromise = new Promise<string>((res, rej) => {
        reject = () => rej(testString);
      });
      setTimeout(reject, 500);
      const awaitPromise = awaitWithTimeout(
        testPromise,
        Duration.from({seconds: 1}),
      );
      jest.advanceTimersByTime(500);

      const result = await awaitPromise;
      expect(result.exception).toBe(testString);
      expect(result.timedOut).toBe(false);
    });

    it('handles timeout properly', async () => {
      jest.useFakeTimers({now: 0});
      let resolve = () => {};
      const testString = 'fooby';
      const testPromise = new Promise<string>(r => {
        resolve = () => r(testString);
      });
      setTimeout(resolve, 1500);
      const awaitPromise = awaitWithTimeout(
        testPromise,
        Duration.from({seconds: 1}),
      );
      jest.advanceTimersByTime(1500);

      const result = await awaitPromise;
      expect(result.timedOut).toBe(true);
    });
  });
});
