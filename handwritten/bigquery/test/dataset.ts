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

import {
  DecorateRequestOptions,
  ServiceObject,
  util,
} from '@google-cloud/common';
import * as extend from 'extend';

let promisified = false;
let extended = false;

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll: (c: Function, options: any) => {
      if (c.name !== 'Dataset') {
        return actual.promisifyAll(c, options);
      }
      promisified = true;
      expect(options.exclude).toEqual(['model', 'routine', 'table']);
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
        if (c.name !== 'Dataset') {
          return;
        }
        const methodsArr = Array.isArray(methods) ? methods : [methods];
        if (
          methodsArr.length === 3 &&
          methodsArr[0] === 'getModels' &&
          methodsArr[1] === 'getRoutines' &&
          methodsArr[2] === 'getTables'
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

jest.mock('@google-cloud/common', () => {
  const actual = jest.requireActual('@google-cloud/common');
  class FakeServiceObject extends actual.ServiceObject {
    calledWith_: IArguments;
    constructor(config: any) {
      super(config);
      // eslint-disable-next-line prefer-rest-params
      this.calledWith_ = arguments;
    }
  }
  return {
    ...actual,
    ServiceObject: FakeServiceObject,
  };
});

import * as _root from '../src';
import {DatasetOptions} from '../src/dataset';
import {FormattedMetadata, TableOptions} from '../src/table';

interface CalledWithDataset extends ServiceObject {
  calledWith_: Array<{
    parent: {};
    baseUrl: string;
    id: string;
    methods: Record<string, any>;
  }>;
}

describe('BigQuery/Dataset', () => {
  const BIGQUERY = {
    projectId: 'my-project',
    createDataset: util.noop,
  } as {} as _root.BigQuery;
  const DATASET_ID = 'kittens';
  const LOCATION = 'asia-northeast1';
  const ANOTHER_PROJECT_ID = 'another-test-project';

  // tslint:disable-next-line variable-name
  let Dataset: typeof _root.Dataset;
  // tslint:disable-next-line variable-name
  let Table: typeof _root.Table;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ds: any;

  beforeAll(() => {
    Dataset = require('../src/dataset').Dataset;
    Table = require('../src/table').Table;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    ds = new Dataset(BIGQUERY, DATASET_ID);
  });

  describe('instantiation', () => {
    it('should extend the correct methods', () => {
      expect(extended).toBe(true); // See `fakePaginator.extend`
    });

    it('should streamify the correct methods', () => {
      expect(ds.getTablesStream).toBe('getTables');
      expect(ds.getModelsStream).toBe('getModels');
    });

    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should inherit from ServiceObject', () => {
      expect(ds instanceof ServiceObject).toBe(true);

      const calledWith = (ds as CalledWithDataset).calledWith_[0];

      expect(calledWith.parent).toBe(BIGQUERY);
      expect(calledWith.baseUrl).toBe('/datasets');
      expect(calledWith.id).toBe(DATASET_ID);
      expect(calledWith.methods).toEqual({
        create: true,
        exists: true,
        get: true,
        getMetadata: true,
        setMetadata: true,
      });
    });

    it('should capture user provided location', () => {
      const options = {location: LOCATION};
      const ds = new Dataset(BIGQUERY, DATASET_ID, options);

      expect(ds.location).toBe(LOCATION);
    });

    it('should set the client projectId by default', () => {
      const ds = new Dataset(BIGQUERY, DATASET_ID);

      expect(ds.projectId).toBe(BIGQUERY.projectId);
    });

    it('should capture user provided projectId', () => {
      const projectIdOverride = 'octavia';
      const options = {projectId: projectIdOverride};
      const ds = new Dataset(BIGQUERY, DATASET_ID, options);

      expect(ds.projectId).toBe(projectIdOverride);
    });

    describe('createMethod', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bq: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ds: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let config: any;

      beforeEach(() => {
        bq = extend(true, {}, BIGQUERY);
        ds = new Dataset(bq, DATASET_ID);
        config = ds.calledWith_[0];
      });

      it('should call through to BigQuery#createDataset', done => {
        const OPTIONS = {
          projectId: BIGQUERY.projectId,
        };

        bq.createDataset = (id: string, options: {}, callback: Function) => {
          expect(id).toBe(DATASET_ID);
          expect(options).toEqual(OPTIONS);
          callback(); // the done fn
        };

        config.createMethod(DATASET_ID, OPTIONS, done);
      });

      it('should optionally accept options', done => {
        bq.createDataset = (id: string, options: {}, callback: Function) => {
          callback(); // the done fn
        };

        config.createMethod(DATASET_ID, done);
      });

      it('should pass the location', done => {
        bq.createDataset = (
          id: string,
          options: DatasetOptions,
          callback: Function,
        ) => {
          expect(options.location).toBe(LOCATION);
          callback(); // the done fn
        };

        ds.location = LOCATION;
        config.createMethod(DATASET_ID, done);
      });

      it('should pass the projectId', done => {
        bq.createDataset = (
          id: string,
          options: DatasetOptions,
          callback: Function,
        ) => {
          expect(options.projectId).toBe('project-id');
          callback(); // the done fn
        };

        ds.projectId = 'project-id';
        config.createMethod(DATASET_ID, done);
      });
    });

    describe('projectId override interceptor', () => {
      const projectIdOverride = 'DuBois';

      it('should use projectId override uri', () => {
        ds = new Dataset(BIGQUERY, DATASET_ID, {projectId: projectIdOverride});
        const interceptor = ds.interceptors.pop();
        const fakeReqOpts = {
          method: 'PATCH',
          json: {
            etag: '',
          },
          uri: `/projects/${ds.bigQuery.projectId}/`,
        };

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.uri).toEqual(`/projects/${projectIdOverride}/`);
      });
    });

    describe('etag interceptor', () => {
      const FAKE_ETAG = 'abc';

      it('should apply the If-Match header', () => {
        const interceptor = ds.interceptors.pop();

        const fakeReqOpts = {
          method: 'PATCH',
          json: {
            etag: FAKE_ETAG,
          },
          uri: `/projects/${BIGQUERY.projectId}/`,
        };

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.headers).toEqual({'If-Match': FAKE_ETAG});
      });

      it('should respect already existing headers', () => {
        const interceptor = ds.interceptors.pop();

        const fakeReqOpts = {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          json: {
            etag: FAKE_ETAG,
          },
          uri: `/projects/${BIGQUERY.projectId}/`,
        };

        const expectedHeaders = Object.assign({}, fakeReqOpts.headers, {
          'If-Match': FAKE_ETAG,
        });

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.headers).toEqual(expectedHeaders);
      });

      it('should not apply the header if method is not patch', () => {
        const interceptor = ds.interceptors.pop();

        const fakeReqOpts = {
          method: 'POST',
          json: {
            etag: FAKE_ETAG,
          },
          uri: `/projects/${BIGQUERY.projectId}/`,
        };

        const reqOpts = interceptor.request(fakeReqOpts);
        expect(reqOpts.headers).toEqual(undefined);
      });
    });
  });

  describe('createQueryJob', () => {
    const FAKE_QUERY = 'SELECT * FROM `table`';

    it('should extend the options', done => {
      const fakeOptions = {
        query: FAKE_QUERY,
        a: {b: 'c'},
      };

      const expectedOptions = extend(
        true,
        {
          location: LOCATION,
        },
        fakeOptions,
        {
          defaultDataset: {
            datasetId: ds.id,
          },
        },
      );

      ds.bigQuery.createQueryJob = (options: {}, callback: Function) => {
        expect(options).toEqual(expectedOptions);
        expect(fakeOptions).not.toBe(options);
        callback(); // the done fn
      };

      ds.location = LOCATION;
      ds.createQueryJob(fakeOptions, done);
    });

    it('should accept a query string', done => {
      ds.bigQuery.createQueryJob = (
        options: _root.Query,
        callback: Function,
      ) => {
        expect(options.query).toBe(FAKE_QUERY);
        callback(); // the done fn
      };

      ds.createQueryJob(FAKE_QUERY, done);
    });
  });

  describe('createQueryStream', () => {
    const options = {
      a: 'b',
      c: 'd',
    };

    it('should call through to bigQuery', done => {
      ds.bigQuery.createQueryStream = () => {
        done();
      };

      ds.createQueryStream();
    });

    it('should return the result of the call to bq.query', done => {
      ds.bigQuery.createQueryStream = () => {
        return {
          done,
        };
      };

      ds.createQueryStream().done();
    });

    it('should accept a string', done => {
      const query = 'SELECT * FROM allthedata';

      ds.bigQuery.createQueryStream = (opts: _root.Query) => {
        expect(opts.query).toBe(query);
        done();
      };

      ds.createQueryStream(query);
    });

    it('should pass along options', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ds.bigQuery.createQueryStream = (opts: any) => {
        expect(opts.a).toBe(options.a);
        expect(opts.c).toBe(options.c);
        done();
      };

      ds.createQueryStream(options);
    });

    it('should extend options with defaultDataset', done => {
      ds.bigQuery.createQueryStream = (opts: _root.Query) => {
        expect(opts.defaultDataset).toEqual({datasetId: ds.id});
        done();
      };

      ds.createQueryStream(options);
    });

    it('should extend options with the location', done => {
      ds.bigQuery.createQueryStream = (opts: _root.Query) => {
        expect(opts.location).toBe(LOCATION);
        done();
      };

      ds.location = LOCATION;
      ds.createQueryStream();
    });

    it('should not modify original options object', done => {
      ds.bigQuery.createQueryStream = () => {
        expect(options).toEqual({a: 'b', c: 'd'});
        done();
      };

      ds.createQueryStream();
    });
  });

  describe('createTable', () => {
    const SCHEMA_OBJECT = {
      fields: [
        {name: 'id', type: 'INTEGER'},
        {name: 'breed', type: 'STRING'},
        {name: 'name', type: 'STRING'},
        {name: 'dob', type: 'TIMESTAMP'},
        {name: 'around', type: 'BOOLEAN'},
      ],
    };
    const SCHEMA_STRING = 'id:integer,breed,name,dob:timestamp,around:boolean';
    const TABLE_ID = 'kittens';

    const API_RESPONSE = {
      tableReference: {
        tableId: TABLE_ID,
        projectId: BIGQUERY.projectId,
      },
    };

    it('should create a table', done => {
      const options = {
        schema: SCHEMA_OBJECT,
      };

      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.uri).toBe('/tables');

        const body = reqOpts.json;
        expect(body.schema).toEqual(SCHEMA_OBJECT);
        expect(body.tableReference.datasetId).toBe(DATASET_ID);
        expect(body.tableReference.projectId).toBe(ds.projectId);
        expect(body.tableReference.tableId).toBe(TABLE_ID);

        done();
      };

      ds.createTable(TABLE_ID, options, (err: any) => { if (err) done(err); });
    });

    it('should create a table on a different project', done => {
      const options = {
        schema: SCHEMA_OBJECT,
      };
      const anotherDs = new Dataset(BIGQUERY, DATASET_ID, {
        projectId: ANOTHER_PROJECT_ID,
      }) as any;
      anotherDs.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('POST');
        expect(reqOpts.uri).toBe('/tables');

        const body = reqOpts.json;
        expect(body.schema).toEqual(SCHEMA_OBJECT);
        expect(body.tableReference.datasetId).toBe(DATASET_ID);
        expect(body.tableReference.projectId).toBe(ANOTHER_PROJECT_ID);
        expect(body.tableReference.tableId).toBe(TABLE_ID);

        done();
      };

      // Under the hood dataset.createTable is called
      const table = anotherDs.table(TABLE_ID);
      table.create(options, (err: any) => { if (err) done(err); });
    });

    it('should not require options', done => {
      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, API_RESPONSE);
      };

      ds.createTable(TABLE_ID, done);
    });

    it('should format the metadata', done => {
      const formatMetadata_ = Table.formatMetadata_;
      const formatted = {};
      const fakeOptions = {};

      Table.formatMetadata_ = options => {
        expect(options).toBe(fakeOptions);
        return formatted as {} as FormattedMetadata;
      };

      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json).toBe(formatted);

        Table.formatMetadata_ = formatMetadata_;
        done();
      };

      ds.createTable(TABLE_ID, fakeOptions, (err: any) => { if (err) done(err); });
    });

    it('should create a schema object from a string', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.schema).toEqual(SCHEMA_OBJECT);
        done();
      };

      ds.createTable(TABLE_ID, {schema: SCHEMA_STRING}, (err: any) => { if (err) done(err); });
    });

    it('should wrap an array schema', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.schema.fields).toEqual(SCHEMA_OBJECT.fields);
        done();
      };

      ds.createTable(
        TABLE_ID,
        {
          schema: SCHEMA_OBJECT.fields,
        },
        (err: any) => { if (err) done(err); },
      );
    });

    it('should assign record type to nested schemas', done => {
      const nestedField = {
        id: 'nested',
        fields: [{id: 'nested_name', type: 'STRING'}],
      };

      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.json.schema.fields[1].type).toBe('RECORD');
        done();
      };

      ds.createTable(
        TABLE_ID,
        {
          schema: {
            fields: [{id: 'name', type: 'STRING'}, nestedField],
          },
        },
        (err: any) => { if (err) done(err); },
      );
    });

    it('should return an error to the callback', done => {
      const error = new Error('Error.');

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      ds.createTable(TABLE_ID, {schema: SCHEMA_OBJECT}, (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return a Table object', done => {
      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, API_RESPONSE);
      };

      ds.createTable(
        TABLE_ID,
        {schema: SCHEMA_OBJECT},
        (err: Error, table: _root.Table) => {
          expect(err).toBeFalsy();
          expect(table instanceof Table).toBe(true);
          done();
        },
      );
    });

    it('should pass the location to the Table', done => {
      const response = Object.assign({location: LOCATION}, API_RESPONSE);

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, response);
      };

      ds.table = (id: string, options: TableOptions) => {
        expect(options.location).toBe(LOCATION);
        setImmediate(done);
        return {};
      };

      ds.createTable(TABLE_ID, {schema: SCHEMA_OBJECT}, (err: any) => { if (err) done(err); });
    });

    it('should pass the projectId to the Table', done => {
      const response = Object.assign({location: LOCATION}, API_RESPONSE);

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, response);
      };

      ds.table = (id: string, options: TableOptions) => {
        expect(options.location).toBe(LOCATION);
        setImmediate(done);
        return {};
      };

      ds.createTable(TABLE_ID, {schema: SCHEMA_OBJECT}, (err: any) => { if (err) done(err); });
    });

    it('should return an apiResponse', done => {
      const opts = {id: TABLE_ID, schema: SCHEMA_OBJECT};

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, API_RESPONSE);
      };

      ds.createTable(
        TABLE_ID,
        opts,
        (err: Error, table: _root.Table, apiResponse: {}) => {
          expect(err).toBeFalsy();
          expect(apiResponse).toBe(API_RESPONSE);
          done();
        },
      );
    });

    it('should assign metadata to the Table object', done => {
      const apiResponse = Object.assign(
        {
          a: 'b',
          c: 'd',
        },
        API_RESPONSE,
      );

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, apiResponse);
      };

      ds.createTable(
        TABLE_ID,
        {schema: SCHEMA_OBJECT},
        (err: Error, table: _root.Table) => {
          expect(err).toBeFalsy();
          expect(table.metadata).toBe(apiResponse);
          done();
        },
      );
    });
  });

  describe('delete', () => {
    it('should delete the dataset via the api', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.method).toBe('DELETE');
        expect(reqOpts.uri).toBe('');
        expect(reqOpts.qs).toEqual({deleteContents: false});
        done();
      };

      ds.delete((err: any) => { if (err) done(err); });
    });

    it('should allow a force delete', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({deleteContents: true});
        done();
      };

      ds.delete({force: true}, (err: any) => { if (err) done(err); });
    });

    it('should execute callback when done', done => {
      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback();
      };

      ds.delete(done);
    });

    it('should pass error to callback', done => {
      const error = new Error('Error.');

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      ds.delete((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should pass apiResponse to callback', done => {
      const apiResponse = {};

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(null, apiResponse);
      };

      ds.delete((err: Error, apiResponse_: {}) => {
        expect(apiResponse_).toBe(apiResponse);
        done();
      });
    });
  });

  describe('getModels', () => {
    it('should get models from the api', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/models');
        expect(reqOpts.qs).toEqual({});
        done();
      };

      ds.getModels((err: any) => { if (err) done(err); });
    });

    it('should accept a query', done => {
      const query = {
        maxResults: 8,
        pageToken: 'token',
      };

      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toBe(query);
        done();
      };

      ds.getModels(query, (err: any) => { if (err) done(err); });
    });

    it('should default the query value to an empty object', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({});
        done();
      };

      ds.getModels((err: any) => { if (err) done(err); });
    });

    it('should return error to callback', done => {
      const error = new Error('Error.');

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      ds.getModels((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    describe('success', () => {
      const modelId = 'modelName';
      const apiResponse = {
        models: [
          {
            a: 'b',
            c: 'd',
            modelReference: {modelId},
          },
        ],
      };

      beforeEach(() => {
        ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
          callback(null, apiResponse);
        };
      });

      it('should return Model & apiResponse', done => {
        ds.getModels(
          (
            err: Error,
            models: _root.Model[],
            nextQuery: {},
            apiResponse_: {},
          ) => {
            expect(err).toBeFalsy();

            const model = models[0];

            expect(model instanceof _root.Model).toBe(true);
            expect(model.id).toBe(modelId);
            expect(apiResponse_).toBe(apiResponse);
            done();
          },
        );
      });

      it('should assign metadata to the Model objects', done => {
        ds.getModels((err: Error, models: _root.Model[]) => {
          expect(err).toBeFalsy();
          expect(models[0].metadata).toBe(apiResponse.models[0]);
          done();
        });
      });

      it('should return token if more results exist', done => {
        const pageToken = 'token';

        const query = {
          maxResults: 5,
        };

        const expectedNextQuery = {
          maxResults: 5,
          pageToken,
        };

        ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
          callback(null, {nextPageToken: pageToken});
        };

        ds.getModels(
          query,
          (err: Error, tables: _root.Model[], nextQuery: {}) => {
            expect(err).toBeFalsy();
            expect(nextQuery).toEqual(expectedNextQuery);
            done();
          },
        );
      });
    });
  });

  describe('getTables', () => {
    it('should get tables from the api', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.uri).toBe('/tables');
        expect(reqOpts.qs).toEqual({});
        done();
      };

      ds.getTables((err: any) => { if (err) done(err); });
    });

    it('should accept a query', done => {
      const query = {
        maxResults: 8,
        pageToken: 'token',
      };

      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toBe(query);
        done();
      };

      ds.getTables(query, (err: any) => { if (err) done(err); });
    });

    it('should default the query value to an empty object', done => {
      ds.request = (reqOpts: DecorateRequestOptions) => {
        expect(reqOpts.qs).toEqual({});
        done();
      };

      ds.getTables((err: any) => { if (err) done(err); });
    });

    it('should return error to callback', done => {
      const error = new Error('Error.');

      ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
        callback(error);
      };

      ds.getTables((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    describe('success', () => {
      const tableId = 'tableName';
      const apiResponse = {
        tables: [
          {
            a: 'b',
            c: 'd',
            tableReference: {tableId},
            location: LOCATION,
          },
        ],
      };

      beforeEach(() => {
        ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
          callback(null, apiResponse);
        };
      });

      it('should return Table & apiResponse', done => {
        ds.getTables(
          (
            err: Error,
            tables: _root.Table[],
            nextQuery: {},
            apiResponse_: {},
          ) => {
            expect(err).toBeFalsy();

            const table = tables[0];

            expect(table instanceof Table).toBe(true);
            expect(table.id).toBe(tableId);
            expect(table.location).toBe(LOCATION);
            expect(apiResponse_).toBe(apiResponse);
            done();
          },
        );
      });

      it('should assign metadata to the Table objects', done => {
        ds.getTables((err: Error, tables: _root.Table[]) => {
          expect(err).toBeFalsy();
          expect(tables[0].metadata).toBe(apiResponse.tables[0]);
          done();
        });
      });

      it('should return token if more results exist', done => {
        const pageToken = 'token';

        const query = {
          maxResults: 5,
        };

        const expectedNextQuery = {
          maxResults: 5,
          pageToken,
        };

        ds.request = (reqOpts: DecorateRequestOptions, callback: Function) => {
          callback(null, {nextPageToken: pageToken});
        };

        ds.getTables(
          query,
          (err: Error, tables: _root.Table[], nextQuery: {}) => {
            expect(err).toBeFalsy();
            expect(nextQuery).toEqual(expectedNextQuery);
            done();
          },
        );
      });
    });
  });

  describe('model', () => {
    it('should throw an error if the id is missing', () => {
      const expectedErr = /A model ID is required\./;
      expect(() => ds.model()).toThrow(expectedErr);
    });

    it('should return a Model object', () => {
      const modelId = 'modelId';
      const model = ds.model(modelId);
      expect(model instanceof _root.Model).toBe(true);
      expect(model.id).toBe(modelId);
    });
  });

  describe('query', () => {
    const options = {
      a: 'b',
      c: 'd',
    };

    it('should call through to bigQuery', done => {
      ds.bigQuery.query = () => {
        done();
      };

      ds.query();
    });

    it('should accept a string', done => {
      const query = 'SELECT * FROM allthedata';

      ds.bigQuery.query = (opts: _root.Query) => {
        expect(opts.query).toBe(query);
        done();
      };

      ds.query(query);
    });

    it('should pass along skipParsing', done => {
      const query = {
        query: 'SELECT * FROM allthedata',
        skipParsing: true,
      };

      ds.bigQuery.query = (opts: _root.Query) => {
        expect(opts.skipParsing).toBe(true);
        done();
      };

      ds.query(query);
    });

    it('should pass along options', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ds.bigQuery.query = (opts: any) => {
        expect(opts.a).toBe(options.a);
        expect(opts.c).toBe(options.c);
        done();
      };

      ds.query(options);
    });

    it('should extend options with defaultDataset', done => {
      ds.bigQuery.query = (opts: _root.Query) => {
        expect(opts.defaultDataset).toEqual({datasetId: ds.id});
        done();
      };

      ds.query(options);
    });

    it('should extend options with the location', done => {
      ds.bigQuery.query = (opts: _root.Query) => {
        expect(opts.location).toBe(LOCATION);
        done();
      };

      ds.location = LOCATION;
      ds.query();
    });

    it('should not modify original options object', done => {
      ds.bigQuery.query = () => {
        expect(options).toEqual({a: 'b', c: 'd'});
        done();
      };

      ds.query();
    });

    it('should pass callback', done => {
      const callback = util.noop;

      ds.bigQuery.query = (opts: _root.Query, cb: Function) => {
        expect(cb).toBe(callback);
        done();
      };

      ds.query(options, callback);
    });
  });

  describe('table', () => {
    it('should throw an error if the id is missing', () => {
      const expectedErr = /A table ID is required\./;
      expect(() => ds.table()).toThrow(expectedErr);
    });

    it('should return a Table object', () => {
      const tableId = 'tableId';
      const table = ds.table(tableId);
      expect(table instanceof Table).toBe(true);
      expect(table.id).toBe(tableId);
    });

    it('should inherit the dataset location', () => {
      ds.location = LOCATION;
      const table = ds.table('tableId');

      expect(table.location).toBe(LOCATION);
    });

    it('should pass along the location if provided', () => {
      ds.location = LOCATION;

      const location = 'US';
      const table = ds.table('tableId', {location});

      expect(table.location).toBe(location);
    });
  });
});
