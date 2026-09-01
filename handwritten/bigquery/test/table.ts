// Copyright 2014 Google LLC
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

// eslint-disable-next-line no-var
var mockPromisified = false;
// eslint-disable-next-line no-var
var mockExtended = false;
// eslint-disable-next-line no-var
var makeWritableStreamOverride: Function | null = null;
// eslint-disable-next-line no-var
var isCustomTypeOverride: Function | null = null;

jest.mock('@google-cloud/common', () => {
  const common = jest.requireActual('@google-cloud/common');
  class FakeServiceObject extends common.ServiceObject {
    calledWith_: IArguments;
    constructor(config: any) {
      super(config);
      // eslint-disable-next-line prefer-rest-params
      this.calledWith_ = arguments;
    }
  }
  const fakeUtil = Object.assign({}, common.util, {
    isCustomType: (...args: Array<{}>) => {
      return (isCustomTypeOverride || common.util.isCustomType)(...args);
    },
    makeWritableStream: (...args: Array<{}>) => {
      (makeWritableStreamOverride || common.util.makeWritableStream)(...args);
    },
    noop: () => {},
  });
  return {
    ...common,
    ServiceObject: FakeServiceObject,
    util: fakeUtil,
  };
});

jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (c: Function) => {
    if (c.name === 'Table') {
      mockPromisified = true;
    }
    const actual = jest.requireActual('@google-cloud/promisify');
    actual.promisifyAll(c);
  },
}));

jest.mock('@google-cloud/paginator', () => ({
  paginator: {
    extend: (c: Function, methods: string[] | string) => {
      if (c.name !== 'Table') {
        return;
      }

      const arr = Array.isArray(methods) ? methods : [methods];
      expect(c.name).toBe('Table');
      expect(arr).toEqual(['getRows']);
      mockExtended = true;
    },
    streamify: (methodName: string) => {
      return methodName;
    },
  },
}));

import {
  DecorateRequestOptions,
  ServiceObject,
  ServiceObjectConfig,
  util,
} from '@google-cloud/common';
import {GoogleErrorBody} from '@google-cloud/common/build/src/util';
import * as pfy from '@google-cloud/promisify';
import {File} from '@google-cloud/storage';
import * as Big from 'big.js';
import {EventEmitter} from 'events';
import * as extend from 'extend';
import * as stream from 'stream';
import * as crypto from 'crypto';

import {BigQuery, Query} from '../src/bigquery';
import {toArray} from '../src/util';
import {Job, JobOptions} from '../src/job';
import {
  CopyTableMetadata,
  JobLoadMetadata,
  Table as TableType,
  ViewDefinition,
} from '../src/table';
import bigquery from '../src/types';
import {Duplex} from 'stream';
import {RowQueue} from '../src/rowQueue';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Table: any = require('../src/table').Table;

interface CalledWithTable extends ServiceObject {
  calledWith_: Array<{
    parent: {};
    baseUrl: string;
    id: string;
    methods: string[];
  }>;
}

async function pReflect<T>(promise: Promise<T>) {
  try {
    const value = await promise;
    return {
      isFulfilled: true,
      isRejected: false,
      value,
    };
  } catch (error) {
    return {
      isFulfilled: false,
      isRejected: true,
      reason: error,
    };
  }
}

interface MakeWritableStreamOptions {
  metadata: bigquery.IJob;
  request: {uri: string};
}

