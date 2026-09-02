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

import {ExponentialRetry} from '../src/exponential-retry';
import {Duration} from '../src/temporal';
import {TestUtils} from './test-utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function introspect(obj: unknown): any {
  return obj;
}

interface TestItem {
  foo: string;
}

function makeItem() {
  return {
    foo: 'an item',
  };
}

describe('exponential retry class', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('initializes correctly', () => {
    // This one is honestly not terribly interesting except that the
    // class is storing the durations as numbers internally.
    const er = new ExponentialRetry<string>(
      Duration.from({seconds: 1}),
      Duration.from({seconds: 2}),
    );

    const eri = introspect(er);
    expect(eri._backoffMs).toBe(1000);
    expect(eri._maxBackoffMs).toBe(2000);
  });

  it('makes the first callback', () => {
    const clock = TestUtils.useFakeTimers();
    const er = new ExponentialRetry<TestItem>(
      Duration.from({milliseconds: 100}),
      Duration.from({milliseconds: 1000}),
    );
    jest.spyOn(global.Math, 'random').mockReturnValue(0.75);

    const item = makeItem();
    let retried = false;
    er.retryLater(item, (s: typeof item, t: Duration) => {
      expect(s).toBe(item);
      expect(t.milliseconds).toBe(125);
      retried = true;
    });

    clock.tick(125);

    const leftovers = er.close();
    expect(retried).toBe(true);
    expect(leftovers.length).toBe(0);
  });

  it('closes gracefully', () => {
    const clock = TestUtils.useFakeTimers();
    const er = new ExponentialRetry<TestItem>(
      Duration.from({milliseconds: 100}),
      Duration.from({milliseconds: 1000}),
    );
    jest.spyOn(global.Math, 'random').mockReturnValue(0.75);

    let called = false;
    const item = makeItem();
    er.retryLater(item, (s: typeof item, t: Duration) => {
      expect(s).toBe(item);
      expect(t.milliseconds).toBe(125);
      called = true;
    });

    clock.tick(5);

    const leftovers = er.close();

    clock.tick(125);

    expect(called).toBe(false);

    const eri = introspect(er);
    expect(eri._items.isEmpty()).toBe(true);

    expect(leftovers.length).toBe(1);
  });

  it('backs off exponentially', () => {
    const clock = TestUtils.useFakeTimers();
    const er = new ExponentialRetry<TestItem>(
      Duration.from({milliseconds: 100}),
      Duration.from({milliseconds: 1000}),
    );
    jest.spyOn(global.Math, 'random').mockReturnValue(0.75);

    let callbackCount = 0;
    let callbackTime: Duration = Duration.from({milliseconds: 0});

    const item = makeItem();
    const callback = (s: TestItem, t: Duration) => {
      expect(s).toBe(item);
      callbackTime = t;
      callbackCount++;
      if (callbackCount === 1) {
        er.retryLater(item, callback);
      }
    };
    er.retryLater(item, callback);

    clock.tick(125);
    expect(callbackCount).toBe(1);
    expect(callbackTime.milliseconds).toBe(125);

    clock.tick(400);
    expect(callbackCount).toBe(2);
    expect(callbackTime.milliseconds).toBe(375);

    const leftovers = er.close();
    expect(leftovers.length).toBe(0);
  });

  it('backs off exponentially until the max backoff', () => {
    const clock = TestUtils.useFakeTimers();
    const item = makeItem();
    const er = new ExponentialRetry<TestItem>(
      Duration.from({milliseconds: 100}),
      Duration.from({milliseconds: 150}),
    );
    jest.spyOn(global.Math, 'random').mockReturnValue(0.75);

    let callbackCount = 0;
    let callbackTime: Duration = Duration.from({milliseconds: 0});

    const callback = (s: TestItem, t: Duration) => {
      expect(s).toBe(item);
      callbackTime = t;
      callbackCount++;
      if (callbackCount === 1) {
        er.retryLater(item, callback);
      }
    };
    er.retryLater(item, callback);

    clock.tick(125);
    expect(callbackCount).toBe(1);
    expect(callbackTime.milliseconds).toBe(125);

    clock.tick(400);
    expect(callbackCount).toBe(2);
    expect(callbackTime.milliseconds).toBe(312);

    const leftovers = er.close();
    expect(leftovers.length).toBe(0);
  });

  it('calls retries in the right order', () => {
    const clock = TestUtils.useFakeTimers();
    const items = [makeItem(), makeItem()];

    const er = new ExponentialRetry<TestItem>(
      Duration.from({milliseconds: 100}),
      Duration.from({milliseconds: 1000}),
    );

    // Just disable the fuzz for this test.
    jest.spyOn(global.Math, 'random').mockReturnValue(0.5);

    const callbackCounts = [0, 0];
    const callbackTimes: Duration[] = [
      Duration.from({milliseconds: 0}),
      Duration.from({milliseconds: 0}),
    ];

    const callback = (s: TestItem, t: Duration) => {
      const idx = s === items[0] ? 0 : 1;
      callbackCounts[idx]++;
      callbackTimes[idx] = t;

      if (callbackCounts[idx] < 2) {
        er.retryLater(items[idx], callback);
      }
    };

    // Load in the first item and get it retrying.
    er.retryLater(items[0], callback);

    clock.tick(300);
    expect(callbackCounts).toEqual([2, 0]);
    expect(callbackTimes.map(d => d.milliseconds)).toEqual([300, 0]);

    // Load in the second item and get it retrying.
    er.retryLater(items[1], callback);

    clock.tick(125);

    // The first item should've retried twice and still be in the queue,
    // while the second item should've retried once and quit.
    expect(callbackCounts).toEqual([2, 1]);
    expect(callbackTimes.map(d => d.milliseconds)).toEqual([300, 100]);

    // Make sure that we did in fact set another timer for the next event.
    const eri = introspect(er);
    expect(eri._timer).toBeTruthy();

    const leftovers = er.close();
    expect(leftovers.length).toBe(1);
  });
});
