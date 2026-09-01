// Copyright 2019 Google LLC
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
  DecorateRequestOptions,
  Service,
  ServiceConfig,
  ServiceOptions,
  util,
} from '@google-cloud/common';
import * as Big from 'big.js';
import * as extend from 'extend';
import * as crypto from 'crypto';
import {PreciseDate} from '@google-cloud/precise-date';

import {toArray} from '../src/util';

interface InputObject {
  year?: number;
  month?: number;
  day?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  fractional?: number;
}

interface CalledWithService extends Service {
  calledWith_: Array<{
    baseUrl: string;
    scopes: string[];
    packageJson: {};
  }>;
}

let promisified = false;
let extended = false;

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll: (c: Function, options: any) => {
      if (c.name !== 'BigQuery') {
        return;
      }
      promisified = true;
      expect(options.exclude).toEqual([
        'dataset',
        'date',
        'datetime',
        'geography',
        'int',
        'job',
        'time',
        'timestamp',
        'range',
      ]);
    },
  };
});

jest.mock('@google-cloud/paginator', () => {
  const actual = jest.requireActual('@google-cloud/paginator');
  return {
    ...actual,
    paginator: {
      ...actual.paginator,
      extend: (c: Function, methods: string[]) => {
        if (c.name !== 'BigQuery') {
          return;
        }
        const methodsArr = Array.isArray(methods) ? methods : [methods];
        if (
          methodsArr.length === 2 &&
          methodsArr[0] === 'getDatasets' &&
          methodsArr[1] === 'getJobs'
        ) {
          extended = true;
        }
      },
      streamify: (methodName: string) => {
        return methodName;
      },
    },
  };
});

jest.mock('../src/dataset', () => {
  class FakeDataset {
    calledWith_: Array<{}>;
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
    }
  }
  return {
    Dataset: FakeDataset,
  };
});

jest.mock('../src/job', () => {
  class FakeJob {
    calledWith_: Array<{}>;
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
    }
  }
  return {
    Job: FakeJob,
  };
});

jest.mock('../src/table', () => {
  const actual = jest.requireActual('../src/table');
  class FakeTable {
    calledWith_: Array<{}>;
    dataset: any;
    id: any;
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
      this.dataset = args[0];
      this.id = args[1];
    }
  }
  return {
    ...actual,
    Table: FakeTable,
  };
});

jest.mock('@google-cloud/common', () => {
  const actual = jest.requireActual('@google-cloud/common');
  class FakeService extends actual.Service {
    calledWith_: IArguments;
    constructor(config: any, options: any) {
      super(config, options);
      // eslint-disable-next-line prefer-rest-params
      this.calledWith_ = arguments;
    }
  }
  class FakeApiError {
    calledWith_: Array<{}>;
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
    }
  }
  return {
    ...actual,
    Service: FakeService,
    util: {
      ...actual.util,
      ApiError: FakeApiError,
    },
  };
});

import {
  BigQueryInt,
  BigQueryDate,
  IntegerTypeCastValue,
  IntegerTypeCastOptions,
  Dataset,
  Job,
  PROTOCOL_REGEX,
  Table,
  JobOptions,
  TableField,
  Query,
  QueryResultsOptions,
  QueryOptions,
} from '../src';

