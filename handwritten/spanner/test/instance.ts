/*!
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable prefer-rest-params */

import {ApiError} from '@google-cloud/common';
import {grpc} from 'google-gax';
import snakeCase = require('lodash.snakecase');
import {Duplex} from 'stream';

import * as inst from '../src/instance';
import {Spanner, Database, RequestConfig} from '../src';
import {toArray} from '../src/helper';
import {SessionPoolOptions} from '../src/session-pool';
import {Backup} from '../src/backup';
import {PreciseDate} from '@google-cloud/precise-date';
import {CLOUD_RESOURCE_HEADER, AFE_SERVER_TIMING_HEADER} from '../src/common';


jest.mock("@google-cloud/promisify", () => {
  const actual = jest.requireActual("@google-cloud/promisify");
  return {
    ...actual,
    promisifyAll: (klass: any, options: any) => {
      if (klass.name === "Instance") {
        (global as any).__promisified_instance = true;
        expect(options.exclude).toEqual(["database", "backup"]);
      }
    },
  };
});

class FakeDatabase {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
}

class FakeGrpcServiceObject {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
}

class FakeBackup {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
}

jest.mock("../src/common-grpc/service-object", () => ({
  GrpcServiceObject: FakeGrpcServiceObject,
}));
jest.mock("../src/database", () => ({
  Database: FakeDatabase,
}));
jest.mock("../src/backup", () => ({
  Backup: FakeBackup,
}));


