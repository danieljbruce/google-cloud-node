// Copyright 2016 Google LLC
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

import {Bigtable} from '../src';
import {TabularApiSurface} from '../src/tabular-api-surface';
import {
  Table,
  Entry,
  GetRowsOptions,
  GetRowsCallback,
  GetRowsResponse,
  MutateOptions,
  MutateCallback,
} from '../src/table.js';
import {Mutation} from '../src/mutation.js';
import * as rw from '../src/row';
import {Row, RowError} from '../src/row';
import {Chunk} from '../src/chunktransformer.js';
import {CallOptions, ServiceError} from 'google-gax';
import {ClientSideMetricsConfigManager} from '../src/client-side-metrics/metrics-config-manager';
import * as getRowsInternalModule from '../src/utils/getRowsInternal';
import * as mutateInternalModule from '../src/utils/mutateInternal';
import {RowDataUtils} from '../src/row-data-utils';
import * as pumpify from 'pumpify';
import {OperationMetricsCollector} from '../src/client-side-metrics/operation-metrics-collector';

(global as any).mockPromisified = (global as any).mockPromisified || false;
jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (klass: Function) => {
    if (klass.name === 'Row') {
      (global as any).mockPromisified = true;
    }
  },
}));

const ROW_ID = 'my-row';
const CONVERTED_ROW_ID = 'my-converted-row';
const TABLE = {
  bigtable: {},
  name: '/projects/project/instances/my-instance/tables/my-table',
} as Table;

jest.mock('../src/utils/getRowsInternal', () => ({
  getRowsInternal: jest.fn(),
}));

jest.mock('../src/utils/mutateInternal', () => ({
  mutateInternal: jest.fn(),
}));

jest.mock('../src/mutation', () => {
  const actual = jest.requireActual('../src/mutation');
  const FakeMutation = {
    methods: actual.Mutation.methods,
    convertToBytes: jest.fn((value: any) => {
      if (value === 'my-row') {
        return 'my-converted-row';
      }
      return value;
    }),
    convertFromBytes: jest.fn((value: any) => {
      return value;
    }),
    parseColumnName: jest.fn((column: any) => {
      return actual.Mutation.parseColumnName(column);
    }),
    parse: jest.fn((entry: any) => {
      return {
        mutations: entry,
      };
    }),
  };
  (global as any).FakeMutation = FakeMutation;
  return {
    ...actual,
    Mutation: FakeMutation,
  };
});

jest.mock('../src/filter', () => {
  const actual = jest.requireActual('../src/filter');
  const FakeFilter = {
    parse: jest.fn((filter: any) => {
      return filter;
    }),
  };
  (global as any).FakeFilter = FakeFilter;
  return {
    ...actual,
    Filter: FakeFilter,
  };
});

const FakeMutation = (global as any).FakeMutation;
const FakeFilter = (global as any).FakeFilter;

const FakeRowDataUtil = RowDataUtils;

