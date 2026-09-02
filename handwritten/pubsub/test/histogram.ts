// Copyright 2017 Google LLC
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

import {Histogram} from '../src/histogram';

describe('Histogram', () => {
  let histogram: Histogram;

  const MIN_VALUE = 10000;
  const MAX_VALUE = 600000;

  beforeEach(() => {
    histogram = new Histogram({min: MIN_VALUE, max: MAX_VALUE});
  });

  describe('initialization', () => {
    it('should set default min/max values', () => {
      histogram = new Histogram();
      expect(histogram.options.min).toBe(0);
      expect(histogram.options.max).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should accept user defined min/max values', () => {
      histogram = new Histogram({min: 5, max: 10});

      expect(histogram.options.min).toBe(5);
      expect(histogram.options.max).toBe(10);
    });

    it('should create a data map', () => {
      expect(histogram.data instanceof Map).toBe(true);
    });

    it('should set the initial length to 0', () => {
      expect(histogram.length).toBe(0);
    });
  });

  describe('add', () => {
    it('should increment a value', () => {
      histogram.data.set(MIN_VALUE, 1);
      histogram.add(MIN_VALUE);

      expect(histogram.data.get(MIN_VALUE)).toBe(2);
    });

    it('should initialize a value if absent', () => {
      histogram.add(MIN_VALUE);

      expect(histogram.data.get(MIN_VALUE)).toBe(1);
    });

    it('should adjust the length for each item added', () => {
      histogram.add(MIN_VALUE);
      histogram.add(MIN_VALUE);
      histogram.add(MIN_VALUE * 2);

      expect(histogram.length).toBe(3);
    });

    it('should cap the value', () => {
      const outOfBounds = MAX_VALUE + MIN_VALUE;

      histogram.add(outOfBounds);

      expect(histogram.data.get(outOfBounds)).toBeUndefined();
      expect(histogram.data.get(MAX_VALUE)).toBe(1);
    });

    it('should apply a minimum', () => {
      const outOfBounds = MIN_VALUE - 1000;

      histogram.add(outOfBounds);

      expect(histogram.data.get(outOfBounds)).toBeUndefined();
      expect(histogram.data.get(MIN_VALUE)).toBe(1);
    });
  });

  describe('percentile', () => {
    function range(a: number, b: number) {
      const result: number[] = [];

      for (; a < b; a++) {
        result.push(a);
      }

      return result;
    }

    it('should return the nth percentile', () => {
      range(100, 201).forEach(value => {
        histogram.add(value * 1000);
      });

      expect(histogram.percentile(100)).toBe(200000);
      expect(histogram.percentile(101)).toBe(200000);
      expect(histogram.percentile(99)).toBe(199000);
      expect(histogram.percentile(1)).toBe(101000);
    });

    it('should return the min value if unable to determine', () => {
      expect(histogram.percentile(99)).toBe(MIN_VALUE);
    });
  });
});