describe('BigQuery/Table', () => {
  const DATASET = {
    id: 'dataset-id',
    projectId: 'project-id',
    createTable: util.noop,
    bigQuery: {
      job: (id: string) => {
        return {id};
      },
      apiEndpoint: 'bigquery.googleapis.com',
      request: util.noop,
    },
  };

  const SCHEMA_OBJECT = {
    fields: [
      {name: 'id', type: 'INTEGER'},
      {name: 'name', type: 'STRING'},
      {name: 'dob', type: 'TIMESTAMP'},
      {name: 'has_claws', type: 'BOOLEAN'},
      {name: 'hair_count', type: 'FLOAT'},
      {name: 'numeric_col', type: 'NUMERIC'},
    ],
  };

  const SCHEMA_STRING = [
    'id:integer',
    'name',
    'dob:timestamp',
    'has_claws:boolean',
    'hair_count:float',
    'numeric_col:numeric',
  ].join(',');

  const LOCATION = 'asia-northeast1';
  const TABLE_ID = 'kittens';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let table: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tableOverrides: any = {};

  beforeAll(() => {
    const tableCached = extend(true, {}, Table);

    // Override all util methods, allowing them to be mocked. Overrides are
    // removed before each test.
    Object.keys(Table).forEach(tableMethod => {
      if (typeof Table[tableMethod] !== 'function') {
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Table[tableMethod] = (...args: any[]) => {
        const method = tableOverrides[tableMethod] || tableCached[tableMethod];
        return method(...args);
      };
    });
  });

  beforeEach(() => {
    isCustomTypeOverride = null;
    makeWritableStreamOverride = null;
    tableOverrides = {};
    table = new Table(DATASET as any, TABLE_ID);
    table.bigQuery.request = util.noop;
    table.bigQuery.createJob = util.noop;
    jest.spyOn(BigQuery, 'mergeSchemaWithRows_').mockImplementation((...args: any[]) => args[1]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('instantiation', () => {
    it('should extend the correct methods', () => {
      expect(mockExtended).toBe(true); // See `fakePaginator.extend`
    });

    it('should streamify the correct methods', () => {
      expect(table.createReadStream).toBe('getRows');
    });

    it('should promisify all the things', () => {
      expect(mockPromisified).toBe(true);
    });

    it('should inherit from ServiceObject', done => {
      const datasetInstance = Object.assign({}, DATASET, {
        createTable: {
          bind: (context: {}) => {
            expect(context).toBe(datasetInstance);
            done();
          },
        },
      });

      const table = new Table(datasetInstance as any, TABLE_ID);
      expect(table instanceof ServiceObject).toBe(true);

      const calledWith = (table as any).calledWith_[0];

      expect(calledWith.parent).toBe(datasetInstance);
      expect(calledWith.baseUrl).toBe('/tables');
      expect(calledWith.id).toBe(TABLE_ID);
      expect(calledWith.methods).toEqual({
        create: true,
        delete: true,
        exists: true,
        get: true,
        getMetadata: true,
      });
    });

    it('should capture the location', () => {
      const options = {location: LOCATION};
      const table = new Table(DATASET as any, TABLE_ID, options);

      expect(table.location).toBe(LOCATION);
    });

    describe('etag interceptor', () => {
      const FAKE_ETAG = 'abc';

      it('should apply the If-Match header', () => {
        const interceptor = table.interceptors.pop();

        const fakeReqOpts = {
          method: 'PATCH',
          json: {
            etag: FAKE_ETAG,
          },
        };

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.headers).toEqual({'If-Match': FAKE_ETAG});
      });

      it('should respect already existing headers', () => {
        const interceptor = table.interceptors.pop();

        const fakeReqOpts = {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          json: {
            etag: FAKE_ETAG,
          },
        };

        const expectedHeaders = Object.assign({}, fakeReqOpts.headers, {
          'If-Match': FAKE_ETAG,
        });

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.headers).toEqual(expectedHeaders);
      });

      it('should not apply the header if method is not patch', () => {
        const interceptor = table.interceptors.pop();

        const fakeReqOpts = {
          method: 'POST',
          json: {
            etag: FAKE_ETAG,
          },
        };

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.headers).toEqual(undefined);
      });
    });
  });

  describe('createSchemaFromString_', () => {
    it('should create a schema object from a string', () => {
      expect(Table.createSchemaFromString_(SCHEMA_STRING)).toEqual(SCHEMA_OBJECT);
    });

    it('should trim names', () => {
      const schema = Table.createSchemaFromString_(' name :type');
      expect(schema.fields[0].name).toBe('name');
    });

    it('should trim types', () => {
      const schema = Table.createSchemaFromString_('name: type ');
      expect(schema.fields[0].type).toBe('TYPE');
    });
  });

  describe('encodeValue_', () => {
    it('should return null if null or undefined', () => {
      expect(Table.encodeValue_(null)).toBe(null);
      expect(Table.encodeValue_(undefined)).toBe(null);
    });

    it('should properly encode values', () => {
      const buffer = Buffer.from('test');
      expect(Table.encodeValue_(buffer)).toBe(buffer.toString('base64'));

      const date = new Date();
      expect(Table.encodeValue_(date)).toBe(date.toJSON());

      const range = BigQuery.range(
        '[2020-10-01 12:00:00+08, 2020-12-31 12:00:00+08)',
        'TIMESTAMP',
      );
      expect(Table.encodeValue_(range)).toEqual({
        start: '2020-10-01T04:00:00.000Z',
        end: '2020-12-31T04:00:00.000Z',
      });
    });

    it('should properly encode custom types', () => {
      class BigQueryDate {
        value: {};
        constructor(value: {}) {
          this.value = value;
        }
      }
      class BigQueryDatetime {
        value: {};
        constructor(value: {}) {
          this.value = value;
        }
      }
      class BigQueryTime {
        value: {};
        constructor(value: {}) {
          this.value = value;
        }
      }
      class BigQueryTimestamp {
        value: {};
        constructor(value: {}) {
          this.value = value;
        }
      }
      class BigQueryInt {
        value: {};
        constructor(value: {}) {
          this.value = value;
        }
      }

      const date = new BigQueryDate('date');
      const datetime = new BigQueryDatetime('datetime');
      const time = new BigQueryTime('time');
      const timestamp = new BigQueryTimestamp('timestamp');
      const integer = new BigQueryInt('integer');

      expect(Table.encodeValue_(date)).toBe('date');
      expect(Table.encodeValue_(datetime)).toBe('datetime');
      expect(Table.encodeValue_(time)).toBe('time');
      expect(Table.encodeValue_(timestamp)).toBe('timestamp');
      expect(Table.encodeValue_(integer)).toBe('integer');
    });

    it('should properly encode arrays', () => {
      const buffer = Buffer.from('test');
      const date = new Date();

      const array = [buffer, date];

      expect(Table.encodeValue_(array)).toEqual([
        buffer.toString('base64'),
        date.toJSON(),
      ]);
    });

    it('should properly encode objects', () => {
      const buffer = Buffer.from('test');
      const date = new Date();

      const object = {
        nested: {
          array: [buffer, date],
        },
      };

      expect(Table.encodeValue_(object)).toEqual({
        nested: {
          array: [buffer.toString('base64'), date.toJSON()],
        },
      });
    });

    it('should properly encode numerics', () => {
      expect(Table.encodeValue_(new Big('123.456'))).toBe('123.456');
      expect(Table.encodeValue_(new Big('-123.456'))).toBe('-123.456');
      expect(Table.encodeValue_(new Big('99999999999999999999999999999.999999999'))).toBe('99999999999999999999999999999.999999999');
      expect(Table.encodeValue_(new Big('-99999999999999999999999999999.999999999'))).toBe('-99999999999999999999999999999.999999999');
    });

    it('should return properly encode objects with null prototype', () => {
      const obj = Object.create(null);
      obj['name'] = 'Test';
      expect(Table.encodeValue_(obj)).toEqual({
        name: 'Test',
      });
    });
  });

  describe('formatMetadata_', () => {
    it('should return a deep copy', () => {
      const metadata = {
        a: {
          b: 'c',
        },
      };

      const formatted = Table.formatMetadata_(metadata);

      expect(metadata).toEqual(formatted);
      expect(metadata).not.toBe(formatted);
    });

    it('should format the name option', () => {
      const NAME = 'name';

      const formatted = Table.formatMetadata_({name: NAME});

      expect(formatted.name).toBe(undefined);
      expect(formatted.friendlyName).toBe(NAME);
    });

    it('should format the schema string option', () => {
      const fakeSchema = {};

      Table.createSchemaFromString_ = (schema: string) => {
        expect(schema).toBe(SCHEMA_STRING);
        return fakeSchema;
      };

      const formatted = Table.formatMetadata_({schema: SCHEMA_STRING});

      expect(formatted.schema).toBe(fakeSchema);
    });

    it('should accept an array of schema fields', () => {
      const fields = ['a', 'b', 'c'];

      const formatted = Table.formatMetadata_({schema: fields});

      expect(formatted.schema.fields).toEqual(fields);
    });

    it('should format the schema fields option', () => {
      const metadata = {
        schema: {
          fields: ['a', {fields: []}, 'b'],
        },
      };

      const expectedFields = ['a', {fields: [], type: 'RECORD'}, 'b'];
      const formatted = Table.formatMetadata_(metadata);

      expect(formatted.schema.fields).toEqual(expectedFields);
    });

    it('should format the time partitioning option', () => {
      const formatted = Table.formatMetadata_({partitioning: 'abc'});

      expect(formatted.timePartitioning.type).toBe('ABC');
    });

    it('should format the table view option', () => {
      const VIEW = 'abc';

      const formatted = Table.formatMetadata_({view: VIEW});

      expect(formatted.view.query).toBe(VIEW);
      expect(formatted.view.useLegacySql).toBe(false);
    });

    it('should allow the view option to be passed as a pre-formatted object', () => {
      const view: ViewDefinition = {query: 'abc', useLegacySql: false};

      const {view: formattedView} = Table.formatMetadata_({view});

      expect(formattedView).toEqual(view);
    });
  });

  describe('copy', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fakeJob: any;

    beforeEach(() => {
      fakeJob = new EventEmitter();
      table.createCopyJob = (
        destination: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(null, fakeJob);
      };
    });

    it('should pass the arguments to createCopyJob', done => {
      const fakeDestination = {};
      const fakeMetadata: CopyTableMetadata = {
        createDisposition: 'CREATE_NEVER',
        writeDisposition: 'WRITE_TRUNCATE',
      };

      table.createCopyJob = (destination: {}, metadata: {}) => {
        expect(destination).toBe(fakeDestination);
        expect(metadata).toBe(fakeMetadata);
        done();
      };

      table.copy(fakeDestination, fakeMetadata, (err: any) => { if (err) done(err); });
    });

    it('should optionally accept metadata', done => {
      table.createCopyJob = (destination: {}, metadata: {}) => {
        expect(metadata).toEqual({});
        done();
      };

      table.copy({}, (err: any) => { if (err) done(err); });
    });

    it('should return any createCopyJob errors', done => {
      const error = new Error('err');
      const response = {};

      table.createCopyJob = (
        destination: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(error, null, response);
      };

      table.copy({}, (err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(response);
        done();
      });
    });

    it('should return any job errors', done => {
      const error = new Error('err');

      table.copy({}, (err: any) => {
        expect(err).toBe(error);
        done();
      });

      fakeJob.emit('error', error);
    });

    it('should return the metadata on complete', done => {
      const metadata = {};

      table.copy({}, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(metadata);
        done();
      });

      fakeJob.emit('complete', metadata);
    });
  });

  describe('copyFrom', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fakeJob: any;

    beforeEach(() => {
      fakeJob = new EventEmitter();
      table.createCopyFromJob = (
        sourceTables: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(null, fakeJob);
      };
    });

    it('should pass the arguments to createCopyFromJob', done => {
      const fakeSourceTables = {};
      const fakeMetadata = {};

      table.createCopyFromJob = (sourceTables: {}, metadata: {}) => {
        expect(sourceTables).toBe(fakeSourceTables);
        expect(metadata).toBe(fakeMetadata);
        done();
      };

      table.copyFrom(fakeSourceTables, fakeMetadata, (err: any) => { if (err) done(err); });
    });

    it('should optionally accept metadata', done => {
      table.createCopyFromJob = (sourceTables: {}, metadata: {}) => {
        expect(metadata).toEqual({});
        done();
      };

      table.copyFrom({}, (err: any) => { if (err) done(err); });
    });

    it('should return any createCopyFromJob errors', done => {
      const error = new Error('err');
      const response = {};

      table.createCopyFromJob = (
        sourceTables: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(error, null, response);
      };

      table.copyFrom({}, (err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(response);
        done();
      });
    });

    it('should return any job errors', done => {
      const error = new Error('err');

      table.copyFrom({}, (err: any) => {
        expect(err).toBe(error);
        done();
      });

      fakeJob.emit('error', error);
    });

    it('should return the metadata on complete', done => {
      const metadata = {};

      table.copyFrom({}, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(metadata);
        done();
      });

      fakeJob.emit('complete', metadata);
    });
  });

  describe('createCopyJob', () => {
    let DEST_TABLE: any;

    beforeAll(() => {
      DEST_TABLE = new Table(DATASET as any, 'destination-table');
    });

    it('should throw if a destination is not a Table', async () => {
      await expect(table.createCopyJob()).rejects.toThrow(/Destination must be a Table/);

      await expect(table.createCopyJob({})).rejects.toThrow(/Destination must be a Table/);

      expect(() => table.createCopyJob(() => {})).toThrow(/Destination must be a Table/);
    });

    it('should send correct request to the API', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts).toEqual({
          configuration: {
            copy: {
              a: 'b',
              c: 'd',
              destinationTable: {
                datasetId: DEST_TABLE.dataset.id,
                projectId: DEST_TABLE.dataset.projectId,
                tableId: DEST_TABLE.id,
              },
              sourceTable: {
                datasetId: table.dataset.id,
                projectId: table.dataset.projectId,
                tableId: table.id,
              },
            },
          },
        });

        done();
      };

      table.createCopyJob(DEST_TABLE, {a: 'b', c: 'd'}, (err: any) => { if (err) done(err); });
    });

    it('should accept a job prefix', done => {
      const fakeJobPrefix = 'abc-';
      const options = {
        jobPrefix: fakeJobPrefix,
      };

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.jobPrefix).toBe(fakeJobPrefix);
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.copy as any).jobPrefix).toBe(undefined);
        callback(); // the done fn
      };

      table.createCopyJob(DEST_TABLE, options, done);
    });

    it('should accept a reservation id', done => {
      const options = {
        reservation: 'reservation/1',
      };

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.configuration?.reservation).toBe('reservation/1');
        callback(); // the done fn
      };

      table.createCopyJob(DEST_TABLE, options, done);
    });

    it('should use the default location', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.location).toBe(LOCATION);
        callback(); // the done fn
      };

      table.location = LOCATION;
      table.createCopyJob(DEST_TABLE, done);
    });

    it('should accept a job id', done => {
      const jobId = 'job-id';
      const options = {jobId};

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.jobId).toBe(jobId);
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.copy as any).jobId).toBe(undefined);
        callback(); // the done fn
      };

      table.createCopyJob(DEST_TABLE, options, done);
    });

    it('should pass the callback to createJob', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(done).toBe(callback);
        callback(); // the done fn
      };

      table.createCopyJob(DEST_TABLE, {}, done);
    });

    it('should optionally accept metadata', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(done).toBe(callback);
        callback(); // the done fn
      };

      table.createCopyJob(DEST_TABLE, done);
    });
  });

  describe('createCopyFromJob', () => {
    let SOURCE_TABLE: any;

    beforeAll(() => {
      SOURCE_TABLE = new Table(DATASET as any, 'source-table');
    });

    it('should throw if a source is not a Table', async () => {
      await expect(table.createCopyFromJob(['table'])).rejects.toThrow(/Source must be a Table/);

      await expect(table.createCopyFromJob([SOURCE_TABLE, 'table'])).rejects.toThrow(/Source must be a Table/);

      await expect(table.createCopyFromJob({})).rejects.toThrow(/Source must be a Table/);

      expect(() => table.createCopyFromJob(() => {})).toThrow(/Source must be a Table/);
    });

    it('should send correct request to the API', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts).toEqual({
          configuration: {
            copy: {
              a: 'b',
              c: 'd',
              destinationTable: {
                datasetId: table.dataset.id,
                projectId: table.dataset.projectId,
                tableId: table.id,
              },
              sourceTables: [
                {
                  datasetId: SOURCE_TABLE.dataset.id,
                  projectId: SOURCE_TABLE.dataset.projectId,
                  tableId: SOURCE_TABLE.id,
                },
              ],
            },
          },
        });

        done();
      };

      table.createCopyFromJob(SOURCE_TABLE, {a: 'b', c: 'd'}, (err: any) => { if (err) done(err); });
    });

    it('should accept multiple source tables', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts.configuration!.copy!.sourceTables).toEqual([
          {
            datasetId: SOURCE_TABLE.dataset.id,
            projectId: SOURCE_TABLE.dataset.projectId,
            tableId: SOURCE_TABLE.id,
          },
          {
            datasetId: SOURCE_TABLE.dataset.id,
            projectId: SOURCE_TABLE.dataset.projectId,
            tableId: SOURCE_TABLE.id,
          },
        ]);

        done();
      };

      table.createCopyFromJob([SOURCE_TABLE, SOURCE_TABLE], (err: any) => { if (err) done(err); });
    });

    it('should accept a job prefix', done => {
      const fakeJobPrefix = 'abc-';
      const options = {
        jobPrefix: fakeJobPrefix,
      };

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.jobPrefix).toBe(fakeJobPrefix);
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.copy as any).jobPrefix).toBe(undefined);
        callback(); // the done fn
      };

      table.createCopyFromJob(SOURCE_TABLE, options, done);
    });

    it('should accept a reservation id', done => {
      const options = {
        reservation: 'reservation/1',
      };

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.configuration?.reservation).toBe('reservation/1');
        callback(); // the done fn
      };

      table.createCopyFromJob(SOURCE_TABLE, options, done);
    });

    it('should use the default location', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.location).toBe(LOCATION);
        callback(); // the done fn
      };

      table.location = LOCATION;
      table.createCopyFromJob(SOURCE_TABLE, done);
    });

    it('should accept a job id', done => {
      const jobId = 'job-id';
      const options = {jobId};

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.jobId).toBe(jobId);
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.copy as any).jobId).toBe(undefined);
        callback(); // the done fn
      };

      table.createCopyFromJob(SOURCE_TABLE, options, done);
    });

    it('should pass the callback to createJob', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(done).toBe(callback);
        callback(); // the done fn
      };

      table.createCopyFromJob(SOURCE_TABLE, {}, done);
    });

    it('should optionally accept options', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(done).toBe(callback);
        callback(); // the done fn
      };

      table.createCopyFromJob(SOURCE_TABLE, done);
    });
  });

  describe('createInsertStream', () => {
    it('should create a row queue', async () => {
      await table.createInsertStream();
      expect(table.rowQueue instanceof RowQueue).toBeTruthy();
    });

    it('should create a row queue with options', async () => {
      const opts = {insertRowsOptions: {raw: false}};
      await table.createInsertStream(opts);
      const queue = table.rowQueue;
      expect(queue.insertRowsOptions).toEqual(opts.insertRowsOptions);
    });

    it('should return a stream', () => {
      const stream = table.createInsertStream();
      expect(stream instanceof Duplex).toBeTruthy();
    });

    it('should add a row to the queue', () => {
      const cb = jest.fn();
      const chunk = {name: 'turing'};
      const stream = table.createInsertStream();
      const rowQueue = table.rowQueue;
      const stub = jest.spyOn(rowQueue, 'add');
      stream._write(chunk, {}, cb);
      expect(stub).toHaveBeenCalledTimes(1);
      expect(stub.mock.calls[0][0]).toEqual(chunk);
      expect(cb.mock.calls.length).toBe(1);
    });
  });

  describe('createExtractJob', () => {
    const FILE = {
      name: 'file-name.json',
      bucket: {
        name: 'bucket-name',
      },
    };

    beforeEach(() => {
      isCustomTypeOverride = () => {
        return true;
      };

      table.bigQuery.job = (id: string) => {
        return {id};
      };

      table.bigQuery.createJob = () => {};
    });

    it('should call createJob correctly', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts.configuration!.extract!.sourceTable).toEqual({
          datasetId: table.dataset.id,
          projectId: table.dataset.projectId,
          tableId: table.id,
        });

        done();
      };

      table.createExtractJob(FILE, (err: any) => { if (err) done(err); });
    });

    it('should accept just a destination and a callback', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        callback(null, {jobReference: {jobId: 'job-id'}});
      };

      table.createExtractJob(FILE, done);
    });

    describe('formats', () => {
      it('should accept csv', done => {
        table.bigQuery.createJob = (reqOpts: JobOptions) => {
          const extract = reqOpts.configuration!.extract!;
          expect(extract.destinationFormat).toBe('CSV');
          done();
        };

        table.createExtractJob(FILE, {format: 'csv'}, (err: any) => { if (err) done(err); });
      });

      it('should accept json', done => {
        table.bigQuery.createJob = (reqOpts: JobOptions) => {
          const extract = reqOpts.configuration!.extract!;
          expect(extract.destinationFormat).toBe('NEWLINE_DELIMITED_JSON');
          done();
        };

        table.createExtractJob(FILE, {format: 'json'}, (err: any) => { if (err) done(err); });
      });

      it('should accept avro', done => {
        table.bigQuery.createJob = (reqOpts: JobOptions) => {
          const extract = reqOpts.configuration!.extract!;
          expect(extract.destinationFormat).toBe('AVRO');
          done();
        };

        table.createExtractJob(FILE, {format: 'avro'}, (err: any) => { if (err) done(err); });
      });

      it('should accept orc', done => {
        table.bigQuery.createJob = (reqOpts: JobOptions) => {
          const extract = reqOpts.configuration!.extract!;
          expect(extract.destinationFormat).toBe('ORC');
          done();
        };

        table.createExtractJob(FILE, {format: 'orc'}, (err: any) => { if (err) done(err); });
      });

      it('should accept parquet', done => {
        table.bigQuery.createJob = (reqOpts: JobOptions) => {
          const extract = reqOpts.configuration!.extract!;
          expect(extract.destinationFormat).toBe('PARQUET');
          done();
        };

        table.createExtractJob(FILE, {format: 'parquet'}, (err: any) => { if (err) done(err); });
      });

      it('should accept Firestore backup', done => {
        table.bigQuery.createJob = (reqOpts: JobOptions) => {
          const extract = reqOpts.configuration!.extract!;
          expect(extract.destinationFormat).toBe('DATASTORE_BACKUP');
          done();
        };

        table.createExtractJob(
          FILE,
          {format: 'export_metadata'},
          (err: any) => { if (err) done(err); },
        );
      });
    });
    it('should parse out full gs:// urls from files', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts.configuration!.extract!.destinationUris).toEqual(['gs://' + FILE.bucket.name + '/' + FILE.name]);
        done();
      };

      table.createExtractJob(FILE, (err: any) => { if (err) done(err); });
    });

    it('should check if a destination is a File', done => {
      isCustomTypeOverride = (dest: {}, type: string) => {
        expect(dest).toBe(FILE);
        expect(type).toBe('storage/file');
        setImmediate(done);
        return true;
      };

      table.createExtractJob(FILE, (err: any) => { if (err) done(err); });
    });

    it('should throw if a destination is not a File', () => {
      isCustomTypeOverride = () => {
        return false;
      };

      expect(() => {
        table.createExtractJob({}, util.noop);
      }).toThrow(/Destination must be a File object/);

      expect(() => {
        table.createExtractJob([FILE, {}], util.noop);
      }).toThrow(/Destination must be a File object/);
    });

    it('should detect file format if a format is not provided', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        const destFormat = reqOpts.configuration!.extract!.destinationFormat;
        expect(destFormat).toBe('NEWLINE_DELIMITED_JSON');
        done();
      };

      table.createExtractJob(FILE, (err: any) => { if (err) done(err); });
    });

    it('should assign the provided format if matched', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        const extract = reqOpts.configuration!.extract!;
        expect(extract.destinationFormat).toBe('CSV');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((extract as any).format).toBe(undefined);
        done();
      };

      table.createExtractJob(FILE, {format: 'csv'}, (err: any) => { if (err) done(err); });
    });

    it('should throw if a provided format is not recognized', () => {
      expect(() => {
        table.createExtractJob(FILE, {format: 'zip'}, util.noop);
      }).toThrow(/Destination format not recognized/);
    });

    it('should assign GZIP compression with gzip: true', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts.configuration!.extract!.compression).toBe('GZIP');
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.extract as any).gzip).toBe(undefined);
        done();
      };

      table.createExtractJob(FILE, {gzip: true}, util.noop);
    });

    it('should accept a job prefix', done => {
      const fakeJobPrefix = 'abc-';
      const options = {
        jobPrefix: fakeJobPrefix,
      };

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.jobPrefix).toBe(fakeJobPrefix);
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.extract as any).jobPrefix).toBe(undefined);
        callback(); // the done fn
      };

      table.createExtractJob(FILE, options, done);
    });

    it('should accept a reservation id', done => {
      const options = {
        reservation: 'reservation/1',
      };

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.configuration?.reservation).toBe('reservation/1');
        callback(); // the done fn
      };

      table.createExtractJob(FILE, options, done);
    });

    it('should use the default location', done => {
      const table = new Table(DATASET as any, TABLE_ID, {location: LOCATION});

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.location).toBe(LOCATION);
        callback(); // the done fn
      };

      table.createExtractJob(FILE, done);
    });

    it('should accept a job id', done => {
      const jobId = 'job-id';
      const options = {jobId};

      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.jobId).toBe(jobId);
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.extract as any).jobId).toBe(undefined);
        callback(); // the done fn
      };

      table.createExtractJob(FILE, options, done);
    });

    it('should pass the callback to createJob', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(done).toBe(callback);
        callback(); // the done fn
      };

      table.createExtractJob(FILE, {}, done);
    });

    it('should optionally accept options', done => {
      table.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(done).toBe(callback);
        callback(); // the done fn
      };

      table.createExtractJob(FILE, done);
    });
  });

  describe('createLoadJob', () => {
    const FILEPATH = require.resolve('./testdata/testfile.json');
    const FILE = {
      name: 'file-name.json',
      bucket: {
        name: 'bucket-name',
      },
    };

    const JOB = {
      id: 'foo',
      metadata: {},
    };

    let bqCreateJobStub: any;

    beforeEach(() => {
      bqCreateJobStub = jest.spyOn(table.bigQuery, 'createJob')
        .mockResolvedValue([JOB, JOB.metadata]);
      isCustomTypeOverride = () => {
        return true;
      };
    });

    afterEach(() => {
      
    });

    it('should accept just a File and a callback', done => {
      table.createWriteStream_ = () => {
        const ws = new stream.Writable();
        setImmediate(() => {
          ws.emit('job', JOB);
          ws.end();
        });
        return ws;
      };

      table.createLoadJob(FILEPATH, (err: any, job: Job, resp: {}) => {
        expect(err).toBe(null);
        expect(job).toBe(JOB);
        expect(resp).toBe(JOB.metadata);
        done();
      });
    });

    it('should infer the file format from the given filepath', done => {
      table.createWriteStream_ = (metadata: JobLoadMetadata) => {
        expect(metadata.sourceFormat).toBe('NEWLINE_DELIMITED_JSON');
        const ws = new stream.Writable();
        setImmediate(() => {
          ws.emit('job', JOB);
          ws.end();
        });
        return ws;
      };

      table.createLoadJob(FILEPATH, done);
    });

    it('should execute callback with error from writestream', done => {
      const error = new Error('Error.');

      table.createWriteStream_ = (metadata: JobLoadMetadata) => {
        expect(metadata.sourceFormat).toBe('NEWLINE_DELIMITED_JSON');
        const ws = new stream.Writable();
        setImmediate(() => {
          ws.emit('error', error);
          ws.end();
        });
        return ws;
      };

      table.createLoadJob(FILEPATH, (err: any) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should not infer the file format if one is given', done => {
      table.createWriteStream_ = (metadata: JobLoadMetadata) => {
        expect(metadata.sourceFormat).toBe('CSV');
        const ws = new stream.Writable();
        setImmediate(() => {
          ws.emit('job', JOB);
          ws.end();
        });
        return ws;
      };

      table.createLoadJob(FILEPATH, {sourceFormat: 'CSV'}, done);
    });

    it('should check if a destination is a File', done => {
      isCustomTypeOverride = (dest: File, type: string) => {
        expect(dest).toBe(FILE);
        expect(type).toBe('storage/file');
        setImmediate(done);
        return true;
      };

      table.createLoadJob(FILE, (err: any) => { if (err) done(err); });
    });

    it('should throw if a File object is not provided', async () => {
      isCustomTypeOverride = () => {
        return false;
      };
      await expect(table.createLoadJob({})).rejects.toThrow(/Source must be a File object/,);
    });

    it('should convert File objects to gs:// urls', async () => {
      await table.createLoadJob(FILE);
      expect(bqCreateJobStub.mock.calls.length).toBe(1);
      expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceUris).toEqual(['gs://' + FILE.bucket.name + '/' + FILE.name]);
    });

    it('should infer the file format from a File object', async () => {
      await table.createLoadJob(FILE);
      expect(bqCreateJobStub.mock.calls.length).toBe(1);
      expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceFormat).toBe('NEWLINE_DELIMITED_JSON');
    });

    it('should not override a provided format with a File', async () => {
      await table.createLoadJob(FILE, {sourceFormat: 'AVRO'});
      expect(bqCreateJobStub.mock.calls.length).toBe(1);
      expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceFormat).toBe('AVRO');
    });

    it('should use bigQuery.createJob', async () => {
      await table.createLoadJob(FILE, {});
      expect(bqCreateJobStub.mock.calls.length === 1).toBeTruthy();
    });

    it('should optionally accept options', async () => {
      await table.createLoadJob(FILE);
      expect(bqCreateJobStub.mock.calls.length === 1).toBeTruthy();
    });

    it('should set the job prefix', async () => {
      const jobPrefix = 'abc';
      await table.createLoadJob(FILE, {jobPrefix});
      expect(bqCreateJobStub.mock.calls.length).toBe(1);
      expect(bqCreateJobStub.mock.calls[0][0].jobPrefix).toBe(jobPrefix);
      expect(bqCreateJobStub.mock.calls[0][0].configuration.load.jobPrefix).toBeUndefined();
    });

    it('should set the job reservation', async () => {
      const reservation = 'reservation/1';
      await table.createLoadJob(FILE, {reservation});
      expect(bqCreateJobStub.mock.calls.length).toBe(1);
      expect(bqCreateJobStub.mock.calls[0][0].configuration.reservation).toBe(reservation);
    });

    it('should use the default location', async () => {
      const table = new Table(DATASET as any, TABLE_ID, {location: LOCATION});
      await table.createLoadJob(FILE);
      expect(bqCreateJobStub).toHaveBeenCalledWith(expect.objectContaining({location: LOCATION}));
    });

    it('should accept a job id', async () => {
      const jobId = 'job-id';
      await table.createLoadJob(FILE, {jobId});
      expect(bqCreateJobStub.mock.calls.length).toBe(1);
      expect(bqCreateJobStub.mock.calls[0][0].jobId).toBe(jobId);
      expect(bqCreateJobStub.mock.calls[0][0].configuration.load.jobId).toBeUndefined();
    });

    describe('formats', () => {
      it('should accept csv', async () => {
        await table.createLoadJob(FILE, {format: 'csv'});
        expect(bqCreateJobStub.mock.calls.length).toBe(1);
        expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceFormat).toBe('CSV');
      });

      it('should accept json', async () => {
        await table.createLoadJob(FILE, {format: 'json'});
        expect(bqCreateJobStub.mock.calls.length).toBe(1);
        expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceFormat).toBe('NEWLINE_DELIMITED_JSON');
      });

      it('should accept avro', async () => {
        await table.createLoadJob(FILE, {format: 'avro'});
        expect(bqCreateJobStub.mock.calls.length).toBe(1);
        expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceFormat).toBe('AVRO');
      });

      it('should accept export_metadata', async () => {
        await table.createLoadJob(FILE, {format: 'export_metadata'});
        expect(bqCreateJobStub.mock.calls.length).toBe(1);
        expect(bqCreateJobStub.mock.calls[0][0].configuration.load.sourceFormat).toBe('DATASTORE_BACKUP');
      });
    });
  });

  describe('createQueryJob', () => {
    it('should call through to dataset#createQueryJob', done => {
      const fakeOptions = {};
      const fakeReturnValue = {};

      table.dataset.createQueryJob = (options: Query, callback: Function) => {
        expect(options).toBe(fakeOptions);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setImmediate(callback as any);
        return fakeReturnValue;
      };

      const returnVal = table.createQueryJob(fakeOptions, done);
      expect(returnVal).toBe(fakeReturnValue);
    });
  });

  describe('createQueryStream', () => {
    it('should call datasetInstance.createQueryStream()', done => {
      table.dataset.createQueryStream = (a: {}) => {
        expect(a).toBe('a');
        done();
      };

      table.createQueryStream('a');
    });

    it('should return whatever dataset.createQueryStream returns', () => {
      const fakeValue = 123;
      table.dataset.createQueryStream = () => {
        return fakeValue;
      };
      const val = table.createQueryStream();
      expect(val).toBe(fakeValue);
    });
  });

  describe('createWriteStream_', () => {
    describe('formats', () => {
      it('should accept export_metadata', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const load = options.metadata.configuration!.load!;
          expect(load.sourceFormat).toBe('DATASTORE_BACKUP');
          done();
        };

        table.createWriteStream_('export_metadata').emit('writing');
      });

      it('should accept csv', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const load = options.metadata.configuration!.load!;
          expect(load.sourceFormat).toBe('CSV');
          done();
        };

        table.createWriteStream_('csv').emit('writing');
      });

      it('should accept json', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const load = options.metadata.configuration!.load!;
          expect(load.sourceFormat).toBe('NEWLINE_DELIMITED_JSON');
          done();
        };

        table.createWriteStream_('json').emit('writing');
      });

      it('should accept avro', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const load = options.metadata.configuration!.load!;
          expect(load.sourceFormat).toBe('AVRO');
          done();
        };

        table.createWriteStream_('avro').emit('writing');
      });

      it('should accept export_metadata', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const load = options.metadata.configuration!.load!;
          expect(load.sourceFormat).toBe('DATASTORE_BACKUP');
          done();
        };

        table.createWriteStream_('export_metadata').emit('writing');
      });
    });

    it('should format a schema', done => {
      const expectedSchema = {};
      tableOverrides.createSchemaFromString_ = (s: string) => {
        expect(s).toBe(SCHEMA_STRING);
        return expectedSchema;
      };

      makeWritableStreamOverride = (
        stream: stream.Stream,
        options: MakeWritableStreamOptions,
      ) => {
        const load = options.metadata.configuration!.load!;
        expect(load.schema).toEqual(expectedSchema);
        done();
      };

      table.createWriteStream_({schema: SCHEMA_STRING}).emit('writing');
    });

    it('should override destination table', done => {
      const expectedMetadata = {
        destinationTable: {
          projectId: 'projectId-override',
          datasetId: 'datasetId-override',
          tableId: 'tableId-override',
        },
      };
      makeWritableStreamOverride = (
        stream: stream.Stream,
        options: MakeWritableStreamOptions,
      ) => {
        expect(options.metadata.configuration?.load?.destinationTable).toEqual(expectedMetadata.destinationTable);
        done();
      };

      table
        .createWriteStream_({
          destinationTable: {
            projectId: 'projectId-override',
            datasetId: 'datasetId-override',
            tableId: 'tableId-override',
          },
        })
        .emit('writing');
    });

    it('should return a stream', () => {
      expect(table.createWriteStream_() instanceof stream.Stream).toBeTruthy();
    });

    describe('writable stream', () => {
      let fakeJob: EventEmitter;
      let fakeJobId: string;

      beforeEach(() => {
        fakeJob = new EventEmitter();
        fakeJobId = crypto.randomUUID();
        jest.spyOn(crypto, 'randomUUID')
          .mockReturnValue(fakeJobId as crypto.UUID);
      });

      it('should make a writable stream when written to', done => {
        makeWritableStreamOverride = (s: {}) => {
          expect(s).toBe(stream);
          done();
        };
        const stream = table.createWriteStream_();
        stream.emit('writing');
      });

      it('should pass extended metadata', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          expect(options.metadata).toEqual({
            configuration: {
              load: {
                a: 'b',
                c: 'd',
                destinationTable: {
                  projectId: table.dataset.projectId,
                  datasetId: table.dataset.id,
                  tableId: table.id,
                },
              },
            },
            jobReference: {
              projectId: table.dataset.projectId,
              jobId: fakeJobId,
              location: undefined,
            },
          });
          done();
        };

        table.createWriteStream_({a: 'b', c: 'd'}).emit('writing');
      });

      it('should pass the correct request uri', done => {
        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const uri =
            table.bigQuery.apiEndpoint +
            '/upload/bigquery/v2/projects/' +
            table.dataset.projectId +
            '/jobs';
          expect(options.request.uri).toBe(uri);
          done();
        };

        (table.createWriteStream_ as any)().emit('writing');
      });

      it('should respect the jobPrefix option', done => {
        const jobPrefix = 'abc-';
        const expectedJobId = jobPrefix + fakeJobId;

        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const jobId = options.metadata.jobReference!.jobId;
          expect(jobId).toBe(expectedJobId);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = options.metadata.configuration!.load as any;
          expect(config.jobPrefix).toBe(undefined);

          done();
        };

        table.createWriteStream_({jobPrefix}).emit('writing');
      });

      it('should use the default location', done => {
        const table = new Table(DATASET as any, TABLE_ID, {location: LOCATION});

        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const location = options.metadata.jobReference!.location;
          expect(location).toBe(LOCATION);

          done();
        };

        (table.createWriteStream_ as any)().emit('writing');
      });

      it('should accept a job id', done => {
        const jobId = 'job-id';
        const options = {jobId};

        makeWritableStreamOverride = (
          stream: stream.Stream,
          options: MakeWritableStreamOptions,
        ) => {
          const jobReference = options.metadata.jobReference!;
          expect(jobReference.jobId).toBe(jobId);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = options.metadata.configuration!.load as any;
          expect(config.jobId).toBe(undefined);

          done();
        };

        table.createWriteStream_(options).emit('writing');
      });

      it('should create a job and emit it with job', done => {
        const metadata = {
          jobReference: {
            jobId: 'job-id',
            location: 'location',
            projectId: 'project-id',
          },
          a: 'b',
          c: 'd',
        };

        table.bigQuery.job = (id: string, options: {}) => {
          expect(id).toBe(metadata.jobReference!.jobId);
          expect(options).toEqual({
            location: metadata.jobReference!.location,
            projectId: metadata.jobReference!.projectId,
          });
          return fakeJob;
        };

        makeWritableStreamOverride = (
          stream: {},
          options: {},
          callback: Function,
        ) => {
          callback(metadata);
        };

        table
          .createWriteStream_()
          .on('job', (job: Job) => {
            expect(job).toBe(fakeJob);
            expect(job.metadata).toEqual(metadata);
            done();
          })
          .emit('writing');
      });
    });
  });

  describe('createWriteStream', () => {
    let fakeJob: EventEmitter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fakeStream: any;

    beforeEach(() => {
      fakeJob = new EventEmitter();
      fakeStream = new EventEmitter();
      table.createWriteStream_ = () => fakeStream;
    });

    it('should pass the metadata to the private method', done => {
      const fakeMetadata = {};

      table.createWriteStream_ = (metadata: {}) => {
        expect(metadata).toBe(fakeMetadata);
        setImmediate(done);
        return new EventEmitter();
      };

      table.createWriteStream(fakeMetadata);
    });

    it('should cork the stream on prefinish', () => {
      let corked = false;

      fakeStream.cork = () => {
        corked = true;
      };

      table.createWriteStream().emit('prefinish');

      expect(corked).toBe(true);
    });

    it('should destroy the stream on job error', done => {
      const error = new Error('error');

      fakeStream.destroy = (err: any) => {
        expect(err).toBe(error);
        done();
      };

      table.createWriteStream().emit('job', fakeJob);
      fakeJob.emit('error', error);
    });

    it('should signal complete upon job complete', done => {
      const stream = table.createWriteStream();

      let uncorked = false;

      stream.uncork = () => {
        uncorked = true;
      };

      stream.on('complete', (job: {}) => {
        expect(job).toBe(fakeJob);

        setImmediate(() => {
          expect(uncorked).toBe(true);
          done();
        });
      });

      stream.emit('job', fakeJob);
      fakeJob.emit('complete');
    });
  });

  describe('extract', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fakeJob: any;

    beforeEach(() => {
      fakeJob = new EventEmitter();
      table.createExtractJob = (
        destination: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(null, fakeJob);
      };
    });

    it('should pass the arguments to createExtractJob', done => {
      const fakeDestination = {};
      const fakeMetadata = {};

      table.createExtractJob = (destination: {}, metadata: {}) => {
        expect(destination).toBe(fakeDestination);
        expect(metadata).toBe(fakeMetadata);
        done();
      };

      table.extract(fakeDestination, fakeMetadata, (err: any) => { if (err) done(err); });
    });

    it('should optionally accept metadata', done => {
      table.createExtractJob = (destination: {}, metadata: {}) => {
        expect(metadata).toEqual({});
        done();
      };

      table.extract({}, (err: any) => { if (err) done(err); });
    });

    it('should return any createExtractJob errors', done => {
      const error = new Error('err');
      const response = {};

      table.createExtractJob = (
        destination: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(error, null, response);
      };

      table.extract({}, (err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(response);
        done();
      });
    });

    it('should return any job errors', done => {
      const error = new Error('err');

      table.extract({}, (err: any) => {
        expect(err).toBe(error);
        done();
      });

      fakeJob.emit('error', error);
    });

    it('should return the metadata on complete', done => {
      const metadata = {};

      table.extract({}, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(metadata);
        done();
      });

      fakeJob.emit('complete', metadata);
    });
  });

  describe('getRows', () => {
    it('should accept just a callback', done => {
      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {});
      };
      table.getRows(done);
    });

    it('should make correct API request', done => {
      const options = {a: 'b', c: 'd'};
      const formatOptions =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              'formatOptions.timestampOutputFormat': 'ISO8601_STRING',
            }
          : {
              'formatOptions.useInt64Timestamp': true,
            };

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.uri).toBe('/data');
        expect(reqOpts.qs).toEqual({
          ...options,
          ...formatOptions,
        });
        callback(null, {});
      };

      table.getRows(options, done);
    });

    it('should execute callback with error & API response', done => {
      const apiResponse = {};
      const error = new Error('Error.');

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error, apiResponse);
      };

      table.getRows((err: any, rows: {}, nextQuery: {}, apiResponse_: {}) => {
        expect(err).toBe(error);
        expect(rows).toBe(null);
        expect(nextQuery).toBe(null);
        expect(apiResponse_).toBe(apiResponse);

        done();
      });
    });

    describe('refreshing metadata', () => {
      // Using "Stephen" so you know who to blame for these tests.
      const rows = [{f: [{v: 'stephen'}]}];
      const schema = {fields: [{name: 'name', type: 'string'}]};
      const wrapIntegers = false;
      const mergedRows = [{name: 'stephen'}];

      beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table.request = (reqOpts: DecorateRequestOptions, callback: any) => {
          // Respond with a row, so it grabs the schema.
          // Use setImmediate to let our getMetadata overwrite process.
          setImmediate(callback, null, {rows});
        };

        jest.restoreAllMocks();
        jest.spyOn(BigQuery, 'mergeSchemaWithRows_')
          .mockImplementation((schema_, rows_, options_) => {
            expect(schema_).toBe(schema);
            expect(rows_).toBe(rows);
            expect(options_.wrapIntegers).toBe(wrapIntegers);
            return mergedRows;
          });
      });

      it('should refresh', done => {
        // Step 1: makes the request.
        table.getRows(responseHandler);

        // Step 2: refreshes the metadata to pull down the schema.
        table.getMetadata = (callback: Function) => {
          table.metadata = {schema};
          callback();
        };

        // Step 3: execute original complete handler with schema-merged rows.
        function responseHandler(err: any, rows: {}) {
          expect(err).toBeFalsy();
          expect(rows).toBe(mergedRows);
          done();
        }
      });

      it('should execute callback from refreshing metadata', done => {
        const apiResponse = {};
        const error = new Error('Error.');

        // Step 1: makes the request.
        table.getRows(responseHandler);

        // Step 2: refreshes the metadata to pull down the schema.
        table.getMetadata = (callback: Function) => {
          callback(error, {}, apiResponse);
        };

        // Step 3: execute original complete handler with schema-merged rows.
        function responseHandler(
          err: Error,
          rows: {},
          nextQuery: {},
          apiResponse_: {},
        ) {
          expect(err).toBe(error);
          expect(rows).toBe(null);
          expect(nextQuery).toBe(null);
          expect(apiResponse_).toBe(apiResponse);
          done();
        }
      });
    });

    it('should return schema-merged rows', done => {
      const rows = [{f: [{v: 'stephen'}]}];
      const schema = {fields: [{name: 'name', type: 'string'}]};
      const wrapIntegers = false;
      const merged = [{name: 'stephen'}];

      table.metadata = {schema};

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {rows});
      };

      jest.restoreAllMocks();
      jest.spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema_, rows_, options_) => {
          expect(schema_).toBe(schema);
          expect(rows_).toBe(rows);
          expect(options_.wrapIntegers).toBe(wrapIntegers);
          return merged;
        });

      table.getRows((err: any, rows: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toBe(merged);
        done();
      });
    });

    it('should return apiResponse in callback', done => {
      const rows = [{f: [{v: 'stephen'}]}];
      const schema = {fields: [{name: 'name', type: 'string'}]};
      table.metadata = {schema};

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {rows});
      };

      table.getRows((err: any, rows: {}, nextQuery: {}, apiResponse: {}) => {
        expect(err).toBeFalsy();
        expect(apiResponse).toEqual({rows: [{f: [{v: 'stephen'}]}]});
        done();
      });
    });

    it('should skip parsing if skipParsing is true', done => {
      const rows = [{f: [{v: 'stephen'}]}];
      const schema = {fields: [{name: 'name', type: 'string'}]};
      table.metadata = {schema};

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {rows});
      };

      jest.restoreAllMocks();
      const mergeStub = jest.spyOn(BigQuery, 'mergeSchemaWithRows_');

      table.getRows(
        {skipParsing: true},
        (err: any, rows_: {}[], nextQuery: {}, apiResponse: any) => {
          expect(err).toBeFalsy();
          expect(rows_).toBe(rows);
          expect(mergeStub.mock.calls.length > 0).toBe(false);
          expect(apiResponse.rows).toEqual(rows);
          done();
        },
      );
    });

    it('should pass nextQuery if pageToken is returned', done => {
      const options = {a: 'b', c: 'd'};
      const pageToken = 'token';

      // Set a schema so it doesn't try to refresh the metadata.
      table.metadata = {schema: {}};

      const callbackResponse =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              'formatOptions.useInt64Timestamp': true,
              pageToken,
            }
          : {
              pageToken,
            };
      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, callbackResponse);
      };
      const formatOptions =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              'formatOptions.timestampOutputFormat': 'ISO8601_STRING',
            }
          : {
              'formatOptions.useInt64Timestamp': true,
            };

      table.getRows(options, (err: any, rows: {}, nextQuery: {}) => {
        expect(err).toBeFalsy();
        expect(nextQuery).toEqual({
          a: 'b',
          c: 'd',
          ...formatOptions,
          pageToken,
        });
        // Original object isn't affected.
        expect(options).toEqual({a: 'b', c: 'd'});
        done();
      });
    });

    it('should return selected fields', done => {
      const selectedFields = 'age';
      const rows = [{f: [{v: 40}]}];
      const schema = {
        fields: [
          {name: 'name', type: 'string'},
          {name: 'age', type: 'INTEGER'},
        ],
      };
      const result = [{age: 40}];

      table.metadata = {schema};

      jest.restoreAllMocks();

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.qs.selectedFields).toBeTruthy();
        callback(null, {rows});
      };

      table.getRows({selectedFields}, (err: any, rows: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toEqual(result);
        done();
      });
    });

    it('should return selected fields after consecutive calls', done => {
      const buildNestedObject = (value: Record<string, string>) => {
        return [
          {
            v: {
              f: [
                {
                  v: {
                    f: Object.values(value).map(v => ({v})),
                  },
                },
              ],
            },
          },
        ];
      };
      const callSequence = [
        {
          selectedFields: ['age', 'nested.object.a'],
          rows: [
            {
              f: [{v: 40}, {v: buildNestedObject({a: '1'})}],
            },
          ],
          expected: [{age: 40, nested: [{object: {a: '1'}}]}],
        },
        {
          selectedFields: ['name', 'address'],
          rows: [
            {
              f: [{v: 'John'}, {v: '1234 Fake St, Springfield'}],
            },
          ],
          expected: [{name: 'John', address: '1234 Fake St, Springfield'}],
        },
        {
          selectedFields: ['age'],
          rows: [{f: [{v: 50}]}],
          expected: [{age: 50}],
        },
      ];
      const schema = {
        fields: [
          {name: 'name', type: 'string'},
          {name: 'age', type: 'INTEGER'},
          {name: 'address', type: 'string'},
          {
            name: 'nested',
            type: 'RECORD',
            mode: 'REPEATED',
            fields: [
              {
                name: 'object',
                type: 'RECORD',
                fields: [
                  {
                    name: 'a',
                    type: 'STRING',
                  },
                  {
                    name: 'b',
                    type: 'STRING',
                  },
                ],
              },
            ],
          },
        ],
      };

      table.metadata = {schema};

      jest.restoreAllMocks();

      for (const [i, call] of callSequence.entries()) {
        table.request = (
          reqOpts: DecorateRequestOptions,
          callback: Function,
        ) => {
          callback(null, {rows: call.rows});
        };
        table.getRows(
          {selectedFields: call.selectedFields.join(',')},
          (err: any, rows: {}) => {
            expect(err).toBeFalsy();
            expect(rows).toEqual(call.expected);
            if (i === callSequence.length - 1) {
              done();
            }
          },
        );
      }
    });

    it('should return selected fields from nested objects', done => {
      const selectedFields = 'objects.nested_object.nested_property_1';
      const rows = [
        {
          f: [
            {
              v: [
                {
                  v: {
                    f: [
                      {
                        v: {
                          f: [
                            {
                              v: 'nested_property_1_value',
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ];
      const schema = {
        fields: [
          {name: 'name', type: 'string'},
          {
            name: 'objects',
            type: 'RECORD',
            mode: 'REPEATED',
            fields: [
              {
                name: 'nested_object',
                type: 'RECORD',
                fields: [
                  {
                    name: 'nested_property',
                    type: 'STRING',
                  },
                  {
                    name: 'nested_property_1',
                    type: 'STRING',
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = [
        {
          objects: [
            {
              nested_object: {
                nested_property_1: 'nested_property_1_value',
              },
            },
          ],
        },
      ];

      table.metadata = {schema};

      jest.restoreAllMocks();

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {rows});
      };

      table.getRows({selectedFields}, (err: any, rows: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toEqual(result);
        done();
      });
    });

    it('should wrap integers', done => {
      const wrapIntegers = {integerTypeCastFunction: jest.fn()};
      const options = {wrapIntegers};
      const merged = [{name: 'stephen'}];
      const formatOptions =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              'formatOptions.timestampOutputFormat': 'ISO8601_STRING',
            }
          : {
              'formatOptions.useInt64Timestamp': true,
            };

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.qs).toEqual({
          ...formatOptions,
        });
        callback(null, {});
      };

      jest.restoreAllMocks();
      jest.spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema_, rows_, options_) => {
          expect(options_.wrapIntegers).toBe(wrapIntegers);
          return merged;
        });

      table.getRows(options, done);
    });

    it('should parse json', done => {
      const options = {
        parseJSON: true,
      };
      const merged = [{name: 'stephen'}];
      const formatOptions =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              'formatOptions.timestampOutputFormat': 'ISO8601_STRING',
            }
          : {
              'formatOptions.useInt64Timestamp': true,
            };

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.qs).toEqual({
          ...formatOptions,
        });
        callback(null, {});
      };

      jest.restoreAllMocks();
      jest.spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema_, rows_, options_) => {
          expect(options_.parseJSON).toBe(true);
          return merged;
        });

      table.getRows(options, done);
    });
  });

  describe('insert', () => {
    const fakeInsertId = 'fake-insert-id';

    const data = [
      {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
      {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
      {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
      {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
      {state: 'MI', gender: 'M', year: '2015', name: 'Berkley', count: '0'},
    ];

    const rawData = [
      {insertId: 1, json: data[0]},
      {insertId: 2, json: data[1]},
      {insertId: 3, json: data[2]},
      {insertId: 4, json: data[3]},
      {insertId: 5, json: data[4]},
    ];

    const dataApiFormat = {
      rows: data.map(row => {
        return {
          insertId: fakeInsertId,
          json: row,
        };
      }),
    };

    const OPTIONS = {
      schema: SCHEMA_STRING,
    };

    let insertSpy: any;
    let requestStub: any;

    beforeEach(() => {
      jest.useFakeTimers();
      insertSpy = jest.spyOn(table, '_insert');
      requestStub = jest.spyOn(table, 'request').mockResolvedValue([{}]);
      jest.spyOn(crypto, 'randomUUID').mockReturnValue(fakeInsertId as crypto.UUID);
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    async function reflectAfterTimer<FnReturn>(fn: () => Promise<FnReturn>) {
      const fnPromise: Promise<FnReturn> = fn();
      const reflectedPromise = pReflect(fnPromise);
      await jest.runAllTimersAsync();
      return reflectedPromise;
    }

    it('should throw an error if rows is empty', async () => {
      await expect(table.insert([])).rejects.toThrow(
        /You must provide at least 1 row to be inserted/,
      );
    });

    it('should save data', async () => {
      await table.insert(data);
      expect(requestStub).toHaveBeenCalledTimes(1);
      expect(requestStub).toHaveBeenCalledWith({
        method: 'POST',
        uri: '/insertAll',
        json: dataApiFormat,
      });
    });

    it('should return a promise if no callback is provided', () => {
      const promise = table.insert(data);
      expect(promise instanceof Promise).toBe(true);
    });

    it('should resolve to an array on success', async () => {
      const resp = await table.insert(data);
      expect(Array.isArray(resp)).toBe(true);
    });

    it('should generate insertId', async () => {
      await table.insert([data[0]]);
      expect(requestStub).toHaveBeenCalledTimes(1);
      const req = requestStub.mock.lastCall![0];
      expect(req.json.rows[0].insertId).toBe(fakeInsertId);
    });

    it('should omit the insertId if createInsertId is false', async () => {
      await table.insert([data[0]], {createInsertId: false});
      expect(requestStub).toHaveBeenCalledTimes(1);
      const req = requestStub.mock.lastCall![0];
      expect(req.json.rows[0].insertId).toBeUndefined();
      expect(req.json.createInsertId).toBeUndefined();
    });

    it('should execute callback with API response', done => {
      const apiResponse = {insertErrors: []};
      requestStub.mockResolvedValue([apiResponse]);

      table.insert(data, (err: any, apiResponse_: {}) => {
        expect(err).toBeFalsy();
        expect(apiResponse_).toBe(apiResponse);
        done();
      });
    });

    it('should execute callback with error & API response', done => {
      const error = new Error('Error.');
      requestStub.mockRejectedValue(error);

      table.insert(data, (err: any, apiResponse_: {}) => {
        expect(err).toBe(error);
        expect(apiResponse_).toBe(null);
        done();
      });
    });

    it('should reject with API error', async () => {
      const error = new Error('Error.');
      requestStub.mockRejectedValue(error);
      await expect(table.insert(data)).rejects.toThrow(error);
    });

    it('should return partial failures', async () => {
      const row0Error = {message: 'Error.', reason: 'notFound'};
      const row1Error = {message: 'Error.', reason: 'notFound'};
      requestStub.mockResolvedValue([
        {
          insertErrors: [
            {index: 0, errors: [row0Error]},
            {index: 1, errors: [row1Error]},
          ],
        },
      ]);

      const reflection = await reflectAfterTimer(() => table.insert(data));
      expect(reflection.isRejected).toBeTruthy();
      const {reason} = reflection;
      expect((reason as GoogleErrorBody).errors).toEqual([
        {
          row: dataApiFormat.rows[0].json,
          errors: [row0Error],
        },
        {
          row: dataApiFormat.rows[1].json,
          errors: [row1Error],
        },
      ]);
    });

    it('should retry partials default max 3', async () => {
      const rowError = {message: 'Error.', reason: 'try again plz'};
      requestStub.mockReset();
      requestStub.mockResolvedValue([
        {
          insertErrors: [
            {index: 0, errors: [rowError]},
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
            {index: 3, errors: [rowError]},
          ],
        },
      ]);

      const reflection = await reflectAfterTimer(() =>
        table.insert(data, OPTIONS),
      );
      expect(reflection.isRejected).toBeTruthy();
      expect(insertSpy.mock.calls.length).toBe(4);
    });

    it('should retry partials with optional max', async () => {
      const partialRetries = 6;
      const rowError = {message: 'Error.', reason: 'try again plz'};
      requestStub.mockReset();
      requestStub.mockResolvedValue([
        {
          insertErrors: [
            {index: 0, errors: [rowError]},
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
            {index: 3, errors: [rowError]},
          ],
        },
      ]);

      const reflection = await reflectAfterTimer(() =>
        table.insert(data, {...OPTIONS, partialRetries}),
      );
      expect(reflection.isRejected).toBeTruthy();
      expect(insertSpy.mock.calls.length).toBe(partialRetries + 1);
    });

    it('should allow 0 partial retries, but still do it once', async () => {
      const rowError = {message: 'Error.', reason: 'try again plz'};
      requestStub.mockReset();
      requestStub.mockResolvedValue([
        {
          insertErrors: [
            {index: 0, errors: [rowError]},
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
            {index: 3, errors: [rowError]},
          ],
        },
      ]);

      const reflection = await reflectAfterTimer(() =>
        table.insert(data, {...OPTIONS, partialRetries: 0}),
      );
      expect(reflection.isRejected).toBeTruthy();
      expect(insertSpy.mock.calls.length).toBe(1);
    });

    it('should keep partial retries option non-negative', async () => {
      const rowError = {message: 'Error.', reason: 'try again plz'};
      requestStub.mockReset();
      requestStub.mockResolvedValue([
        {
          insertErrors: [
            {index: 0, errors: [rowError]},
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
            {index: 3, errors: [rowError]},
          ],
        },
      ]);

      const reflection = await reflectAfterTimer(() =>
        table.insert(data, {...OPTIONS, partialRetries: -1}),
      );
      expect(reflection.isRejected).toBeTruthy();
      expect(insertSpy.mock.calls.length).toBe(1);
    });

    it('should retry partial inserts deltas', async () => {
      const rowError = {message: 'Error.', reason: 'try again plz'};
      requestStub.mockReset();
      requestStub.mockResolvedValueOnce([
        {
          insertErrors: [
            {index: 0, errors: [rowError]},
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
            {index: 3, errors: [rowError]},
          ],
        },
      ]);

      requestStub.mockResolvedValueOnce([
        {
          insertErrors: [
            {index: 0, errors: [rowError]},
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
          ],
        },
      ]);

      requestStub.mockResolvedValueOnce([
        {
          insertErrors: [
            {index: 1, errors: [rowError]},
            {index: 2, errors: [rowError]},
          ],
        },
      ]);

      const goodResponse = [{foo: 'bar'}];
      requestStub.mockResolvedValueOnce(goodResponse);

      const reflection = await reflectAfterTimer(() =>
        table.insert(data, OPTIONS),
      );
      expect(reflection.isFulfilled).toBeTruthy();

      expect(requestStub.mock.calls[0][0].json).toEqual(dataApiFormat);
      expect(requestStub.mock.calls[1][0].json).toEqual({rows: dataApiFormat.rows.slice(0, 4)});
      expect(requestStub.mock.calls[2][0].json).toEqual({rows: dataApiFormat.rows.slice(0, 3)});
      expect(requestStub.mock.calls[3][0].json).toEqual({rows: dataApiFormat.rows.slice(1, 3)});
      expect(requestStub.mock.calls[4]).toBeUndefined();
      expect(reflection.value).toBeTruthy();
    });

    it('should insert raw data', async () => {
      const opts = {raw: true};
      await table.insert(rawData, opts);
      expect(requestStub.mock.calls.length === 1).toBeTruthy();

      const [reqOpts]: DecorateRequestOptions[] = requestStub.mock.calls[0];
      expect(reqOpts.method).toBe('POST');
      expect(reqOpts.uri).toBe('/insertAll');
      expect(reqOpts.json).toEqual({rows: rawData});
    });

    it('should accept options', async () => {
      const opts = {
        ignoreUnknownValues: true,
        skipInvalidRows: true,
        templateSuffix: 'test',
      };

      await table.insert(data, opts);
      expect(requestStub.mock.calls.length === 1).toBeTruthy();

      const [reqOpts]: DecorateRequestOptions[] = requestStub.mock.calls[0];
      expect(reqOpts.method).toBe('POST');
      expect(reqOpts.uri).toBe('/insertAll');

      expect(reqOpts.json.ignoreUnknownValues).toBe(opts.ignoreUnknownValues);
      expect(reqOpts.json.skipInvalidRows).toBe(opts.skipInvalidRows);
      expect(reqOpts.json.templateSuffix).toBe(opts.templateSuffix);

      expect(reqOpts.json.rows).toEqual(dataApiFormat.rows);
    });

    describe('create table and retry', () => {
      let createStub: any;
      let insertCreateSpy: any;

      beforeEach(() => {
        insertCreateSpy = jest.spyOn(table, '_insertAndCreateTable');
        createStub = jest.spyOn(table, 'create').mockResolvedValue([{}]);
        requestStub = jest.spyOn(table, 'request').mockResolvedValue([{}]);
      });

      afterEach(() => {
        insertCreateSpy.mockRestore();
        createStub.mockRestore();
      });

      it('should not include the schema in the insert request', async () => {
        await table.insert(data, OPTIONS);
        expect(requestStub.mock.calls.length).toBe(1);
        expect(requestStub.mock.calls[0][0].json.schema).toBeUndefined();
      });

      it('should attempt to create table if not created', async () => {
        requestStub.mockRejectedValueOnce({code: 404});
        const reflection = await reflectAfterTimer(() =>
          table.insert(data, OPTIONS),
        );
        expect(reflection.isFulfilled).toBeTruthy();
        expect(createStub.mock.calls.length).toBe(1);
        expect(createStub.mock.calls[0][createStub.mock.calls[0].length - 1].schema).toBe(SCHEMA_STRING);
      });

      it('should set a timeout to insert rows in the created table', async () => {
        requestStub.mockRejectedValueOnce({code: 404});
        const expectedDelay = 60000;
        const firstCheckDelay = 50000;
        const remainingCheckDelay = expectedDelay - firstCheckDelay;

        void pReflect(table.insert(data, OPTIONS));
        expect(insertCreateSpy.mock.calls.length).toBe(1);

        await jest.advanceTimersByTimeAsync(firstCheckDelay);
        expect(insertCreateSpy.mock.calls.length).toBe(1);
        expect(createStub.mock.calls.length).toBe(1);

        await jest.advanceTimersByTimeAsync(remainingCheckDelay);
        expect(insertCreateSpy.mock.calls.length).toBe(2);
        expect(insertCreateSpy.mock.calls[1][0]).toBe(data);
        expect(insertCreateSpy.mock.calls[1][1]).toBe(OPTIONS);

        await jest.runAllTimersAsync();
        expect(insertCreateSpy.mock.calls.length).toBe(2);
      });

      it('should reject on table creation errors', async () => {
        requestStub.mockRejectedValueOnce({code: 404});
        const error = new Error('err.');
        createStub.mockRejectedValue(error);

        const reflection = await reflectAfterTimer(() =>
          table.insert(data, OPTIONS),
        );
        expect(reflection.isRejected).toBeTruthy();
        expect(reflection.reason).toBe(error);
      });

      it('should ignore 409 errors', async () => {
        requestStub.mockRejectedValueOnce({code: 404});
        createStub.mockRejectedValue({code: 409});

        const reflection = await reflectAfterTimer(() =>
          table.insert(data, OPTIONS),
        );
        expect(reflection.isFulfilled).toBeTruthy();
        expect(createStub.mock.calls.length).toBe(1);
        expect(insertCreateSpy.mock.calls.length).toBe(2);
        expect(insertCreateSpy.mock.calls[1][0]).toBe(data);
        expect(insertCreateSpy.mock.calls[1][1]).toBe(OPTIONS);
      });

      it('should retry the insert', async () => {
        const errorResponse = {code: 404};
        requestStub.mockRejectedValueOnce(errorResponse);
        requestStub.mockRejectedValueOnce(errorResponse);

        const goodResponse = [{foo: 'bar'}];
        requestStub.mockResolvedValueOnce(goodResponse);

        const reflection = await reflectAfterTimer(() =>
          table.insert(data, OPTIONS),
        );
        expect(reflection.isFulfilled).toBeTruthy();
        expect(requestStub.mock.calls.length).toBe(3);
        requestStub.mock.calls.forEach((call: any) => {
          expect(call[0]).toEqual(expect.objectContaining({
            method: 'POST',
            uri: '/insertAll',
            json: dataApiFormat,
          }));
        });
        expect(reflection.value).toEqual(goodResponse);
      });
    });
  });

  describe('load', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fakeJob: any;

    beforeEach(() => {
      fakeJob = new EventEmitter();
      table.createLoadJob = (source: {}, metadata: {}, callback: Function) => {
        callback(null, fakeJob);
      };
    });

    it('should pass the arguments to createLoadJob', done => {
      const fakeSource = {};
      const fakeMetadata = {};

      table.createLoadJob = (source: {}, metadata: {}) => {
        expect(source).toBe(fakeSource);
        expect(metadata).toBe(fakeMetadata);
        done();
      };

      table.load(fakeSource, fakeMetadata, (err: any) => { if (err) done(err); });
    });

    it('should optionally accept metadata', done => {
      table.createLoadJob = (source: {}, metadata: {}) => {
        expect(metadata).toEqual({});
        done();
      };

      table.load({}, (err: any) => { if (err) done(err); });
    });

    it('should return any createLoadJob errors', done => {
      const error = new Error('err');
      const response = {};

      table.createLoadJob = (source: {}, metadata: {}, callback: Function) => {
        callback(error, null, response);
      };

      table.load({}, (err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(response);
        done();
      });
    });

    it('should return any job errors', done => {
      const error = new Error('err');

      table.load({}, (err: any) => {
        expect(err).toBe(error);
        done();
      });

      fakeJob.emit('error', error);
    });

    it('should return the metadata on complete', done => {
      const metadata = {};

      table.load({}, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(metadata);
        done();
      });

      fakeJob.emit('complete', metadata);
    });
  });

  describe('query', () => {
    it('should pass args through to datasetInstance.query()', done => {
      table.dataset.query = (a: {}, b: {}) => {
        expect(a).toEqual({query: 'a'});
        expect(b).toBe('b');
        done();
      };

      table.query('a', 'b');
    });

    it('should pass skipParsing through to datasetInstance.query()', done => {
      const query = {
        query: 'a',
        skipParsing: true,
      };
      table.dataset.query = (a: {}, b: {}) => {
        expect(a).toEqual(query);
        expect(b).toBe('b');
        done();
      };

      table.query(query, 'b');
    });
  });

  describe('setMetadata', () => {
    it('should call ServiceObject#setMetadata', done => {
      const fakeMetadata = {};
      const formattedMetadata = {};

      Table.formatMetadata_ = (data: {}) => {
        expect(data).toBe(fakeMetadata);
        return formattedMetadata;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ServiceObject.prototype as any).setMetadata = function (
        metadata: {},
        callback: Function,
      ) {
        expect(this).toBe(table);
        expect(metadata).toBe(formattedMetadata);
        expect(callback).toBe(done);
        callback!(null); // the done fn
      };

      table.setMetadata(fakeMetadata, done);
    });
  });

  describe('setIamPolicy', () => {
    const BIGQUERY_DATA_VIEWER = 'roles/bigquery.dataViewer';

    it('should make correct API request', done => {
      const binding = {role: BIGQUERY_DATA_VIEWER, members: ['Turing']};
      const policy = {bindings: [binding], etag: 'abc'};

      table.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.policy).toEqual(policy);
        expect(reqOpts.uri).toBe('/:setIamPolicy');
        expect(reqOpts.method).toBe('POST');
        done();
      };

      table.setIamPolicy(policy);
    });

    it('should accept a callback', () => {
      const binding = {role: BIGQUERY_DATA_VIEWER, members: ['Turing']};
      const policy = {bindings: [binding], etag: 'abc'};

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, policy);
      };

      table.setIamPolicy(policy, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(policy);
      });
    });

    it('should accept options', done => {
      const policy = {};
      const updateMask = 'binding';

      table.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.policy).toEqual(policy);
        expect(reqOpts.json.updateMask).toBe(updateMask);
        expect(reqOpts.uri).toBe('/:setIamPolicy');
        expect(reqOpts.method).toBe('POST');
        done();
      };

      table.setIamPolicy(policy, {updateMask});
    });

    it('should throw with invalid policy version', () => {
      const policy = {version: 100};
      expect(() => {
        table.setIamPolicy(policy, util.noop);
      }).toThrow(/Only IAM policy version 1 is supported./);
    });

    it('should return errors', () => {
      const policy = {};
      const error = new Error('a bad thing!');

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error, null);
      };

      table.setIamPolicy(policy, (err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(null);
      });
    });
  });

  describe('getIamPolicy', () => {
    it('should make correct API call', done => {
      table.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/:getIamPolicy');
        expect(reqOpts.method).toBe('POST');
        done();
      };

      table.getIamPolicy();
    });

    it('should accept just a callback', () => {
      const policy = {};

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.uri).toBe('/:getIamPolicy');
        expect(reqOpts.method).toBe('POST');
        callback(null, policy);
      };

      table.getIamPolicy((err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(policy);
      });
    });

    it('should accept options', () => {
      const policy = {};
      const options = {requestedPolicyVersion: 1};

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.json.options).toEqual(options);
        expect(reqOpts.uri).toBe('/:getIamPolicy');
        expect(reqOpts.method).toBe('POST');
        callback(null, policy);
      };

      table.getIamPolicy(options, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(policy);
      });
    });

    it('should throw with invalid policy version', () => {
      const options = {requestedPolicyVersion: 100};
      expect(() => {
        table.getIamPolicy(options, util.noop);
      }).toThrow(/Only IAM policy version 1 is supported./);
    });

    it('should return errors', () => {
      const error = new Error('a bad thing!');

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error, null);
      };

      table.getIamPolicy((err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(null);
      });
    });
  });

  describe('testIamPermissions', () => {
    it('should make correct API call', () => {
      const permissions = ['bigquery.do.stuff'];

      table.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/:testIamPermissions');
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.json).toEqual({permissions});
      };

      table.testIamPermissions(permissions, util.noop);
    });

    it('should accept a callback', () => {
      const permissions = ['bigquery.do.stuff'];

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        expect(reqOpts.json.permissions).toEqual(permissions);
        expect(reqOpts.uri).toBe('/:testIamPermissions');
        expect(reqOpts.method).toBe('POST');
        callback(null, {permissions});
      };

      table.testIamPermissions(permissions, (err: any, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toEqual({permissions});
      });
    });

    it('should return errors', () => {
      const permissions = ['bigquery.do.stuff'];
      const error = new Error('a bad thing!');

      table.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error, null);
      };

      table.testIamPermissions(permissions, (err: any, resp: {}) => {
        expect(err).toBe(error);
        expect(resp).toBe(null);
      });
    });
  });
});
