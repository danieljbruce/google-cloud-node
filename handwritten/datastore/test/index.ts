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

import * as gax from 'google-gax';
import {PassThrough, Readable} from 'stream';

import * as ds from '../src';
import {AggregateField, Datastore, DatastoreOptions} from '../src';
import {Datastore as OriginalDatastore} from '../src';
import {
  entity,
  Entity,
  EntityProto,
  EntityObject,
  Entities,
} from '../src/entity';
import {RequestCallback, RequestConfig} from '../src/request';
import {ExplainOptions, ExplainMetrics, RunQueryInfo} from '../src/query';
import * as is from 'is';
import * as extend from 'extend';
import {google} from '../src/protos';
import {ServiceError} from 'google-gax';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const v1 = require('../src/v1');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeEntityInit: any = {
  KEY_SYMBOL: Symbol('fake key symbol'),
  Int: class {
    value: {};
    constructor(value: {}) {
      this.value = value;
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isDsInt(...args: any[]) {
    this.calledWith_ = args;
  },
  Double: class {
    value: {};
    constructor(value: {}) {
      this.value = value;
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isDsDouble(...args: any[]) {
    this.calledWith_ = args;
  },
  GeoPoint: class {
    value: {};
    constructor(value: {}) {
      this.value = value;
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isDsGeoPoint(...args: any) {
    this.calledWith_ = args;
  },
  Key: class {
    calledWith_: IArguments;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any) {
      this.calledWith_ = args;
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isDsKey(...args: any) {
    this.calledWith_ = args;
  },
  isKeyComplete: entity.isKeyComplete,
  keyFromKeyProto: entity.keyFromKeyProto,
  keyToKeyProto: entity.keyToKeyProto,
  encodeValue: entity.encodeValue,
  entityToEntityProto: entity.entityToEntityProto,
  addExcludeFromIndexes: entity.addExcludeFromIndexes,
  findLargeProperties_: entity.findLargeProperties_,
  URLSafeKey: entity.URLSafeKey,
};

// eslint-disable-next-line no-var
var mockFakeEntity: any = fakeEntityInit;


let googleAuthOverride: Function | null = null;
function fakeGoogleAuth(...args: Array<{}>) {
  return (googleAuthOverride || (() => {}))(...args);
}

let createInsecureOverride: Function | null = null;

const SECOND_DATABASE_ID = 'multidb-test';
export {SECOND_DATABASE_ID};

jest.mock('google-auth-library', () => ({
  GoogleAuth: fakeGoogleAuth,
}));

jest.mock('google-gax', () => {
  const actual = jest.requireActual('google-gax');
  return {
    ...actual,
    GoogleAuth: fakeGoogleAuth,
    GrpcClient: class extends actual.GrpcClient {
      constructor(opts: any) {
        super(opts);
        this.grpc = {
          credentials: {
            createInsecure(...args: any[]) {
              return (createInsecureOverride || (() => {}))(...args);
            },
          },
        } as any;
      }
    },
  };
});

// eslint-disable-next-line no-var
var MockIndex = class {
  calledWith_: Array<{}>;
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
};

// eslint-disable-next-line no-var
var MockQuery = class {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
};

// eslint-disable-next-line no-var
var MockTransaction = class {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
};

jest.mock('../src/index-class', () => {
  const actual = jest.requireActual('../src/index-class');
  return {
    get Index() {
      return MockIndex || actual.Index;
    },
  };
});
jest.mock('../src/query', () => {
  const actual = jest.requireActual('../src/query');
  return {
    get Query() {
      return MockQuery || actual.Query;
    },
  };
});
jest.mock('../src/transaction', () => {
  const actual = jest.requireActual('../src/transaction');
  return {
    get Transaction() {
      return MockTransaction || actual.Transaction;
    },
  };
});
jest.mock('../src/v1', () => {
  const actual = jest.requireActual('../src/v1');
  return actual;
});
jest.mock('../src/entity', () => {
  const actual = jest.requireActual('../src/entity');
  return {
    get entity() {
      return (mockFakeEntity && Object.keys(mockFakeEntity).length > 0)
        ? mockFakeEntity
        : actual.entity;
    },
  };
});


const clientTestCases = [
  {namespace: `${Date.now()}`},
  {namespace: `second-db-${Date.now()}`, databaseId: SECOND_DATABASE_ID},
];
for (const clientOptions of clientTestCases) {
  describe('Datastore', () => {
    const Datastore = ds.Datastore;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let datastore: any;

      const PROJECT_ID = 'project-id';
      const NAMESPACE = 'namespace';

      const DATASTORE_PROJECT_ID_CACHED = process.env.DATASTORE_PROJECT_ID;

      const DEFAULT_OPTIONS = {
        projectId: PROJECT_ID,
        apiEndpoint: 'http://localhost',
        credentials: {},
        keyFilename: 'key/file',
        email: 'email',
        namespace: NAMESPACE,
      };

      const OPTIONS = Object.assign(DEFAULT_OPTIONS, clientOptions);



      beforeEach(() => {
        Object.assign(mockFakeEntity, fakeEntityInit);

        createInsecureOverride = null;
        googleAuthOverride = null;

        datastore = new Datastore({
          projectId: PROJECT_ID,
          namespace: NAMESPACE,
        });
      });

      afterEach(() => {
        if (typeof DATASTORE_PROJECT_ID_CACHED === 'string') {
          process.env.DATASTORE_PROJECT_ID = DATASTORE_PROJECT_ID_CACHED;
        } else {
          delete process.env.DATASTORE_PROJECT_ID;
        }
      });

      afterAll(() => {
        createInsecureOverride = null;
        googleAuthOverride = null;
      });

      it('should export GAX client', () => {
        expect(require('../src').v1).toBeTruthy();
      });

      describe('instantiation', () => {
        it('should initialize an empty Client map', () => {
          expect(datastore.clients_ instanceof Map).toBeTruthy();
          expect(datastore.clients_.size).toBe(0);
        });

        it('should alias itself to the datastore property', () => {
          expect(datastore.datastore).toBe(datastore);
        });

        it('should localize the namespace', () => {
          expect(datastore.namespace).toBe(NAMESPACE);
        });

        it('should localize the projectId', () => {
          expect(datastore.options.projectId).toBe(PROJECT_ID);
        });

        it('should not default options.projectId to placeholder', () => {
          const datastore = new Datastore({});
          expect(datastore.options.projectId).toBe(undefined);
        });

        it('should use DATASTORE_PROJECT_ID', () => {
          const projectId = 'overridden-project-id';
          process.env.DATASTORE_PROJECT_ID = projectId;
          const datastore = new Datastore({});
          expect(datastore.options.projectId).toBe(projectId);
        });

        it('should set the default base URL', () => {
          expect(datastore.defaultBaseUrl_).toBe('datastore.googleapis.com');
        });

        it('should set default API connection details', done => {
          const determineBaseUrl_ = Datastore.prototype.determineBaseUrl_;

          Datastore.prototype.determineBaseUrl_ = customApiEndpoint => {
            Datastore.prototype.determineBaseUrl_ = determineBaseUrl_;

            expect(customApiEndpoint).toBe(OPTIONS.apiEndpoint);
            done();
          };

          new Datastore(OPTIONS);
        });

        it('should localize the options', () => {
          delete process.env.DATASTORE_PROJECT_ID;

          const options = {
            a: 'b',
            c: 'd',
          } as DatastoreOptions;

          const datastore = new Datastore(options);

          expect(datastore.options).not.toBe(options);

          expect(datastore.options).toEqual(Object.assign(
              {
                libName: 'gccl',
                libVersion: require('../../package.json').version,
                scopes: v1.DatastoreClient.scopes,
                servicePath: datastore.baseUrl_,
                port: 443,
                projectId: undefined,
              },
              options,
            ));
        });

        it('should set port if detected', () => {
          const determineBaseUrl_ = Datastore.prototype.determineBaseUrl_;
          const port = 99;
          Datastore.prototype.determineBaseUrl_ = function () {
            Datastore.prototype.determineBaseUrl_ = determineBaseUrl_;
            this.port_ = port;
          };
          const datastore = new Datastore(OPTIONS);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((datastore.options as any).port).toBe(port);
        });

        it('should set grpc ssl credentials if localhost custom endpoint', () => {
          const fakeInsecureCreds = {};
          createInsecureOverride = () => {
            return fakeInsecureCreds;
          };

          const datastore = new Datastore(OPTIONS);

          expect(datastore.options.sslCreds).toBe(fakeInsecureCreds);
        });

        describe('checking ssl credentials are set correctly with custom endpoints', () => {
          function setHost(host: string) {
            process.env.DATASTORE_EMULATOR_HOST = host;
          }

          const sslCreds = gax.grpc.ChannelCredentials.createSsl();
          const fakeInsecureCreds = {
            insecureCredProperty: 'insecureCredPropertyValue',
          };

          beforeEach(() => {
            createInsecureOverride = () => {
              return fakeInsecureCreds;
            };
          });

          describe('without DATASTORE_EMULATOR_HOST environment variable set', () => {
            beforeEach(() => {
              delete process.env.DATASTORE_EMULATOR_HOST;
            });

            describe('using a localhost endpoint', () => {
              const apiEndpoint = 'http://localhost:8080';
              it('should use ssl credentials provided', () => {
                // SSL credentials provided in the constructor should always be used.
                const options = {
                  apiEndpoint,
                  sslCreds,
                };
                const datastore = new Datastore(options);
                expect(datastore.options.sslCreds).toBe(sslCreds);
              });
              it('should use insecure ssl credentials when ssl credentials are not provided', () => {
                // When using a localhost endpoint it is assumed that the emulator is being used.
                // Therefore, sslCreds should be set to insecure credentials to skip authentication.
                const datastore = new Datastore({
                  apiEndpoint,
                });
                expect(datastore.options.sslCreds).toBe(fakeInsecureCreds);
              });
            });
            describe('using a remote endpoint', () => {
              const apiEndpoint = 'http://remote:8080';
              it('should use ssl credentials provided', () => {
                // SSL credentials provided in the constructor should always be used.
                const options = {
                  apiEndpoint,
                  sslCreds,
                };
                const datastore = new Datastore(options);
                expect(datastore.options.sslCreds).toBe(sslCreds);
              });
              it('should not set ssl credentials when ssl credentials are not provided', () => {
                // When using a remote endpoint without DATASTORE_EMULATOR_HOST set,
                // it is assumed that the emulator is not being used.
                // This test captures the case where users use a regional endpoint.
                const datastore = new Datastore({
                  apiEndpoint,
                });
                expect(datastore.options.sslCreds).toBe(undefined);
              });
            });
          });
          describe('with DATASTORE_EMULATOR_HOST environment variable set', () => {
            beforeEach(() => {
              delete process.env.DATASTORE_EMULATOR_HOST;
            });

            describe('with DATASTORE_EMULATOR_HOST set to localhost', () => {
              const apiEndpoint = 'http://localhost:8080';
              beforeEach(() => {
                setHost(apiEndpoint);
              });

              it('should use ssl credentials provided', () => {
                // SSL credentials provided in the constructor should always be used.
                const datastore = new Datastore({
                  apiEndpoint,
                  sslCreds,
                });
                expect(datastore.options.sslCreds).toBe(sslCreds);
              });

              it('should use insecure ssl credentials when ssl credentials are not provided', () => {
                // When DATASTORE_EMULATOR_HOST is set it is assumed that the emulator is being used.
                // Therefore, sslCreds should be set to insecure credentials to skip authentication.
                const datastore = new Datastore({
                  apiEndpoint,
                });
                expect(datastore.options.sslCreds).toBe(fakeInsecureCreds);
              });
            });

            describe('with DATASTORE_EMULATOR_HOST set to remote host', () => {
              const apiEndpoint = 'http://remote:8080';
              beforeEach(() => {
                setHost(apiEndpoint);
              });

              it('should use ssl credentials provided', () => {
                // SSL credentials provided in the constructor should always be used.
                const datastore = new Datastore({
                  apiEndpoint,
                  sslCreds,
                });
                expect(datastore.options.sslCreds).toBe(sslCreds);
              });

              it('should use insecure ssl credentials when ssl credentials are not provided', () => {
                // When DATASTORE_EMULATOR_HOST is set it is assumed that the emulator is being used.
                // Therefore, sslCreds should be set to insecure credentials to skip authentication.
                const datastore = new Datastore({
                  apiEndpoint,
                });
                expect(datastore.options.sslCreds).toBe(fakeInsecureCreds);
              });
            });

            afterAll(() => {
              delete process.env.DATASTORE_EMULATOR_HOST;
            });
          });
        });

        it('should cache a local GoogleAuth instance', () => {
          const fakeGoogleAuthInstance = {};

          googleAuthOverride = () => {
            return fakeGoogleAuthInstance;
          };

          const datastore = new Datastore({});
          expect(datastore.auth).toBe(fakeGoogleAuthInstance);
        });
      });

      describe('double', () => {
        it('should expose Double builder', () => {
          const aDouble = 7.0;
          const double = Datastore.double(aDouble);
          expect(double.value).toBe(aDouble);
        });

        it('should also be on the prototype', () => {
          const aDouble = 7.0;
          const double = datastore.double(aDouble);
          expect(double.value).toBe(aDouble);
        });
      });

      describe('geoPoint', () => {
        it('should expose GeoPoint builder', () => {
          const aGeoPoint = {latitude: 24, longitude: 88};
          const geoPoint = Datastore.geoPoint(aGeoPoint);
          expect(geoPoint.value).toBe(aGeoPoint);
        });

        it('should also be on the prototype', () => {
          const aGeoPoint = {latitude: 24, longitude: 88};
          const geoPoint = datastore.geoPoint(aGeoPoint);
          expect(geoPoint.value).toBe(aGeoPoint);
        });
      });

      describe('int', () => {
        it('should expose Int builder', () => {
          const anInt = 7;
          const int = Datastore.int(anInt);
          expect(int.value).toBe(anInt);
        });

        it('should also be on the prototype', () => {
          const anInt = 7;
          const int = datastore.int(anInt);
          expect(int.value).toBe(anInt);
        });
      });

      describe('isDouble', () => {
        it('should pass value to entity', () => {
          const value = 0.42;
          let called = false;
          const saved = mockFakeEntity.isDsDouble;
          mockFakeEntity.isDsDouble = (arg: {}) => {
            expect(arg).toBe(value);
            called = true;
            return false;
          };
          expect(datastore.isDouble(value)).toBe(false);
          expect(called).toBe(true);
          mockFakeEntity.isDsDouble = saved;
        });

        it('should expose Double identifier', () => {
          const something = {};
          Datastore.isDouble(something);
          expect(mockFakeEntity.calledWith_[0]).toBe(something);
        });
      });

      describe('isGeoPoint', () => {
        it('should pass value to entity', () => {
          const value = {fakeLatitude: 1, fakeLongitude: 2};
          let called = false;
          const saved = mockFakeEntity.isDsGeoPoint;
          mockFakeEntity.isDsGeoPoint = (arg: {}) => {
            expect(arg).toBe(value);
            called = true;
            return false;
          };
          expect(datastore.isGeoPoint(value)).toBe(false);
          expect(called).toBe(true);
          mockFakeEntity.isDsGeoPoint = saved;
        });

        it('should expose GeoPoint identifier', () => {
          const something = {};
          Datastore.isGeoPoint(something);
          expect(mockFakeEntity.calledWith_[0]).toBe(something);
        });
      });

      describe('isInt', () => {
        it('should pass value to entity', () => {
          const value = 42;
          let called = false;
          const saved = mockFakeEntity.isDsInt;
          mockFakeEntity.isDsInt = (arg: {}) => {
            expect(arg).toBe(value);
            called = true;
            return false;
          };
          expect(datastore.isInt(value)).toBe(false);
          expect(called).toBe(true);
          mockFakeEntity.isDsInt = saved;
        });

        it('should expose Int identifier', () => {
          const something = {};
          Datastore.isInt(something);
          expect(mockFakeEntity.calledWith_[0]).toBe(something);
        });
      });

      describe('isKey', () => {
        it('should pass value to entity', () => {
          const value = {zz: true};
          let called = false;
          const saved = mockFakeEntity.isDsKey;
          mockFakeEntity.isDsKey = (arg: {}) => {
            expect(arg).toBe(value);
            called = true;
            return false;
          };
          expect(datastore.isKey(value)).toBe(false);
          expect(called).toBe(true);
          mockFakeEntity.isDsKey = saved;
        });

        it('should expose Key identifier', () => {
          const something = {};
          datastore.isKey(something);
          expect(mockFakeEntity.calledWith_[0]).toBe(something);
        });
      });

      describe('KEY', () => {
        it('should expose the KEY symbol', () => {
          expect(Datastore.KEY).toBe(mockFakeEntity.KEY_SYMBOL);
        });

        it('should also be on the prototype', () => {
          expect(datastore.KEY).toBe(Datastore.KEY);
        });
      });

      describe('MORE_RESULTS_AFTER_CURSOR', () => {
        it('should expose a MORE_RESULTS_AFTER_CURSOR helper', () => {
          expect(Datastore.MORE_RESULTS_AFTER_CURSOR).toBe('MORE_RESULTS_AFTER_CURSOR');
        });

        it('should also be on the prototype', () => {
          expect(datastore.MORE_RESULTS_AFTER_CURSOR).toBe(Datastore.MORE_RESULTS_AFTER_CURSOR);
        });
      });

      describe('MORE_RESULTS_AFTER_LIMIT', () => {
        it('should expose a MORE_RESULTS_AFTER_LIMIT helper', () => {
          expect(Datastore.MORE_RESULTS_AFTER_LIMIT).toBe('MORE_RESULTS_AFTER_LIMIT');
        });

        it('should also be on the prototype', () => {
          expect(datastore.MORE_RESULTS_AFTER_LIMIT).toBe(Datastore.MORE_RESULTS_AFTER_LIMIT);
        });
      });

      describe('NO_MORE_RESULTS', () => {
        it('should expose a NO_MORE_RESULTS helper', () => {
          expect(Datastore.NO_MORE_RESULTS).toBe('NO_MORE_RESULTS');
        });

        it('should also be on the prototype', () => {
          expect(datastore.NO_MORE_RESULTS).toBe(Datastore.NO_MORE_RESULTS);
        });
      });

      describe('createQuery', () => {
        it('should return a Query object', () => {
          const namespace = 'namespace';
          const kind = ['Kind'];

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const query: any = datastore.createQuery(namespace, kind);
          expect(query instanceof MockQuery).toBeTruthy();

          expect(query.calledWith_[0]).toBe(datastore);
          expect(query.calledWith_[1]).toBe(namespace);
          expect(query.calledWith_[2]).toEqual(kind);
        });

        it('should include the default namespace', () => {
          const kind = ['Kind'];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const query: any = datastore.createQuery(kind);
          expect(query.calledWith_[0]).toBe(datastore);
          expect(query.calledWith_[1]).toBe(datastore.namespace);
          expect(query.calledWith_[2]).toEqual(kind);
        });

        it('should include the default namespace in a kindless query', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const query: any = datastore.createQuery();
          expect(query.calledWith_[0]).toBe(datastore);
          expect(query.calledWith_[1]).toBe(datastore.namespace);
          expect(query.calledWith_[2]).toEqual([]);
        });
      });

      describe('export', () => {
        it('should accept a bucket string destination', done => {
          const bucket = 'bucket';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.outputUrlPrefix).toBe(`gs://${bucket}`);
            done();
          };

          datastore.export({bucket}, () => {});
        });

        it('should remove extraneous gs:// prefix from input', done => {
          const bucket = 'gs://bucket';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.outputUrlPrefix).toBe(`${bucket}`);
            done();
          };

          datastore.export({bucket}, () => {});
        });

        it('should accept a Bucket object destination', done => {
          const bucket = {name: 'bucket'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.outputUrlPrefix).toBe(`gs://${bucket.name}`);
            done();
          };

          datastore.export({bucket}, () => {});
        });

        it('should throw if a destination is not provided', () => {
          expect(() => {
            datastore.export({}, () => {});
          }).toThrow(/A Bucket object or URL must be provided\./);
        });

        it('should throw if bucket and outputUrlPrefix are provided', () => {
          expect(() => {
            datastore.export(
              {
                bucket: 'bucket',
                outputUrlPrefix: 'output-url-prefix',
              },
              () => {},
            );
          }).toThrow(/Both `bucket` and `outputUrlPrefix` were provided\./);
        });

        it('should accept kinds', done => {
          const kinds = ['kind1', 'kind2'];
          const config = {bucket: 'bucket', kinds};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.entityFilter.kinds).toEqual(kinds);
            done();
          };

          datastore.export(config, () => {});
        });

        it('should throw if both kinds and entityFilter are provided', () => {
          expect(() => {
            datastore.export(
              {
                bucket: 'bucket',
                kinds: ['kind1', 'kind2'],
                entityFilter: {},
              },
              () => {},
            );
          }).toThrow(/Both `entityFilter` and `kinds` were provided\./);
        });

        it('should accept namespaces', done => {
          const namespaces = ['ns1', 'n2'];
          const config = {bucket: 'bucket', namespaces};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.entityFilter.namespaceIds).toEqual(namespaces);
            done();
          };

          datastore.export(config, () => {});
        });

        it('should throw if both namespaces and entityFilter are provided', () => {
          expect(() => {
            datastore.export(
              {
                bucket: 'bucket',
                namespaces: ['ns1', 'ns2'],
                entityFilter: {},
              },
              () => {},
            );
          }).toThrow(/Both `entityFilter` and `namespaces` were provided\./);
        });

        it('should remove extraneous properties from request', done => {
          const config = {
            bucket: 'bucket',
            gaxOptions: {},
            kinds: ['kind1', 'kind2'],
            namespaces: ['ns1', 'ns2'],
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(typeof config.reqOpts.bucket).toBe('undefined');
            expect(typeof config.reqOpts.gaxOptions).toBe('undefined');
            expect(typeof config.reqOpts.kinds).toBe('undefined');
            expect(typeof config.reqOpts.namespaces).toBe('undefined');
            done();
          };

          datastore.export(config, () => {});
        });

        it('should send any user input to API', done => {
          const userProperty = 'abc';
          const config = {bucket: 'bucket', userProperty};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.userProperty).toBe(userProperty);
            done();
          };

          datastore.export(config, () => {});
        });

        it('should send correct request', done => {
          const config = {bucket: 'bucket'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.client).toBe('DatastoreAdminClient');
            expect(config.method).toBe('exportEntities');
            expect(typeof config.gaxOpts).toBe('undefined');
            done();
          };

          datastore.export(config, () => {});
        });

        it('should accept gaxOptions', done => {
          const gaxOptions = {};
          const config = {bucket: 'bucket', gaxOptions};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.gaxOpts).toBe(gaxOptions);
            done();
          };

          datastore.export(config, () => {});
        });
      });

      describe('getIndexes', () => {
        it('should send the correct request', done => {
          const options = {a: 'b'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.client).toBe('DatastoreAdminClient');
            expect(config.method).toBe('listIndexes');
            expect(config.reqOpts).toEqual({
              pageSize: undefined,
              pageToken: undefined,
              ...options,
            });
            expect(config.gaxOpts).toEqual({});

            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should locate pagination settings from gaxOptions', done => {
          const options = {
            gaxOptions: {
              pageSize: 'size',
              pageToken: 'token',
            },
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.pageSize).toBe(options.gaxOptions.pageSize);
            expect(config.reqOpts.pageToken).toBe(options.gaxOptions.pageToken);
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should prefer pageSize and pageToken from options over gaxOptions', done => {
          const options = {
            pageSize: 'size-good',
            pageToken: 'token-good',
            gaxOptions: {
              pageSize: 'size-bad',
              pageToken: 'token-bad',
            },
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.pageSize).toBe(options.pageSize);
            expect(config.reqOpts.pageToken).toBe(options.pageToken);
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should remove extraneous pagination settings from request', done => {
          const options = {
            gaxOptions: {
              pageSize: 'size',
              pageToken: 'token',
            },
            autoPaginate: true,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(typeof config.gaxOpts.pageSize).toBe('undefined');
            expect(typeof config.gaxOpts.pageToken).toBe('undefined');
            expect(typeof config.reqOpts.autoPaginate).toBe('undefined');
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should accept gaxOptions', done => {
          const options = {
            gaxOptions: {a: 'b'},
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(typeof config.reqOpts.gaxOptions).toBe('undefined');
            expect(config.gaxOpts).toEqual(options.gaxOptions);
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should not send gaxOptions as request options', done => {
          const options = {
            gaxOptions: {a: 'b'},
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(Object.keys(options.gaxOptions).every(k => !config.reqOpts[k])).toBeTruthy();
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should set autoPaginate from options', done => {
          const options = {
            autoPaginate: true,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.gaxOpts.autoPaginate).toBe(options.autoPaginate);
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should prefer autoPaginate from gaxOpts', done => {
          const options = {
            autoPaginate: false,
            gaxOptions: {
              autoPaginate: true,
            },
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.gaxOpts.autoPaginate).toBe(true);
            done();
          };

          datastore.getIndexes(options, () => {});
        });

        it('should execute callback with error and correct response arguments', done => {
          const error = new Error('Error.');
          const apiResponse = {};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any, callback: Function) => {
            callback(error, [], null, apiResponse);
          };

          datastore.getIndexes(
            (err: Error, indexes: [], nextQuery: {}, apiResp: {}) => {
              expect(err).toBe(error);
              expect(indexes).toEqual([]);
              expect(nextQuery).toBe(null);
              expect(apiResp).toBe(apiResponse);
              done();
            },
          );
        });

        it('should execute callback with Index instances', done => {
          const rawIndex = {indexId: 'name', a: 'b'};
          const indexInstance = {};

          datastore.index = (id: string) => {
            expect(id).toBe(rawIndex.indexId);
            return indexInstance;
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any, callback: Function) => {
            callback(null, [rawIndex]);
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.getIndexes((err: Error, indexes: any[]) => {
            expect(err).toBeFalsy();
            expect(indexes).toEqual([indexInstance]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((indexes[0] as any)!.metadata).toBe(rawIndex);
            done();
          });
        });

        it('should execute callback with prepared nextQuery', done => {
          const options = {pageToken: '1'};
          const nextQuery = {pageToken: '2'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any, callback: Function) => {
            callback(null, [], nextQuery);
          };

          datastore.getIndexes(
            options,
            (err: Error, indexes: [], _nextQuery: {}) => {
              expect(err).toBeFalsy();
              expect(_nextQuery).toEqual(nextQuery);
              done();
            },
          );
        });
      });

      describe('getIndexesStream', () => {
        it('should make correct request', done => {
          const options = {a: 'b'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.requestStream_ = (config: any) => {
            expect(config.client).toBe('DatastoreAdminClient');
            expect(config.method).toBe('listIndexesStream');
            expect(config.reqOpts).toEqual({
              ...options,
            });
            expect(typeof config.gaxOpts).toBe('undefined');
            setImmediate(done);
            return new PassThrough();
          };

          datastore.getIndexesStream(options);
        });

        it('should accept gaxOptions', done => {
          const options = {gaxOptions: {}};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.requestStream_ = (config: any) => {
            expect(config.gaxOpts).toBe(options.gaxOptions);
            setImmediate(done);
            return new PassThrough();
          };

          datastore.getIndexesStream(options);
        });

        it('should transform response indexes into Index objects', done => {
          const rawIndex = {indexId: 'name', a: 'b'};
          const indexInstance = {};
          const requestStream = new Readable({
            objectMode: true,
            read() {
              this.push(rawIndex);
              this.push(null);
            },
          });

          datastore.index = (id: string) => {
            expect(id).toBe(rawIndex.indexId);
            return indexInstance;
          };

          datastore.requestStream_ = () => requestStream;

          datastore
            .getIndexesStream()
            .on('error', done)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .on('data', (index: any) => {
              expect(index).toBe(indexInstance);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              expect((index as any).metadata).toBe(rawIndex);
              done();
            });
        });
      });

      describe('import', () => {
        it('should throw if both file and inputUrl are provided', () => {
          expect(() => {
            datastore.import(
              {
                file: 'file',
                inputUrl: 'gs://file',
              },
              () => {},
            );
          }).toThrow(/Both `file` and `inputUrl` were provided\./);
        });

        it('should accept a file string source', done => {
          const file = 'file';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.inputUrl).toBe(`gs://${file}`);
            done();
          };

          datastore.import({file}, () => {});
        });

        it('should remove extraneous gs:// prefix from input', done => {
          const file = 'gs://file';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.inputUrl).toBe(`${file}`);
            done();
          };

          datastore.import({file}, () => {});
        });

        it('should accept a File object source', done => {
          const file = {bucket: {name: 'bucket'}, name: 'file'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.inputUrl).toBe(`gs://${file.bucket.name}/${file.name}`);
            done();
          };

          datastore.import({file}, () => {});
        });

        it('should throw if a source is not provided', () => {
          expect(() => {
            datastore.import({}, () => {});
          }).toThrow(/An input URL must be provided\./);
        });

        it('should accept kinds', done => {
          const kinds = ['kind1', 'kind2'];
          const config = {file: 'file', kinds};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.entityFilter.kinds).toEqual(kinds);
            done();
          };

          datastore.import(config, () => {});
        });

        it('should throw if both kinds and entityFilter are provided', () => {
          expect(() => {
            datastore.import(
              {
                file: 'file',
                kinds: ['kind1', 'kind2'],
                entityFilter: {},
              },
              () => {},
            );
          }).toThrow(/Both `entityFilter` and `kinds` were provided\./);
        });

        it('should accept namespaces', done => {
          const namespaces = ['ns1', 'n2'];
          const config = {file: 'file', namespaces};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.entityFilter.namespaceIds).toEqual(namespaces);
            done();
          };

          datastore.import(config, () => {});
        });

        it('should throw if both namespaces and entityFilter are provided', () => {
          expect(() => {
            datastore.import(
              {
                file: 'file',
                namespaces: ['ns1', 'ns2'],
                entityFilter: {},
              },
              () => {},
            );
          }).toThrow(/Both `entityFilter` and `namespaces` were provided\./);
        });

        it('should remove extraneous properties from request', done => {
          const config = {
            file: 'file',
            gaxOptions: {},
            kinds: ['kind1', 'kind2'],
            namespaces: ['ns1', 'ns2'],
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(typeof config.reqOpts.file).toBe('undefined');
            expect(typeof config.reqOpts.gaxOptions).toBe('undefined');
            expect(typeof config.reqOpts.kinds).toBe('undefined');
            expect(typeof config.reqOpts.namespaces).toBe('undefined');
            done();
          };

          datastore.import(config, () => {});
        });

        it('should send any user input to API', done => {
          const userProperty = 'abc';
          const config = {file: 'file', userProperty};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.reqOpts.userProperty).toBe(userProperty);
            done();
          };

          datastore.import(config, () => {});
        });

        it('should send correct request', done => {
          const config = {file: 'file'};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.client).toBe('DatastoreAdminClient');
            expect(config.method).toBe('importEntities');
            expect(typeof config.gaxOpts).toBe('undefined');
            done();
          };

          datastore.import(config, () => {});
        });

        it('should accept gaxOptions', done => {
          const gaxOptions = {};
          const config = {file: 'file', gaxOptions};

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datastore.request_ = (config: any) => {
            expect(config.gaxOpts).toBe(gaxOptions);
            done();
          };

          datastore.import(config, () => {});
        });
      });

      describe('index', () => {
        it('should return an Index object', () => {
          const indexId = 'index-id';
          const index = datastore.index(indexId);
          expect(index instanceof MockIndex).toBeTruthy();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = (index as any).calledWith_;
          expect(args[0]).toBe(datastore);
          expect(args[1]).toBe(indexId);
        });
      });

      describe('insert', () => {
        afterEach(() => {
          jest.restoreAllMocks();
        });

        it('should prepare entity objects', done => {
          const entityObject = {};
          const preparedEntityObject = {prepared: true};
          const expectedEntityObject = Object.assign({}, preparedEntityObject, {
            method: 'insert',
          });

          jest.spyOn(ds.DatastoreRequest, 'prepareEntityObject_')
            .mockImplementation(obj => {
              expect(obj).toBe(entityObject);
              return preparedEntityObject as {};
            });

          datastore.save = (entities: Entity[]) => {
            expect(entities[0]).toEqual(expectedEntityObject);
            done();
          };

          datastore.insert(entityObject, () => {});
        });

        it('should pass the correct arguments to save', done => {
          datastore.save = (entities: Entity[], callback: Function) => {
            expect(JSON.parse(JSON.stringify(entities))).toEqual([
              {
                key: {
                  namespace: 'ns',
                  kind: 'Company',
                  path: ['Company', null],
                },
                data: {},
                method: 'insert',
              },
            ]);
            callback();
          };
          const key = new entity.Key({namespace: 'ns', path: ['Company']});
          datastore.insert({key, data: {}}, done);
        });
      });

      describe('key', () => {
        it('should return a Key object', () => {
          const options = {} as entity.KeyOptions;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const key: any = datastore.key(options);
          expect(key.calledWith_[0]).toBe(options);
        });

        it('should use a non-object argument as the path', () => {
          const options = 'path';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const key: any = datastore.key(options);
          expect(key.calledWith_[0].namespace).toBe(datastore.namespace);
          expect(key.calledWith_[0].path).toEqual([options]);
        });
      });

      describe('save', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type Any = any;
        let key: entity.Key;

        beforeEach(() => {
          key = new entity.Key({
            namespace: 'namespace',
            path: ['Company', 123],
          });
        });

        afterEach(() => {
          jest.restoreAllMocks();
        });

        it('should save with keys', done => {
          const expectedReq = {
            mutations: [
              {
                upsert: {
                  key: {
                    partitionId: {
                      namespaceId: 'namespace',
                    },
                    path: [
                      {
                        kind: 'Company',
                        id: 123,
                      },
                    ],
                  },
                  properties: {
                    k: {
                      stringValue: 'v',
                    },
                  },
                },
              },
              {
                upsert: {
                  key: {
                    partitionId: {
                      namespaceId: 'namespace',
                    },
                    path: [
                      {
                        kind: 'Company',
                        id: 123,
                      },
                    ],
                  },
                  properties: {
                    k: {
                      stringValue: 'v',
                    },
                  },
                },
              },
            ],
          };

          datastore.request_ = (config: RequestConfig, callback: Function) => {
            expect(config.client).toBe('DatastoreClient');
            expect(config.method).toBe('commit');

            expect(config.reqOpts).toEqual(expectedReq);
            expect(config.gaxOpts).toEqual({});

            callback();
          };
          datastore.save(
            [
              {key, data: {k: 'v'}},
              {key, data: {k: 'v'}},
            ],
            done,
          );
        });

        it('should save null value when excludeLargeProperties enabled', done => {
          const expectedProperties = {
            stringField: {
              stringValue: 'string value',
            },
            nullField: {
              nullValue: 0,
            },
            arrayField: {
              arrayValue: {
                values: [
                  {
                    integerValue: '0',
                  },
                  {
                    nullValue: 0,
                  },
                ],
              },
            },
            objectField: {
              nullValue: 0,
            },
          };

          datastore.request_ = (config: RequestConfig, callback: Function) => {
            expect(config.reqOpts!.mutations![0].upsert!.properties).toEqual(expectedProperties);
            callback();
          };

          const entities = {
            key: key,
            data: {
              stringField: 'string value',
              nullField: null,
              arrayField: [0, null],
              objectField: null,
            },
            excludeLargeProperties: true,
          };
          datastore.save(entities, done);
        });

        it('should allow customization of GAX options', done => {
          const gaxOptions = {};

          datastore.request_ = (config: RequestConfig) => {
            expect(config.gaxOpts).toBe(gaxOptions);
            done();
          };

          datastore.save(
            {
              key,
              data: {},
            },
            gaxOptions,
            () => {},
          );
        });

        it('should throw error when value is not provided', done => {
          datastore.request_ = (config: RequestConfig) => {
            done('Should not reach request_ function');
          };

          try {
            datastore.save(
              {
                key,
                data: [
                  {
                    name: 'something',
                  },
                ],
              },
              () => {
                done('Should not reach callback');
              },
            );
          } catch (err: unknown) {
            expect((err as {message: string}).message).toBe('Unsupported field value, undefined, was provided.');
            done();
            return;
          }
          throw new Error('Calling save should have thrown an error');
        });

        it('should throw error when name property does not support toString method', done => {
          datastore.request_ = (config: RequestConfig) => {
            done('Should not reach request_ function');
          };
          try {
            datastore.save(
              {
                key,
                data: [
                  {
                    name: null,
                    value: 7,
                  },
                ],
              },
              () => {
                done('Should not reach callback');
              },
            );
          } catch (err: unknown) {
            expect([
                "Cannot read properties of null (reading 'toString')", // Later Node versions
                "Cannot read property 'toString' of null", // Node 14
              ].includes((err as {message: string}).message)).toBeTruthy();
            done();
            return;
          }
          throw new Error('Calling save should have thrown an error');
        });

        it('should prepare entity objects', done => {
          const entityObject = {};
          let prepared = false;

          jest.spyOn(ds.DatastoreRequest, 'prepareEntityObject_')
            .mockImplementation(obj => {
              expect(obj).toBe(entityObject);
              prepared = true;
              return {
                key,
                method: 'insert',
                data: {k: 'v'},
              } as {};
            });

          datastore.request_ = () => {
            expect(prepared).toBe(true);
            done();
          };

          datastore.save(entityObject, () => {});
        });

        it('should save with specific method', done => {
          datastore.request_ = (config: RequestConfig, callback: Function) => {
            expect(config.reqOpts!.mutations!.length).toBe(3);
            expect(is.object(config.reqOpts!.mutations![0].insert)).toBeTruthy();
            expect(is.object(config.reqOpts!.mutations![1].update)).toBeTruthy();
            expect(is.object(config.reqOpts!.mutations![2].upsert)).toBeTruthy();

            const insert = config.reqOpts!.mutations![0].insert!;
            expect(insert.properties!.k).toEqual({stringValue: 'v'});

            const update = config.reqOpts!.mutations![1].update!;
            expect(update.properties!.k2).toEqual({stringValue: 'v2'});

            const upsert = config.reqOpts!.mutations![2].upsert!;
            expect(upsert.properties!.k3).toEqual({stringValue: 'v3'});

            callback();
          };

          datastore.save(
            [
              {key, method: 'insert', data: {k: 'v'}},
              {key, method: 'update', data: {k2: 'v2'}},
              {key, method: 'upsert', data: {k3: 'v3'}},
            ],
            done,
          );
        });

        it('should throw if a given method is not recognized', () => {
          expect(() => {
            datastore.save(
              {
                key,
                method: 'auto_insert_id',
                data: {
                  k: 'v',
                },
              },
              () => {},
            );
          }).toThrow(/Method auto_insert_id not recognized/);
        });

        it('should not alter the provided data object', done => {
          const entities = [
            {
              key,
              method: 'insert',
              indexed: false,
              data: {
                value: {
                  a: 'b',
                  c: [1, 2, 3],
                },
              },
            },
          ];
          const expectedEntities = entities.map(x => extend(true, {}, x));

          datastore.request_ = () => {
            // By the time the request is made, the original object has already been
            // transformed into a raw request.
            expect(entities).toEqual(expectedEntities);
            done();
          };

          datastore.save(entities, () => {});
        });

        it('should return apiResponse in callback', done => {
          const key = new entity.Key({namespace: 'ns', path: ['Company']});
          const mockCommitResponse = {};
          datastore.request_ = (config: RequestConfig, callback: Function) => {
            callback(null, mockCommitResponse);
          };
          datastore.save(
            {key, data: {}},
            (err: Error | null, apiResponse: Entity) => {
              expect(err).toBeFalsy();
              expect(mockCommitResponse).toBe(apiResponse);
              done();
            },
          );
        });

        it('should allow setting the indexed value of a property', done => {
          datastore.request_ = (config: RequestConfig) => {
            const property =
              config.reqOpts!.mutations![0].upsert!.properties!.name;
            expect(property.stringValue).toBe('value');
            expect(property.excludeFromIndexes).toBe(true);
            done();
          };

          datastore.save(
            {
              key,
              data: [
                {
                  name: 'name',
                  value: 'value',
                  excludeFromIndexes: true,
                },
              ],
            },
            () => {},
          );
        });

        it('should allow setting the indexed value on arrays', done => {
          datastore.request_ = (config: RequestConfig) => {
            const property =
              config.reqOpts!.mutations![0].upsert!.properties!.name;

            property.arrayValue!.values!.forEach((value: Any) => {
              expect(value.excludeFromIndexes).toBe(true);
            });

            done();
          };

          datastore.save(
            {
              key,
              data: [
                {
                  name: 'name',
                  value: ['one', 'two', 'three'],
                  excludeFromIndexes: true,
                },
              ],
            },
            () => {},
          );
        });

        it('should allow exclude property indexed with "*" wildcard from root', done => {
          const longString = Buffer.alloc(1501, '.').toString();
          const data = {
            longString,
            notMetadata: true,
            longStringArray: [longString],
            metadata: {
              longString,
              otherProperty: 'value',
              obj: {
                longStringArray: [
                  {
                    longString,
                    nestedLongStringArray: [
                      {
                        longString,
                        nestedProperty: true,
                      },
                      {
                        longString,
                      },
                    ],
                  },
                ],
              },
              longStringArray: [
                {
                  longString,
                  nestedLongStringArray: [
                    {
                      longString,
                      nestedProperty: true,
                    },
                    {
                      longString,
                    },
                  ],
                },
              ],
            },
          };

          const validateIndex = (data: Any) => {
            if (data.arrayValue) {
              data.arrayValue.values.forEach((value: Any) => {
                validateIndex(value);
              });
            } else if (data.entityValue) {
              Object.keys(data.entityValue.properties).forEach(path => {
                validateIndex(data.entityValue.properties[path]);
              });
            } else {
              expect(data.excludeFromIndexes).toBe(true);
            }
          };

          datastore.request_ = (config: RequestConfig) => {
            const properties = config.reqOpts!.mutations![0].upsert!.properties;
            Object.keys(properties!).forEach(path => {
              validateIndex(properties![path]);
            });
            done();
          };

          datastore.save(
            {
              key,
              data,
              excludeFromIndexes: ['.*'],
            },
            () => {},
          );
        });

        it('should allow exclude property indexed with "*" wildcard for object and array', done => {
          const longString = Buffer.alloc(1501, '.').toString();
          const data = {
            longString,
            notMetadata: true,
            longStringArray: [longString],
            metadata: {
              longString,
              otherProperty: 'value',
              obj: {
                longStringArray: [
                  {
                    longString,
                    nestedLongStringArray: [
                      {
                        longString,
                        nestedProperty: true,
                      },
                      {
                        longString,
                      },
                    ],
                  },
                ],
              },
              longStringArray: [
                {
                  longString,
                  nestedLongStringArray: [
                    {
                      longString,
                      nestedProperty: true,
                    },
                    {
                      longString,
                    },
                  ],
                },
              ],
            },
          };

          const validateIndex = (data: Any) => {
            if (data.arrayValue) {
              data.arrayValue.values.forEach((value: Any) => {
                validateIndex(value);
              });
            } else if (data.entityValue) {
              Object.keys(data.entityValue.properties).forEach(path => {
                validateIndex(data.entityValue.properties[path]);
              });
            } else {
              expect(data.excludeFromIndexes).toBe(true);
            }
          };

          datastore.request_ = (config: RequestConfig) => {
            const properties = config.reqOpts!.mutations![0].upsert!.properties;
            Object.keys(properties!).forEach(path => {
              validateIndex(properties![path]);
            });
            done();
          };

          datastore.save(
            {
              key,
              data,
              excludeFromIndexes: [
                'longString',
                'notMetadata',
                'longStringArray[]',
                'metadata.longString',
                'metadata.otherProperty',
                'metadata.obj.*',
                'metadata.longStringArray[].*',
              ],
            },
            () => {},
          );
        });

        it('should allow setting the indexed value on arrays', done => {
          datastore.request_ = (config: RequestConfig) => {
            const property =
              config.reqOpts!.mutations![0].upsert!.properties!.name;

            property.arrayValue!.values!.forEach((value: Any) => {
              expect(value.excludeFromIndexes).toBe(true);
            });

            done();
          };

          datastore.save(
            {
              key,
              data: [
                {
                  name: 'name',
                  value: ['one', 'two', 'three'],
                  excludeFromIndexes: true,
                },
              ],
            },
            () => {},
          );
        });

        it('should prepare excludeFromIndexes array for large values', done => {
          const longString = Buffer.alloc(1501, '.').toString();
          const data = {
            longString,
            notMetadata: true,
            longStringArray: [longString],
            metadata: {
              longString,
              otherProperty: 'value',
              obj: {
                longStringArray: [
                  {
                    longString,
                    nestedLongStringArray: [
                      {
                        longString,
                        nestedProperty: true,
                      },
                      {
                        longString,
                      },
                    ],
                  },
                ],
              },
              longStringArray: [
                {
                  longString,
                  nestedLongStringArray: [
                    {
                      longString,
                      nestedProperty: true,
                    },
                    {
                      longString,
                    },
                  ],
                },
              ],
            },
          };

          const excludeFromIndexes = [
            'longString',
            'longStringArray[]',
            'metadata.longString',
            'metadata.obj.longStringArray[].longString',
            'metadata.obj.longStringArray[].nestedLongStringArray[].longString',
            'metadata.longStringArray[].longString',
            'metadata.longStringArray[].nestedLongStringArray[].longString',
          ];

          mockFakeEntity.entityToEntityProto = (entity: EntityObject) => {
            return entity as unknown as EntityProto;
          };
          datastore.request_ = (config: RequestConfig) => {
            expect((config.reqOpts!.mutations![0].upsert! as Entity)
                .excludeLargeProperties).toBe(true);
            expect((config.reqOpts!.mutations![0].upsert! as Entity)
                .excludeFromIndexes).toEqual(excludeFromIndexes);
            done();
          };

          datastore.save(
            {
              key,
              data,
              excludeLargeProperties: true,
            },
            () => {},
          );
        });

        it('should allow auto setting the indexed value of a property with excludeLargeProperties', done => {
          const longString = Buffer.alloc(1501, '.').toString();
          const data = [
            {
              name: 'name',
              value: longString,
            },
            {
              name: 'description',
              value: 'value',
            },
          ];

          datastore.request_ = (config: RequestConfig) => {
            expect(config.reqOpts!.mutations![0].upsert!.properties!.name
                .excludeFromIndexes).toEqual(true);
            done();
          };

          datastore.save(
            {
              key,
              data,
              excludeLargeProperties: true,
            },
            () => {},
          );
        });

        it('should assign ID on keys without them', done => {
          const incompleteKey = new entity.Key({path: ['Incomplete']});
          const incompleteKey2 = new entity.Key({path: ['Incomplete']});
          const completeKey = new entity.Key({path: ['Complete', 'Key']});

          const keyProtos: Array<{}> = [];
          const ids = [1, 2];

          const response = {
            mutationResults: [
              {
                key: {},
              },
              {
                key: {},
              },
              {},
            ],
          };

          datastore.request_ = (config: RequestConfig, callback: Function) => {
            callback(null, response);
          };

          jest.spyOn(mockFakeEntity, 'keyFromKeyProto').mockImplementation(keyProto => {
            keyProtos.push(keyProto as any);
            return {
              id: ids[keyProtos.length - 1],
            } as {} as entity.Key;
          });

          datastore.save(
            [
              {key: incompleteKey, data: {}},
              {key: incompleteKey2, data: {}},
              {key: completeKey, data: {}},
            ],
            (err: Error) => {
              expect(err).toBeFalsy();

              expect(incompleteKey.id).toBe(ids[0]);
              expect(incompleteKey2.id).toBe(ids[1]);

              expect(keyProtos.length).toBe(2);
              expect(keyProtos[0]).toBe(response.mutationResults[0].key);
              expect(keyProtos[1]).toBe(response.mutationResults[1].key);

              done();
            },
          );
        });

        describe('transactions', () => {
          beforeEach(() => {
            // Trigger transaction mode.
            datastore.id = 'transaction-id';
            datastore.requestCallbacks_ = [];
            datastore.requests_ = [];
          });

          it('should queue request & callback', () => {
            datastore.save({
              key,
              data: [{name: 'name', value: 'value'}],
            });

            expect(typeof datastore.requestCallbacks_[0]).toBe('function');
            expect(typeof datastore.requests_[0]).toBe('object');
          });
        });
      });

      describe('update', () => {
        afterEach(() => {
          jest.restoreAllMocks();
        });

        it('should prepare entity objects', done => {
          const entityObject = {};
          const preparedEntityObject = {prepared: true};
          const expectedEntityObject = Object.assign({}, preparedEntityObject, {
            method: 'update',
          });

          jest.spyOn(ds.DatastoreRequest, 'prepareEntityObject_')
            .mockImplementation(obj => {
              expect(obj).toBe(entityObject);
              return preparedEntityObject as {};
            });

          datastore.save = (entities: Entity[]) => {
            expect(entities[0]).toEqual(expectedEntityObject);
            done();
          };

          datastore.update(entityObject, () => {});
        });

        it('should pass the correct arguments to save', done => {
          datastore.save = (entities: Entity[], callback: Function) => {
            expect(JSON.parse(JSON.stringify(entities))).toEqual([
              {
                key: {
                  namespace: 'ns',
                  kind: 'Company',
                  path: ['Company', null],
                },
                data: {},
                method: 'update',
              },
            ]);
            callback();
          };

          const key = new entity.Key({namespace: 'ns', path: ['Company']});
          datastore.update({key, data: {}}, done);
        });
      });

      describe('upsert', () => {
        afterEach(() => {
          jest.restoreAllMocks();
        });

        it('should prepare entity objects', done => {
          const entityObject = {};
          const preparedEntityObject = {prepared: true};
          const expectedEntityObject = Object.assign({}, preparedEntityObject, {
            method: 'upsert',
          });

          jest.spyOn(ds.DatastoreRequest, 'prepareEntityObject_')
            .mockImplementation(obj => {
              expect(obj).toBe(entityObject);
              return preparedEntityObject as {};
            });

          datastore.save = (entities: Entity[]) => {
            expect(entities[0]).toEqual(expectedEntityObject);
            done();
          };

          datastore.upsert(entityObject, () => {});
        });

        it('should pass the correct arguments to save', done => {
          datastore.save = (entities: Entity[], callback: Function) => {
            expect(JSON.parse(JSON.stringify(entities))).toEqual([
              {
                key: {
                  namespace: 'ns',
                  kind: 'Company',
                  path: ['Company', null],
                },
                data: {},
                method: 'upsert',
              },
            ]);

            callback();
          };

          const key = new entity.Key({namespace: 'ns', path: ['Company']});
          datastore.upsert({key, data: {}}, done);
        });
      });

      describe('transaction', () => {
        it('should return a Transaction object', () => {
          const transaction = datastore.transaction();
          expect(transaction.calledWith_[0]).toBe(datastore);
        });

        it('should pass options to the Transaction constructor', () => {
          const options = {};
          const transaction = datastore.transaction(options);
          expect(transaction.calledWith_[1]).toBe(options);
        });
      });

      describe('determineBaseUrl_', () => {
        function setHost(host: string) {
          process.env.DATASTORE_EMULATOR_HOST = host;
        }

        beforeEach(() => {
          delete process.env.DATASTORE_EMULATOR_HOST;
        });

        it('should default to defaultBaseUrl_', () => {
          const defaultBaseUrl_ = 'defaulturl';
          datastore.defaultBaseUrl_ = defaultBaseUrl_;

          datastore.determineBaseUrl_();
          expect(datastore.baseUrl_).toBe(defaultBaseUrl_);
        });

        it('should remove slashes from the baseUrl', () => {
          const expectedBaseUrl = 'localhost';

          setHost('localhost/');
          datastore.determineBaseUrl_();
          expect(datastore.baseUrl_).toBe(expectedBaseUrl);

          setHost('localhost//');
          datastore.determineBaseUrl_();
          expect(datastore.baseUrl_).toBe(expectedBaseUrl);
        });

        it('should remove the protocol if specified', () => {
          setHost('http://localhost');
          datastore.determineBaseUrl_();
          expect(datastore.baseUrl_).toBe('localhost');

          setHost('https://localhost');
          datastore.determineBaseUrl_();
          expect(datastore.baseUrl_).toBe('localhost');
        });

        it('should set Numberified port if one was found', () => {
          setHost('http://localhost:9090');
          datastore.determineBaseUrl_();
          expect(datastore.port_).toBe(9090);
        });

        it('should not set customEndpoint_ when using default baseurl', () => {
          const datastore = new Datastore({projectId: PROJECT_ID});
          datastore.determineBaseUrl_();
          expect(datastore.customEndpoint_).toBe(undefined);
        });

        it('should set customEndpoint_ when using custom API endpoint', () => {
          datastore.determineBaseUrl_('apiEndpoint');
          expect(datastore.customEndpoint_).toBe(true);
        });

        it('should set baseUrl when using custom API endpoint', () => {
          datastore.determineBaseUrl_('apiEndpoint');
          expect(datastore.baseUrl_).toBe('apiEndpoint');
        });

        describe('with DATASTORE_EMULATOR_HOST environment variable', () => {
          const DATASTORE_EMULATOR_HOST = 'localhost:9090';
          const EXPECTED_BASE_URL = 'localhost';
          const EXPECTED_PORT = 9090;

          beforeEach(() => {
            setHost(DATASTORE_EMULATOR_HOST);
          });

          afterAll(() => {
            delete process.env.DATASTORE_EMULATOR_HOST;
          });

          it('should use the DATASTORE_EMULATOR_HOST env var', () => {
            datastore.determineBaseUrl_();
            expect(datastore.baseUrl_).toBe(EXPECTED_BASE_URL);
            expect(datastore.port_).toBe(EXPECTED_PORT);
          });

          it('should set customEndpoint_', () => {
            datastore.determineBaseUrl_();
            expect(datastore.customEndpoint_).toBe(true);
          });
        });
      });

      describe('keyToLegacyUrlSafe', () => {
        it('should convert key to URL-safe base64 string', () => {
          const key = new entity.Key({
            path: ['Task', 'Test'],
          });
          const base64EndocdedUrlSafeKey =
            'agpwcm9qZWN0LWlkcg4LEgRUYXNrIgRUZXN0DA';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (datastore.auth as any).getProjectId = (callback: Function) => {
            callback(null, 'project-id');
          };
          datastore.keyToLegacyUrlSafe(
            key,
            (err: Error | null | undefined, urlSafeKey: string) => {
              expect(err).toBeFalsy();
              expect(urlSafeKey).toBe(base64EndocdedUrlSafeKey);
            },
          );
        });

        it('should convert key to URL-safe base64 string with location prefix', () => {
          const key = new entity.Key({
            path: ['Task', 'Test'],
          });
          const locationPrefix = 's~';
          const base64EndocdedUrlSafeKey =
            'agxzfnByb2plY3QtaWRyDgsSBFRhc2siBFRlc3QM';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (datastore.auth as any).getProjectId = (callback: Function) => {
            callback(null, 'project-id');
          };
          datastore.keyToLegacyUrlSafe(
            key,
            locationPrefix,
            (err: Error | null | undefined, urlSafeKey: string) => {
              expect(err).toBeFalsy();
              expect(urlSafeKey).toBe(base64EndocdedUrlSafeKey);
            },
          );
        });

        it('should not return URL-safe key to user if auth.getProjectId errors', () => {
          const error = new Error('Error.');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (datastore.auth as any).getProjectId = (callback: Function) => {
            callback(error);
          };
          datastore.keyToLegacyUrlSafe(
            {} as entity.Key,
            (err: Error | null | undefined, urlSafeKey: string) => {
              expect(err).toBe(error);
              expect(urlSafeKey).toBe(undefined);
            },
          );
        });
      });

      describe('keyFromLegacyUrlsafe', () => {
        it('should convert key to url safe base64 string', () => {
          const encodedKey = 'agpwcm9qZWN0LWlkcg4LEgRUYXNrIgRUZXN0DA';
          const key = datastore.keyFromLegacyUrlsafe(encodedKey);
          expect(key.kind).toBe('Task');
          expect(key.name).toBe('Test');
        });
      });

      describe('without using mocks', () => {
        describe('on save tests', () => {
          const onSaveTests = [
            {
              description:
                'should encode a save request without excludeFromIndexes',
              properties: {k: {stringValue: 'v'}},
              entitiesWithoutKey: {data: {k: 'v'}},
            },
            {
              description:
                'should add exclude from indexes to property k and ignore excludeFromIndexes with wildcard',
              properties: {k: {stringValue: 'v', excludeFromIndexes: true}},
              entitiesWithoutKey: {
                data: {k: 'v'},
                excludeFromIndexes: ['k', 'k.*'],
              },
            },
            {
              description:
                'should encode a save request without properties and without excludeFromIndexes',
              properties: {},
              entitiesWithoutKey: {data: {}},
            },
            {
              description:
                'should encode a save request with no properties ignoring excludeFromIndexes for a property not on save data',
              properties: {},
              entitiesWithoutKey: {
                data: {},
                excludeFromIndexes: [
                  'non_exist_property', // this just ignored
                  'non_exist_property.*', // should also be ignored
                ],
              },
            },
            {
              description:
                'should encode a save request with one property ignoring excludeFromIndexes for a property not on save data',
              properties: {k: {stringValue: 'v'}},
              entitiesWithoutKey: {
                data: {k: 'v'},
                excludeFromIndexes: [
                  'non_exist_property[]', // this just ignored
                ],
              },
            },
            {
              description:
                'should encode a save request with one property ignoring excludeFromIndexes for a property with a wildcard not on save data',
              properties: {k: {stringValue: 'v'}},
              entitiesWithoutKey: {
                data: {k: 'v'},
                excludeFromIndexes: [
                  'non_exist_property[].*', // this just ignored
                ],
              },
            },
          ];

          for (const onSaveTest of onSaveTests) {
              it(`${onSaveTest.description}`, async () => {
                const datastore = new OriginalDatastore({
                  namespace: `${Date.now()}`,
                });
                {
                  // This block of code mocks out request_ to check values passed into it.
                  const expectedConfig = {
                    client: 'DatastoreClient',
                    method: 'commit',
                    gaxOpts: {},
                    reqOpts: {
                      mutations: [
                        {
                          upsert: {
                            key: {
                              path: [{kind: 'Post', name: 'Post1'}],
                              partitionId: {
                                namespaceId: datastore.namespace,
                              },
                            },
                            properties: onSaveTest.properties,
                          },
                        },
                      ],
                    },
                  };
                  // Mock out the request function to compare config passed into it.
                  datastore.request_ = (
                    config: RequestConfig,
                    callback: RequestCallback,
                  ) => {
                    try {
                      expect(config).toEqual(expectedConfig);
                      callback(null, 'some-data');
                    } catch (e: any) {
                      callback(e);
                    }
                  };
                }
                {
                  // Attach key to entities parameter passed in and run save with those parameters.
                  const key = datastore.key(['Post', 'Post1']);
                  const entities = Object.assign(
                    {key},
                    onSaveTest.entitiesWithoutKey,
                  );
                  const results = await datastore.save(entities);
                  expect(results).toEqual(['some-data']);
                }
              });
          }
        });
      });

      describe('multi-db support', () => {
        it('should get the database id from the client', async () => {
          const otherDatastore = new Datastore({
            namespace: `${Date.now()}`,
            databaseId: SECOND_DATABASE_ID,
          });
          expect(otherDatastore.getDatabaseId()).toBe(SECOND_DATABASE_ID);
        });
      });

      describe('Query Profiling', () => {
        const executionStats = {
          resultsReturned: '8',
          executionDuration: {
            seconds: '0',
            nanos: 95389000,
          },
          readOperations: '8',
          debugStats: {
            fields: {
              index_entries_scanned: {
                stringValue: '8',
                kind: 'stringValue',
              },
              documents_scanned: {
                stringValue: '8',
                kind: 'stringValue',
              },
            },
          },
        };
        const planSummary = {
          indexesUsed: [
            {
              fields: {
                query_scope: {
                  stringValue: 'Collection Group',
                  kind: 'stringValue',
                },
                properties: {
                  stringValue: '(__name__ASC)',
                  kind: 'stringValue',
                },
              },
            },
          ],
        };
        const expectedPlanSummary = {
          indexesUsed: [
            {
              query_scope: 'Collection Group',
              properties: '(__name__ASC)',
            },
          ],
        };
        const expectedExecutionStats = {
          resultsReturned: 8,
          readOperations: 8,
          executionDuration: {
            seconds: '0',
            nanos: 95389000,
          },
          debugStats: {
            index_entries_scanned: '8',
            documents_scanned: '8',
          },
        };
        const profilingCases = [
            {
              modeName: 'ExplainAnalyze',
              options: {
                explainOptions: {
                  analyze: true,
                },
              },
              expectedInfo: {
                explainMetrics: {
                  planSummary: expectedPlanSummary,
                  executionStats: expectedExecutionStats,
                },
              },
              explainMetrics: {
                explainMetrics: {
                  executionStats,
                  planSummary,
                },
              },
              expectedExplainOptions: {
                analyze: true,
              },
            },
            {
              modeName: 'Explain',
              options: {
                explainOptions: {
                  analyze: false,
                },
              },
              expectedInfo: {
                explainMetrics: {
                  planSummary: expectedPlanSummary,
                },
              },
              explainMetrics: {
                explainMetrics: {
                  planSummary,
                },
              },
              expectedExplainOptions: {
                analyze: false,
              },
            },
            {
              modeName: 'Normal',
              options: {},
              expectedInfo: {},
              explainMetrics: {},
              expectedExplainOptions: undefined,
            },
        ];
        for (const modeOptions of profilingCases) {
          const datastore = new ds.Datastore();
          describe(`for the ${modeOptions.modeName} query mode`, () => {
              it('should provide correct request/response data for runQuery', async () => {
                // Mock out the request function to compare config passed into it.
                datastore.request_ = (
                  config: RequestConfig,
                  callback: RequestCallback,
                ) => {
                  expect(config.client).toEqual('DatastoreClient');
                  expect(config.method).toEqual('runQuery');
                  expect(config.reqOpts?.explainOptions).toEqual(modeOptions.expectedExplainOptions);
                  callback(
                    null,
                    Object.assign(
                      {
                        batch: {
                          entityResults: [],
                          moreResults: 'NO_MORE_RESULTS',
                        },
                      },
                      modeOptions.explainMetrics,
                    ),
                  );
                };
                const ancestor = datastore.key(['Book', 'GoT']);
                const q = datastore
                  .createQuery('Character')
                  .hasAncestor(ancestor);
                const [entities, info] = await datastore.runQuery(
                  q,
                  modeOptions.options,
                );
                expect(entities).toEqual([]);
                expect(info).toEqual(Object.assign(
                    {moreResults: 'NO_MORE_RESULTS'},
                    modeOptions.expectedInfo,
                  ));
              });
              it('should provide correct request/response data for runAggregationQuery', async () => {
                // Mock out the request function to compare config passed into it.
                datastore.request_ = (
                  config: RequestConfig,
                  callback: RequestCallback,
                ) => {
                  expect(config.client).toEqual('DatastoreClient');
                  expect(config.method).toEqual('runAggregationQuery');
                  expect(config.reqOpts?.explainOptions).toEqual(modeOptions.expectedExplainOptions);
                  callback(
                    null,
                    Object.assign(
                      {
                        batch: {
                          aggregationResults: [],
                          moreResults: 'NO_MORE_RESULTS',
                        },
                      },
                      modeOptions.explainMetrics,
                    ),
                  );
                };
                const ancestor = datastore.key(['Book', 'GoT']);
                const q = datastore
                  .createQuery('Character')
                  .hasAncestor(ancestor);
                const aggregate = datastore
                  .createAggregationQuery(q)
                  .addAggregation(AggregateField.sum('appearances'));
                const [entities, info] = await datastore.runAggregationQuery(
                  aggregate,
                  modeOptions.options,
                );
                expect(entities).toEqual([]);
                expect(info).toEqual(modeOptions.expectedInfo);
              });
            });
        }
      });
    });
}
