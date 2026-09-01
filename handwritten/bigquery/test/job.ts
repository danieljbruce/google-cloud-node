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

jest.mock('@google-cloud/common', () => {
  const common = jest.requireActual('@google-cloud/common');
  class FakeOperation {
    calledWith_: Array<{}>;
    interceptors: Array<{}>;
    id: {};
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
      this.interceptors = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.id = (this.calledWith_[0] as any).id;
    }
  }
  return {
    ...common,
    Operation: FakeOperation,
  };
});

jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (c: Function) => {
    if (c.name === 'Job') {
      mockPromisified = true;
    }
  },
}));

jest.mock('@google-cloud/paginator', () => ({
  paginator: {
    extend: (c: Function, methods: string[] | string) => {
      if (c.name !== 'Job') {
        return;
      }

      const arr = Array.isArray(methods) ? methods : [methods];
      expect(arr).toEqual(['getQueryResults']);
      mockExtended = true;
    },
    streamify: (methodName: string) => {
      return methodName;
    },
  },
}));

import {DecorateRequestOptions, util, ServiceObject} from '@google-cloud/common';
import * as pfy from '@google-cloud/promisify';

import {BigQuery} from '../src/bigquery';
import {toArray} from '../src/util';
import {QueryResultsOptions} from '../src/job';
import {Job} from '../src/job';

const {Operation: FakeOperation} = require('@google-cloud/common');

interface CalledWithJob {
  calledWith_: Array<{
    parent: {};
    baseUrl: string;
    id: string;
    methods: any;
  }>;
}