describe('BigQuery', () => {
  const JOB_ID = 'JOB_ID';
  const PROJECT_ID = 'test-project';
  const ANOTHER_PROJECT_ID = 'another-test-project';
  const LOCATION = 'asia-northeast1';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BigQueryCached: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BigQuery: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bq: any;

  const BIGQUERY_EMULATOR_HOST = process.env.BIGQUERY_EMULATOR_HOST;

  beforeAll(() => {
    delete process.env.BIGQUERY_EMULATOR_HOST;
    BigQuery = require('../src/bigquery').BigQuery;
    BigQueryCached = Object.assign({}, BigQuery);
  });

  beforeEach(() => {
    BigQuery = Object.assign(BigQuery, BigQueryCached);
    bq = new BigQuery({
      projectId: PROJECT_ID,
      defaultJobCreationMode: 'JOB_CREATION_OPTIONAL',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (BIGQUERY_EMULATOR_HOST) {
      process.env.BIGQUERY_EMULATOR_HOST = BIGQUERY_EMULATOR_HOST;
    }
  });

  describe('instantiation', () => {
    it('should extend the correct methods', () => {
      expect(extended).toBe(true); // See `fakePaginator.extend`
    });

    it('should streamify the correct methods', () => {
      expect(bq.getDatasetsStream).toBe('getDatasets');
      expect(bq.getJobsStream).toBe('getJobs');
      expect(bq.createQueryStream).toBe('queryAsStream_');
    });

    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should inherit from Service', () => {
      expect(bq instanceof Service).toBe(true);

      const calledWith = (bq as CalledWithService).calledWith_[0];

      const baseUrl = 'https://bigquery.googleapis.com/bigquery/v2';
      expect(calledWith.baseUrl).toBe(baseUrl);
      expect(calledWith.scopes).toEqual([
        'https://www.googleapis.com/auth/bigquery',
      ]);
      expect(calledWith.packageJson).toEqual(// eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../../package.json'));
    });

    it('should allow overriding the apiEndpoint', () => {
      const apiEndpoint = 'https://not.real.local';
      bq = new BigQuery({
        apiEndpoint,
      });
      const calledWith = bq.calledWith_[0];
      expect(calledWith.baseUrl).toBe(`${apiEndpoint}/bigquery/v2`);
      expect(calledWith.apiEndpoint).toBe(`${apiEndpoint}`);
    });

    it('should prepend apiEndpoint with default protocol', () => {
      const protocollessApiEndpoint = 'some.fake.endpoint';
      bq = new BigQuery({
        apiEndpoint: protocollessApiEndpoint,
      });
      const calledWith = bq.calledWith_[0];
      expect(calledWith.baseUrl).toBe(`https://${protocollessApiEndpoint}/bigquery/v2`);
      expect(calledWith.apiEndpoint).toBe(`https://${protocollessApiEndpoint}`);
    });

    it('should strip trailing slash from apiEndpoint', () => {
      const apiEndpoint = 'https://some.fake.endpoint/';
      bq = new BigQuery({
        apiEndpoint: apiEndpoint,
      });
      const calledWith = bq.calledWith_[0];
      expect(calledWith.baseUrl).toBe(`${apiEndpoint}bigquery/v2`);
      expect(calledWith.apiEndpoint).toBe('https://some.fake.endpoint');
    });

    it('should allow overriding TPC universe', () => {
      const universeDomain = 'fake-tpc-env.example.com/';
      bq = new BigQuery({
        universeDomain: universeDomain,
      });
      const calledWith = bq.calledWith_[0];
      expect(calledWith.baseUrl).toBe('https://bigquery.fake-tpc-env.example.com/bigquery/v2');
      expect(calledWith.apiEndpoint).toBe('https://bigquery.fake-tpc-env.example.com');
    });

    it('should capture any user specified location', () => {
      const bq = new BigQuery({
        projectId: PROJECT_ID,
        location: LOCATION,
      });
      expect(bq.location).toBe(LOCATION);
    });

    it('should pass scopes from options', () => {
      const bq = new BigQuery({
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });

      const expectedScopes = [
        'https://www.googleapis.com/auth/bigquery',
        'https://www.googleapis.com/auth/drive.readonly',
      ];

      const calledWith = bq.calledWith_[0];
      expect(calledWith.scopes).toEqual(expectedScopes);
    });

    it('should pass autoRetry from options', () => {
      const retry = false;
      const bq = new BigQuery({
        autoRetry: retry,
      });

      const calledWith = bq.calledWith_[0];
      expect(calledWith.autoRetry).toEqual(retry);
    });

    it('should pass maxRetries from options', () => {
      const retryVal = 1;
      const bq = new BigQuery({
        maxRetries: retryVal,
      });

      const calledWith = bq.calledWith_[0];
      expect(calledWith.maxRetries).toEqual(retryVal);
    });

    it('should pass retryOptions from options', () => {
      const retryOptions = {
        autoRetry: true,
        maxRetries: 3,
      };
      const bq = new BigQuery({
        retryOptions: retryOptions,
      });

      const calledWith = bq.calledWith_[0];
      expect(calledWith.retryOptions).toEqual(retryOptions);
    });

    it('should not modify options argument', () => {
      const options = {
        projectId: PROJECT_ID,
      };
      const expectedCalledWith = Object.assign({}, options, {
        apiEndpoint: 'https://bigquery.googleapis.com',
      });
      const bigquery = new BigQuery(options);
      const calledWith = bigquery.calledWith_[1];
      expect(calledWith).not.toBe(options);
      expect(calledWith).not.toEqual(options);
      expect(calledWith).toEqual(expectedCalledWith);
    });

    describe('BIGQUERY_EMULATOR_HOST', () => {
      const EMULATOR_HOST = 'https://internal.benchmark.com/path';

      beforeAll(() => {
        process.env.BIGQUERY_EMULATOR_HOST = EMULATOR_HOST;
      });

      afterAll(() => {
        delete process.env.BIGQUERY_EMULATOR_HOST;
      });

      it('should set baseUrl to env var STORAGE_EMULATOR_HOST', () => {
        bq = new BigQuery({
          projectId: PROJECT_ID,
        });

        const calledWith = bq.calledWith_[0];
        expect(calledWith.baseUrl).toBe(EMULATOR_HOST);
        expect(calledWith.apiEndpoint).toBe('https://internal.benchmark.com/path');
      });

      it('should be overriden by apiEndpoint', () => {
        bq = new BigQuery({
          projectId: PROJECT_ID,
          apiEndpoint: 'https://some.api.com',
        });

        const calledWith = bq.calledWith_[0];
        expect(calledWith.baseUrl).toBe(EMULATOR_HOST);
        expect(calledWith.apiEndpoint).toBe('https://some.api.com');
      });

      it('should prepend default protocol and strip trailing slash', () => {
        const EMULATOR_HOST = 'internal.benchmark.com/path/';
        process.env.BIGQUERY_EMULATOR_HOST = EMULATOR_HOST;

        bq = new BigQuery({
          projectId: PROJECT_ID,
        });

        const calledWith = bq.calledWith_[0];
        expect(calledWith.baseUrl).toBe(EMULATOR_HOST);
        expect(calledWith.apiEndpoint).toBe('https://internal.benchmark.com/path');
      });
    });

    describe('prettyPrint request interceptor', () => {
      let requestInterceptor: Function;

      beforeEach(() => {
        requestInterceptor = bq.interceptors.pop().request;
      });

      it('should disable prettyPrint', () => {
        expect(requestInterceptor({})).toEqual({
          qs: {prettyPrint: false},
        });
      });

      it('should clone json', () => {
        const reqOpts = {qs: {a: 'b'}};
        const expectedReqOpts = {qs: {a: 'b', prettyPrint: false}};
        expect(requestInterceptor(reqOpts)).toEqual(expectedReqOpts);
        expect(reqOpts).not.toEqual(expectedReqOpts);
      });
    });
  });

  describe('mergeSchemaWithRows_', () => {
    const SCHEMA_OBJECT = {
      fields: [
        {name: 'id', type: 'INTEGER'},
        {name: 'name', type: 'STRING'},
        {name: 'dob', type: 'TIMESTAMP'},
        {name: 'has_claws', type: 'BOOLEAN'},
        {name: 'has_fangs', type: 'BOOL'},
        {name: 'hair_count', type: 'FLOAT'},
        {name: 'teeth_count', type: 'FLOAT64'},
        {name: 'numeric_col', type: 'NUMERIC'},
        {name: 'bignumeric_col', type: 'BIGNUMERIC'},
      ],
    } as {fields: TableField[]};

    beforeEach(() => {
      jest.spyOn(BigQuery, 'date').mockImplementation(input => {
        return {
          type: 'fakeDate',
          input,
        };
      });

      jest.spyOn(BigQuery, 'datetime').mockImplementation(input => {
        return {
          type: 'fakeDatetime',
          input,
        };
      });

      jest.spyOn(BigQuery, 'time').mockImplementation(input => {
        return {
          type: 'fakeTime',
          input,
        };
      });

      jest.spyOn(BigQuery, 'timestamp').mockImplementation(input => {
        return {
          type: 'fakeTimestamp',
          input,
        };
      });

      jest.spyOn(BigQuery, 'geography').mockImplementation(input => {
        return {
          type: 'fakeGeography',
          input,
        };
      });

      jest.spyOn(BigQuery, 'range').mockImplementation((input, elementType) => {
        return {
          type: 'fakeRange',
          input,
          elementType,
        };
      });
    });

    it('should merge the schema and flatten the rows', () => {
      const now = new Date();
      const buffer = Buffer.from('test');

      const rows = [
        {
          raw: {
            f: [
              {v: '3'},
              {v: 'Milo'},
              {v: now.valueOf() * 1000}, // int64 microseconds
              {v: 'false'},
              {v: 'true'},
              {v: '5.222330009847'},
              {v: '30.2232138'},
              {v: '3.14'},
              {v: '9.9876543210123456789'},
              {
                v: [
                  {
                    v: '10',
                  },
                ],
              },
              {
                v: [
                  {
                    v: '2',
                  },
                ],
              },
              {v: null},
              {v: buffer.toString('base64')},
              {
                v: [
                  {
                    v: {
                      f: [
                        {
                          v: {
                            f: [
                              {
                                v: 'nested_value',
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {v: 'date-input'},
              {v: 'datetime-input'},
              {v: 'time-input'},
              {v: 'geography-input'},
              {v: '[2020-10-01 12:00:00+08, 2020-12-31 12:00:00+08)'},
            ],
          },
          expected: {
            id: 3,
            name: 'Milo',
            dob: {
              input: new PreciseDate(BigInt(now.valueOf()) * BigInt(1_000_000)),
              type: 'fakeTimestamp',
            },
            has_claws: false,
            has_fangs: true,
            hair_count: 5.222330009847,
            teeth_count: 30.2232138,
            numeric_col: new Big(3.14),
            bignumeric_col: new Big('9.9876543210123456789'),
            arr: [10],
            arr2: [2],
            nullable: null,
            buffer,
            objects: [
              {
                nested_object: {
                  nested_property: 'nested_value',
                },
              },
            ],
            date: {
              input: 'date-input',
              type: 'fakeDate',
            },
            datetime: {
              input: 'datetime-input',
              type: 'fakeDatetime',
            },
            time: {
              input: 'time-input',
              type: 'fakeTime',
            },
            geography: {
              input: 'geography-input',
              type: 'fakeGeography',
            },
            range: {
              type: 'fakeRange',
              input: {
                end: {
                  input: '2020-12-31 12:00:00+08',
                  type: 'fakeDatetime',
                },
                start: {
                  input: '2020-10-01 12:00:00+08',
                  type: 'fakeDatetime',
                },
              },
              elementType: 'DATETIME',
            },
          },
        },
      ];

      const schemaObject = extend(true, SCHEMA_OBJECT, {});

      schemaObject.fields.push({
        name: 'arr',
        type: 'INTEGER',
        mode: 'REPEATED',
      });

      schemaObject.fields.push({
        name: 'arr2',
        type: 'INT64',
        mode: 'REPEATED',
      });

      schemaObject.fields.push({
        name: 'nullable',
        type: 'STRING',
        mode: 'NULLABLE',
      });

      schemaObject.fields.push({
        name: 'buffer',
        type: 'BYTES',
      });

      schemaObject.fields.push({
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
            ],
          },
        ],
      });

      schemaObject.fields.push({
        name: 'date',
        type: 'DATE',
      });

      schemaObject.fields.push({
        name: 'datetime',
        type: 'DATETIME',
      });

      schemaObject.fields.push({
        name: 'time',
        type: 'TIME',
      });

      schemaObject.fields.push({
        name: 'geography',
        type: 'GEOGRAPHY',
      });

      schemaObject.fields.push({
        name: 'range',
        type: 'RANGE',
        rangeElementType: {
          type: 'DATETIME',
        },
      });

      const rawRows = rows.map(x => x.raw);
      const mergedRows = BigQuery.mergeSchemaWithRows_(schemaObject, rawRows, {
        wrapIntegers: false,
      });

      mergedRows.forEach((mergedRow: {}, index: number) => {
        expect(mergedRow).toEqual(rows[index].expected);
      });
    });

    it('should parse uint64 timestamps with nanosecond precision', () => {
      const SCHEMA_OBJECT = {
        fields: [{name: 'ts', type: 'TIMESTAMP'}],
      } as {fields: TableField[]};

      jest.restoreAllMocks(); // restore BigQuery.timestamp call

      const rows = {
        raw: [
          {f: [{v: '-604800000000'}]}, // negative value
          {f: [{v: '0'}]}, // 0 value
          {f: [{v: '1000000'}]}, // 1 sec after epoch
          {f: [{v: '1712609904434123'}]}, // recent time
        ],
        expectedParsed: [
          {ts: BigQuery.timestamp('1969-12-25T00:00:00.000Z')},
          {ts: BigQuery.timestamp('1970-01-01T00:00:00Z')},
          {ts: BigQuery.timestamp('1970-01-01T00:00:01Z')},
          {ts: BigQuery.timestamp('2024-04-08T20:58:24.434123Z')},
        ],
      };

      const mergedRows = BigQuery.mergeSchemaWithRows_(
        SCHEMA_OBJECT,
        rows.raw,
        {},
      );
      mergedRows.forEach((mergedRow: {}, i: number) => {
        expect(mergedRow).toEqual(rows.expectedParsed[i]);
      });
    });

    it('should wrap integers with option', () => {
      const wrapIntegersBoolean = true;
      const wrapIntegersObject = {};
      const fakeInt = new BigQueryInt(100);

      const SCHEMA_OBJECT = {
        fields: [{name: 'fave_number', type: 'INTEGER'}],
      } as {fields: TableField[]};

      const rows = {
        raw: {
          f: [{v: 100}],
        },
        expectedBool: {
          fave_number: fakeInt,
        },
        expectedObj: {
          fave_number: fakeInt.valueOf(),
        },
      };

      jest.spyOn(BigQuery, 'int').mockReturnValue(fakeInt);

      let mergedRows = BigQuery.mergeSchemaWithRows_(SCHEMA_OBJECT, rows.raw, {
        wrapIntegers: wrapIntegersBoolean,
      });
      mergedRows.forEach((mergedRow: {}) => {
        expect(mergedRow).toEqual(rows.expectedBool);
      });

      mergedRows = BigQuery.mergeSchemaWithRows_(SCHEMA_OBJECT, rows.raw, {
        wrapIntegers: wrapIntegersObject,
      });
      mergedRows.forEach((mergedRow: {}) => {
        expect(mergedRow).toEqual(rows.expectedObj);
      });
    });

    it('should parse json with option', () => {
      const jsonValue = {name: 'John Doe'};

      const SCHEMA_OBJECT = {
        fields: [{name: 'json_field', type: 'JSON'}],
      } as {fields: TableField[]};

      const rows = {
        raw: {
          f: [{v: JSON.stringify(jsonValue)}],
        },
        expectedParsed: {
          json_field: jsonValue,
        },
        expectedRaw: {
          json_field: JSON.stringify(jsonValue),
        },
      };

      let mergedRows = BigQuery.mergeSchemaWithRows_(SCHEMA_OBJECT, rows.raw, {
        parseJSON: false,
      });
      mergedRows.forEach((mergedRow: {}) => {
        expect(mergedRow).toEqual(rows.expectedRaw);
      });

      mergedRows = BigQuery.mergeSchemaWithRows_(SCHEMA_OBJECT, rows.raw, {
        parseJSON: true,
      });
      mergedRows.forEach((mergedRow: {}) => {
        expect(mergedRow).toEqual(rows.expectedParsed);
      });
    });
  });

  describe('date', () => {
    const INPUT_STRING = '2017-1-1';
    const INPUT_OBJ = {
      year: 2017,
      month: 1,
      day: 1,
    };

    // tslint:disable-next-line ban
    it.skip('should expose static and instance constructors', () => {
      const staticD = BigQuery.date();
      expect(staticD instanceof BigQueryDate).toBe(true);
      expect(staticD instanceof bq.date).toBe(true);

      const instanceD = bq.date();
      expect(instanceD instanceof BigQueryDate).toBe(true);
      expect(instanceD instanceof bq.date).toBe(true);
    });

    it('should have the correct constructor name', () => {
      const date = bq.date(INPUT_STRING);
      expect(date.constructor.name).toBe('BigQueryDate');
    });

    it('should accept a string', () => {
      const date = bq.date(INPUT_STRING);
      expect(date.value).toBe(INPUT_STRING);
    });

    it('should accept an object', () => {
      const date = bq.date(INPUT_OBJ);
      expect(date.value).toBe(INPUT_STRING);
    });
  });

  describe('datetime', () => {
    const INPUT_STRING = '2017-1-1T14:2:38.883388Z';

    const INPUT_OBJ = {
      year: 2017,
      month: 1,
      day: 1,
      hours: 14,
      minutes: 2,
      seconds: 38,
      fractional: 883388,
    };

    const EXPECTED_VALUE = '2017-1-1 14:2:38.883388';

    // tslint:disable-next-line ban
    it.skip('should expose static and instance constructors', () => {
      const staticDt = BigQuery.datetime(INPUT_OBJ);
      expect(staticDt instanceof BigQuery.datetime).toBe(true);
      expect(staticDt instanceof bq.datetime).toBe(true);

      const instanceDt = bq.datetime(INPUT_OBJ);
      expect(instanceDt instanceof BigQuery.datetime).toBe(true);
      expect(instanceDt instanceof bq.datetime).toBe(true);
    });

    it('should have the correct constructor name', () => {
      const datetime = bq.datetime(INPUT_STRING);
      expect(datetime.constructor.name).toBe('BigQueryDatetime');
    });

    it('should accept an object', () => {
      const datetime = bq.datetime(INPUT_OBJ);
      expect(datetime.value).toBe(EXPECTED_VALUE);
    });

    it('should not include time if hours not provided', () => {
      const datetime = bq.datetime({
        year: 2016,
        month: 1,
        day: 1,
      });

      expect(datetime.value).toBe('2016-1-1');
    });

    it('should accept a string', () => {
      const datetime = bq.datetime(INPUT_STRING);
      expect(datetime.value).toBe(EXPECTED_VALUE);
    });
  });

  describe('time', () => {
    const INPUT_STRING = '14:2:38.883388';
    const INPUT_OBJ = {
      hours: 14,
      minutes: 2,
      seconds: 38,
      fractional: 883388,
    };

    // tslint:disable-next-line ban
    it.skip('should expose static and instance constructors', () => {
      const staticT = BigQuery.time();
      expect(staticT instanceof BigQuery.time).toBe(true);
      expect(staticT instanceof bq.time).toBe(true);

      const instanceT = bq.time();
      expect(instanceT instanceof BigQuery.time).toBe(true);
      expect(instanceT instanceof bq.time).toBe(true);
    });

    it('should have the correct constructor name', () => {
      const time = bq.time(INPUT_STRING);
      expect(time.constructor.name).toBe('BigQueryTime');
    });

    it('should accept a string', () => {
      const time = bq.time(INPUT_STRING);
      expect(time.value).toBe(INPUT_STRING);
    });

    it('should accept an object', () => {
      const time = bq.time(INPUT_OBJ);
      expect(time.value).toBe(INPUT_STRING);
    });

    it('should default minutes and seconds to 0', () => {
      const time = bq.time({
        hours: 14,
      });
      expect(time.value).toBe('14:0:0');
    });

    it('should not include fractional digits if not provided', () => {
      const input = Object.assign({}, INPUT_OBJ) as InputObject;
      delete input.fractional;

      const time = bq.time(input);
      expect(time.value).toBe('14:2:38');
    });
  });

  describe('timestamp', () => {
    const INPUT_STRING = '2016-12-06T12:00:00.000Z';
    const INPUT_STRING_MICROS = '2016-12-06T12:00:00.123456Z';
    const INPUT_DATE = new Date(INPUT_STRING);
    const INPUT_PRECISE_DATE = new PreciseDate(INPUT_STRING_MICROS);
    const EXPECTED_VALUE = INPUT_DATE.toJSON();
    const EXPECTED_VALUE_MICROS = INPUT_PRECISE_DATE.toISOString();

    // tslint:disable-next-line ban
    it.skip('should expose static and instance constructors', () => {
      const staticT = BigQuery.timestamp(INPUT_DATE);
      expect(staticT instanceof BigQuery.timestamp).toBe(true);
      expect(staticT instanceof bq.timestamp).toBe(true);

      const instanceT = bq.timestamp(INPUT_DATE);
      expect(instanceT instanceof BigQuery.timestamp).toBe(true);
      expect(instanceT instanceof bq.timestamp).toBe(true);
    });

    it('should have the correct constructor name', () => {
      const timestamp = bq.timestamp(INPUT_STRING);
      expect(timestamp.constructor.name).toBe('BigQueryTimestamp');
    });

    it('should accept a NaN', () => {
      const timestamp = bq.timestamp(NaN);
      expect(timestamp.value).toBe(null);
    });

    it('should accept a string', () => {
      const timestamp = bq.timestamp(INPUT_STRING);
      expect(timestamp.value).toBe(EXPECTED_VALUE);
    });

    it('should accept a string with microseconds', () => {
      const timestamp = bq.timestamp(INPUT_STRING_MICROS);
      expect(timestamp.value).toBe(EXPECTED_VALUE_MICROS);
    });

    it('should accept a float number', () => {
      const d = new Date();
      const f = d.valueOf() / 1000; // float seconds
      let timestamp = bq.timestamp(f);
      expect(timestamp.value).toBe(d.toJSON());

      timestamp = bq.timestamp(f.toString());
      expect(timestamp.value).toBe(d.toJSON());
    });

    it('should accept a Date object', () => {
      const timestamp = bq.timestamp(INPUT_DATE);
      expect(timestamp.value).toBe(EXPECTED_VALUE);
    });

    it('should accept a PreciseDate object', () => {
      const timestamp = bq.timestamp(INPUT_PRECISE_DATE);
      expect(timestamp.value).toBe(EXPECTED_VALUE_MICROS);
    });
  });

  describe('range', () => {
    const INPUT_DATE_RANGE = '[2020-01-01, 2020-12-31)';
    const INPUT_DATETIME_RANGE = '[2020-01-01 12:00:00, 2020-12-31 12:00:00)';
    const INPUT_TIMESTAMP_RANGE =
      '[2020-10-01 12:00:00+08, 2020-12-31 12:00:00+08)';

    it('should have the correct constructor name', () => {
      const range = bq.range(INPUT_DATE_RANGE, 'DATE');
      expect(range.constructor.name).toBe('BigQueryRange');
    });

    it('should accept a string literal', () => {
      const dateRange = bq.range(INPUT_DATE_RANGE, 'DATE');
      expect(dateRange.apiValue).toBe('[2020-01-01, 2020-12-31)');
      expect(dateRange.literalValue).toBe('RANGE<DATE> [2020-01-01, 2020-12-31)');
      expect(dateRange.value).toEqual({
        start: '2020-01-01',
        end: '2020-12-31',
      });

      const datetimeRange = bq.range(INPUT_DATETIME_RANGE, 'DATETIME');
      expect(datetimeRange.apiValue).toBe('[2020-01-01 12:00:00, 2020-12-31 12:00:00)');
      expect(datetimeRange.literalValue).toBe('RANGE<DATETIME> [2020-01-01 12:00:00, 2020-12-31 12:00:00)');
      expect(datetimeRange.value).toEqual({
        start: '2020-01-01 12:00:00',
        end: '2020-12-31 12:00:00',
      });

      const timestampRange = bq.range(INPUT_TIMESTAMP_RANGE, 'TIMESTAMP');
      expect(timestampRange.apiValue).toBe('[2020-10-01T04:00:00.000Z, 2020-12-31T04:00:00.000Z)');
      expect(timestampRange.literalValue).toBe('RANGE<TIMESTAMP> [2020-10-01T04:00:00.000Z, 2020-12-31T04:00:00.000Z)');
      expect(timestampRange.value).toEqual({
        start: '2020-10-01T04:00:00.000Z',
        end: '2020-12-31T04:00:00.000Z',
      });
    });

    it('should accept a BigQueryDate|BigQueryDatetime|BigQueryTimestamp objects', () => {
      const dateRange = bq.range({
        start: bq.date('2020-01-01'),
        end: bq.date('2020-12-31'),
      });
      expect(dateRange.apiValue).toBe(INPUT_DATE_RANGE);
      expect(dateRange.literalValue).toBe(`RANGE<DATE> ${INPUT_DATE_RANGE}`);
      expect(dateRange.elementType).toBe('DATE');
      expect(dateRange.value).toEqual({
        start: '2020-01-01',
        end: '2020-12-31',
      });

      const datetimeRange = bq.range({
        start: bq.datetime('2020-01-01 12:00:00'),
        end: bq.datetime('2020-12-31 12:00:00'),
      });
      expect(datetimeRange.apiValue).toBe(INPUT_DATETIME_RANGE);
      expect(datetimeRange.literalValue).toBe(`RANGE<DATETIME> ${INPUT_DATETIME_RANGE}`);
      expect(datetimeRange.elementType).toBe('DATETIME');
      expect(datetimeRange.value).toEqual({
        start: '2020-01-01 12:00:00',
        end: '2020-12-31 12:00:00',
      });

      const timestampRange = bq.range({
        start: bq.timestamp('2020-10-01 12:00:00+08'),
        end: bq.timestamp('2020-12-31 12:00:00+08'),
      });
      expect(timestampRange.apiValue).toBe('[2020-10-01T04:00:00.000Z, 2020-12-31T04:00:00.000Z)');
      expect(timestampRange.literalValue).toBe('RANGE<TIMESTAMP> [2020-10-01T04:00:00.000Z, 2020-12-31T04:00:00.000Z)');
      expect(timestampRange.elementType).toBe('TIMESTAMP');
      expect(timestampRange.value).toEqual({
        start: '2020-10-01T04:00:00.000Z',
        end: '2020-12-31T04:00:00.000Z',
      });
    });

    it('should accept a start/end as string with element type', () => {
      const dateRange = bq.range(
        {
          start: '2020-01-01',
          end: '2020-12-31',
        },
        'DATE',
      );
      expect(dateRange.apiValue).toBe(INPUT_DATE_RANGE);
      expect(dateRange.literalValue).toBe(`RANGE<DATE> ${INPUT_DATE_RANGE}`);
      expect(dateRange.elementType).toBe('DATE');

      const datetimeRange = bq.range(
        {
          start: '2020-01-01 12:00:00',
          end: '2020-12-31 12:00:00',
        },
        'DATETIME',
      );
      expect(datetimeRange.apiValue).toBe(INPUT_DATETIME_RANGE);
      expect(datetimeRange.literalValue).toBe(`RANGE<DATETIME> ${INPUT_DATETIME_RANGE}`);
      expect(datetimeRange.elementType).toBe('DATETIME');

      const timestampRange = bq.range(
        {
          start: '2020-10-01 12:00:00+08',
          end: '2020-12-31 12:00:00+08',
        },
        'TIMESTAMP',
      );
      expect(timestampRange.apiValue).toBe('[2020-10-01T04:00:00.000Z, 2020-12-31T04:00:00.000Z)');
      expect(timestampRange.literalValue).toBe('RANGE<TIMESTAMP> [2020-10-01T04:00:00.000Z, 2020-12-31T04:00:00.000Z)');
      expect(timestampRange.elementType).toBe('TIMESTAMP');
    });

    it('should accept a Range with start and/or end missing', () => {
      const dateRange = bq.range(
        {
          start: '2020-01-01',
        },
        'DATE',
      );
      expect(dateRange.literalValue).toBe('RANGE<DATE> [2020-01-01, UNBOUNDED)');

      const datetimeRange = bq.range(
        {
          end: '2020-12-31 12:00:00',
        },
        'DATETIME',
      );
      expect(datetimeRange.literalValue).toBe('RANGE<DATETIME> [UNBOUNDED, 2020-12-31 12:00:00)');

      const timestampRange = bq.range({}, 'TIMESTAMP');
      expect(timestampRange.literalValue).toBe('RANGE<TIMESTAMP> [UNBOUNDED, UNBOUNDED)');
    });
  });

  describe('geography', () => {
    const INPUT_STRING = 'POINT(1 2)';

    it('should have the correct constructor name', () => {
      const geography = BigQuery.geography(INPUT_STRING);
      expect(geography.constructor.name).toBe('Geography');
    });

    it('should accept a string', () => {
      const geography = BigQuery.geography(INPUT_STRING);
      expect(geography.value).toBe(INPUT_STRING);
    });

    it('should call through to the static method', () => {
      const fakeGeography = {value: 'foo'};

      jest
        .spyOn(BigQuery, 'geography')
        .mockImplementation((input: any) => input === INPUT_STRING ? fakeGeography as any : undefined as any);

      const geography = bq.geography(INPUT_STRING);
      expect(geography).toBe(fakeGeography);
    });
  });

  describe('int', () => {
    const INPUT_STRING = '100';

    it('should call through to the static method', () => {
      const fakeInt = new BigQueryInt(INPUT_STRING);

      jest
        .spyOn(BigQuery, 'int')
        .mockImplementation((input: any) =>
          input === INPUT_STRING ? (fakeInt as any) : (undefined as any),
        );

      const int = bq.int(INPUT_STRING);
      expect(int).toBe(fakeInt);
    });

    it('should have the correct constructor name', () => {
      const int = BigQuery.int(INPUT_STRING);
      expect(int.constructor.name).toBe('BigQueryInt');
    });
  });

  describe('BigQueryInt', () => {
    it('should store the stringified value', () => {
      const INPUT_NUM = 100;
      const int = new BigQueryInt(INPUT_NUM);
      expect(int.value).toBe(INPUT_NUM.toString());
    });

    describe('valueOf', () => {
      let valueObject: IntegerTypeCastValue;

      beforeEach(() => {
        valueObject = {
          integerValue: 8,
        };
      });

      describe('integerTypeCastFunction is not provided', () => {
        const expectedError = (opts: {
          integerValue: string | number;
          schemaFieldName?: string;
        }) => {
          return new Error(
            'We attempted to return all of the numeric values, but ' +
              (opts.schemaFieldName ? opts.schemaFieldName + ' ' : '') +
              'value ' +
              opts.integerValue +
              " is out of bounds of 'Number.MAX_SAFE_INTEGER'.\n" +
              "To prevent this error, please consider passing 'options.wrapIntegers' as\n" +
              '{\n' +
              '  integerTypeCastFunction: provide <your_custom_function>\n' +
              '  fields: optionally specify field name(s) to be custom casted\n' +
              '}\n',
          );
        };

        it('should throw if integerTypeCastOptions is provided but integerTypeCastFunction is not', () => {
          expect(() =>
              new BigQueryInt(
                valueObject,
                {} as IntegerTypeCastOptions,
              ).valueOf()).toThrow(/integerTypeCastFunction is not a function or was not provided\./);
        });

        it('should throw if integer value is outside of bounds passing objects', () => {
          const largeIntegerValue = (Number.MAX_SAFE_INTEGER + 1).toString();
          const smallIntegerValue = (Number.MIN_SAFE_INTEGER - 1).toString();

          const valueObject = {
            integerValue: largeIntegerValue,
            schemaFieldName: 'field',
          };

          const valueObject2 = {
            integerValue: smallIntegerValue,
            schemaFieldName: 'field',
          };

          expect(() => {
            new BigQueryInt(valueObject).valueOf();
          }).toThrow(expectedError(valueObject));

          expect(() => {
            new BigQueryInt(valueObject2).valueOf();
          }).toThrow(expectedError(valueObject2));
        });

        it('should throw if integer value is outside of bounds passing strings or Numbers', () => {
          const largeIntegerValue = Number.MAX_SAFE_INTEGER + 1;
          const smallIntegerValue = Number.MIN_SAFE_INTEGER - 1;

          // should throw when Number is passed
          expect(() => {
              new BigQueryInt(largeIntegerValue).valueOf();
            }).toThrow(expectedError({integerValue: largeIntegerValue}));

          // should throw when string is passed
          expect(() => {
              new BigQueryInt(smallIntegerValue.toString()).valueOf();
            }).toThrow(expectedError({integerValue: smallIntegerValue}));
        });

        it('should not auto throw on initialization', () => {
          const largeIntegerValue = Number.MAX_SAFE_INTEGER + 1;

          const valueObject = {
            integerValue: largeIntegerValue,
          };

          expect(() => {
            new BigQueryInt(valueObject);
          }).not.toThrow();
        });

        describe('integerTypeCastFunction is provided', () => {
          it('should throw if integerTypeCastFunction is not a function', () => {
            expect(() =>
                new BigQueryInt(valueObject, {
                  integerTypeCastFunction: {} as Function,
                }).valueOf()).toThrow(/integerTypeCastFunction is not a function or was not provided\./);
          });

          it('should custom-cast value when integerTypeCastFunction is provided', () => {
            const stub = jest.fn();

            new BigQueryInt(valueObject, {
              integerTypeCastFunction: stub,
            }).valueOf();
            expect(stub).toHaveBeenCalledTimes(1);
          });

          it('should custom-cast value if in `fields` specified by user', () => {
            const stub = jest.fn();

            Object.assign(valueObject, {
              schemaFieldName: 'funField',
            });

            new BigQueryInt(valueObject, {
              integerTypeCastFunction: stub,
              fields: 'funField',
            }).valueOf();
            expect(stub).toHaveBeenCalledTimes(1);
          });

          it('should not custom-cast value if not in `fields` specified by user', () => {
            const stub = jest.fn();

            Object.assign(valueObject, {
              schemaFieldName: 'funField',
            });

            new BigQueryInt(valueObject, {
              integerTypeCastFunction: stub,
              fields: 'unFunField',
            }).valueOf();
            expect(stub).not.toHaveBeenCalled();
          });

          it('should catch integerTypeCastFunction error and throw', () => {
            const error = new Error('My bad!');
            const stub = jest.fn(() => { throw error; });
            expect(() =>
                new BigQueryInt(valueObject, {
                  integerTypeCastFunction: stub,
                }).valueOf()).toThrow(/integerTypeCastFunction threw an error:/);
          });
        });
      });

      describe('toJSON', () => {
        it('should return correct JSON', () => {
          const expected = {type: 'BigQueryInt', value: '8'};
          const JSON = new BigQueryInt(valueObject).toJSON();
          expect(JSON).toEqual(expected);
        });
      });
    });
  });

  describe('getTypeDescriptorFromValue_', () => {
    it('should return correct types', () => {
      expect(BigQuery.getTypeDescriptorFromValue_(bq.date()).type).toBe('DATE');
      expect(BigQuery.getTypeDescriptorFromValue_(bq.datetime('')).type).toBe('DATETIME');
      expect(BigQuery.getTypeDescriptorFromValue_(bq.time()).type).toBe('TIME');
      expect(BigQuery.getTypeDescriptorFromValue_(bq.timestamp(0)).type).toBe('TIMESTAMP');
      expect(BigQuery.getTypeDescriptorFromValue_(Buffer.alloc(2)).type).toBe('BYTES');
      expect(BigQuery.getTypeDescriptorFromValue_(true).type).toBe('BOOL');
      expect(BigQuery.getTypeDescriptorFromValue_(8).type).toBe('INT64');
      expect(BigQuery.getTypeDescriptorFromValue_(8.1).type).toBe('FLOAT64');
      expect(BigQuery.getTypeDescriptorFromValue_('hi').type).toBe('STRING');
      expect(BigQuery.getTypeDescriptorFromValue_(new Big('1.1')).type).toBe('NUMERIC');
      expect(BigQuery.getTypeDescriptorFromValue_(
          new Big('1999.9876543210123456789'),
        ).type).toBe('BIGNUMERIC');
      expect(BigQuery.getTypeDescriptorFromValue_(bq.int('100')).type).toBe('INT64');
      expect(BigQuery.getTypeDescriptorFromValue_(bq.geography('POINT (1 1')).type).toBe('GEOGRAPHY');
      expect(BigQuery.getTypeDescriptorFromValue_(
          bq.range(
            '[2020-10-01 12:00:00+08, 2020-12-31 12:00:00+08)',
            'TIMESTAMP',
          ),
        ).type).toBe('RANGE');
    });

    it('should return correct type for an array', () => {
      const type = BigQuery.getTypeDescriptorFromValue_([1]);

      expect(type).toEqual({
        type: 'ARRAY',
        arrayType: {
          type: 'INT64',
        },
      });
    });

    it('should return correct type for a struct', () => {
      const type = BigQuery.getTypeDescriptorFromValue_({prop: 1});

      expect(type).toEqual({
        type: 'STRUCT',
        structTypes: [
          {
            name: 'prop',
            type: {
              type: 'INT64',
            },
          },
        ],
      });
    });

    it('should throw if a type cannot be detected', () => {
      const expectedError = new RegExp(
        [
          'This value could not be translated to a BigQuery data type.',
          undefined,
        ].join('\n'),
      );

      expect(() => {
        BigQuery.getTypeDescriptorFromValue_(undefined);
      }).toThrow(expectedError);
    });

    it('should throw with an empty array', () => {
      expect(() => {
        BigQuery.getTypeDescriptorFromValue_([]);
      }).toThrow(/Parameter types must be provided for empty arrays via the 'types' field in query options./);
    });

    it('should throw with a null value', () => {
      const expectedError = new RegExp(
        "Parameter types must be provided for null values via the 'types' field in query options.",
      );

      expect(() => {
        BigQuery.getTypeDescriptorFromValue_(null);
      }).toThrow(expectedError);
    });
  });

  describe('getTypeDescriptorFromProvidedType_', () => {
    it('should return correct type for an array', () => {
      const type = BigQuery.getTypeDescriptorFromProvidedType_(['INT64']);

      expect(type).toEqual({
        type: 'ARRAY',
        arrayType: {
          type: 'INT64',
        },
      });
    });

    it('should return correct type for a struct', () => {
      const type = BigQuery.getTypeDescriptorFromProvidedType_({prop: 'INT64'});

      expect(type).toEqual({
        type: 'STRUCT',
        structTypes: [
          {
            name: 'prop',
            type: {
              type: 'INT64',
            },
          },
        ],
      });
    });

    it('should throw for invalid provided type', () => {
      const INVALID_TYPE = 'invalid';

      expect(() => {
        BigQuery.getTypeDescriptorFromProvidedType_(INVALID_TYPE);
      }).toThrow(/Invalid type provided:/);
    });
  });

  describe('valueToQueryParameter_', () => {
    it('should get the type', done => {
      const value = {};

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockImplementation((value_: any) => {
          expect(value_).toBe(value);
          setImmediate(done);
          return {
            type: '',
          };
        });

      const queryParameter = BigQuery.valueToQueryParameter_(value);
      expect(queryParameter.parameterValue.value).toBe(value);
    });

    it('should get the provided type', done => {
      const value = {};
      const providedType = 'STRUCT';

      jest.spyOn(BigQuery, 'getTypeDescriptorFromProvidedType_').mockImplementation((providedType_: any) => {
          expect(providedType_).toBe(providedType);
          setImmediate(done);
          return {
            type: '',
          };
        });

      const queryParameter = BigQuery.valueToQueryParameter_(
        value,
        providedType,
      );

      expect(queryParameter.parameterValue.value).toBe(value);
    });

    it('should format a Date', () => {
      const date = new Date();
      const expectedValue = date.toJSON().replace(/(.*)T(.*)Z$/, '$1 $2');

      jest.spyOn(BigQuery, 'timestamp').mockImplementation((value: any) => {
        expect(value).toBe(date);
        return {
          value: expectedValue,
        };
      });

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'TIMESTAMP',
      });

      const queryParameter = BigQuery.valueToQueryParameter_(date);
      expect(queryParameter.parameterValue.value).toBe(expectedValue);
    });

    it('should locate the value on DATETIME objects', () => {
      const datetime = {
        value: 'value',
      };

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'DATETIME',
      });

      const queryParameter = BigQuery.valueToQueryParameter_(datetime);
      expect(queryParameter.parameterValue.value).toBe(datetime.value);
    });

    it('should locate the value on nested DATETIME objects', () => {
      const datetimes = [
        {
          value: 'value',
        },
      ];

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'ARRAY',
        arrayType: {type: 'DATETIME'},
      });

      const {parameterValue} = BigQuery.valueToQueryParameter_(datetimes);
      expect(parameterValue.arrayValues).toEqual(datetimes);
    });

    it('should locate the value on TIME objects', () => {
      const time = {
        value: 'value',
      };

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'TIME',
      });

      const queryParameter = BigQuery.valueToQueryParameter_(time);
      expect(queryParameter.parameterValue.value).toBe(time.value);
    });

    it('should locate the value on nested TIME objects', () => {
      const times = [
        {
          value: 'value',
        },
      ];

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'ARRAY',
        arrayType: {type: 'TIME'},
      });

      const {parameterValue} = BigQuery.valueToQueryParameter_(times);
      expect(parameterValue.arrayValues).toEqual(times);
    });

    it('should locate the value on BigQueryInt objects', () => {
      const int = new BigQueryInt(100);

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'INT64',
      });

      const queryParameter = BigQuery.valueToQueryParameter_(int);
      expect(queryParameter.parameterValue.value).toBe(int.value);
    });

    it('should locate the value on nested BigQueryInt objects', () => {
      const ints = [new BigQueryInt('100')];
      const expected = [{value: '100'}];

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'ARRAY',
        arrayType: {type: 'INT64'},
      });

      const {parameterValue} = BigQuery.valueToQueryParameter_(ints);
      expect(parameterValue.arrayValues).toEqual(expected);
    });

    it('should format an array', () => {
      const array = [1];

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: 'ARRAY',
        arrayType: {type: 'INT64'},
      });

      const queryParameter = BigQuery.valueToQueryParameter_(array);
      const arrayValues = queryParameter.parameterValue.arrayValues;
      expect(arrayValues).toEqual([
        {
          value: array[0],
        },
      ]);
    });

    it('should format an array with provided type', () => {
      const array = [[1]];
      const providedType = [['INT64']];

      jest.spyOn(BigQuery, 'getTypeDescriptorFromProvidedType_').mockReturnValue({
        type: 'ARRAY',
        arrayType: {
          type: 'ARRAY',
          arrayType: {type: 'INT64'},
        },
      });

      const queryParameter = BigQuery.valueToQueryParameter_(
        array,
        providedType,
      );
      const arrayValues = queryParameter.parameterValue.arrayValues;
      expect(arrayValues).toEqual([
        {
          arrayValues: [
            {
              value: array[0][0],
            },
          ],
        },
      ]);
    });

    it('should format a struct', () => {
      const struct = {
        key: 'value',
      };

      const expectedParameterValue = {};

      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockImplementation(() => {
        jest.spyOn(BigQuery, 'valueToQueryParameter_').mockImplementation((value: any) => {
          expect(value).toBe(struct.key);
          return {
            parameterValue: expectedParameterValue,
          };
        });

        return {
          type: 'STRUCT',
        };
      });

      const queryParameter = BigQuery.valueToQueryParameter_(struct);
      const structValues = queryParameter.parameterValue.structValues;

      expect(structValues.key).toBe(expectedParameterValue);
    });

    it('should format a struct with provided type', () => {
      const struct = {a: 1};
      const providedType = {a: 'INT64'};

      const getTypeStub = jest.spyOn(
        BigQuery,
        'getTypeDescriptorFromProvidedType_',
      );
      getTypeStub.mockReturnValueOnce({
        type: 'STRUCT',
        structTypes: [
          {
            name: 'a',
            type: {
              type: 'INT64',
            },
          },
        ],
      });
      getTypeStub.mockReturnValueOnce({type: 'INT64'});

      const queryParameter = BigQuery.valueToQueryParameter_(
        struct,
        providedType,
      );
      const structValues = queryParameter.parameterValue.structValues;
      expect(structValues).toEqual({
        a: {
          value: 1,
        },
      });
    });

    it('should format an array of structs', () => {
      const structs = [{name: 'Stephen'}];
      const expectedParam = {
        parameterType: {
          type: 'ARRAY',
          arrayType: {
            type: 'STRUCT',
            structTypes: [{name: 'name', type: {type: 'STRING'}}],
          },
        },
        parameterValue: {
          arrayValues: [
            {
              structValues: {
                name: {value: 'Stephen'},
              },
            },
          ],
        },
      };

      const param = BigQuery.valueToQueryParameter_(structs);
      expect(param).toEqual(expectedParam);
    });

    it('should format JSON types', () => {
      const typeName = 'JSON';
      const value = {
        foo: 'bar',
      };
      const strValue = JSON.stringify(value);
      expect(BigQuery.valueToQueryParameter_(value, typeName)).toEqual({
        parameterType: {
          type: typeName,
        },
        parameterValue: {
          value: strValue,
        },
      });
      expect(BigQuery.valueToQueryParameter_(strValue, typeName)).toEqual({
          parameterType: {
            type: typeName,
          },
          parameterValue: {
            value: strValue,
          },
        });
    });

    it('should format all other types', () => {
      const typeName = 'ANY-TYPE';
      jest.spyOn(BigQuery, 'getTypeDescriptorFromValue_').mockReturnValue({
        type: typeName,
      });
      expect(BigQuery.valueToQueryParameter_(8)).toEqual({
        parameterType: {
          type: typeName,
        },
        parameterValue: {
          value: 8,
        },
      });
    });

    describe('_getValue', () => {
      it('should return currect value', () => {
        const value = 'VALUE';
        const type = 'TYPE';

        jest.spyOn(BigQuery, '_isCustomType').mockReturnValue(false);
        expect(BigQuery._getValue(value, type)).toBe(value);
      });

      it('should return value of custom type', () => {
        const geography = bq.geography('POINT (1 1)');

        jest.spyOn(BigQuery, '_isCustomType').mockReturnValue(true);
        expect(BigQuery._getValue(geography, geography.type)).toBe(geography.value);
      });

      it('should handle null values', () => {
        const value = null;
        const type = 'TYPE';

        expect(BigQuery._getValue(value, type)).toBe(value);
      });
    });

    describe('_isCustomType', () => {
      it('should identify custom types', () => {
        const time = {type: 'TIME'};
        const date = {type: 'DATE'};
        const geo = {type: 'GEOGRAPHY'};
        const range = {type: 'RANGE'};

        expect(BigQuery._isCustomType(time)).toBe(true);
        expect(BigQuery._isCustomType(date)).toBe(true);
        expect(BigQuery._isCustomType(geo)).toBe(true);
        expect(BigQuery._isCustomType(range)).toBe(true);
      });
    });
  });

  describe('createDataset', () => {
    const DATASET_ID = 'kittens';

    it('should create a dataset', done => {
      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.uri).toBe('/datasets');
        expect(reqOpts.json.datasetReference).toEqual({
          datasetId: DATASET_ID,
        });

        done();
      };

      bq.createDataset(DATASET_ID, (err: any) => { if (err) done(err); });
    });

    it('should create a dataset on a different project', done => {
      bq.makeAuthenticatedRequest = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.projectId).toBe(ANOTHER_PROJECT_ID);
        expect(reqOpts.uri).toBe(`https://bigquery.googleapis.com/bigquery/v2/projects/${ANOTHER_PROJECT_ID}/datasets`);
        expect(reqOpts.json.datasetReference).toEqual({
          datasetId: DATASET_ID,
        });

        done();
      };

      bq.createDataset(
        DATASET_ID,
        {
          projectId: ANOTHER_PROJECT_ID,
        },
        (err: any) => { if (err) done(err); },
      );
    });

    it('should send the location if available', done => {
      const bq = new BigQuery({
        projectId: PROJECT_ID,
        location: LOCATION,
      });

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.location).toBe(LOCATION);
        done();
      };

      bq.createDataset(DATASET_ID, (err: any) => { if (err) done(err); });
    });

    it('should not modify the original options object', done => {
      const options = {
        a: 'b',
        c: 'd',
      };

      const originalOptions = Object.assign({}, options);

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json).not.toBe(options);
        expect(options).toEqual(originalOptions);
        done();
      };

      bq.createDataset(DATASET_ID, options, (err: any) => { if (err) done(err); });
    });

    it('should return an error to the callback', done => {
      const error = new Error('Error.');

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      bq.createDataset(DATASET_ID, (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return a Dataset object', done => {
      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {});
      };

      bq.createDataset(DATASET_ID, (err: Error, dataset: Dataset) => {
        expect(err).toBeFalsy();
        expect(dataset instanceof Dataset).toBe(true);
        done();
      });
    });

    it('should return an apiResponse', done => {
      const resp = {success: true};

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, resp);
      };

      bq.createDataset(
        DATASET_ID,
        (err: Error, dataset: Dataset, apiResponse: {}) => {
          expect(err).toBeFalsy();
          expect(apiResponse).toEqual(resp);
          done();
        },
      );
    });

    it('should assign metadata to the Dataset object', done => {
      const metadata = {a: 'b', c: 'd'};

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, metadata);
      };

      bq.createDataset(DATASET_ID, (err: Error, dataset: Dataset) => {
        expect(err).toBeFalsy();
        expect(dataset.metadata).toEqual(metadata);
        done();
      });
    });
  });

  describe('createJob', () => {
    const RESPONSE = {
      status: {
        state: 'RUNNING',
      },
      jobReference: {
        location: LOCATION,
      },
    };

    let fakeJobId: string;

    beforeEach(() => {
      fakeJobId = crypto.randomUUID();

      jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue(fakeJobId as crypto.UUID);
    });

    it('should make the correct request', done => {
      const fakeOptions = {
        a: 'b',
      };

      const expectedOptions = Object.assign({}, fakeOptions, {
        jobReference: {
          projectId: bq.projectId,
          jobId: fakeJobId,
          location: undefined,
        },
      });

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.uri).toBe('/jobs');
        expect(reqOpts.json).toEqual(expectedOptions);
        expect(reqOpts.json).not.toBe(fakeOptions);
        done();
      };

      bq.createJob(fakeOptions, (err: any) => { if (err) done(err); });
    });

    it('should accept a job prefix', done => {
      const jobPrefix = 'abc-';
      const expectedJobId = jobPrefix + fakeJobId;
      const options = {
        jobPrefix,
      };

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.jobReference.jobId).toBe(expectedJobId);
        expect(reqOpts.json.jobPrefix).toBe(undefined);
        done();
      };

      bq.createJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept a location', done => {
      const options = {
        location: LOCATION,
      };

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.jobReference.location).toBe(LOCATION);
        expect(reqOpts.json.location).toBe(undefined);
        done();
      };

      bq.createJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept a job id', done => {
      const jobId = 'job-id';
      const options = {jobId};

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.jobReference.jobId).toBe(jobId);
        expect(reqOpts.json.jobId).toBe(undefined);
        done();
      };

      bq.createJob(options, (err: any) => { if (err) done(err); });
    });

    it('should use the user defined location if available', done => {
      const bq = new BigQuery({
        projectId: PROJECT_ID,
        location: LOCATION,
      });

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.jobReference.location).toBe(LOCATION);
        done();
      };

      bq.createJob({}, (err: any) => { if (err) done(err); });
    });

    it('should return a non-409 request error', done => {
      const response = {};
      const error = new Error('err.');

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error, response);
      };

      bq.createJob({}, (err: Error, job: Job, resp: {}) => {
        expect(err).toBe(error);
        expect(job).toBe(null);
        expect(resp).toBe(response);
        done();
      });
    });

    it('should refresh metadata when API returns 409', done => {
      bq.job = () => {
        return {
          getMetadata: async () => [RESPONSE],
        };
      };

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        const error = new util.ApiError('Error.');
        error.code = 409;
        callback(error);
      };

      bq.createJob({}, (err: Error, job: Job, resp: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(RESPONSE);
        done();
      });
    });

    it('should return 409 if the user provided the job ID', done => {
      const error = new util.ApiError('Error.');
      error.code = 409;

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      bq.createJob({jobId: 'job-id'}, (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return 409 if dryRun is true', done => {
      const error = new util.ApiError('Error.');
      error.code = 409;

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      bq.createJob({configuration: {dryRun: true}}, (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return any status errors', done => {
      const errors = [{reason: 'notFound'}];
      const response = extend(true, {}, RESPONSE, {
        status: {errors},
      });

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, response);
      };

      bq.createJob({}, (err: any) => {
        expect(err instanceof util.ApiError).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorOpts: any = err.calledWith_[0];
        expect(errorOpts.errors).toEqual(errors);
        expect(errorOpts.response).toBe(response);
        done();
      });
    });

    it('should return a job object', done => {
      const fakeJob = {};

      bq.job = (jobId: string, options: JobOptions) => {
        expect(jobId).toBe(fakeJobId);
        expect(options.location).toBe(LOCATION);
        return fakeJob;
      };

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, RESPONSE);
      };

      bq.createJob({location: LOCATION}, (err: Error, job: Job, resp: {}) => {
        expect(err).toBeFalsy();
        expect(job).toBe(fakeJob);
        expect(job.metadata).toBe(RESPONSE);
        expect(resp).toBe(RESPONSE);
        done();
      });
    });

    it('should update the job location in the official API format', done => {
      const fakeJob: {location?: string} = {};

      bq.job = () => {
        return fakeJob;
      };

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, RESPONSE);
      };

      bq.createJob({}, (err: Error) => {
        expect(err).toBeFalsy();
        expect(fakeJob.location).toBe(LOCATION);
        done();
      });
    });
  });

  describe('createQueryJob', () => {
    const QUERY_STRING = 'SELECT * FROM [dataset.table]';

    it('should throw if neither a query or a pageToken is provided', () => {
      expect(() => {
        bq.createQueryJob(undefined, util.noop);
      }).toThrow(/SQL query string is required/);

      expect(() => {
        bq.createQueryJob({noQuery: 'here'}, util.noop);
      }).toThrow(/SQL query string is required/);

      expect(() => {
        bq.createQueryJob({pageToken: 'NEXT_PAGE_TOKEN'}, util.noop);
      }).not.toThrow();
    });

    describe('with destination', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let dataset: any;
      const TABLE_ID = 'table-id';

      beforeEach(() => {
        dataset = {
          bigQuery: bq,
          id: 'dataset-id',
          createTable: util.noop,
        };
      });

      it('should throw if a destination is not a table', () => {
        expect(() => {
          bq.createQueryJob(
            {
              query: 'query',
              destination: 'not a table',
            },
            util.noop,
          );
        }).toThrow(/Destination must be a Table/);
      });

      it('should assign destination table to request body', done => {
        bq.request = (reqOpts: DecorateRequestOptions) => {
          expect(reqOpts.json.configuration.query.destinationTable).toEqual({
            datasetId: dataset.id,
            projectId: dataset.projectId,
            tableId: TABLE_ID,
          });

          done();
        };

        bq.createQueryJob(
          {
            query: 'query',
            destination: new Table(dataset, TABLE_ID),
          },
          (err: any) => {
            if (err) done(err);
          },
        );
      });

      it('should delete `destination` prop from request body', done => {
        bq.request = (reqOpts: DecorateRequestOptions) => {
          const body = reqOpts.json;
          expect(body.configuration.query.destination).toBe(undefined);
          done();
        };

        bq.createQueryJob(
          {
            query: 'query',
            destination: new Table(dataset, TABLE_ID),
          },
          (err: any) => {
            if (err) done(err);
          },
        );
      });
    });

    describe('SQL parameters', () => {
      const NAMED_PARAMS = {
        key: 'value',
      };

      const POSITIONAL_PARAMS = ['value'];

      const NAMED_TYPES = {key: 'STRING'};

      const POSITIONAL_TYPES = ['STRING'];

      it('should delete the params option', done => {
        bq.createJob = (reqOpts: JobOptions) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((reqOpts as any).params).toBe(undefined);
          done();
        };

        bq.createQueryJob(
          {
            query: QUERY_STRING,
            params: NAMED_PARAMS,
          },
          (err: any) => { if (err) done(err); },
        );
      });

      it('should not modify queryParameters if params is not informed', done => {
        bq.createJob = (reqOpts: JobOptions) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((reqOpts as any).params).toBe(undefined);
          expect(reqOpts.configuration?.query?.queryParameters).toEqual(NAMED_PARAMS);
          done();
        };

        bq.createQueryJob(
          {
            query: QUERY_STRING,
            queryParameters: NAMED_PARAMS,
          },
          (err: any) => { if (err) done(err); },
        );
      });

      describe('named', () => {
        it('should set the correct parameter mode', done => {
          bq.createJob = (reqOpts: JobOptions) => {
            const query = reqOpts.configuration!.query!;
            expect(query.parameterMode).toBe('named');
            done();
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: NAMED_PARAMS,
            },
            (err: any) => { if (err) done(err); },
          );
        });

        it('should set the correct query parameters', done => {
          const queryParameter = {};

          jest.spyOn(BigQuery, 'valueToQueryParameter_').mockImplementation((value: any) => {
            expect(value).toBe(NAMED_PARAMS.key);
            return queryParameter;
          });

          bq.createJob = (reqOpts: JobOptions) => {
            const query = reqOpts.configuration!.query!;
            expect(query.queryParameters![0]).toBe(queryParameter);
            expect(query.queryParameters![0].name).toBe('key');
            done();
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: NAMED_PARAMS,
            },
            (err: any) => { if (err) done(err); },
          );
        });

        it('should allow for optional parameter types', () => {
          const queryParameter = {};

          jest.spyOn(BigQuery,
            'valueToQueryParameter_').mockImplementation((value: any, providedType: any) => {
              expect(value).toBe(NAMED_PARAMS.key);
              expect(providedType).toBe(NAMED_TYPES.key);
              return queryParameter;
            },
          );
          bq.createJob = (reqOpts: JobOptions) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((reqOpts as any).params).toBe(undefined);
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: NAMED_PARAMS,
              types: NAMED_TYPES,
            },
            (err: any) => { expect(err).toBeFalsy(); },
          );
        });

        it('should allow for providing only some parameter types', () => {
          const queryParameter = {};

          jest.spyOn(BigQuery, 'valueToQueryParameter_').mockImplementation((value: any) => {
            expect(value).toBe(NAMED_PARAMS.key);
            return queryParameter;
          });

          bq.createJob = (reqOpts: JobOptions) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((reqOpts as any).params).toBe(undefined);
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: NAMED_PARAMS,
              types: {},
            },
            (err: any) => { expect(err).toBeFalsy(); },
          );
        });

        it('should throw for invalid type structure provided', () => {
          expect(() => {
            bq.createQueryJob(
              {
                query: QUERY_STRING,
                params: NAMED_PARAMS,
                types: POSITIONAL_TYPES,
              },
              util.noop,
            );
          }).toThrow(
            /Provided types must match the value type passed to `params`/,
          );
        });
      });

      describe('positional', () => {
        it('should set the correct parameter mode', done => {
          const queryParameter = {};

          jest.spyOn(BigQuery, 'valueToQueryParameter_').mockImplementation((value: any) => {
            return queryParameter;
          });

          bq.createJob = (reqOpts: JobOptions) => {
            const query = reqOpts.configuration!.query!;
            expect(query.parameterMode).toBe('positional');
            done();
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: POSITIONAL_PARAMS,
            },
            (err: any) => { if (err) done(err); },
          );
        });

        it('should set the correct query parameters', done => {
          const queryParameter = {};

          jest.spyOn(BigQuery, 'valueToQueryParameter_').mockImplementation((value: any) => {
            expect(value).toBe(POSITIONAL_PARAMS[0]);
            return queryParameter;
          });

          bq.createJob = (reqOpts: JobOptions) => {
            const query = reqOpts.configuration!.query!;
            expect(query.queryParameters![0]).toBe(queryParameter);
            done();
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: POSITIONAL_PARAMS,
            },
            (err: any) => { if (err) done(err); },
          );
        });

        it('should convert value and type to query parameter', done => {
          const fakeQueryParameter = {fake: 'query parameter'};

          bq.createJob = (reqOpts: JobOptions) => {
            const queryParameters =
              reqOpts.configuration!.query!.queryParameters;
            expect(queryParameters).toEqual([fakeQueryParameter]);
            done();
          };

          jest.spyOn(BigQuery, 'valueToQueryParameter_').mockImplementation((value, type) => {
              expect(value).toBe(POSITIONAL_PARAMS[0]);
              expect(type).toBe(POSITIONAL_TYPES[0]);
              return fakeQueryParameter;
            });

          bq.createQueryJob({
            query: QUERY_STRING,
            params: POSITIONAL_PARAMS,
            types: POSITIONAL_TYPES,
          });
        });

        it('should allow for optional parameter types', () => {
          bq.createJob = (reqOpts: JobOptions) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((reqOpts as any).params).toBe(undefined);
          };

          bq.createQueryJob(
            {
              query: QUERY_STRING,
              params: POSITIONAL_PARAMS,
              types: POSITIONAL_TYPES,
            },
            (err: any) => { expect(err).toBeFalsy(); },
          );
        });

        it('should throw for invalid type structure provided for positional params', () => {
          expect(() => {
            bq.createQueryJob(
              {
                query: QUERY_STRING,
                params: POSITIONAL_PARAMS,
                types: NAMED_TYPES,
              },
              util.noop,
            );
          }).toThrow(
            /Provided types must match the value type passed to `params`/,
          );
        });

        it('should throw for incorrect number of types provided for positional params', () => {
          const ADDITIONAL_TYPES = ['string', 'string'];
          expect(() => {
            bq.createQueryJob(
              {
                query: QUERY_STRING,
                params: POSITIONAL_PARAMS,
                types: ADDITIONAL_TYPES,
              },
              util.noop,
            );
          }).toThrow(/Incorrect number of parameter types provided./);
        });
      });
    });

    it('should accept the dryRun options', done => {
      const options = {
        query: QUERY_STRING,
        dryRun: true,
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.query as any).dryRun).toBe(undefined);
        expect(reqOpts.configuration!.dryRun).toBe(options.dryRun);
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept the label options', done => {
      const options = {
        query: QUERY_STRING,
        labels: {foo: 'bar'},
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.query as any).labels).toBe(undefined);
        expect(reqOpts.configuration!.labels).toEqual(options.labels);
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept a job prefix', done => {
      const options = {
        query: QUERY_STRING,
        jobPrefix: 'hi',
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.query as any).jobPrefix).toBe(undefined);
        expect(reqOpts.jobPrefix).toBe(options.jobPrefix);
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept a reservation id', done => {
      const options = {
        query: QUERY_STRING,
        reservation: 'reservation/1',
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(reqOpts.configuration?.reservation).toBe('reservation/1');
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept a location', done => {
      const options = {
        query: QUERY_STRING,
        location: LOCATION,
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.query as any).location).toBe(undefined);
        expect(reqOpts.location).toBe(LOCATION);
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept a job id', done => {
      const options = {
        query: QUERY_STRING,
        jobId: 'jobId',
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.query as any).jobId).toBe(undefined);
        expect(reqOpts.jobId).toBe(options.jobId);
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should accept the jobTimeoutMs options', done => {
      const options = {
        query: QUERY_STRING,
        jobTimeoutMs: 1000,
      };

      bq.createJob = (reqOpts: JobOptions) => {
        expect(// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reqOpts.configuration!.query as any).jobTimeoutMs).toBe(undefined);
        expect(reqOpts.configuration!.jobTimeoutMs).toBe(`${options.jobTimeoutMs}`);
        done();
      };

      bq.createQueryJob(options, (err: any) => { if (err) done(err); });
    });

    it('should pass the callback to createJob', done => {
      bq.createJob = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(); // the done fn
      };

      bq.createQueryJob(QUERY_STRING, done);
    });
  });

  describe('dataset', () => {
    const DATASET_ID = 'dataset-id';

    it('should throw an error if the id is missing', () => {
      const expectedErr = /A dataset ID is required\./;
      expect(() => bq.dataset()).toThrow(expectedErr);
    });

    it('returns a Dataset instance', () => {
      const ds = bq.dataset(DATASET_ID);
      expect(ds instanceof Dataset).toBe(true);
    });

    it('should scope the correct dataset', () => {
      const ds = bq.dataset(DATASET_ID);
      const args = ds.calledWith_;

      expect(args[0]).toBe(bq);
      expect(args[1]).toBe(DATASET_ID);
    });

    it('should accept dataset metadata', () => {
      const options = {location: 'US'};
      const ds = bq.dataset(DATASET_ID, options);
      const args = ds.calledWith_;

      expect(args[2]).toBe(options);
    });

    it('should pass the location if available', () => {
      const bq = new BigQuery({
        projectId: PROJECT_ID,
        location: LOCATION,
      });

      const options = {a: 'b'};
      const expectedOptions = Object.assign({location: LOCATION}, options);

      const ds = bq.dataset(DATASET_ID, options);
      const args = ds.calledWith_;

      expect(args[2]).toEqual(expectedOptions);
      expect(args[2]).not.toBe(options);
    });
  });

  describe('getDatasets', () => {
    it('should get datasets from the api', done => {
      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/datasets');
        expect(reqOpts.qs).toEqual({});

        done();
      };

      bq.getDatasets((err: any) => { if (err) done(err); });
    });

    it('should accept query', done => {
      const queryObject = {all: true, maxResults: 8, pageToken: 'token'};

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toBe(queryObject);
        done();
      };

      bq.getDatasets(queryObject, (err: any) => { if (err) done(err); });
    });

    it('should default the query to an empty object', done => {
      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({});
        done();
      };
      bq.getDatasets((err: any) => { if (err) done(err); });
    });

    it('should return error to callback', done => {
      const error = new Error('Error.');

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      bq.getDatasets((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return Dataset objects', done => {
      const datasetId = 'datasetName';

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {
          datasets: [
            {
              datasetReference: {datasetId},
              location: LOCATION,
            },
          ],
        });
      };

      bq.getDatasets((err: Error, datasets: any[]) => {
        expect(err).toBeFalsy();

        const dataset = datasets[0];
        const args = dataset.calledWith_;

        expect(dataset instanceof Dataset).toBe(true);
        expect(args[0]).toBe(bq);
        expect(args[1]).toBe(datasetId);
        expect(args[2]).toEqual({location: LOCATION});
        done();
      });
    });

    it('should return Dataset objects', done => {
      const resp = {success: true};

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, resp);
      };

      bq.getDatasets(
        (err: Error, datasets: {}, nextQuery: {}, apiResponse: {}) => {
          expect(err).toBeFalsy();
          expect(apiResponse).toBe(resp);
          done();
        },
      );
    });

    it('should assign metadata to the Dataset objects', done => {
      const datasetObjects = [
        {
          a: 'b',
          c: 'd',
          datasetReference: {
            datasetId: 'datasetName',
          },
        },
      ];

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {datasets: datasetObjects});
      };

      bq.getDatasets((err: Error, datasets: Dataset[]) => {
        expect(err).toBeFalsy();
        expect(datasets[0].metadata).toBe(datasetObjects[0]);
        done();
      });
    });

    it('should return token if more results exist', done => {
      const token = 'token';

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {nextPageToken: token});
      };

      bq.getDatasets((err: Error, datasets: Dataset[], nextQuery: {}) => {
        expect(nextQuery).toEqual({
          pageToken: token,
        });
        done();
      });
    });

    it('should fetch datasets from a different project', done => {
      const queryObject = {projectId: ANOTHER_PROJECT_ID};

      bq.makeAuthenticatedRequest = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe(`https://bigquery.googleapis.com/bigquery/v2/projects/${ANOTHER_PROJECT_ID}/datasets`);
        done();
      };

      bq.getDatasets(queryObject, (err: any) => { if (err) done(err); });
    });
  });

  describe('getJobs', () => {
    it('should get jobs from the api', done => {
      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/jobs');
        expect(reqOpts.qs).toEqual({});
        expect(reqOpts.useQuerystring).toEqual(true);
        done();
      };

      bq.getJobs((err: any) => { if (err) done(err); });
    });

    it('should accept query', done => {
      const queryObject = {
        allUsers: true,
        maxResults: 8,
        pageToken: 'token',
        projection: 'full',
        stateFilter: 'done',
      };

      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual(queryObject);
        done();
      };

      bq.getJobs(queryObject, (err: any) => { if (err) done(err); });
    });

    it('should default the query to an object', done => {
      bq.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({});
        done();
      };
      bq.getJobs((err: any) => { if (err) done(err); });
    });

    it('should return error to callback', done => {
      const error = new Error('Error.');

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      bq.getJobs((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return Job objects', done => {
      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {
          jobs: [
            {
              id: JOB_ID,
              jobReference: {
                jobId: JOB_ID,
                location: LOCATION,
              },
            },
          ],
        });
      };

      bq.getJobs((err: Error, jobs: any[]) => {
        expect(err).toBeFalsy();

        const job = jobs[0];
        const args = job.calledWith_;

        expect(job instanceof Job).toBe(true);
        expect(args[0]).toBe(bq);
        expect(args[1]).toBe(JOB_ID);
        expect(args[2]).toEqual({location: LOCATION});
        done();
      });
    });

    it('should return apiResponse', done => {
      const resp = {
        jobs: [
          {
            id: JOB_ID,
            jobReference: {
              jobId: JOB_ID,
            },
          },
        ],
      };

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, resp);
      };

      bq.getJobs((err: Error, jobs: Job[], nextQuery: {}, apiResponse: {}) => {
        expect(err).toBeFalsy();
        expect(resp).toBe(apiResponse);
        done();
      });
    });

    it('should assign metadata to the Job objects', done => {
      const jobObjects = [
        {
          a: 'b',
          c: 'd',
          id: JOB_ID,
          jobReference: {
            jobId: JOB_ID,
          },
        },
      ];

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {jobs: jobObjects});
      };

      bq.getJobs((err: Error, jobs: Job[]) => {
        expect(err).toBeFalsy();
        expect(jobs[0].metadata).toBe(jobObjects[0]);
        done();
      });
    });

    it('should return token if more results exist', done => {
      const token = 'token';

      bq.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, {nextPageToken: token});
      };

      bq.getJobs((err: Error, jobs: Job[], nextQuery: {}) => {
        expect(err).toBeFalsy();
        expect(nextQuery).toEqual({
          pageToken: token,
        });
        done();
      });
    });
  });

  describe('job', () => {
    it('should return a Job instance', () => {
      const job = bq.job(JOB_ID);
      expect(job instanceof Job).toBe(true);
    });

    it('should scope the correct job', () => {
      const job = bq.job(JOB_ID);
      const args = job.calledWith_;

      expect(args[0]).toBe(bq);
      expect(args[1]).toBe(JOB_ID);
    });

    it('should pass the options object', () => {
      const options = {a: 'b'};
      const job = bq.job(JOB_ID, options);

      expect(job.calledWith_[2]).toBe(options);
    });

    it('should pass in the user specified location', () => {
      const bq = new BigQuery({
        projectId: PROJECT_ID,
        location: LOCATION,
      });

      const options = {a: 'b'};
      const expectedOptions = Object.assign({location: LOCATION}, options);

      const job = bq.job(JOB_ID, options);
      const args = job.calledWith_;

      expect(args[2]).toEqual(expectedOptions);
      expect(args[2]).not.toBe(options);
    });
  });

  describe('query', () => {
    const FAKE_ROWS = [{}, {}, {}];
    const FAKE_RESPONSE = {};
    const QUERY_STRING = 'SELECT * FROM [dataset.table]';

    it('should return any errors from createQueryJob', done => {
      const error = new Error('err');

      bq.createQueryJob = (query: {}, callback: Function) => {
        callback(error, null, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, options: {}) => {
        return undefined;
      };

      bq.query(QUERY_STRING, (err: Error, rows: {}, resp: {}) => {
        expect(err).toBe(error);
        expect(rows).toBe(null);
        expect(resp).toBe(FAKE_RESPONSE);
        done();
      });
    });

    it('should return any errors from jobs.query', done => {
      const error = new Error('err');

      bq.runJobsQuery = (query: {}, callback: Function) => {
        callback(error, FAKE_RESPONSE, {});
      };

      bq.query(QUERY_STRING, (err: Error, rows: {}, resp: {}) => {
        expect(err).toBe(error);
        expect(rows).toBe(null);
        expect(resp).toBe(FAKE_RESPONSE);
        done();
      });
    });

    it('should return throw error when jobs.query times out', done => {
      const fakeJob = {};

      bq.runJobsQuery = (query: {}, callback: Function) => {
        callback(null, fakeJob, {
          queryId: crypto.randomUUID(),
          jobComplete: false,
        });
      };

      bq.query(
        QUERY_STRING,
        {timeoutMs: 1000},
        (err: Error, rows: {}, resp: {}) => {
          expect(err.message).toBe('The query did not complete before 1000ms');
          expect(rows).toBe(null);
          expect(resp).toBe(fakeJob);
          done();
        },
      );
    });

    it('should exit early if dryRun is set', done => {
      const options = {
        query: QUERY_STRING,
        dryRun: true,
      };

      bq.createQueryJob = (query: {}, callback: Function) => {
        expect(query).toBe(options);
        callback(null, null, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, options: {}) => {
        return undefined;
      };

      bq.query(options, (err: Error, rows: {}, resp: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toEqual([]);
        expect(resp).toBe(FAKE_RESPONSE);
        done();
      });
    });

    it('should call job#getQueryResults', done => {
      const fakeJob = {
        getQueryResults: (options: {}, callback: Function) => {
          callback(null, FAKE_ROWS, FAKE_RESPONSE);
        },
      };

      bq.createQueryJob = (query: {}, callback: Function) => {
        callback(null, fakeJob, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, options: {}) => {
        return undefined;
      };

      bq.query(QUERY_STRING, (err: Error, rows: {}, resp: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toBe(FAKE_ROWS);
        expect(resp).toBe(FAKE_RESPONSE);
        done();
      });
    });

    it('should call job#getQueryResults with cached rows and response from jobs.query', done => {
      const fakeJob = {
        getQueryResults: (options: QueryResultsOptions, callback: Function) => {
          callback(null, options._cachedRows, null, options._cachedResponse);
        },
      };

      const fakeResponse = {
        jobComplete: true,
        schema: {
          fields: [{name: 'value', type: 'INT64'}],
        },
        rows: [{f: [{v: 1}]}, {f: [{v: 2}]}, {f: [{v: 3}]}],
      };

      bq.runJobsQuery = (query: {}, callback: Function) => {
        callback(null, fakeJob, fakeResponse);
      };

      bq.query(QUERY_STRING, (err: Error, rows: {}, query: {}, resp: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toEqual([
          {
            value: 1,
          },
          {
            value: 2,
          },
          {
            value: 3,
          },
        ]);
        expect(resp).toBe(fakeResponse);
        done();
      });
    });

    it('should delete res.rows if skipParsing is false', done => {
      const rawRows = [{f: [{v: 'hi'}]}];
      const resp = {
        jobComplete: true,
        schema: {
          fields: [{name: 'name', type: 'STRING'}],
        },
        rows: rawRows,
      };

      const job = {
        getQueryResults: (options: {}, callback: Function) => {
          callback(null, [], null, resp);
        },
      };

      bq.runJobsQuery = (reqOpts: {}, callback: Function) => {
        callback(null, job, resp);
      };

      bq.query(
        {
          query: 'SELECT * FROM table',
          skipParsing: false,
        },
        (err: Error, rows: {}[], nextQuery: {}, response: any) => {
          expect(err).toBeFalsy();
          // the job Complete callback returned the resp
          expect(response.rows).toEqual(undefined);
          done();
        },
      );
    });

    it('should skip parsing if skipParsing is true', done => {
      const rawRows = [{f: [{v: 'hi'}]}];
      const resp = {
        jobComplete: true,
        schema: {
          fields: [{name: 'name', type: 'STRING'}],
        },
        rows: rawRows,
      };

      const job = {
        getQueryResults: (options: QueryResultsOptions, callback: Function) => {
          callback(null, options._cachedRows, null, options._cachedResponse);
        },
      };

      bq.runJobsQuery = (reqOpts: {}, callback: Function) => {
        callback(null, job, resp);
      };

      bq.query(
        {
          query: 'SELECT * FROM table',
          skipParsing: true,
        },
        (err: Error, rows: {}[], nextQuery: {}, response: any) => {
          expect(err).toBeFalsy();
          expect(rows).toBe(rawRows);
          expect(response.rows).toEqual(rawRows);
          done();
        },
      );
    });

    it('should call job#getQueryResults with query options', done => {
      let queryResultsOpts = {};
      const fakeJob = {
        getQueryResults: (options: {}, callback: Function) => {
          queryResultsOpts = options;
          callback(null, FAKE_ROWS, FAKE_RESPONSE);
        },
      };

      bq.createQueryJob = (query: {}, callback: Function) => {
        callback(null, fakeJob, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, options: {}) => {
        return undefined;
      };

      const query = {
        query: QUERY_STRING,
        wrapIntegers: true,
        parseJSON: true,
      };
      bq.query(query, (err: Error, rows: {}, resp: {}) => {
        expect(err).toBeFalsy();
        expect(queryResultsOpts).toEqual({
          job: fakeJob,
          wrapIntegers: true,
          parseJSON: true,
        });
        expect(rows).toBe(FAKE_ROWS);
        expect(resp).toBe(FAKE_RESPONSE);
        done();
      });
    });

    it('should assign Job on the options', done => {
      const fakeJob = {
        getQueryResults: (options: {}) => {
          expect(options).toEqual({job: fakeJob});
          done();
        },
      };

      bq.createQueryJob = (query: {}, callback: Function) => {
        callback(null, fakeJob, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, opts: {}) => {
        return undefined;
      };

      bq.query(QUERY_STRING, (err: any) => { if (err) done(err); });
    });

    it('should optionally accept options', done => {
      const fakeOptions = {};
      const fakeJob = {
        getQueryResults: (options: {}) => {
          expect(options).not.toBe(fakeOptions);
          expect(options).toEqual({job: fakeJob});
          done();
        },
      };

      bq.createQueryJob = (query: {}, callback: Function) => {
        callback(null, fakeJob, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, opts: {}) => {
        return undefined;
      };

      bq.query(QUERY_STRING, fakeOptions, (err: any) => { if (err) done(err); });
    });

    it('should accept a reservation id', done => {
      const query: Query = {
        query: QUERY_STRING,
        reservation: 'reservation/1',
      };
      const fakeJob = {
        getQueryResults: (options: {}) => {
          done();
        },
      };

      bq.createJob = (reqOpts: JobOptions, callback: Function) => {
        expect(reqOpts.configuration?.reservation).toBe('reservation/1');
        callback(null, fakeJob, FAKE_RESPONSE);
      };

      bq.buildQueryRequest_ = (query: {}, opts: {}) => {
        return undefined;
      };

      bq.query(query, (err: any) => { if (err) done(err); });
    });
  });

  describe('buildQueryRequest_', () => {
    const DATASET_ID = 'dataset-id';
    const TABLE_ID = 'table-id';
    const QUERY_STRING = 'SELECT * FROM [dataset.table]';

    it('should create a QueryRequest from a Query interface', () => {
      const q: Query = {
        query: QUERY_STRING,
        maxResults: 10,
        defaultDataset: {
          projectId: PROJECT_ID,
          datasetId: DATASET_ID,
        },
        priority: 'INTERACTIVE',
        params: {
          key: 'value',
        },
        maximumBytesBilled: '1024',
        labels: {
          key: 'value',
        },
        jobCreationMode: 'JOB_CREATION_REQUIRED',
      };
      const req = bq.buildQueryRequest_(q, {});
      for (const key in req) {
        if (req[key] === undefined) {
          delete req[key];
        }
      }
      const formatOptions =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              timestampOutputFormat: 'ISO8601_STRING',
            }
          : {
              useInt64Timestamp: true,
            };
      const expectedReq = {
        query: QUERY_STRING,
        useLegacySql: false,
        requestId: req.requestId,
        maxResults: 10,
        defaultDataset: {
          projectId: PROJECT_ID,
          datasetId: DATASET_ID,
        },
        parameterMode: 'named',
        queryParameters: [
          {
            name: 'key',
            parameterType: {
              type: 'STRING',
            },
            parameterValue: {
              value: 'value',
            },
          },
        ],
        maximumBytesBilled: '1024',
        labels: {
          key: 'value',
        },
        jobCreationMode: 'JOB_CREATION_REQUIRED',
        formatOptions,
      };
      expect(req).toEqual(expectedReq);
    });

    describe('timestamp format options', () => {
      const testCases: {
        name: string;
        opts: QueryOptions;
        expected?: any;
        bail?: boolean;
      }[] = [
        {
          name: 'TOF: omitted, UI64: omitted (default ISO8601_STRING)',
          opts: {},
          expected: {
            timestampOutputFormat: 'ISO8601_STRING',
          },
        },
        {
          name: 'TOF: omitted, UI64: true',
          opts: {
            ['formatOptions.useInt64Timestamp']: true,
          },
          expected: {
            useInt64Timestamp: true,
          },
        },
        {
          name: 'TOF: omitted, UI64: false (default ISO8601_STRING)',
          opts: {
            ['formatOptions.useInt64Timestamp']: false,
          },
          expected: {
            useInt64Timestamp: false,
          },
        },
      ];

      testCases.forEach(testCase => {
        it(`should handle ${testCase.name}`, () => {
          if (process.env.BIGQUERY_PICOSECOND_SUPPORT !== 'true') {
            return;
          }
          const req = bq.buildQueryRequest_(QUERY_STRING, testCase.opts);

          const expectedReq = {
            query: QUERY_STRING,
            useLegacySql: false,
            requestId: req.requestId,
            jobCreationMode: 'JOB_CREATION_OPTIONAL',
            formatOptions: testCase.expected,
            connectionProperties: undefined,
            continuous: undefined,
            createSession: undefined,
            defaultDataset: undefined,
            destinationEncryptionConfiguration: undefined,
            labels: undefined,
            location: undefined,
            maxResults: undefined,
            maximumBytesBilled: undefined,
            preserveNulls: undefined,
            reservation: undefined,
            timeoutMs: undefined,
            useQueryCache: undefined,
            writeIncrementalResults: undefined,
          };
          expect(req).toEqual(expectedReq);
        });
      });
    });

    it('should create a QueryRequest from a SQL string', () => {
      const req = bq.buildQueryRequest_(QUERY_STRING, {});
      for (const key in req) {
        if (req[key] === undefined) {
          delete req[key];
        }
      }
      const formatOptions =
        process.env.BIGQUERY_PICOSECOND_SUPPORT === 'true'
          ? {
              timestampOutputFormat: 'ISO8601_STRING',
            }
          : {
              useInt64Timestamp: true,
            };
      const expectedReq = {
        query: QUERY_STRING,
        useLegacySql: false,
        requestId: req.requestId,
        jobCreationMode: 'JOB_CREATION_OPTIONAL',
        formatOptions,
      };
      expect(req).toEqual(expectedReq);
    });

    it('should not create a QueryRequest when config is not accepted by jobs.query', () => {
      const dataset: any = {
        bigQuery: bq,
        id: 'dataset-id',
        createTable: util.noop,
      };
      const table = new Table(dataset, TABLE_ID);
      const testCases: Query[] = [
        {
          query: QUERY_STRING,
          dryRun: true,
        },
        {
          query: QUERY_STRING,
          destination: table as unknown as Table,
        },
        {
          query: QUERY_STRING,
          clustering: {
            fields: ['date'],
          },
        },
        {
          query: QUERY_STRING,
          clustering: {},
        },
        {
          query: QUERY_STRING,
          timePartitioning: {},
        },
        {
          query: QUERY_STRING,
          rangePartitioning: {},
        },
        {
          query: QUERY_STRING,
          jobId: 'fixed-job-id',
        },
        {
          query: QUERY_STRING,
          createDisposition: 'CREATED_IF_NEEDED',
          writeDisposition: 'WRITE_APPEND',
        },
        {
          query: QUERY_STRING,
          schemaUpdateOptions: ['update'],
        },
      ];

      for (const index in testCases) {
        const testCase = testCases[index];
        const req = bq.buildQueryRequest_(testCase, {});
        expect(req).toBeUndefined();
      }
    });
  });

  describe('queryAsStream_', () => {
    let queryStub: jest.SpyInstance;
    const defaultOpts = {
      location: undefined,
      maxResults: undefined,
      pageToken: undefined,
      wrapIntegers: undefined,
      parseJSON: undefined,
      autoPaginate: false,
    };

    beforeEach(() => {
      queryStub = jest.spyOn(bq, 'query').mockImplementation((q: any, opts: any, cb: any) => { if (cb) setImmediate(cb); });
    });

    it('should call query correctly with a string', done => {
      const query = 'SELECT';
      bq.queryAsStream_(query, done);
      expect(queryStub).toHaveBeenCalledTimes(1); expect(queryStub).toHaveBeenCalledWith(query, defaultOpts, expect.any(Function));
    });

    it('should call query correctly with a Query object', done => {
      const query = {query: 'SELECT', wrapIntegers: true, parseJSON: true};
      bq.queryAsStream_(query, done);
      const opts = {
        ...defaultOpts,
        wrapIntegers: true,
        parseJSON: true,
      };
      expect(queryStub).toHaveBeenCalledTimes(1); expect(queryStub).toHaveBeenCalledWith(query, opts, expect.any(Function));
    });

    it('should query as job if supplied', done => {
      const cbStub = jest.fn((q: any, cb: any) => { if (cb) setImmediate(cb); });
      const query = {
        job: {
          getQueryResults: cbStub,
        },
      };
      bq.queryAsStream_(query, done);
      expect(cbStub).toHaveBeenCalledTimes(1); expect(cbStub).toHaveBeenCalledWith(query, expect.any(Function));
      expect(queryStub).not.toHaveBeenCalled();
    });

    it('should pass wrapIntegers if supplied', done => {
      const wrapIntegers = {
        integerValue: 100,
      };
      const query = {
        query: 'SELECT',
        wrapIntegers,
      };

      bq.queryAsStream_(query, done);

      const opts = {
        ...defaultOpts,
        wrapIntegers,
      };

      expect(queryStub).toHaveBeenCalledTimes(1); expect(queryStub).toHaveBeenCalledWith(query, opts, expect.any(Function));
    });

    it('should pass parseJSON if supplied', done => {
      const parseJSON = true;
      const query = {
        query: 'SELECT',
        parseJSON,
      };

      bq.queryAsStream_(query, done);

      const opts = {
        ...defaultOpts,
        parseJSON,
      };

      expect(queryStub).toHaveBeenCalledTimes(1); expect(queryStub).toHaveBeenCalledWith(query, opts, expect.any(Function));
    });
  });

  describe('#sanitizeEndpoint', () => {
    const USER_DEFINED_SHORT_API_ENDPOINT = 'myapi.com:8080';
    const USER_DEFINED_PROTOCOL = 'myproto';
    const USER_DEFINED_FULL_API_ENDPOINT = `${USER_DEFINED_PROTOCOL}://myapi.com:8080`;

    it('should default protocol to https', () => {
      const endpoint = BigQuery.sanitizeEndpoint(
        USER_DEFINED_SHORT_API_ENDPOINT,
      );
      expect(endpoint.match(PROTOCOL_REGEX)![1]).toBe('https');
    });

    it('should not override protocol', () => {
      const endpoint = BigQuery.sanitizeEndpoint(
        USER_DEFINED_FULL_API_ENDPOINT,
      );
      expect(endpoint.match(PROTOCOL_REGEX)![1]).toBe(USER_DEFINED_PROTOCOL);
    });

    it('should remove trailing slashes from URL', () => {
      const endpointsWithTrailingSlashes = [
        `${USER_DEFINED_FULL_API_ENDPOINT}/`,
        `${USER_DEFINED_FULL_API_ENDPOINT}//`,
      ];
      for (const endpointWithTrailingSlashes of endpointsWithTrailingSlashes) {
        const endpoint = BigQuery.sanitizeEndpoint(endpointWithTrailingSlashes);
        expect(endpoint.endsWith('/')).toBe(false);
      }
    });
  });
});
