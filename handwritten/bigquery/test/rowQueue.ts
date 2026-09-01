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

import {util} from '@google-cloud/common';
import {Duplex, Stream} from 'stream';
import * as t from '../src/table';
import * as _root from '../src';

class FakeRowBatch {
  batchOptions: t.RowBatchOptions;
  rows: _root.RowMetadata[];
  callbacks: _root.InsertRowsCallback[];
  created: number;
  bytes: number;
  constructor(options: t.RowBatchOptions) {
    this.batchOptions = options!;
    this.rows = [];
    this.callbacks = [];
    this.created = Date.now();
    this.bytes = 0;
  }

  add(): void {}

  canFit(): boolean {
    return true;
  }
  isAtMax(): boolean {
    return false;
  }
  isFull(): boolean {
    return false;
  }
}

jest.mock('../src/rowBatch', () => {
  const actual = jest.requireActual('../src/rowBatch');
  return {
    ...actual,
    RowBatch: FakeRowBatch,
  };
});

import * as q from '../src/rowQueue';
const Table = require('../src/table').Table;

const DATASET = {
  id: 'dataset-id',
  createTable: util.noop,
  bigQuery: {
    projectId: 'project-id',
    job: (id: string) => {
      return {id};
    },
    apiEndpoint: 'bigquery.googleapis.com',
    request: util.noop,
  },
} as {} as _root.Dataset;