describe('BigQuery/Job', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BIGQUERY: any = {
    projectId: 'my-project',
    Promise,
  };
  const JOB_ID = 'job_XYrk_3z';
  const LOCATION = 'asia-northeast1';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let job: any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    job = new Job(BIGQUERY, JOB_ID);
  });


  describe('initialization', () => {
    it('should paginate all the things', () => {
      expect(mockExtended).toBe(true);
    });

    it('should promisify all the things', () => {
      expect(mockPromisified).toBe(true);
    });

    it('should assign this.bigQuery', () => {
      expect(job.bigQuery).toEqual(BIGQUERY);
    });

    it('should inherit from Operation', () => {
      expect(job instanceof FakeOperation).toBe(true);

      const calledWith = (job as CalledWithJob).calledWith_[0];

      expect(calledWith.parent).toBe(BIGQUERY);
      expect(calledWith.baseUrl).toBe('/jobs');
      expect(calledWith.id).toBe(JOB_ID);
      expect(calledWith.methods).toEqual({
        delete: {
          reqOpts: {
            method: 'DELETE',
            uri: '/delete',
            qs: {location: undefined},
          },
        },
        exists: true,
        get: true,
        getMetadata: {
          reqOpts: {
            qs: {location: undefined},
          },
        },
      });
    });

    it('should accept a location option', () => {
      const options = {location: 'US'};
      const job: any = new Job(BIGQUERY, JOB_ID, options);

      expect(job.location).toBe(options.location);
    });

    it('should accept a projectId option', () => {
      const options = {projectId: 'cool-project'};
      const job: any = new Job(BIGQUERY, JOB_ID, options);

      expect(job.projectId).toBe(options.projectId);
    });

    it('should send the location via getMetadata', () => {
      const job: any = new Job(BIGQUERY, JOB_ID, {location: LOCATION});
      const calledWith = (job as any).calledWith_[0];

      expect(calledWith.methods.getMetadata).toEqual({
        reqOpts: {
          qs: {location: LOCATION},
        },
      });
    });

    it('should update the location after initializing job object', () => {
      const job: any = new Job(BIGQUERY, JOB_ID);
      job.location = LOCATION;
      const calledWith = (job as any).calledWith_[0];

      expect(calledWith.methods.getMetadata).toEqual({
        reqOpts: {
          qs: {location: LOCATION},
        },
      });
    });
  });

  describe('cancel', () => {
    it('should make the correct API request', done => {
      job.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.uri).toBe('/cancel');
        done();
      };

      job.cancel((err: any) => { if (err) done(err); });
    });

    it('should include the job location', done => {
      const job: any = new Job(BIGQUERY, JOB_ID, {location: LOCATION});

      job.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({location: LOCATION});
        done();
      };

      job.cancel((err: any) => { if (err) done(err); });
    });
  });

  describe('getQueryResults', () => {
    const pageToken = 'token';
    const options = {
      a: 'a',
      b: 'b',
      location: 'US',
    };

    const RESPONSE = {
      pageToken,
      jobReference: {jobId: JOB_ID},
    };

    beforeEach(() => {
      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        callback(null, RESPONSE);
      };

      BIGQUERY.mergeSchemaWithRows_ = (schema: {}, rows: {}, options: {}) => {
        return rows;
      };
    });

    it('should make the correct request', done => {
      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/queries/' + JOB_ID);
        done();
      };

      job.getQueryResults((err: any) => { if (err) done(err); });
    });

    it('should optionally accept options', done => {
      const options = {a: 'b'};
      const expectedOptions = Object.assign(
        {location: undefined, 'formatOptions.useInt64Timestamp': true},
        options,
      );

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual(expectedOptions);
        done();
      };

      job.getQueryResults(options, (err: any) => { if (err) done(err); });
    });

    it('should inherit the location', done => {
      const job: any = new Job(BIGQUERY, JOB_ID, {location: LOCATION});

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({
          location: LOCATION,
          'formatOptions.useInt64Timestamp': true,
        });
        done();
      };

      job.getQueryResults((err: any) => { if (err) done(err); });
    });

    it('should delete any cached jobs', done => {
      const options = {job: {}, a: 'b'};
      const expectedOptions = {
        location: undefined,
        a: 'b',
        'formatOptions.useInt64Timestamp': true,
      };

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual(expectedOptions);
        done();
      };

      job.getQueryResults(options, (err: any) => { if (err) done(err); });
    });

    it('should return any errors to the callback', done => {
      const error = new Error('err');
      const response = {};

      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        callback(error, response);
      };

      job.getQueryResults((err: any, rows: {}, nextQuery: {}, resp: {}) => {
        expect(err).toBe(error);
        expect(rows).toBe(null);
        expect(nextQuery).toBe(null);
        expect(resp).toBe(response);
        done();
      });
    });

    it('should return the rows and response to the callback', done => {
      job.getQueryResults((err: {}, rows: {}, nextQuery: {}, resp: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toEqual([]);
        expect(resp).toBe(RESPONSE);
        done();
      });
    });

    it('should merge the rows with the schema', done => {
      const response = {
        schema: {},
        rows: [],
      };

      const mergedRows: Array<{}> = [];

      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        callback(null, response);
      };

      jest
        .spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema, rows, {wrapIntegers}) => {
          expect(schema).toBe(response.schema);
          expect(rows).toBe(response.rows);
          expect(wrapIntegers).toBe(false);
          return mergedRows;
        });

      job.getQueryResults((err: any, rows: {}) => {
        expect(err).toBeFalsy();
        expect(rows).toBe(mergedRows);
        done();
      });
    });

    it('it should wrap integers', done => {
      const response = {
        schema: {},
        rows: [],
      };

      const mergedRows: Array<{}> = [];

      const options = {wrapIntegers: true};
      const expectedOptions = Object.assign({
        location: undefined,
        'formatOptions.useInt64Timestamp': true,
      });

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual(expectedOptions);
        done();
      };

      jest
        .spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema, rows, {wrapIntegers}) => {
          expect(schema).toBe(response.schema);
          expect(rows).toBe(response.rows);
          expect(wrapIntegers).toBe(true);
          return mergedRows;
        });

      job.getQueryResults(options, (err: any) => { if (err) done(err); });
    });

    it('it should parse JSON', done => {
      const response = {
        schema: {},
        rows: [],
      };

      const mergedRows: Array<{}> = [];

      const options = {parseJSON: true};
      const expectedOptions = Object.assign({
        location: undefined,
        'formatOptions.useInt64Timestamp': true,
      });

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual(expectedOptions);
        done();
      };

      jest
        .spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema, rows, {parseJSON}) => {
          expect(schema).toBe(response.schema);
          expect(rows).toBe(response.rows);
          expect(parseJSON).toBe(true);
          return mergedRows;
        });

      job.getQueryResults(options, (err: any) => { if (err) done(err); });
    });

    it('should skip parsing if skipParsing is true', done => {
      const response = {
        schema: {},
        rows: [{f: [{v: 'hi'}]}],
      };

      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        callback(null, response);
      };

      const mergeStub = jest.spyOn(BigQuery, 'mergeSchemaWithRows_');

      job.getQueryResults({skipParsing: true}, (err: any, rows: {}[]) => {
        expect(err).toBeFalsy();
        expect(rows).toBe(response.rows);
        expect(mergeStub.mock.calls.length > 0).toBe(false);
        done();
      });
    });

    it('should not delete resp.rows if skipParsing is true', done => {
      const options: QueryResultsOptions = {
        skipParsing: true,
      };

      const rawRows = [{f: [{v: 'hi'}]}];
      const resp = {
        jobComplete: true,
        rows: rawRows,
        schema: {
          fields: [{name: 'name', type: 'STRING'}],
        },
      };

      job.bigQuery.request = (reqOpts: {}, callback: Function) => {
        callback(null, resp);
      };

      job.getQueryResults(
        options,
        (err: any, rows: {}, nextQuery: {}, response: any) => {
          expect(err).toBeFalsy();
          expect(response.rows).toEqual(rawRows);
          done();
        },
      );
    });

    it('should return the query when the job is not complete', done => {
      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        callback(null, {
          jobComplete: false,
        });
      };

      job.getQueryResults(options, (err: any, rows: {}, nextQuery: {}) => {
        expect(err).toBeFalsy();
        expect(nextQuery).toEqual(options);
        expect(nextQuery).not.toBe(options);
        done();
      });
    });

    it('should return an error when the job is not complete & timeout is overridden', done => {
      const options = {job: {}, timeoutMs: 1000};
      const message = `The query did not complete before ${options.timeoutMs}ms`;
      const response = {
        jobComplete: false,
      };

      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        callback(null, response);
      };

      job.getQueryResults(
        options,
        (err: any, rows: {}, nextQuery: {}, resp: {}) => {
          expect(err.message).toBe(message);
          expect(rows).toBe(null);
          expect(nextQuery).toEqual(options);
          expect(resp).toBe(response);
          done();
        },
      );
    });

    it('should delete resp.rows if skipParsing is false by default', done => {
      const options: QueryResultsOptions = {};

      const rawRows = [{f: [{v: 'hi'}]}];
      const resp = {
        jobComplete: true,
        rows: rawRows,
        schema: {
          fields: [{name: 'name', type: 'STRING'}],
        },
      };

      job.bigQuery.request = (reqOpts: {}, callback: Function) => {
        callback(null, resp);
      };

      job.getQueryResults(
        options,
        (err: any, rows: {}, nextQuery: {}, response: any) => {
          expect(err).toBeFalsy();
          expect(response.rows).toEqual(undefined);
          done();
        },
      );
    });

    it('should populate nextQuery when more results exist', done => {
      job.getQueryResults(
        options,
        (err: any, rows: {}, nextQuery: QueryResultsOptions) => {
          expect(err).toBeFalsy();
          expect(nextQuery.pageToken).toBe(pageToken);
          done();
        },
      );
    });
  });

  describe('getQueryResultsStream', () => {
    it('should have streamified getQueryResults', () => {
      expect(job.getQueryResultsStream).toBe('getQueryResultsAsStream_');
    });
  });

  describe('getQueryResultsAsStream_', () => {
    it('should call getQueryResults correctly', done => {
      const options = {a: 'b', c: 'd'};

      job.getQueryResults = (
        options_: QueryResultsOptions,
        callback: Function,
      ) => {
        expect(options_).toEqual({
          a: 'b',
          c: 'd',
          autoPaginate: false,
        });
        callback(); // done()
      };

      job.getQueryResultsAsStream_(options, done);
    });
  });

  describe('poll_', () => {
    it('should call getMetadata', done => {
      job.getMetadata = () => {
        done();
      };

      job.poll_((err: any) => { if (err) done(err); });
    });

    describe('API error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        job.getMetadata = (callback: Function) => {
          callback(error);
        };
      });

      it('should return an error', done => {
        job.poll_((err: any) => {
          expect(err).toBe(error);
          done();
        });
      });
    });

    describe('job failure', () => {
      const error = new Error('Error.');
      const apiResponse = {
        status: {
          errorResult: error,
          errors: [error],
        },
      };

      
      beforeEach(() => {
        job.getMetadata = (callback: Function) => {
          callback(null, apiResponse);
        };
      });

      it('should detect and return an error from the response', done => {
        jest.spyOn(util, 'ApiError').mockImplementation(body => {
          expect(body).toBe(apiResponse.status);
          return error;
        });

        job.poll_((err: any) => {
          expect(err).toBe(error);
          done();
        });
      });

    });

    describe('job pending', () => {
      const apiResponse = {
        status: {
          state: 'PENDING',
        },
      };

      beforeEach(() => {
        job.getMetadata = (callback: Function) => {
          callback(null, apiResponse, apiResponse);
        };
      });

      it('should execute callback', done => {
        job.poll_((err: any, metadata: {}) => {
          expect(err).toBeFalsy();
          expect(metadata).toBe(undefined);
          done();
        });
      });
    });

    describe('job complete', () => {
      const apiResponse = {
        status: {
          state: 'DONE',
        },
      };

      beforeEach(() => {
        job.getMetadata = (callback: Function) => {
          callback(null, apiResponse, apiResponse);
        };
      });

      it('should emit complete with metadata', done => {
        job.poll_((err: any, metadata: {}) => {
          expect(err).toBeFalsy();
          expect(metadata).toBe(apiResponse);
          done();
        });
      });
    });
  });
});