describe('Instance', () => {
  // tslint:disable-next-line variable-name
  let Instance: typeof inst.Instance;
  let instance: inst.Instance;


  const SPANNER = {
    request: () => {},
    requestStream: () => {},
    projectId: 'project-id',
    instances_: new Map(),
    projectFormattedName_: 'projects/project-id',
    commonHeaders_: {
      [AFE_SERVER_TIMING_HEADER]: 'true',
    },
  } as {} as Spanner;

  const NAME = 'instance-name';

  beforeAll(() => {
    Instance = inst.Instance;
  });

  beforeEach(() => {
    instance = new Instance(SPANNER, NAME);
  });

  describe('instantiation', () => {
    it('should localize an database map', () => {
      expect(instance.databases_ instanceof Map).toBeTruthy();
    });

    it('should promisify all the things', () => {
      expect((global as any).__promisified_instance).toBeTruthy();
    });

    it('should format the name', () => {
      const formatName_ = Instance.formatName_;
      const formattedName = 'formatted-name';

      Instance.formatName_ = (projectId, name) => {
        Instance.formatName_ = formatName_;

        expect(projectId).toBe(SPANNER.projectId);
        expect(name).toBe(NAME);

        return formattedName;
      };

      const instance = new Instance(SPANNER, NAME);
      expect(instance.formattedName_).toBeTruthy();
    });

    it('should localize the request function', done => {
      const spannerInstance = Object.assign({}, SPANNER);

      spannerInstance.request = function () {
        expect(this).toBe(spannerInstance);
        done();
      };

      const instance = new Instance(spannerInstance, NAME);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (instance as any).request();
    });

    it('should localize the requestStream function', done => {
      const spannerInstance = Object.assign({}, SPANNER);
      const CONFIG = {};

      spannerInstance.requestStream = function (config) {
        expect(this).toBe(spannerInstance);
        expect(config).toBe(CONFIG);
        done();
      };

      const instance = new Instance(spannerInstance, NAME);
      instance.requestStream(CONFIG as RequestConfig);
    });

    it('should inherit from ServiceObject', done => {
      const options = {};
      const spannerInstance = Object.assign({}, SPANNER, {
        createInstance(name, options_, callback) {
          expect(name).toBe(instance.formattedName_);
          expect(options_).toBe(options);
          callback(); // done()
        },
      });

      const instance = new Instance(spannerInstance, NAME);
      expect((instance as any).calledWith_).toBeDefined();

      const calledWith = instance.calledWith_[0];

      expect(calledWith.parent).toBe(spannerInstance);
      expect(calledWith.id).toBe(NAME);
      expect(calledWith.methods).toEqual({create: true});

      calledWith.createMethod(null, options, done);
    });

    it('should set the commonHeaders_', () => {
      expect(instance.commonHeaders_).toEqual({
        [CLOUD_RESOURCE_HEADER]: instance.formattedName_,
        [AFE_SERVER_TIMING_HEADER]: 'true',
      });
    });
  });

  describe('formatName_', () => {
    const PATH = 'projects/' + SPANNER.projectId + '/instances/' + NAME;

    it('should return the name if already formatted', () => {
      expect(Instance.formatName_(SPANNER.projectId, PATH)).toBe(PATH);
    });

    it('should format the name', () => {
      const formattedName = Instance.formatName_(SPANNER.projectId, NAME);
      expect(formattedName).toBe(PATH);
    });
  });

  describe('createDatabase', () => {
    const NAME = 'database-name';
    const PATH = 'projects/project-id/databases/' + NAME;

    const OPTIONS = {
      a: 'b',
    } as inst.CreateDatabaseOptions;
    const ORIGINAL_OPTIONS = Object.assign({}, OPTIONS);

    it('should throw if a name is not provided', () => {
      expect(() => {
        void instance.createDatabase(null!);
      }).toThrow(/A name is required to create a database\./);
    });

    it('should make the correct default request', done => {
      instance.request = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('createDatabase');
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
          createStatement: 'CREATE DATABASE `' + NAME + '`',
        });
        expect(config.gaxOpts).toBe(undefined);
        expect(config.headers).toEqual(instance.commonHeaders_);

        done();
      };

      instance.createDatabase(NAME, (err => { expect(err).toBeFalsy(); }));
    });

    it('should accept options', done => {
      instance.request = config => {
        expect(OPTIONS).toEqual(ORIGINAL_OPTIONS);

        const expectedReqOpts = Object.assign(
          {
            parent: instance.formattedName_,
            createStatement: 'CREATE DATABASE `' + NAME + '`',
          },
          OPTIONS,
        );

        expect(config.reqOpts).toEqual(expectedReqOpts);

        done();
      };

      instance.createDatabase(NAME, OPTIONS, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not alter the original options', done => {
      const options = Object.assign({}, OPTIONS, {
        poolOptions: {},
        poolCtor: {},
      });
      const originalOptions = Object.assign({}, options);
      instance.request = (config, callback: Function) => {
        expect(config.reqOpts.poolOptions).toBe(undefined);
        callback();
      };

      instance.createDatabase(NAME, options, err => {
        if (err) {
          (err => { expect(err).toBeFalsy(); })(err);
        }
        expect(options).toEqual(originalOptions);
        done();
      });
    });

    it('should accept gaxOptions', done => {
      const options = Object.assign({}, OPTIONS, {gaxOptions: {}});
      instance.request = config => {
        expect(config.gaxOpts).toBe(options.gaxOptions);
        expect(config.reqOpts.gaxOptions).toBe(undefined);

        done();
      };

      instance.createDatabase(NAME, options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should only use the name in the createStatement', done => {
      instance.request = config => {
        const expectedReqOpts = Object.assign(
          {
            parent: instance.formattedName_,
            createStatement: 'CREATE DATABASE `' + NAME + '`',
          },
          OPTIONS,
        );

        expect(config.reqOpts).toEqual(expectedReqOpts);

        done();
      };

      instance.createDatabase(PATH, OPTIONS, (err => { expect(err).toBeFalsy(); }));
    });

    describe('options.poolOptions/poolCtor', () => {
      it('should allow specifying session pool options', done => {
        const poolOptions = {};

        const options = Object.assign({}, OPTIONS, {
          poolOptions,
        });

        instance.request = (config, callback: Function) => {
          expect(config.reqOpts.poolOptions).toBe(undefined);
          callback();
        };

        instance.database = (name, poolOptions_) => {
          expect(poolOptions_).toBe(poolOptions);
          done();
          return {} as Database;
        };

        instance.createDatabase(PATH, options, (err => { expect(err).toBeFalsy(); }));
      });

      it('should allow specifying session pool constructor', done => {
        const poolCtor = {};

        const options = Object.assign({}, OPTIONS, {
          poolCtor,
        });

        instance.request = (config, callback: Function) => {
          expect(config.reqOpts.poolCtor).toBe(undefined);
          callback();
        };

        instance.database = (name, poolOptions_) => {
          expect(poolOptions_).toBe(poolCtor);
          done();
          return {} as Database;
        };

        instance.createDatabase(PATH, options, (err => { expect(err).toBeFalsy(); }));
      });
    });

    describe('options.schema', () => {
      it('should arrify and rename to extraStatements', done => {
        const SCHEMA = 'schema';

        const options = Object.assign({}, OPTIONS, {
          schema: SCHEMA,
        });

        instance.request = config => {
          expect(config.reqOpts.extraStatements).toEqual([SCHEMA]);
          expect(config.reqOpts.schema).toBe(undefined);
          done();
        };

        instance.createDatabase(NAME, options, (err => { expect(err).toBeFalsy(); }));
      });

      it('should arrify and rename to extraStatements from array style schema filed', done => {
        const SCHEMA = ['schema', 'schema2'];

        const options = Object.assign({}, OPTIONS, {
          schema: SCHEMA,
        });

        instance.request = config => {
          expect(config.reqOpts.extraStatements).toEqual(SCHEMA);
          expect(config.reqOpts.schema).toBe(undefined);
          done();
        };

        instance.createDatabase(NAME, options, (err => { expect(err).toBeFalsy(); }));
      });
    });

    describe('error', () => {
      const ERROR = new Error('Error.');
      const API_RESPONSE = {};

      beforeEach(() => {
        instance.request = (config, callback: Function) => {
          callback(ERROR, null, API_RESPONSE);
        };
      });

      it('should execute callback with error & API response', done => {
        instance.createDatabase(NAME, OPTIONS, (err, db, op, resp) => {
          expect(err).toBe(ERROR);
          expect(op).toBe(null);
          expect(resp).toBe(API_RESPONSE);
          done();
        });
      });
    });

    describe('success', () => {
      const OPERATION = {};
      const API_RESPONSE = {};

      beforeEach(() => {
        instance.request = (config, callback: Function) => {
          callback(null, OPERATION, API_RESPONSE);
        };
      });

      it('should exec callback with a Database and Operation', done => {
        const fakeDatabaseInstance = {};

        instance.database = name => {
          expect(name).toBe(NAME);
          return fakeDatabaseInstance as Database;
        };

        instance.createDatabase(NAME, OPTIONS, (err, db, op, resp) => {
          (err => { expect(err).toBeFalsy(); })(err);
          expect(db).toBe(fakeDatabaseInstance);
          expect(op).toBe(OPERATION);
          expect(resp).toBe(API_RESPONSE);
          done();
        });
      });
    });
  });

  describe('database', () => {
    const NAME = 'database-name';

    it('should throw if a name is not provided', () => {
      expect(() => {
        instance.database(null!);
      }).toThrow(/A name is required to access a Database object\./);
    });

    it('should create and cache a Database', () => {
      const cache = instance.databases_;
      const poolOptions = {};

      expect(cache.has(NAME)).toBe(false);

      const database = instance.database(
        NAME,
        poolOptions,
      ) as {} as FakeDatabase;

      expect(database instanceof FakeDatabase).toBeTruthy();
      expect(database.calledWith_[0]).toBe(instance);
      expect(database.calledWith_[1]).toBe(NAME);
      expect(database.calledWith_[2]).toBe(poolOptions);
      expect(database).toBe(cache.get(NAME));
    });

    it('should re-use cached objects', () => {
      const cache = instance.databases_;
      const fakeDatabase = {} as Database;

      cache.set(NAME, fakeDatabase);

      const database = instance.database(NAME);

      expect(database).toBe(fakeDatabase);
    });

    it('should create and cache different objects when called with different session pool options', () => {
      const cache = instance.databases_;
      const fakeDatabase = {} as Database;
      const fakeDatabaseWithSessionPoolOptions = {} as Database;
      const emptySessionPoolOptions = {} as SessionPoolOptions;
      const fakeSessionPoolOptions = {
        min: 1000,
        max: 1000,
      } as SessionPoolOptions;
      const fakeSessionPoolOptionsInOtherOrder = {
        max: 1000,
        min: 1000,
      } as SessionPoolOptions;

      cache.set(NAME, fakeDatabase);
      cache.set(
        NAME +
          '/' +
          JSON.stringify(Object.entries(fakeSessionPoolOptions).sort()),
        fakeDatabaseWithSessionPoolOptions,
      );

      const database = instance.database(NAME);
      const databaseWithEmptyOptions = instance.database(
        NAME,
        emptySessionPoolOptions,
      );
      const databaseWithOptions = instance.database(
        NAME,
        fakeSessionPoolOptions,
      );
      const databaseWithOptionsInOtherOrder = instance.database(
        NAME,
        fakeSessionPoolOptionsInOtherOrder,
      );

      expect(database).toBe(fakeDatabase);
      expect(databaseWithEmptyOptions).toBe(fakeDatabase);
      expect(databaseWithOptions).toBe(fakeDatabaseWithSessionPoolOptions);
      expect(databaseWithOptionsInOtherOrder).toBe(fakeDatabaseWithSessionPoolOptions);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      instance.parent = SPANNER;
    });

    it('should close all cached databases', done => {
      let closed = false;

      instance.databases_.set('key', {
        close() {
          closed = true;
          return Promise.resolve();
        },
      } as {} as Database);

      instance.request = () => {
        expect(closed).toBe(true);
        expect(instance.databases_.size).toBe(0);
        done();
      };

      instance.delete((err => { expect(err).toBeFalsy(); }));
    });

    it('should ignore closing errors', done => {
      instance.databases_.set('key', {
        close() {
          return Promise.reject(new Error('err'));
        },
      } as {} as Database);

      instance.request = () => {
        done();
      };

      instance.delete((err => { expect(err).toBeFalsy(); }));
    });

    it('should make the correct request', done => {
      instance.request = (config, callback: Function) => {
        expect(config.client).toBe('InstanceAdminClient');
        expect(config.method).toBe('deleteInstance');
        expect(config.reqOpts).toEqual({
          name: instance.formattedName_,
        });
        expect(config.gaxOpts).toEqual({});
        expect(config.headers).toEqual(instance.commonHeaders_);
        callback(); // done()
      };

      instance.delete(done);
    });

    it('should remove the Instance from the cache', done => {
      const cache = instance.parent.instances_;

      instance.request = (config, callback) => {
        callback(null);
      };

      cache.set(instance.id, instance);
      expect(cache.get(instance.id)).toBe(instance);

      instance.delete(err => {
        (err => { expect(err).toBeFalsy(); })(err);
        expect(cache.has(instance.id)).toBe(false);
        done();
      });
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      instance.request = (config, callback: Function) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        callback(); // done()
      };

      instance.delete(gaxOptions, done);
    });
  });

  describe('exists', () => {
    afterEach(() => jest.restoreAllMocks());

    it('should return any non-404 like errors', done => {
      const error = {code: 3};

      jest.spyOn(instance, 'getMetadata').mockImplementation(
          (
            opts_:
              | inst.GetInstanceMetadataOptions
              | inst.GetInstanceMetadataCallback,
            cb,
          ) => {
            cb = typeof opts_ === 'function' ? opts_ : cb;
            cb(error as grpc.ServiceError);
          },
        );

      instance.exists((err, exists) => {
        expect(err).toBe(error);
        expect(exists).toBe(null);
        done();
      });
    });

    it('should return true if error is absent', done => {
      jest.spyOn(instance, 'getMetadata').mockImplementation(
          (
            opts_:
              | inst.GetInstanceMetadataOptions
              | inst.GetInstanceMetadataCallback,
            cb,
          ) => {
            cb = typeof opts_ === 'function' ? opts_ : cb;
            cb(null);
          },
        );

      instance.exists((err, exists) => {
        (err => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(true);
        done();
      });
    });

    it('should return false if not found error if present', done => {
      const error = {code: 5};

      jest.spyOn(instance, 'getMetadata').mockImplementation(
          (
            opts_:
              | inst.GetInstanceMetadataOptions
              | inst.GetInstanceMetadataCallback,
            callback,
          ) => {
            callback = typeof opts_ === 'function' ? opts_ : callback;

            callback(error as grpc.ServiceError);
          },
        );

      instance.exists((err, exists) => {
        (err => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(false);
        done();
      });
    });

    it('should accept and pass gaxOptions to getMetadata', done => {
      const gaxOptions = {};
      (instance.getMetadata as Function) = options => {
        expect(options.gaxOptions).toBe(gaxOptions);
        done();
      };
      instance.exists(gaxOptions, (err => { expect(err).toBeFalsy(); }));
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const options = {};

      jest.spyOn(instance, 'getMetadata').mockImplementation(() => done());

      instance.get(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should accept and pass gaxOptions to getMetadata', done => {
      const gaxOptions = {};
      (instance.getMetadata as Function) = options => {
        expect(options.gaxOptions).toBe(gaxOptions);
        done();
      };

      instance.get({gaxOptions}, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require an options object', done => {
      jest.spyOn(instance, 'getMetadata').mockImplementation(() => done());

      instance.get((err => { expect(err).toBeFalsy(); }));
    });

    it('should accept and pass `fields` string as is', () => {
      const fieldNames = 'nodeCount';
      const spyMetadata = jest.spyOn(instance, 'getMetadata');

      instance.get({fieldNames}, (err => { expect(err).toBeFalsy(); }));

      expect(spyMetadata).toHaveBeenCalledWith({fieldNames}, expect.any(Function));
    });

    it('should accept and pass `fields` array as is', () => {
      const fieldNames = ['name', 'labels', 'nodeCount'];
      const spyMetadata = jest.spyOn(instance, 'getMetadata');

      instance.get({fieldNames}, (err => { expect(err).toBeFalsy(); }));

      expect(spyMetadata).toHaveBeenCalledWith({fieldNames}, expect.any(Function));
    });

    describe('autoCreate', () => {
      const error = new ApiError('Error.') as grpc.ServiceError;
      error.code = 5;

      const OPTIONS = {
        autoCreate: true,
      };

      const OPERATION = {
        listeners: {},
        on(eventName, callback) {
          OPERATION.listeners[eventName] = callback;
          return OPERATION;
        },
      };

      beforeEach(() => {
        OPERATION.listeners = {};

        jest.spyOn(instance, 'getMetadata').mockImplementation((opts_: {}, callback) => callback!(error));

        instance.create = (options, callback) => {
          callback(null, null, OPERATION);
        };
      });

      it('should accet and pass createInstanceRequest options to create', done => {
        const config = 'config';
        const nodes = 1;
        const displayName = 'displayName';
        const labels = {label: 'mayLabael'};

        instance.create = options => {
          expect(options.fieldNames).toBe(undefined);
          expect(options.autoCreate).toBe(undefined);
          expect(options).toEqual({config, nodes, displayName, labels});
          done();
        };
        instance.get(
          {
            autoCreate: true,
            config,
            nodes,
            displayName,
            labels,
            fieldNames: 'labels',
          },
          (err => { expect(err).toBeFalsy(); }),
        );
      });

      it('should accept and pass gaxOptions to instance#create', done => {
        const gaxOptions = {timeout: 1000};
        const options = Object.assign({}, OPTIONS, {gaxOptions});
        instance.create = options => {
          expect(options.gaxOptions).toEqual(gaxOptions);
          done();
        };

        instance.get(options, (err => { expect(err).toBeFalsy(); }));
      });

      it('should call create', done => {
        const createOptions: {autoCreate?: {}} = Object.assign({}, OPTIONS);
        delete createOptions.autoCreate;
        instance.create = options => {
          expect(options).toEqual(createOptions);
          done();
        };

        instance.get(OPTIONS, (err => { expect(err).toBeFalsy(); }));
      });

      it('should return error if create failed', done => {
        const error = new Error('Error.');

        instance.create = (options, callback) => {
          callback(error);
        };

        instance.get(OPTIONS, err => {
          expect(err).toBe(error);
          done();
        });
      });

      it('should return operation error', done => {
        const error = new Error('Error.');

        setImmediate(() => {
          OPERATION.listeners['error'](error);
        });

        instance.get(OPTIONS, err => {
          expect(err).toBe(error);
          done();
        });
      });

      it('should execute callback if opereation succeeded', done => {
        const metadata = {};

        setImmediate(() => {
          OPERATION.listeners['complete'](metadata);
        });

        instance.get(OPTIONS, (err, instance_, apiResponse) => {
          (err => { expect(err).toBeFalsy(); })(err);
          expect(instance_).toBe(instance);
          expect(instance.metadata).toBe(metadata);
          expect(metadata).toBe(apiResponse);
          done();
        });
      });
    });

    it('should not auto create without error code 5', done => {
      const error = new Error('Error.') as grpc.ServiceError;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).code = 'NOT-5';

      const options = {
        autoCreate: true,
      };

      jest.spyOn(instance, 'getMetadata').mockImplementation((opts_: {}, callback) => callback!(error));

      instance.create = () => {
        throw new Error('Should not create.');
      };

      instance.get(options, err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should not auto create unless requested', done => {
      const error = new ApiError('Error.') as grpc.ServiceError;
      error.code = 5;

      jest.spyOn(instance, 'getMetadata').mockImplementation((opts_: {}, callback) => callback!(error));

      instance.create = () => {
        throw new Error('Should not create.');
      };

      instance.get(err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.') as grpc.ServiceError;

      jest.spyOn(instance, 'getMetadata').mockImplementation((opts_: {}, callback) => callback!(error));

      instance.get(err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return self and API response', done => {
      const apiResponse = {} as inst.IInstance;

      jest.spyOn(instance, 'getMetadata').mockImplementation((opts_: {}, callback) => callback!(null, apiResponse));

      instance.get((err, instance_, apiResponse_) => {
        (err => { expect(err).toBeFalsy(); })(err);
        expect(instance_).toBe(instance);
        expect(apiResponse_).toBe(apiResponse);
        done();
      });
    });
  });

  describe('getDatabases', () => {
    const pageSize = 3;
    const OPTIONS = {
      pageSize,
      gaxOptions: {autoPaginate: false},
    } as inst.GetDatabasesOptions;
    const ORIGINAL_OPTIONS = Object.assign({}, OPTIONS);

    it('should make the correct request', done => {
      const expectedReqOpts = Object.assign({}, OPTIONS, {
        parent: instance.formattedName_,
      });
      delete expectedReqOpts.gaxOptions;

      instance.request = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('listDatabases');
        expect(config.reqOpts).toEqual(expectedReqOpts);

        expect(config.reqOpts).not.toBe(OPTIONS);
        expect(OPTIONS).toEqual(ORIGINAL_OPTIONS);

        expect(config.gaxOpts).toEqual(OPTIONS.gaxOptions);
        expect(config.headers).toEqual(instance.commonHeaders_);

        done();
      };

      instance.getDatabases(OPTIONS, (err => { expect(err).toBeFalsy(); }));
    });

    it('should pass pageSize and pageToken from gaxOptions into reqOpts', done => {
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};
      const options = {gaxOptions};
      const expectedReqOpts: {gaxOptions?: {}} = Object.assign(
        {},
        options,
        {
          parent: instance.formattedName_,
        },
        {pageSize: gaxOptions.pageSize, pageToken: gaxOptions.pageToken},
      );
      delete expectedReqOpts.gaxOptions;

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getDatabases(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('pageSize and pageToken in options should take precedence over gaxOptions', done => {
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};

      const optionsPageSize = 5;
      const optionsPageToken = 'optionsToken';
      const options = {
        pageSize: optionsPageSize,
        pageToken: optionsPageToken,
        gaxOptions,
      };
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: optionsPageSize, pageToken: optionsPageToken},
      );
      delete expectedReqOpts.gaxOptions;

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getDatabases(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require options', done => {
      instance.request = config => {
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
        });

        expect(config.gaxOpts).toEqual({});

        done();
      };

      instance.getDatabases((err => { expect(err).toBeFalsy(); }));
    });

    describe('error', () => {
      const REQUEST_RESPONSE_ARGS = [new Error('Error.'), null, null, {}];

      beforeEach(() => {
        instance.request = (config, callback: Function) => {
          callback(...REQUEST_RESPONSE_ARGS);
        };
      });

      it('should execute callback with original arguments', done => {
        instance.getDatabases(OPTIONS, (...args) => {
          expect(args).toEqual(REQUEST_RESPONSE_ARGS);
          done();
        });
      });
    });

    describe('success', () => {
      const DATABASES = [
        {
          name: 'database-name',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const REQUEST_RESPONSE_ARGS: any = [null, DATABASES, null, {}];

      beforeEach(() => {
        instance.request = (config, callback) => {
          callback(...REQUEST_RESPONSE_ARGS);
        };
      });

      it('should create and return Database objects', done => {
        const fakeDatabaseInstance = {};

        instance.database = (name, options) => {
          expect(name).toBe(DATABASES[0].name);
          expect((options as SessionPoolOptions).min).toBe(0);
          return fakeDatabaseInstance as Database;
        };

        instance.getDatabases(OPTIONS, (...args) => {
          (err => { expect(err).toBeFalsy(); })(args[0]);
          expect(args[0]).toBe(REQUEST_RESPONSE_ARGS[0]);
          const database = args[1]!.pop();
          expect(database).toBe(fakeDatabaseInstance);
          expect(database!.metadata).toBe(REQUEST_RESPONSE_ARGS[1][0]);
          expect(args[2]).toBe(REQUEST_RESPONSE_ARGS[2]);
          expect(args[3]).toBe(REQUEST_RESPONSE_ARGS[3]);
          done();
        });
      });

      it('should return a complete nextQuery object', done => {
        const pageSize = 1;
        const filter = 'filter';
        const NEXTPAGEREQUEST = {
          parent: instance.formattedName_,
          pageSize,
          filter,
          pageToken: 'pageToken',
        };
        const REQUEST_RESPONSE_ARGS = [null, [], NEXTPAGEREQUEST, {}];

        const GETDATABASESOPTIONS = {
          pageSize,
          filter,
          gaxOptions: {timeout: 1000, autoPaginate: false},
        };
        const EXPECTEDNEXTQUERY = Object.assign(
          {},
          GETDATABASESOPTIONS,
          NEXTPAGEREQUEST,
        );
        instance.request = (config, callback) => {
          callback(...REQUEST_RESPONSE_ARGS);
        };
        function callback(err, databases, nextQuery) {
          expect(nextQuery).toEqual(EXPECTEDNEXTQUERY);
          done();
        }
        instance.getDatabases(GETDATABASESOPTIONS, callback);
      });
    });
  });

  describe('getDatabasesStream', () => {
    const OPTIONS = {
      gaxOptions: {autoPaginate: false},
    } as inst.GetDatabasesOptions;
    const returnValue = {} as Duplex;

    it('should make and return the correct gax API call', () => {
      const expectedReqOpts = Object.assign({}, OPTIONS, {
        parent: instance.formattedName_,
      });
      delete expectedReqOpts.gaxOptions;

      instance.requestStream = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('listDatabasesStream');
        expect(config.reqOpts).toEqual(expectedReqOpts);

        expect(config.reqOpts).not.toBe(OPTIONS);

        expect(config.gaxOpts).toEqual(OPTIONS.gaxOptions);
        expect(config.headers).toEqual(instance.commonHeaders_);

        return returnValue;
      };

      const returnedValue = instance.getDatabasesStream(OPTIONS);
      expect(returnedValue).toBe(returnValue);
    });

    it('should pass pageSize and pageToken from gaxOptions into reqOpts', () => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};
      const options = {gaxOptions};
      const expectedReqOpts = Object.assign(
        {},
        {
          parent: instance.formattedName_,
        },
        {pageSize: gaxOptions.pageSize, pageToken: gaxOptions.pageToken},
      );

      instance.requestStream = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        return returnValue;
      };

      const returnedValue = instance.getDatabasesStream(options);
      expect(returnedValue).toBe(returnValue);
    });

    it('pageSize and pageToken in options should take precedence over gaxOptions', () => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};

      const optionsPageSize = 5;
      const optionsPageToken = 'optionsToken';
      const options = {
        pageSize: optionsPageSize,
        pageToken: optionsPageToken,
        gaxOptions,
      };
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: optionsPageSize, pageToken: optionsPageToken},
      );
      delete expectedReqOpts.gaxOptions;

      instance.requestStream = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        return returnValue;
      };

      const returnedValue = instance.getDatabasesStream(options);
      expect(returnedValue).toBe(returnValue);
    });

    it('should not require options', () => {
      instance.requestStream = config => {
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
        });

        expect(config.gaxOpts).toEqual({});

        return returnValue;
      };

      const returnedValue = instance.getDatabasesStream();
      expect(returnedValue).toBe(returnValue);
    });
  });

  describe('getMetadata', () => {
    it('should correctly call and return request', () => {
      const requestReturnValue = {};

      function callback() {}

      instance.request = config => {
        expect(config.client).toBe('InstanceAdminClient');
        expect(config.method).toBe('getInstance');
        expect(config.reqOpts).toEqual({
          name: instance.formattedName_,
        });
        expect(config.gaxOpts).toBe(undefined);
        expect(config.headers).toEqual(instance.commonHeaders_);
        return requestReturnValue;
      };

      const returnValue = instance.getMetadata(callback);
      expect(returnValue).toBe(requestReturnValue);
    });

    it('should accept `fieldNames` as string', done => {
      const fieldNames = 'nodeCount';

      instance.request = config => {
        expect(config.reqOpts).toEqual({
          fieldMask: {
            paths: toArray(fieldNames).map(snakeCase),
          },
          name: instance.formattedName_,
        });
        done();
      };
      instance.getMetadata({fieldNames}, (err => { expect(err).toBeFalsy(); }));
    });

    it('should accept `fieldNames` as string array', done => {
      const fieldNames = ['name', 'labels', 'nodeCount'];

      instance.request = config => {
        expect(config.reqOpts).toEqual({
          fieldMask: {
            paths: fieldNames.map(snakeCase),
          },
          name: instance.formattedName_,
        });
        done();
      };
      instance.getMetadata({fieldNames}, (err => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      instance.request = config => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };
      instance.getMetadata({gaxOptions}, (err => { expect(err).toBeFalsy(); }));
    });

    it('should update metadata', done => {
      const metadata = {};
      instance.request = (config, callback) => {
        callback(null, metadata);
      };
      instance.getMetadata(() => {
        expect(instance.metadata).toBe(metadata);
        done();
      });

      it('should call callback with error', done => {
        const error = new Error('Error');
        instance.request = (config, callback) => {
          callback(error);
        };
        instance.getMetadata(err => {
          expect(err).toBe(error);
          done();
        });
      });
    });
  });

  describe('setMetadata', () => {
    const METADATA = {
      needsToBeSnakeCased: true,
    } as inst.IInstance;
    const ORIGINAL_METADATA = Object.assign({}, METADATA);

    it('should make and return the request', () => {
      const requestReturnValue = {};

      function callback() {}

      instance.request = (config, callback_) => {
        expect(config.client).toBe('InstanceAdminClient');
        expect(config.method).toBe('updateInstance');

        const expectedReqOpts = Object.assign({}, METADATA, {
          name: instance.formattedName_,
        });

        expect(config.reqOpts.instance).toEqual(expectedReqOpts);
        expect(config.reqOpts.fieldMask).toEqual({
          paths: ['needs_to_be_snake_cased'],
        });

        expect(METADATA).toEqual(ORIGINAL_METADATA);
        expect(config.gaxOpts).toEqual({});
        expect(config.headers).toEqual(instance.commonHeaders_);

        expect(callback_).toBe(callback);

        return requestReturnValue;
      };

      const returnValue = instance.setMetadata(METADATA, callback);
      expect(returnValue).toBe(requestReturnValue);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      instance.request = config => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };
      instance.setMetadata(METADATA, gaxOptions, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require a callback', () => {
      expect(async () => {
        await instance.setMetadata(METADATA);
      }).not.toThrow();
    });
  });

  describe('getBackups', () => {
    const OPTIONS = {
      a: 'b',
    } as inst.GetBackupsOptions;
    const ORIGINAL_OPTIONS = Object.assign({}, OPTIONS);

    it('should make the correct request', done => {
      const gaxOpts = {
        timeout: 1000,
      };
      const options = {a: 'b', gaxOptions: gaxOpts};

      const expectedReqOpts = Object.assign({}, OPTIONS, {
        parent: instance.formattedName_,
      });

      instance.request = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('listBackups');
        expect(config.reqOpts).toEqual(expectedReqOpts);

        expect(config.reqOpts).not.toBe(OPTIONS);
        expect(OPTIONS).toEqual(ORIGINAL_OPTIONS);

        expect(config.gaxOpts).toEqual(options.gaxOptions);
        expect(config.headers).toEqual(instance.commonHeaders_);
        done();
      };

      instance.getBackups(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should pass pageSize and pageToken from gaxOptions into reqOpts', done => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};
      const options = {gaxOptions};
      const expectedReqOpts = Object.assign(
        {},
        {
          parent: instance.formattedName_,
        },
        {pageSize: gaxOptions.pageSize, pageToken: gaxOptions.pageToken},
      );

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getBackups(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('pageSize and pageToken in options should take precedence over gaxOptions', done => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};

      const optionsPageSize = 5;
      const optionsPageToken = 'optionsToken';
      const options = {
        pageSize: optionsPageSize,
        pageToken: optionsPageToken,
        gaxOptions,
      };
      const expectedReqOpts = Object.assign(
        {},
        {
          parent: instance.formattedName_,
        },
        {pageSize: optionsPageSize, pageToken: optionsPageToken},
      );

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getBackups(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require options', done => {
      instance.request = config => {
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
        });
        expect(config.gaxOpts).toEqual({});
        done();
      };

      instance.getBackups((err => { expect(err).toBeFalsy(); }));
    });

    describe('error', () => {
      const REQUEST_RESPONSE_ARGS = [new Error('Error.'), null, null, {}];

      beforeEach(() => {
        instance.request = (config, callback: Function) => {
          callback(...REQUEST_RESPONSE_ARGS);
        };
      });

      it('should execute callback with original arguments', done => {
        instance.getBackups(OPTIONS, (...args) => {
          expect(args).toEqual(REQUEST_RESPONSE_ARGS);
          done();
        });
      });
    });

    describe('success', () => {
      const BACKUPS = [
        {
          name: 'backup-name',
          database: 'database-name',
          expireTime: new PreciseDate(1000),
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const REQUEST_RESPONSE_ARGS: any = [null, BACKUPS, null, {}];

      beforeEach(() => {
        instance.request = (config, callback) => {
          callback(...REQUEST_RESPONSE_ARGS);
        };
      });

      it('should create and return Backup objects', done => {
        const fakeBackupInstance = {};

        instance.backup = backupId => {
          expect(backupId).toBe(BACKUPS[0].name);
          return fakeBackupInstance as Backup;
        };

        instance.getBackups(OPTIONS, (...args) => {
          (err => { expect(err).toBeFalsy(); })(args[0]);
          expect(args[0]).toBe(REQUEST_RESPONSE_ARGS[0]);
          const backup = args[1]!.pop();
          expect(backup).toBe(fakeBackupInstance);
          expect(backup!.metadata).toBe(REQUEST_RESPONSE_ARGS[1][0]);
          expect(args[2]).toBe(REQUEST_RESPONSE_ARGS[2]);
          expect(args[3]).toBe(REQUEST_RESPONSE_ARGS[3]);
          done();
        });
      });

      it('should return a complete nextQuery object', done => {
        const pageSize = 1;
        const filter = 'filter';
        const NEXTPAGEREQUEST = {
          parent: instance.formattedName_,
          pageSize,
          filter,
          pageToken: 'pageToken',
        };
        const REQUEST_RESPONSE_ARGS = [null, [], NEXTPAGEREQUEST, {}];

        const GETBACKUPSOPTIONS = {
          pageSize,
          filter,
          gaxOptions: {timeout: 1000, autoPaginate: false},
        };
        const EXPECTEDNEXTQUERY = Object.assign(
          {},
          GETBACKUPSOPTIONS,
          NEXTPAGEREQUEST,
        );
        instance.request = (config, callback) => {
          callback(...REQUEST_RESPONSE_ARGS);
        };
        function callback(err, backups, nextQuery) {
          expect(nextQuery).toEqual(EXPECTEDNEXTQUERY);
          done();
        }
        instance.getBackups(GETBACKUPSOPTIONS, callback);
      });
    });
  });

  describe('getBackupsStream', () => {
    const OPTIONS = {
      gaxOptions: {autoPaginate: false},
    } as inst.GetDatabasesOptions;
    const returnValue = {} as Duplex;

    it('should make and return the correct gax API call', () => {
      const expectedReqOpts = Object.assign({}, OPTIONS, {
        parent: instance.formattedName_,
      });
      delete expectedReqOpts.gaxOptions;

      instance.requestStream = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('listBackupsStream');
        expect(config.reqOpts).toEqual(expectedReqOpts);

        expect(config.reqOpts).not.toBe(OPTIONS);

        expect(config.gaxOpts).toEqual(OPTIONS.gaxOptions);
        expect(config.headers).toEqual(instance.commonHeaders_);

        return returnValue;
      };

      const returnedValue = instance.getBackupsStream(OPTIONS);
      expect(returnedValue).toBe(returnValue);
    });

    it('should pass pageSize and pageToken from gaxOptions into reqOpts', () => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};
      const options = {gaxOptions};
      const expectedReqOpts = Object.assign(
        {},
        {
          parent: instance.formattedName_,
        },
        {pageSize: gaxOptions.pageSize, pageToken: gaxOptions.pageToken},
      );

      instance.requestStream = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        return returnValue;
      };

      const returnedValue = instance.getBackupsStream(options);
      expect(returnedValue).toBe(returnValue);
    });

    it('pageSize and pageToken in options should take precedence over gaxOptions', () => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};

      const optionsPageSize = 5;
      const optionsPageToken = 'optionsToken';
      const options = {
        pageSize: optionsPageSize,
        pageToken: optionsPageToken,
        gaxOptions,
      };
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: optionsPageSize, pageToken: optionsPageToken},
      );
      delete expectedReqOpts.gaxOptions;

      instance.requestStream = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        return returnValue;
      };

      const returnedValue = instance.getBackupsStream(options);
      expect(returnedValue).toBe(returnValue);
    });

    it('should not require options', () => {
      instance.requestStream = config => {
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
        });

        expect(config.gaxOpts).toEqual({});

        return returnValue;
      };

      const returnedValue = instance.getBackupsStream();
      expect(returnedValue).toBe(returnValue);
    });
  });

  describe('backup', () => {
    const BACKUP_NAME = 'backup-name';

    it('should throw if a backup ID is not provided', () => {
      expect(() => {
        instance.backup(null!);
      }).toThrow(/A backup ID is required to create a Backup\./);
    });

    it('should return an instance of Backup', () => {
      const backup = instance.backup(BACKUP_NAME) as {} as FakeBackup;
      expect(backup instanceof FakeBackup).toBeTruthy();
      expect(backup.calledWith_[0]).toBe(instance);
      expect(backup.calledWith_[1]).toBe(BACKUP_NAME);
    });
  });

  describe('getBackupOperations', () => {
    const OPTIONS = {
      a: 'b',
    } as inst.GetBackupOperationsOptions;
    const ORIGINAL_OPTIONS = Object.assign({}, OPTIONS);

    it('should make the correct request', done => {
      const gaxOpts = {
        timeout: 1000,
      };
      const options = {a: 'b', gaxOptions: gaxOpts};

      const expectedReqOpts = Object.assign({}, OPTIONS, {
        parent: instance.formattedName_,
      });

      instance.request = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('listBackupOperations');
        expect(config.reqOpts).toEqual(expectedReqOpts);

        expect(config.reqOpts).not.toBe(OPTIONS);
        expect(OPTIONS).toEqual(ORIGINAL_OPTIONS);

        expect(config.gaxOpts).toEqual(options.gaxOptions);
        done();
      };

      instance.getBackupOperations(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should pass pageSize and pageToken from gaxOptions into reqOpts', done => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};
      const options = Object.assign({}, OPTIONS, {gaxOptions});
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: gaxOptions.pageSize, pageToken: gaxOptions.pageToken},
      );

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getBackupOperations(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('pageSize and pageToken in options should take precedence over gaxOptions', done => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};

      const optionsPageSize = 5;
      const optionsPageToken = 'optionsToken';
      const options = Object.assign({}, OPTIONS, {
        pageSize: optionsPageSize,
        pageToken: optionsPageToken,
        gaxOptions,
      });
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: optionsPageSize, pageToken: optionsPageToken},
      );

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getBackupOperations(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require options', done => {
      instance.request = config => {
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
        });

        expect(config.gaxOpts).toEqual({});
        done();
      };

      instance.getBackupOperations((err => { expect(err).toBeFalsy(); }));
    });

    it('should return a complete nextQuery object', done => {
      const pageSize = 1;
      const filter = 'filter';
      const NEXTPAGEREQUEST = {
        parent: instance.formattedName_,
        pageSize,
        filter,
        pageToken: 'pageToken',
      };
      const RESPONSE = [null, [], NEXTPAGEREQUEST, {}];

      const GETBACKUPOPSOPTIONS = {
        pageSize,
        filter,
        gaxOptions: {timeout: 1000, autoPaginate: false},
      };
      const EXPECTEDNEXTQUERY = Object.assign(
        {},
        GETBACKUPOPSOPTIONS,
        NEXTPAGEREQUEST,
      );
      instance.request = (config, callback) => {
        callback(...RESPONSE);
      };
      function callback(err, backupOps, nextQuery) {
        expect(nextQuery).toEqual(EXPECTEDNEXTQUERY);
        done();
      }
      instance.getBackupOperations(GETBACKUPOPSOPTIONS, callback);
    });
  });

  describe('getDatabaseOperations', () => {
    const OPTIONS = {
      a: 'b',
    } as inst.GetDatabaseOperationsOptions;
    const ORIGINAL_OPTIONS = Object.assign({}, OPTIONS);

    it('should make the correct request', done => {
      const gaxOpts = {
        timeout: 1000,
      };
      const options = {a: 'b', gaxOptions: gaxOpts};

      const expectedReqOpts = Object.assign({}, OPTIONS, {
        parent: instance.formattedName_,
      });

      instance.request = config => {
        expect(config.client).toBe('DatabaseAdminClient');
        expect(config.method).toBe('listDatabaseOperations');
        expect(config.reqOpts).toEqual(expectedReqOpts);

        expect(config.reqOpts).not.toBe(OPTIONS);
        expect(OPTIONS).toEqual(ORIGINAL_OPTIONS);

        expect(config.gaxOpts).toEqual(options.gaxOptions);
        expect(config.headers).toEqual(instance.commonHeaders_);
        done();
      };

      instance.getDatabaseOperations(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should pass pageSize and pageToken from gaxOptions into reqOpts', done => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};
      const options = Object.assign({}, OPTIONS, {gaxOptions});
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: gaxOptions.pageSize, pageToken: gaxOptions.pageToken},
      );

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getDatabaseOperations(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('pageSize and pageToken in options should take precedence over gaxOptions', done => {
      const pageSize = 3;
      const pageToken = 'token';
      const gaxOptions = {pageSize, pageToken, timeout: 1000};
      const expectedGaxOpts = {timeout: 1000};

      const optionsPageSize = 5;
      const optionsPageToken = 'optionsToken';
      const options = Object.assign({}, OPTIONS, {
        pageSize: optionsPageSize,
        pageToken: optionsPageToken,
        gaxOptions,
      });
      const expectedReqOpts = Object.assign(
        {},
        OPTIONS,
        {
          parent: instance.formattedName_,
        },
        {pageSize: optionsPageSize, pageToken: optionsPageToken},
      );

      instance.request = config => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        expect(config.gaxOpts).not.toBe(gaxOptions);
        expect(config.gaxOpts).not.toEqual(gaxOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);

        done();
      };

      instance.getDatabaseOperations(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require options', done => {
      instance.request = config => {
        expect(config.reqOpts).toEqual({
          parent: instance.formattedName_,
        });

        expect(config.gaxOpts).toEqual({});
        done();
      };

      instance.getDatabaseOperations((err => { expect(err).toBeFalsy(); }));
    });

    it('should return a complete nextQuery object', done => {
      const pageSize = 1;
      const filter = 'filter';
      const NEXTPAGEREQUEST = {
        parent: instance.formattedName_,
        pageSize,
        filter,
        pageToken: 'pageToken',
      };
      const RESPONSE = [null, [], NEXTPAGEREQUEST, {}];

      const GETDATABASEOPSOPTIONS = {
        pageSize,
        filter,
        gaxOptions: {timeout: 1000, autoPaginate: false},
      };
      const EXPECTEDNEXTQUERY = Object.assign(
        {},
        GETDATABASEOPSOPTIONS,
        NEXTPAGEREQUEST,
      );
      instance.request = (config, callback) => {
        callback(...RESPONSE);
      };
      function callback(err, databaseOps, nextQuery) {
        expect(nextQuery).toEqual(EXPECTEDNEXTQUERY);
        done();
      }
      instance.getDatabaseOperations(GETDATABASEOPSOPTIONS, callback);
    });
  });
});