describe('Bigtable/Row', () => {
  let row: any;

  beforeEach(() => {
    row = new Row(TABLE, ROW_ID);
    row.table.bigtable._metricsConfigManager =
      new ClientSideMetricsConfigManager([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.keys(FakeMutation).forEach(spy => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((FakeMutation as any)[spy].mockClear) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (FakeMutation as any)[spy].mockClear();
      }
    });
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).mockPromisified).toBeTruthy();
    });

    it('should localize Bigtable instance', () => {
      expect(row.bigtable).toBe(TABLE.bigtable);
    });

    it('should localize Table instance', () => {
      expect(row.table).toBe(TABLE);
    });

    it('should localize ID', () => {
      expect(row.id).toBe(ROW_ID);
    });

    it('should create an empty data object', () => {
      expect(row.data).toEqual({});
    });
  });

  describe('formatChunks_', () => {
    let convert = FakeMutation.convertFromBytes;

    beforeEach(() => {
      convert = FakeMutation.convertFromBytes;
      FakeMutation.convertFromBytes = jest.fn(val => {
        return val.replace('unconverted', 'converted');
      });
    });

    afterEach(() => {
      FakeMutation.convertFromBytes = convert;
    });

    it('should format the chunks', () => {
      const timestamp = Date.now();
      const chunks = [
        {
          rowKey: 'unconvertedKey',
          familyName: {
            value: 'familyName',
          },
          qualifier: {
            value: 'unconvertedQualifier',
          },
          value: 'unconvertedValue',
          labels: ['label'],
          timestampMicros: timestamp,
          valueSize: 0,
          commitRow: false,
          resetRow: false,
        },
        {
          commitRow: true,
        },
      ] as Chunk[];

      const rows = Row.formatChunks_(chunks);

      expect(rows).toEqual([
        {
          key: 'convertedKey',
          data: {
            familyName: {
              convertedQualifier: [
                {
                  value: 'convertedValue',
                  labels: ['label'],
                  timestamp,
                  size: 0,
                },
              ],
            },
          },
        },
      ]);
    });

    it('should inherit the row key', () => {
      const chunks = [
        {
          rowKey: 'unconvertedKey',
        },
        {
          rowKey: null,
          familyName: {
            value: 'familyName',
          },
          commitRow: true,
        },
        {
          rowKey: 'unconvertedKey2',
        },
        {
          rowKey: null,
          familyName: {
            value: 'familyName2',
          },
          commitRow: true,
        },
      ] as {} as Chunk[];

      const rows = Row.formatChunks_(chunks);

      expect(rows).toEqual([
        {
          key: 'convertedKey',
          data: {
            familyName: {},
          },
        },
        {
          key: 'convertedKey2',
          data: {
            familyName2: {},
          },
        },
      ]);
    });

    it('should inherit the family name', () => {
      const chunks = [
        {
          rowKey: 'unconvertedKey',
          familyName: {
            value: 'familyName',
          },
        },
        {
          qualifier: {
            value: 'unconvertedQualifier',
          },
        },
        {
          qualifier: {
            value: 'unconvertedQualifier2',
          },
        },
        {
          commitRow: true,
        },
      ] as Chunk[];

      const rows = Row.formatChunks_(chunks);

      expect(rows).toEqual([
        {
          key: 'convertedKey',
          data: {
            familyName: {
              convertedQualifier: [],
              convertedQualifier2: [],
            },
          },
        },
      ]);
    });

    it('should inherit the qualifier', () => {
      const timestamp1 = 123;
      const timestamp2 = 345;

      const chunks = [
        {
          rowKey: 'unconvertedKey',
          familyName: {
            value: 'familyName',
          },
          qualifier: {
            value: 'unconvertedQualifier',
          },
        },
        {
          value: 'unconvertedValue',
          labels: ['label'],
          timestampMicros: timestamp1,
          valueSize: 0,
        },
        {
          value: 'unconvertedValue2',
          labels: ['label2'],
          timestampMicros: timestamp2,
          valueSize: 2,
        },
        {
          commitRow: true,
        },
      ] as Chunk[];

      const rows = Row.formatChunks_(chunks);

      expect(rows).toEqual([
        {
          key: 'convertedKey',
          data: {
            familyName: {
              convertedQualifier: [
                {
                  value: 'convertedValue',
                  labels: ['label'],
                  timestamp: timestamp1,
                  size: 0,
                },
                {
                  value: 'convertedValue2',
                  labels: ['label2'],
                  timestamp: timestamp2,
                  size: 2,
                },
              ],
            },
          },
        },
      ]);
    });

    it('should not decode values when applicable', () => {
      const formatOptions = {
        decode: false,
      };

      (FakeMutation.convertFromBytes as Function) = jest.fn(
        (val, options) => {
          expect(options).toEqual({userOptions: formatOptions});
          return val.replace('unconverted', 'converted');
        },
      );

      const timestamp1 = 123;
      const timestamp2 = 345;

      const chunks = [
        {
          rowKey: 'unconvertedKey',
          familyName: {
            value: 'familyName',
          },
          qualifier: {
            value: 'unconvertedQualifier',
          },
        },
        {
          value: 'unconvertedValue',
          labels: ['label'],
          timestampMicros: timestamp1,
          valueSize: 0,
        },
        {
          value: 'unconvertedValue2',
          labels: ['label2'],
          timestampMicros: timestamp2,
          valueSize: 2,
        },
        {
          commitRow: true,
        },
      ] as Chunk[];

      const rows = Row.formatChunks_(chunks, formatOptions);

      expect(rows).toEqual([
        {
          key: 'convertedKey',
          data: {
            familyName: {
              convertedQualifier: [
                {
                  value: 'convertedValue',
                  labels: ['label'],
                  timestamp: timestamp1,
                  size: 0,
                },
                {
                  value: 'convertedValue2',
                  labels: ['label2'],
                  timestamp: timestamp2,
                  size: 2,
                },
              ],
            },
          },
        },
      ]);

      // 0 === row key
      // 1 === qualifier
      // 2 === value
      const args = (FakeMutation.convertFromBytes as jest.Mock).mock.calls[2];
      expect((args as string[])[1]).toEqual({
        userOptions: formatOptions,
      });
    });

    it('should use the encoding scheme provided', () => {
      const formatOptions = {
        encoding: 'binary' as BufferEncoding,
      };

      (FakeMutation.convertFromBytes as Function) = jest.fn(
        (val, options) => {
          expect(options).toEqual({userOptions: formatOptions});
          return val.toString(formatOptions.encoding);
        },
      );

      const chunks = [
        {
          rowKey: Buffer.from('ø', 'binary'),
          familyName: {
            value: 'familyName',
          },
          qualifier: {
            value: 'qualifier',
          },
          value: 'value',
          valueSize: 0,
          labels: ['label'],
          timestampMicros: 123,
          commitRow: true,
        },
      ] as Chunk[];

      const rows = Row.formatChunks_(chunks, formatOptions);

      expect(rows).toEqual([
        {
          key: 'ø',
          data: {
            familyName: {
              qualifier: [
                {
                  value: 'value',
                  size: 0,
                  labels: ['label'],
                  timestamp: 123,
                },
              ],
            },
          },
        },
      ]);

      // 0 === row key
      // 1 === qualifier
      // 2 === value
      const args: string[] = (FakeMutation.convertFromBytes as jest.Mock).mock.calls[2];
      expect(args[1]).toEqual({userOptions: formatOptions});
    });

    it('should discard old data when reset row is found', () => {
      const chunks = [
        {
          rowKey: 'unconvertedKey',
          familyName: {
            value: 'familyName',
          },
          qualifier: {
            value: 'unconvertedQualifier',
          },
          value: 'unconvertedValue',
          labels: ['label'],
          valueSize: 0,
          timestampMicros: 123,
        },
        {
          resetRow: true,
        },
        {
          rowKey: 'unconvertedKey2',
          familyName: {
            value: 'familyName2',
          },
          qualifier: {
            value: 'unconvertedQualifier2',
          },
          value: 'unconvertedValue2',
          labels: ['label2'],
          valueSize: 2,
          timestampMicros: 345,
        },
        {
          commitRow: true,
        },
      ] as {} as Chunk[];

      const rows = Row.formatChunks_(chunks);

      expect(rows).toEqual([
        {
          key: 'convertedKey2',
          data: {
            familyName2: {
              convertedQualifier2: [
                {
                  value: 'convertedValue2',
                  labels: ['label2'],
                  size: 2,
                  timestamp: 345,
                },
              ],
            },
          },
        },
      ]);
    });
  });

  describe('formatFamilies_', () => {
    const timestamp = Date.now();

    const families = [
      {
        name: 'test-family',
        columns: [
          {
            qualifier: 'test-column',
            cells: [
              {
                value: 'test-value',
                timestampMicros: timestamp,
                labels: [],
              },
            ],
          },
        ],
      },
    ];

    const formattedRowData = {
      'test-family': {
        'test-column': [
          {
            value: 'test-value',
            timestamp,
            labels: [],
          },
        ],
      },
    };

    it('should format the families into a user-friendly format', () => {
      const formatted = Row.formatFamilies_(families);
      expect(formatted).toEqual(formattedRowData);
      const convertStpy = FakeMutation.convertFromBytes;
      expect((convertStpy as jest.Mock).mock.calls.length).toBe(2);
      expect((convertStpy as jest.Mock).mock.calls[0][0]).toBe('test-column');
      expect((convertStpy as jest.Mock).mock.calls[1][0]).toBe('test-value');
    });

    it('should optionally not decode the value', () => {
      const formatted = Row.formatFamilies_(families, {
        decode: false,
      });
      expect(formatted).toEqual(formattedRowData);
      const convertStpy = FakeMutation.convertFromBytes;
      expect((convertStpy as jest.Mock).mock.calls.length).toBe(1);
      expect((convertStpy as jest.Mock).mock.calls[0][0]).toBe('test-column');
    });
  });

  describe('create', () => {
    it('should provide the proper request options', done => {
      (row.table.mutate as Function) = (entry: Entry, gaxOptions: {}) => {
        expect(entry.key).toBe(row.id);
        expect(entry.data).toBe(undefined);
        expect(entry.method).toBe(Mutation.methods.INSERT);
        expect(gaxOptions).toBe(undefined);
        done();
      };
      row.create(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept data to populate the row', done => {
      const options = {
        entry: {
          a: 'a',
          b: 'b',
        },
      };
      (row.table.mutate as Function) = (entry: Entry) => {
        expect(entry.data).toBe(options.entry);
        done();
      };
      row.create(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept options when inserting data', done => {
      const options = {
        gaxOptions: {},
      };
      (row.table.mutate as Function) = (entry: Entry, gaxOptions: {}) => {
        expect(gaxOptions).toBe(options.gaxOptions);
        done();
      };
      row.create(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error to the callback', done => {
      const err = new Error('err');
      const response = {};
      jest.spyOn(row.table, 'mutate').mockImplementation(((...args: any[]) => { args[2](err, response); }) as any);
      row.create((err_: any, row: any, apiResponse: any) => {
        expect(err).toBe(err_);
        expect(row).toBe(null);
        expect(response).toBe(apiResponse);
        done();
      });
    });

    it('should return the Row instance', done => {
      const response = {};
      jest.spyOn(row.table, 'mutate').mockImplementation(((...args: any[]) => { args[2](null, response); }) as any);
      row.create((err: any, row_: any, apiResponse: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(row).toBe(row_);
        expect(response).toBe(apiResponse);
        done();
      });
    });
  });

  describe('createRules', () => {
    const rules = [
      {
        column: 'a:b',
        append: 'c',
        increment: 1,
      },
    ];

    it('should throw if a rule is not provided', () => {
      expect(() => {
        (row.createRules as Function)();
      }).toThrow(/At least one rule must be provided\./);
    });

    it('should read/modify/write rules', done => {
      (row.bigtable.request as Function) = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: any,
        callback: Function,
      ) => {
        expect(config.client).toBe('BigtableClient');
        expect(config.method).toBe('readModifyWriteRow');
        expect(config.reqOpts.tableName).toBe(TABLE.name);
        expect(config.reqOpts.rowKey).toBe(CONVERTED_ROW_ID);
        expect(config.reqOpts.rules).toEqual([
          {
            familyName: 'a',
            columnQualifier: 'b',
            appendValue: 'c',
            incrementAmount: 1,
          },
        ]);
        const spy = FakeMutation.convertToBytes;
        expect((spy as jest.Mock).mock.calls[0][0]).toBe('b');
        expect((spy as jest.Mock).mock.calls[1][0]).toBe('c');
        expect((spy as jest.Mock).mock.calls[2][0]).toBe(ROW_ID);
        callback(); // done()
      };
      row.createRules(rules, done);
    });

    it('should use an appProfileId', done => {
      const bigtableInstance = row.bigtable;
      bigtableInstance.appProfileId = 'app-profile-id-12345';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bigtableInstance.request as Function) = (config: any) => {
        expect(config.reqOpts.appProfileId).toBe(bigtableInstance.appProfileId);
        done();
      };
      row.createRules(rules, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (row.bigtable.request as Function) = (config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };
      row.createRules(rules, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });
  });

  describe('delete', () => {
    it('should provide the proper request options', done => {
      (row.table.mutate as Function) = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutation: any,
        gaxOptions: {},
        callback: Function,
      ) => {
        expect(mutation.key).toBe(ROW_ID);
        expect(mutation.method).toBe(FakeMutation.methods.DELETE);
        expect(gaxOptions).toEqual({});
        callback(); // done()
      };
      row.delete(done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      (row.table.mutate as Function) = (mutation: {}, gaxOptions_: {}) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      };
      row.delete(gaxOptions, done);
    });

    it('should remove existing data', done => {
      const gaxOptions = {};
      (row.table.mutate as Function) = (mutation: {}, gaxOptions_: {}, callback: Function) => {
        expect(gaxOptions_).toBe(gaxOptions);
        callback();
      };
      row.delete(gaxOptions, (err: any) => {
        expect(err).toBeFalsy();
        expect(row.data).toEqual({});
        done();
      });
    });
  });

  describe('deleteCells', () => {
    const columns = ['a:b', 'c'];

    it('should provide the proper request options', done => {
      (row.table.mutate as Function) = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutation: any,
        gaxOptions: {},
        callback: Function,
      ) => {
        expect(mutation.key).toBe(ROW_ID);
        expect(mutation.data).toBe(columns);
        expect(mutation.method).toBe(FakeMutation.methods.DELETE);
        expect(gaxOptions).toEqual({});
        callback(); // done()
      };
      row.deleteCells(columns, done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      jest.spyOn(row.table as any, 'mutate').mockImplementation((mutation, gaxOptions_) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      });
      row.deleteCells(columns, gaxOptions, done);
    });

    it('should remove existing data', done => {
      jest.spyOn(row.table, 'mutate').mockImplementation(((...args: any[]) => { args[2](); }) as any);
      row.deleteCells(columns, (err: any) => {
        expect(err).toBeFalsy();
        expect(row.data).toEqual({});
        done();
      });
    });
  });

  describe('exists', () => {
    it('should not require gaxOptions', done => {
      jest.spyOn(row as any, 'getMetadata').mockImplementation(gaxOptions => {
        expect(gaxOptions).toEqual({
          filter: [
            {
              row: {
                cellLimit: 1,
              },
            },
            {
              value: {
                strip: true,
              },
            },
          ],
        });
        done();
      });
      row.exists(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should add filter to the read row options', done => {
      const gaxOptions = {};
      jest.spyOn(row as any, 'getMetadata').mockImplementation(gaxOptions_ => {
        expect(gaxOptions_).toEqual({
          filter: [
            {
              row: {
                cellLimit: 1,
              },
            },
            {
              value: {
                strip: true,
              },
            },
          ],
        });
        done();
      });
      row.exists(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should pass gaxOptions to getMetadata', done => {
      const gaxOptions = {
        testProperty: true,
      } as CallOptions;

      jest.spyOn(row as any, 'getMetadata').mockImplementation(gaxOptions_ => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (gaxOptions_ as any).testProperty).toBe(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (gaxOptions as any).testProperty);
        done();
      });

      row.exists(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return false if error is RowError', done => {
      const error = new RowError('Error.');
      jest.spyOn(row, 'getMetadata').mockImplementation(((...args: any[]) => { args[args.length - 1](error); }) as any);
      row.exists((err: any, exists: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(false);
        done();
      });
    });

    it('should return error if not RowError', done => {
      const error = new Error('Error.');
      jest.spyOn(row, 'getMetadata').mockImplementation(((...args: any[]) => { args[args.length - 1](error); }) as any);
      row.exists((err: any) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return true if no error', done => {
      jest.spyOn(row, 'getMetadata').mockImplementation(((...args: any[]) => { args[args.length - 1](null, {}); }) as any);
      row.exists((err: any, exists: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(true);
        done();
      });
    });
  });

  describe('filter', () => {
    const mutations = [
      {
        method: 'insert',
        data: {
          a: 'a',
        },
      },
    ] as {} as rw.FilterConfigOption[];

    const fakeMutations = {
      mutations: [
        {
          a: 'b',
        },
      ],
    } as {} as {mutations: rw.FilterConfigOption};

    beforeEach(() => {
      FakeMutation.parse.mockClear();
      FakeFilter.parse.mockClear();
    });

    it('should provide the proper request options', done => {
      const filter = {
        column: 'a',
      };

      const fakeParsedFilter = {
        column: 'b',
      };

      (FakeFilter.parse as Function) = jest.fn(() => {
        return fakeParsedFilter;
      });

      (FakeMutation.parse as Function) = jest.fn(() => {
        return fakeMutations;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (row.bigtable.request as Function) = (config: any) => {
        expect(config.client).toBe('BigtableClient');
        expect(config.method).toBe('checkAndMutateRow');
        expect(config.reqOpts.tableName).toBe(TABLE.name);
        expect(config.reqOpts.rowKey).toBe(CONVERTED_ROW_ID);
        expect(config.reqOpts.predicateFilter).toEqual(fakeParsedFilter);
        expect(config.reqOpts.trueMutations).toEqual(fakeMutations.mutations);
        expect(config.reqOpts.falseMutations).toEqual(fakeMutations.mutations);
        config.gaxOpts.otherArgs.options.interceptors = [];
        expect(config.gaxOpts).toEqual({
          otherArgs: {
            options: {
              interceptors: [],
            },
          },
        });
        expect(FakeMutation.parse).toHaveBeenCalledTimes(2);
        expect((FakeMutation.parse as jest.Mock).mock.calls[0][0]).toBe(mutations[0]);
        expect((FakeMutation.parse as jest.Mock).mock.calls[1][0]).toBe(mutations[0]);
        expect(FakeFilter.parse).toHaveBeenCalledTimes(1);
        expect(FakeFilter.parse).toHaveBeenCalledWith(filter);
        done();
      };

      row.filter(
        filter,
        {
          onMatch: mutations,
          onNoMatch: mutations,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should accept gaxOptions', done => {
      const filter = {
        column: 'a',
      };
      const gaxOptions = {};
      jest.spyOn(row.bigtable as any, 'request').mockImplementation((config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      });
      row.filter(filter, {gaxOptions}, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should use an appProfileId', done => {
      const filter = {
        column: 'a',
      };
      const bigtableInstance = row.bigtable;
      bigtableInstance.appProfileId = 'app-profile-id-12345';
      jest.spyOn(bigtableInstance as any, 'request').mockImplementation((config: any) => {
        expect(config.reqOpts.appProfileId).toBe(bigtableInstance.appProfileId);
        done();
      });
      row.filter(filter, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error to the callback', done => {
      const err = new Error('err');
      const response = {};
      jest.spyOn(row.bigtable, 'request').mockImplementation(((...args: any[]) => { args[1](err, response); }) as any);
      (row.filter as Function)(
        {},
        mutations,
        (err_: Error, matched: boolean, apiResponse: {}) => {
          expect(err).toBe(err_);
          expect(matched).toBe(null);
          expect(response).toBe(apiResponse);
          done();
        },
      );
    });

    it('should return a matched flag', done => {
      const response = {
        predicateMatched: true,
      };
      jest.spyOn(row.bigtable, 'request').mockImplementation(((...args: any[]) => { args[1](null, response); }) as any);
      (row.filter as Function)(
        {},
        mutations,
        (err: Error, matched: boolean, apiResponse: {}) => {
          ((err: any) => { expect(err).toBeFalsy(); })(err);
          expect(matched).toBeTruthy();
          expect(response).toBe(apiResponse);
          done();
        },
      );
    });
  });

  describe('get', () => {
    function getRowInstance(
      fn: (reqOpts: any) => void | Promise<GetRowsResponse>,
    ) {
      const getRowsInternal = (
        table: TabularApiSurface,
        singleRow: boolean,
        optionsOrCallback?: GetRowsOptions | GetRowsCallback,
        cb?: GetRowsCallback,
      ) => {
        return fn(optionsOrCallback);
      };
      jest.spyOn(getRowsInternalModule, 'getRowsInternal').mockImplementation(getRowsInternal as any);
      row = new Row(TABLE, ROW_ID);
      return row;
    }

    function getRowInstanceForErrResp(err: ServiceError | null, resp?: any[]) {
      const getRowsInternal = (
        table: TabularApiSurface,
        singleRow: boolean,
        optionsOrCallback?: GetRowsOptions | GetRowsCallback,
        cb?: GetRowsCallback,
      ) => {
        if (cb) {
          cb(err, resp);
        }
      };
      jest.spyOn(getRowsInternalModule, 'getRowsInternal').mockImplementation(getRowsInternal as any);
      row = new Row(TABLE, ROW_ID);
      return row;
    }
    it('should provide the proper request options', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.keys[0]).toBe(ROW_ID);
        expect(reqOpts.filter).toBe(undefined);
        expect(FakeMutation.parseColumnName).toHaveBeenCalledTimes(0);
        done();
      };
      const row = getRowInstance(fn);
      row.get(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should create a filter for a single column', done => {
      const keys = ['a:b'];

      const expectedFilter = [
        {
          family: 'a',
        },
        {
          column: 'b',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.filter).toEqual(expectedFilter);
        expect(FakeMutation.parseColumnName).toHaveBeenCalledTimes(1);
        expect((FakeMutation.parseColumnName as jest.Mock).mock.calls[0][0]).toBe(keys[0]);
        done();
      };
      const row = getRowInstance(fn);
      row.get(keys, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should create a filter for multiple columns', done => {
      const keys = ['a:b', 'c:d'];

      const expectedFilter = [
        {
          interleave: [
            [
              {
                family: 'a',
              },
              {
                column: 'b',
              },
            ],
            [
              {
                family: 'c',
              },
              {
                column: 'd',
              },
            ],
          ],
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.filter).toEqual(expectedFilter);

        const spy = FakeMutation.parseColumnName;

        expect((spy as jest.Mock).mock.calls.length).toBe(2);
        expect((spy as jest.Mock).mock.calls[0][0]).toBe(keys[0]);
        expect((spy as jest.Mock).mock.calls[1][0]).toBe(keys[1]);
        done();
      };
      const row = getRowInstance(fn);

      row.get(keys, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect supplying only family names', done => {
      const keys = ['a'];

      const expectedFilter = [
        {
          family: 'a',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.filter).toEqual(expectedFilter);
        expect(FakeMutation.parseColumnName).toHaveBeenCalledTimes(1);
        expect((FakeMutation.parseColumnName as jest.Mock).mock.calls[0][0]).toBe(keys[0]);
        done();
      };
      const row = getRowInstance(fn);

      row.get(keys, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect the options object', done => {
      const keys = ['a:b'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = {
        filter: [
          {
            column: {
              cellLimit: 1,
            },
          },
        ],
        descode: false,
      };

      const expectedFilter = [
        {
          family: 'a',
        },
        {
          column: 'b',
        },
        {
          column: {
            cellLimit: 1,
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.filter).toEqual(expectedFilter);
        expect(FakeMutation.parseColumnName).toHaveBeenCalledTimes(1);
        expect((FakeMutation.parseColumnName as jest.Mock).mock.calls[0][0]).toBe(keys[0]);
        expect(reqOpts.decode).toBe(options.decode);
        done();
      };
      const row = getRowInstance(fn);

      row.get(keys, options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect the options object with filter for multiple columns', done => {
      const keys = ['a:b', 'c:d'];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = {
        filter: [
          {
            column: {
              cellLimit: 1,
            },
          },
        ],
      };

      const expectedFilter = [
        {
          interleave: [
            [
              {
                family: 'a',
              },
              {
                column: 'b',
              },
            ],
            [
              {
                family: 'c',
              },
              {
                column: 'd',
              },
            ],
          ],
        },
        {
          column: {
            cellLimit: 1,
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.filter).toEqual(expectedFilter);
        expect(FakeMutation.parseColumnName).toHaveBeenCalledTimes(2);
        expect((FakeMutation.parseColumnName as jest.Mock).mock.calls[0][0]).toBe(keys[0]);
        expect(reqOpts.decode).toBe(options.decode);
        done();
      };
      const row = getRowInstance(fn);

      row.get(keys, options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect filter in options object', done => {
      const keys = [] as string[];

      const options = {
        decode: false,
        filter: [{column: 'abc'}],
      };
      const expectedFilter = options.filter;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.filter).toEqual(expectedFilter);
        done();
      };
      const row = getRowInstance(fn);

      row.get(keys, options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept options without keys', done => {
      const options = {
        decode: false,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (reqOpts: any) => {
        expect(reqOpts.decode).toBe(options.decode);
        expect(!reqOpts.filter).toBeTruthy();
        done();
      };
      const row = getRowInstance(fn);

      row.get(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error to the callback', done => {
      const error = new Error('err');
      const row = getRowInstanceForErrResp(error as ServiceError);
      row.get((err: any, row: any) => {
        expect(error).toBe(err);
        expect(row).toBe(undefined);
        done();
      });
    });

    it('should return a custom error if the row is not found', done => {
      const row = getRowInstanceForErrResp(null, []);
      row.get((err: any, row_: any) => {
        expect(err instanceof RowError).toBeTruthy();
        expect(err!.message).toBe('Unknown row: ' + row.id + '.');
        expect(row_).toEqual(undefined);
        done();
      });
    });

    it('should update the row data upon success', done => {
      const fakeRow = new Row(TABLE, ROW_ID);
      fakeRow.data = {
        a: 'a',
        b: 'b',
      };
      const row = getRowInstanceForErrResp(null, [fakeRow]);
      row.get((err: any, row_: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(row_).toBe(row);
        expect(row.data).toEqual(fakeRow.data);
        done();
      });
    });

    it('should return only data for the keys provided', done => {
      const fakeRow = new Row(TABLE, ROW_ID);

      fakeRow.data = {
        a: 'a',
        b: 'b',
      };

      const keys = ['a', 'b'];
      const row = getRowInstanceForErrResp(null, [fakeRow]);

      row.data = {
        c: 'c',
      };
      row.get(keys, (err: any, data: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(Object.keys(data)).toEqual(keys);
        done();
      });
    });
  });

  describe('getMetadata', () => {
    it('should return an error to the callback', done => {
      const error = new Error('err');
      jest.spyOn(row, 'get').mockImplementation(((...args: any[]) => { args[args.length - 1](error); }) as any);
      row.getMetadata((err: any, metadata: any) => {
        expect(error).toBe(err);
        expect(metadata).toBe(undefined);
        done();
      });
    });

    it('should return metadata to the callback', done => {
      const fakeMetadata = {
        a: 'a',
        b: 'b',
      };
      jest.spyOn(row, 'get').mockImplementation(((...args: any[]) => { args[args.length - 1](null, row); }) as any);
      row.metadata = fakeMetadata;
      row.getMetadata((err: any, metadata: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(metadata).toBe(fakeMetadata);
        done();
      });
    });

    it('should accept an options object', done => {
      const fakeMetadata = {};
      const fakeOptions = {
        decode: false,
      };
      (row.get as Function) = (options: {}, callback: Function) => {
        expect(options).toBe(fakeOptions);
        callback(null, row);
      };
      row.metadata = fakeMetadata;
      row.getMetadata(fakeOptions, (err: any, metadata: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(metadata).toBe(fakeMetadata);
        done();
      });
    });
  });

  describe('increment', () => {
    const COLUMN_NAME = 'a:b';
    let formatFamiliesSpy: any;

    beforeEach(() => {
      formatFamiliesSpy = jest.spyOn(FakeRowDataUtil as any, 'formatFamilies_Util').mockReturnValue({
          a: {
            b: [
              {
                value: 10,
              },
            ],
          },
        });
    });

    afterEach(() => {
      formatFamiliesSpy.mockRestore();
    });

    it('should provide the proper request options', done => {
      jest.spyOn(FakeRowDataUtil as any, 'createRulesUtil').mockImplementation((reqOpts, properties, gaxOptions, cb) => {
          expect((reqOpts as rw.Rule).column).toBe(COLUMN_NAME);
          expect((reqOpts as rw.Rule).increment).toBe(1);
          expect(gaxOptions).toEqual({});
          done();
        });
      row.increment(COLUMN_NAME, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should optionally accept an increment amount', done => {
      const increment = 10;
      jest.spyOn(FakeRowDataUtil as any, 'createRulesUtil').mockImplementation(reqOpts => {
        expect((reqOpts as rw.Rule).increment).toBe(increment);
        done();
      });
      row.increment(COLUMN_NAME, increment, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      jest.spyOn(FakeRowDataUtil as any, 'createRulesUtil').mockImplementation((reqOpts, properties, gaxOptions_) => {
          expect(gaxOptions_).toBe(gaxOptions);
          done();
        });
      row.increment(COLUMN_NAME, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept increment amount and gaxOptions', done => {
      const increment = 10;
      const gaxOptions = {};
      jest.spyOn(FakeRowDataUtil as any, 'createRulesUtil').mockImplementation((reqOpts, properties, gaxOptions_) => {
          expect((reqOpts as rw.Rule).increment).toBe(increment);
          expect(gaxOptions_).toBe(gaxOptions);
          done();
        });
      row.increment(COLUMN_NAME, increment, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error to the callback', done => {
      const error = new Error('err');
      const response = {};
      jest.spyOn(RowDataUtils, 'createRulesUtil').mockImplementation(((...args: any[]) => { args[3](error, response); }) as any);
      row.increment(COLUMN_NAME, (err: any, value: any, apiResponse: any) => {
        expect(err).toBe(error);
        expect(value).toBe(null);
        expect(apiResponse).toBe(response);
        done();
      });
    });

    it('should pass back the updated value to the callback', done => {
      const fakeValue = 10;
      const response = {
        row: {
          families: [
            {
              name: 'a',
              columns: [
                {
                  qualifier: 'b',
                  cells: [
                    {
                      timestampMicros: Date.now(),
                      value: fakeValue,
                      labels: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      jest.spyOn(RowDataUtils, 'createRulesUtil').mockImplementation(((...args: any[]) => { args[3](null, response); }) as any);
      row.increment(COLUMN_NAME, (err: any, value: any, apiResponse: any) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(value).toBe(fakeValue);
        expect(apiResponse).toBe(response);
        expect((formatFamiliesSpy as jest.Mock).mock.calls.length).toBe(1);
        expect(formatFamiliesSpy).toHaveBeenCalledWith(response.row.families);
        done();
      });
    });
  });

  describe('save', () => {
    const data = {
      a: {
        b: 'c',
      },
    };

    it('should insert an object', done => {
      const fn = (
        table: TabularApiSurface,
        metricsCollector: OperationMetricsCollector,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: Entry | Entry[],
        gaxOptions: {},
        callback: Function,
      ) => {
        expect(entry.data).toBe(data);
        callback(); // done()
      };
      jest.spyOn(mutateInternalModule, 'mutateInternal').mockImplementation(fn as any);
      const savedRow = new Row(TABLE, ROW_ID);
      savedRow.save(data, done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      const fn = (
        table: TabularApiSurface,
        metricsCollector: OperationMetricsCollector,
        entry: Entry | Entry[],
        gaxOptions_: MutateOptions | MutateCallback,
      ) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      };
      jest.spyOn(mutateInternalModule, 'mutateInternal').mockImplementation(fn as any);
      const savedRow = new Row(TABLE, ROW_ID);
      savedRow.save(data, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should remove existing data', done => {
      const gaxOptions = {};
      const fn = (
        table: TabularApiSurface,
        metricsCollector: OperationMetricsCollector,
        entry: Entry | Entry[],
        gaxOptions_: MutateOptions | MutateCallback,
        callback: Function,
      ) => {
        expect(gaxOptions_).toBe(gaxOptions);
        callback();
      };
      jest.spyOn(mutateInternalModule, 'mutateInternal').mockImplementation(fn as any);
      const savedRow = new Row(TABLE, ROW_ID);
      savedRow.save(data, gaxOptions, (err: any) => {
        expect(err).toBeFalsy();
        expect(savedRow.data).toEqual({});
        done();
      });
    });
  });

  describe('RowError', () => {
    it('should supply the correct message', () => {
      const error = new RowError('test');
      expect(error.message).toBe('Unknown row: test.');
    });

    it('should supply a 404 error code', () => {
      const error = new RowError('test');
      expect(error.code).toBe(404);
    });
  });
});