describe('Queues', () => {
  let dup: Stream;
  let fakeTable: t.Table;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('RowQueue', () => {
    let queue: q.RowQueue;

    beforeEach(() => {
      dup = new Duplex({objectMode: true});
      fakeTable = new Table(DATASET, 'fake_table_id');
      queue = new q.RowQueue(fakeTable, dup);
    });

    describe('initialization', () => {
      it('should create a row batch', () => {
        expect(queue.batch instanceof FakeRowBatch).toBe(true);
        expect(queue.batch.batchOptions).toBe(queue.batchOptions);
      });

      it('should localize the stream', () => {
        expect(queue.stream).toBe(dup);
      });

      it('should localize the table', () => {
        expect(queue.table).toBe(fakeTable);
      });

      it('should set options', () => {
        const opts = {
          insertRowsOptions: {raw: true},
          batchOptions: {maxBytes: 10, maxMilliseconds: 10, maxRows: 10},
        };
        queue = new q.RowQueue(fakeTable, dup, opts);
        expect(queue.batch.batchOptions).toEqual(opts.batchOptions);
        expect(queue.insertRowsOptions).toEqual(opts.insertRowsOptions);
      });
    });

    describe('setOptions', () => {
      it('should use defaults if min', () => {
        queue = new q.RowQueue(fakeTable, dup);
        const opts = {
          maxRows: q.defaultOptions.maxOutstandingRows,
          maxBytes: q.defaultOptions.maxOutstandingBytes,
          maxMilliseconds: q.defaultOptions.maxDelayMillis,
        };
        queue.setOptions();
        expect(queue.batchOptions).toEqual(opts);
      });
    });

    describe('add', () => {
      let spy: jest.Mock;
      const fakeRowMetadata: t.RowMetadata = {name: 'Turing'};

      beforeEach(() => {
        spy = jest.fn();
      });

      it('should publish immediately if unable to fit message', done => {
        jest.useFakeTimers();
        const addStub = jest.spyOn(queue.batch, 'add');
        jest.spyOn(queue.batch, 'canFit').mockReturnValue(false);

        jest
          .spyOn(queue, 'insert')
          .mockImplementation(() => {
            try {
              expect(addStub).toHaveBeenCalledTimes(0);
              done();
            } catch (e) {
              done(e);
            }
          });

        queue.add(fakeRowMetadata, spy);
        jest.useRealTimers();
      });

      it('should add the row to the batch', () => {
        jest.useFakeTimers();
        const stub = jest.spyOn(queue.batch, 'add');
        jest.spyOn(queue, 'insert').mockImplementation();

        queue.add(fakeRowMetadata, spy);

        const [row, callback] = stub.mock.lastCall!;
        expect(row.json).toEqual(fakeRowMetadata);
        expect(callback).toBe(spy);
        jest.useRealTimers();
      });

      it('should insert immediately if the batch became full', () => {
        const stub = jest.spyOn(queue, 'insert').mockImplementation();
        jest.spyOn(queue.batch, 'isFull').mockReturnValue(true);

        queue.add(fakeRowMetadata, spy);

        expect(stub).toHaveBeenCalledTimes(1);
      });

      it('should set a timeout to publish if need be', () => {
        jest.useFakeTimers();
        const stub = jest.spyOn(queue, 'insert').mockImplementation();
        const maxMilliseconds = 1234;
        const maxRows = 123;
        const maxBytes = 123;

        queue.batchOptions = {maxMilliseconds, maxBytes, maxRows};
        queue.add(fakeRowMetadata, spy);

        expect(stub).toHaveBeenCalledTimes(0);
        jest.advanceTimersByTime(maxMilliseconds);
        expect(stub).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
      });

      it('should set insert id', () => {
        const addStub = jest.spyOn(queue.batch, 'add');
        queue.insertRowsOptions.createInsertId = true;
        queue.add(fakeRowMetadata, spy);
        expect(addStub.mock.calls[0][0].insertId).toBeTruthy();
      });

      it('should encode rows', () => {
        const addStub = jest.spyOn(queue.batch, 'add');
        queue.insertRowsOptions.raw = false;
        queue.add(fakeRowMetadata, spy);
        expect(addStub.mock.calls[0][0].json).toEqual(fakeRowMetadata);
      });
    });

    describe('insert', () => {
      it('should create a new batch', () => {
        const oldBatch = queue.batch;

        queue.insert();

        expect(oldBatch).not.toBe(queue.batch);
        expect(queue.batch instanceof FakeRowBatch).toBe(true);
        expect(queue.batch.batchOptions).toBe(queue.batchOptions);
      });

      it('should cancel any pending insert calls', () => {
        const fakeHandle = 1234 as unknown as NodeJS.Timeout;
        const stub = jest.spyOn(global, 'clearTimeout');

        queue.pending = fakeHandle;
        queue.insert();

        expect(stub).toHaveBeenCalledWith(fakeHandle);
        expect(queue.pending).toBeUndefined();
      });

      it('should insert the rows', () => {
        const batch = queue.batch;
        batch.rows = [{name: 'Turing'}];
        const stub = jest.spyOn(queue, '_insert').mockImplementation();

        queue.insert();

        const [rows, callbacks] = stub.mock.lastCall!;
        expect(rows).toBe(batch.rows);
        expect(callbacks).toBe(batch.callbacks);
      });

      it('should not call insert if batch.rows is empty', () => {
        const stub = jest.spyOn(queue, '_insert').mockImplementation();

        queue.insert();
        expect(stub).not.toHaveBeenCalled();
      });
    });

    describe('_insert', () => {
      let rows: Array<{}>;
      let callbacks: jest.Mock[];

      beforeEach(() => {
        rows = [{}, {}, {}];
        callbacks = rows.map(() => jest.fn());
      });

      const row0Error = {message: 'Error.', reason: 'notFound'};
      const row1Error = {message: 'Error.', reason: 'notFound'};
      const data = [
        {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
        {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
        {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
        {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
        {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
      ];

      const dataApiFormat = {
        rows: data.map(row => {
          return {
            json: row,
          };
        }),
      };
      const error = {
        errors: [
          {
            row: dataApiFormat.rows[0].json,
            errors: [row0Error],
          },
          {
            row: dataApiFormat.rows[1].json,
            errors: [row1Error],
          },
        ],
      } as unknown as Error;

      it('should make the correct request', () => {
        const stub = jest.spyOn(fakeTable, 'request').mockImplementation();
        queue = new q.RowQueue(fakeTable, dup);

        queue._insert(rows, callbacks);

        const [{json, method, uri}] = stub.mock.lastCall! as any;
        expect(json.rows[0]).toEqual(rows[0]);
        expect(json.rows[1]).toEqual(rows[1]);
        expect(json.rows[2]).toEqual(rows[2]);
        expect(method).toBe('POST');
        expect(uri).toBe('/insertAll');
      });

      it('should work without callback provided', () => {
        const stub = jest.spyOn(fakeTable, 'request').mockImplementation();
        queue = new q.RowQueue(fakeTable, dup);

        queue._insert(rows, callbacks);

        const [{json, method, uri}] = stub.mock.lastCall! as any;
        expect(json.rows[0]).toEqual(rows[0]);
        expect(json.rows[1]).toEqual(rows[1]);
        expect(json.rows[2]).toEqual(rows[2]);
        expect(method).toBe('POST');
        expect(uri).toBe('/insertAll');
      });

      it('should make the correct request with raw data', () => {
        const stub = jest.spyOn(fakeTable, 'request').mockImplementation();
        queue = new q.RowQueue(fakeTable, dup, {insertRowsOptions: {raw: true}});

        queue._insert(rows, callbacks);

        const [{json, method, uri}] = stub.mock.lastCall! as any;
        expect(json.rows).toEqual(rows);
        expect(method).toBe('POST');
        expect(uri).toBe('/insertAll');
      });

      it('should pass back any request errors', () => {
        queue = new q.RowQueue(fakeTable, dup, {});

        jest.spyOn(fakeTable, 'request').mockImplementation((config: any, callback: any) => {
          return callback(error, config);
        });

        queue._insert(rows, callbacks, err => {
          expect(err).toBe(error);

          callbacks.forEach(callback => {
            const [err] = callback.mock.lastCall!;
            expect(err).toBe(error);
          });
        });
      });

      it('should execute callback with API response', done => {
        const row0Error = {errors: [{message: 'Error.', reason: 'notFound'}]};
        const apiResponse = {insertErrors: [row0Error]};

        queue.stream.on('error', () => {
          expect(true).toBe(true);
          done();
        });
        jest.spyOn(fakeTable, 'request').mockImplementation((config: any, callback: any) => {
          return callback(null, apiResponse);
        });

        queue._insert(rows, callbacks, (err: any, apiResponse_: any) => {
          expect(err).toBeTruthy();

          callbacks.forEach(callback => {
            const [err] = callback.mock.lastCall!;
            expect(err).toBeTruthy();
          });
          expect(apiResponse_).toBe(apiResponse);
        });
      });
    });
  });
});
