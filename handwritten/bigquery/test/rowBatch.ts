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

import {randomBytes} from 'crypto';
import * as b from '../src/rowBatch';

describe('RowBatch', () => {
  let batch: b.RowBatch;

  const options = {
    maxBytes: 1000,
    maxRows: 100,
    maxMilliseconds: 10,
  };

  beforeEach(() => {
    batch = new b.RowBatch(Object.assign({}, options));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should localize options', () => {
      expect(batch.batchOptions).toEqual(options);
    });

    it('should create a row array', () => {
      expect(batch.rows).toEqual([]);
    });

    it('should create a callback array', () => {
      expect(batch.callbacks).toEqual([]);
    });

    it('should capture the creation time', () => {
      const now = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(now);
      batch = new b.RowBatch(options);

      expect(batch.created).toBe(now);
    });

    it('should initialize bytes to 0', () => {
      expect(batch.bytes).toBe(0);
    });
  });

  describe('add', () => {
    const callback = jest.fn();
    const row = {
      name: 'Turing',
    };

    it('should add the row to the row array', () => {
      batch.add(row, callback);
      expect(batch.rows).toEqual([row]);
    });

    it('should add the callback to the callback array', () => {
      batch.add(row, callback);
      expect(batch.callbacks).toEqual([callback]);
    });
  });

  describe('canFit', () => {
    const row = {
      name: 'Turing',
    };

    it('should return false if too many rows', () => {
      batch.batchOptions.maxRows = 0;
      const canFit = batch.canFit(row);
      expect(canFit).toBe(false);
    });

    it('should return true if it can fit', () => {
      const canFit = batch.canFit(row);
      expect(canFit).toBe(true);
    });
  });

  describe('isAtMax', () => {
    it('should return true if at max row limit', () => {
      Array(50000)
        .fill({
          data: Buffer.from('Hello!'),
        })
        .forEach(row => {
          batch.add(row, () => {});
        });

      const isAtMax = batch.isAtMax();
      expect(isAtMax).toBe(true);
    });

    it('should return true if at max byte limit', () => {
      const row = {
        name: randomBytes(Math.pow(1024, 2) * 9),
      };

      batch.add(row, jest.fn());

      const isAtMax = batch.isAtMax();
      expect(isAtMax).toBe(true);
    });

    it('should return false if it is not full', () => {
      const row = {
        name: randomBytes(500),
      };

      batch.add(row, jest.fn());

      const isAtMax = batch.isAtMax();
      expect(isAtMax).toBe(false);
    });
  });

  describe('isFull', () => {
    const row = {
      name: 'Turing',
    };

    it('should return true if at max row limit', () => {
      batch.batchOptions.maxRows = 1;
      batch.add(row, jest.fn());
      const isFull = batch.isFull();
      expect(isFull).toBe(true);
    });

    it('should return true if at max byte limit', () => {
      batch.batchOptions.maxBytes = row.name.length;
      batch.add(row, jest.fn());
      const isFull = batch.isFull();
      expect(isFull).toBe(true);
    });

    it('should return false if it is not full', () => {
      batch.add(row, jest.fn());
      const isFull = batch.isFull();
      expect(isFull).toBe(false);
    });
  });
});
