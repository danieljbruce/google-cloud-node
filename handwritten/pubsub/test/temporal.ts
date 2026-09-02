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

import {
  Duration,
  atLeast as durationAtLeast,
  atMost as durationAtMost,
} from '../src/temporal';

describe('temporal', () => {
  describe('Duration', () => {
    it('can be created from millis', () => {
      const duration = Duration.from({milliseconds: 1234});
      expect(duration.seconds).toBe(1.234);
    });

    it('can be created from seconds', () => {
      const duration = Duration.from({seconds: 1.234});
      expect(duration.milliseconds).toBe(1234);
    });

    it('can be created from minutes', () => {
      const duration = Duration.from({minutes: 30});
      expect(duration.total('hour')).toBe(0.5);
    });

    it('can be created from hours', () => {
      const duration = Duration.from({hours: 1.5});
      expect(duration.total('minute')).toBe(90);
    });

    it('can be created from a Duration', () => {
      const duration = Duration.from({seconds: 5});
      const second = Duration.from(duration);
      expect(duration.milliseconds).toBe(second.milliseconds);
    });

    it('adds durations', () => {
      const duration = Duration.from({seconds: 10});
      const second = duration.add({milliseconds: 1000});
      expect(second.seconds).toBe(11);
    });

    it('subtracts durations', () => {
      const duration = Duration.from({seconds: 10});
      const second = duration.subtract({seconds: 5});
      expect(second.milliseconds).toBe(5000);
    });

    it('compares durations', () => {
      const duration = Duration.from({seconds: 10});
      const less = Duration.from({seconds: 5});
      const more = Duration.from({seconds: 15});

      const minus = Duration.compare(duration, more);
      expect(minus).toBe(-1);

      const plus = Duration.compare(duration, less);
      expect(plus).toBe(1);

      const equal = Duration.compare(duration, duration);
      expect(equal).toBe(0);
    });

    it('has working helper functions', () => {
      const duration = Duration.from({seconds: 10});

      const atLeast1 = durationAtLeast(duration, Duration.from({seconds: 5}));
      expect(atLeast1.seconds).toBe(10);

      const atLeast2 = durationAtLeast(duration, Duration.from({seconds: 15}));
      expect(atLeast2.seconds).toBe(15);

      const atMost1 = durationAtMost(duration, Duration.from({seconds: 5}));
      expect(atMost1.seconds).toBe(5);

      const atMost2 = durationAtMost(duration, Duration.from({seconds: 15}));
      expect(atMost2.seconds).toBe(10);
    });
  });
});
