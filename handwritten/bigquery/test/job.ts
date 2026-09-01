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

import {DecorateRequestOptions, Operation, util} from '@google-cloud/common';
import {toArray} from '../src/util';
import {QueryResultsOptions} from '../src/job';

let promisified = false;
let extended = false;

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll: (c: Function, options: any) => {
      if (c.name === 'Job') {
        promisified = true;
      }
      return actual.promisifyAll(c, options);
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
        if (c.name !== 'Job') {
          return;
        }

        const methodsArr = Array.isArray(methods) ? methods : [methods];
        if (methodsArr.length === 1 && methodsArr[0] === 'getQueryResults') {
          extended = true;
        }
      },
      streamify: (methodName: string) => {
        return methodName;
      },
    },
  };
});

jest.mock('@google-cloud/common', () => {
  const actual = jest.requireActual('@google-cloud/common');
  class FakeOperation {
    calledWith_: Array<{}>;
    interceptors: Array<{}>;
    id: {};
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
      this.interceptors = [];
      this.id = (this.calledWith_[0] as any).id;
    }
  }
  return {
    ...actual,
    Operation: FakeOperation,
  };
});

import {BigQuery, Job} from '../src';

describe('BigQuery/Job', () => {
  const BIGQUERY: any = {
    projectId: 'my-project',
    Promise,
  };
  const JOB_ID = 'job_XYrk_3z';
  const LOCATION = 'asia-northeast1';

  let job: any;

  beforeEach(() => {
    job = new Job(BIGQUERY, JOB_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should paginate all the things', () => {
      expect(extended).toBe(true);
    });

    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should assign this.bigQuery', () => {
      expect(job.bigQuery).toEqual(BIGQUERY);
    });

    it('should inherit from Operation', () => {
      expect(job instanceof Operation).toBe(true);

      const calledWith = (job as any).calledWith_[0];

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
      const job = new Job(BIGQUERY, JOB_ID, options);

      expect(job.location).toBe(options.location);
    });

    it('should accept a projectId option', () => {
      const options = {projectId: 'cool-project'};
      const job = new Job(BIGQUERY, JOB_ID, options);

      expect(job.projectId).toBe(options.projectId);
    });

    it('should send the location via getMetadata', () => {
      const job = new Job(BIGQUERY, JOB_ID, {location: LOCATION});
      const calledWith = (job as any).calledWith_[0];

      expect(calledWith.methods.getMetadata).toEqual({
        reqOpts: {
          qs: {location: LOCATION},
        },
      });
    });

    it('should update the location after initializing job object', () => {
      const job = new Job(BIGQUERY, JOB_ID);
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
        try {
          expect(reqOpts.method).toBe('POST');
          expect(reqOpts.uri).toBe('/cancel');
          done();
        } catch (e) {
          done(e);
        }
      };

      job.cancel((err: any) => {
        if (err) done(err);
      });
    });

    it('should include the job location', done => {
      const job: any = new Job(BIGQUERY, JOB_ID, {location: LOCATION});

      job.request = (reqOpts: DecorateRequestOptions) => {
        try {
          expect(reqOpts.qs).toEqual({location: LOCATION});
          done();
        } catch (e) {
          done(e);
        }
      };

      job.cancel((err: any) => {
        if (err) done(err);
      });
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
        try {
          expect(reqOpts.uri).toBe('/queries/' + JOB_ID);
          done();
        } catch (e) {
          done(e);
        }
      };

      job.getQueryResults((err: any) => {
        if (err) done(err);
      });
    });

    it('should optionally accept options', done => {
      const options = {a: 'b'};
      const expectedOptions = Object.assign(
        {location: undefined, 'formatOptions.useInt64Timestamp': true},
        options,
      );

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        try {
          expect(reqOpts.qs).toEqual(expectedOptions);
          done();
        } catch (e) {
          done(e);
        }
      };

      job.getQueryResults(options, (err: any) => {
        if (err) done(err);
      });
    });

    it('should inherit the location', done => {
      const job = new Job(BIGQUERY, JOB_ID, {location: LOCATION});

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        try {
          expect(reqOpts.qs).toEqual({
            location: LOCATION,
            'formatOptions.useInt64Timestamp': true,
          });
          done();
        } catch (e) {
          done(e);
        }
      };

      job.getQueryResults((err: any) => {
        if (err) done(err);
      });
    });

    it('should delete any cached jobs', done => {
      const options = {job: {}, a: 'b'};
      const expectedOptions = {
        location: undefined,
        a: 'b',
        'formatOptions.useInt64Timestamp': true,
      };

      BIGQUERY.request = (reqOpts: DecorateRequestOptions) => {
        try {
          expect(reqOpts.qs).toEqual(expectedOptions);
          done();
        } catch (e) {
          done(e);
        }
      };

      job.getQueryResults(options, (err: any) => {
        if (err) done(err);
      });
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

      job.getQueryResults((err: Error, rows: {}, nextQuery: {}, resp: {}) => {
        try {
          expect(err).toBe(error);
          expect(rows).toBeNull();
          expect(nextQuery).toBeNull();
          expect(resp).toBe(response);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should return the rows and response to the callback', done => {
      job.getQueryResults((err: {}, rows: {}, nextQuery: {}, resp: {}) => {
        try {
          expect(err).toBeFalsy();
          expect(rows).toEqual([]);
          expect(resp).toBe(RESPONSE);
          done();
        } catch (e) {
          done(e);
        }
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
        .mockImplementation((schema: any, rows: any, {wrapIntegers}: any) => {
          expect(schema).toBe(response.schema);
          expect(rows).toBe(response.rows);
          expect(wrapIntegers).toBe(false);
          return mergedRows as any;
        });

      job.getQueryResults((err: Error, rows: {}) => {
        try {
          expect(err).toBeFalsy();
          expect(rows).toBe(mergedRows);
          done();
        } catch (e) {
          done(e);
        }
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

      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        try {
          expect(reqOpts.qs).toEqual(expectedOptions);
          callback(null, response);
        } catch (e) {
          done(e);
        }
      };

      jest
        .spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema: any, rows: any, {wrapIntegers}: any) => {
          try {
            expect(schema).toBe(response.schema);
            expect(rows).toBe(response.rows);
            expect(wrapIntegers).toBe(true);
            return mergedRows as any;
          } catch (e) {
            done(e);
            return mergedRows as any;
          }
        });

      job.getQueryResults(options, (err: any) => {
        if (err) done(err);
        else done();
      });
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

      BIGQUERY.request = (
        reqOpts: DecorateRequestOptions,
        callback: Function,
      ) => {
        try {
          expect(reqOpts.qs).toEqual(expectedOptions);
          callback(null, response);
        } catch (e) {
          done(e);
        }
      };

      jest
        .spyOn(BigQuery, 'mergeSchemaWithRows_')
        .mockImplementation((schema: any, rows: any, {parseJSON}: any) => {
          try {
            expect(schema).toBe(response.schema);
            expect(rows).toBe(response.rows);
            expect(parseJSON).toBe(true);
            return mergedRows as any;
          } catch (e) {
            done(e);
            return mergedRows as any;
          }
        });

      job.getQueryResults(options, (err: any) => {
        if (err) done(err);
        else done();
      });
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

      job.getQueryResults({skipParsing: true}, (err: Error, rows: {}[]) => {
        try {
          expect(err).toBeFalsy();
          expect(rows).toBe(response.rows);
          expect(mergeStub).not.toHaveBeenCalled();
          done();
        } catch (e) {
          done(e);
        }
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
        (err: Error, rows: {}, nextQuery: {}, response: any) => {
          try {
            expect(err).toBeFalsy();
            expect(response.rows).toEqual(rawRows);
            done();
          } catch (e) {
            done(e);
          }
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

      job.getQueryResults(options, (err: Error, rows: {}, nextQuery: {}) => {
        try {
          expect(err).toBeFalsy();
          expect(nextQuery).toEqual(options);
          expect(nextQuery).not.toBe(options);
          done();
        } catch (e) {
          done(e);
        }
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
        (err: Error, rows: {}, nextQuery: {}, resp: {}) => {
          try {
            expect(err.message).toBe(message);
            expect(rows).toBeNull();
            expect(nextQuery).toEqual(options);
            expect(resp).toBe(response);
            done();
          } catch (e) {
            done(e);
          }
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
        (err: Error, rows: {}, nextQuery: {}, response: any) => {
          try {
            expect(err).toBeFalsy();
            expect(response.rows).toBeUndefined();
            done();
          } catch (e) {
            done(e);
          }
        },
      );
    });

    it('should populate nextQuery when more results exist', done => {
      job.getQueryResults(
        options,
        (err: Error, rows: {}, nextQuery: QueryResultsOptions) => {
          try {
            expect(err).toBeFalsy();
            expect(nextQuery.pageToken).toBe(pageToken);
            done();
          } catch (e) {
            done(e);
          }
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
        try {
          expect(options_).toEqual({
            a: 'b',
            c: 'd',
            autoPaginate: false,
          });
          callback();
        } catch (e) {
          done(e);
        }
      };

      job.getQueryResultsAsStream_(options, done);
    });
  });

  describe('poll_', () => {
    it('should call getMetadata', done => {
      job.getMetadata = () => {
        done();
      };

      job.poll_((err: any) => {
        if (err) done(err);
      });
    });

    describe('API error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        job.getMetadata = (callback: Function) => {
          callback(error);
        };
      });

      it('should return an error', done => {
        job.poll_((err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
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
        jest.spyOn(util, 'ApiError').mockImplementation((body: any) => {
          expect(body).toBe(apiResponse.status);
          return error as any;
        });

        job.poll_((err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
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
        job.poll_((err: Error, metadata: {}) => {
          try {
            expect(err).toBeFalsy();
            expect(metadata).toBeUndefined();
            done();
          } catch (e) {
            done(e);
          }
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
        job.poll_((err: Error, metadata: {}) => {
          try {
            expect(err).toBeFalsy();
            expect(metadata).toBe(apiResponse);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });
});
