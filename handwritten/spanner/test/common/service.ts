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

import * as path from 'path';
import {util} from '@google-cloud/common';
import * as grpcProtoLoader from '@grpc/proto-loader';
import * as duplexify from 'duplexify';
import * as extend from 'extend';
import {grpc, GrpcClient} from 'google-gax';
import * as retryRequest from 'retry-request';
import {PassThrough} from 'stream';
import {isDate, replaceProjectIdToken} from '../../src/helper';

const glob = global as {} as {GCLOUD_SANDBOX_ENV?: boolean | {}};

const gaxProtosDir = path.join(
  path.dirname(require.resolve('google-gax')),
  '..',
  'protos',
);


function ifError(err?: any) { if (err) throw err; }

let getUserAgentFromPackageJsonOverride: Function | null = null;
let retryRequestOverride: any = null;
let grpcProtoLoadOverride: any = null;
let replaceProjectIdTokenOverride: any = null;

class FakeService {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
}

jest.mock("@google-cloud/common", () => {
  const actual = jest.requireActual("@google-cloud/common");
  return {
    ...actual,
    Service: FakeService,
    util: {
      ...actual.util,
      getUserAgentFromPackageJson: (...args: any[]) => {
        return (
          getUserAgentFromPackageJsonOverride || actual.util.getUserAgentFromPackageJson
        )(...args);
      },
    },
  };
});

jest.mock("@grpc/proto-loader", () => {
  const actual = jest.requireActual("@grpc/proto-loader");
  return {
    ...actual,
    loadSync: (filename: string, options?: any) => {
      return (grpcProtoLoadOverride || actual.loadSync)(filename, options);
    },
  };
});

jest.mock("retry-request", () => {
  const actual = jest.requireActual("retry-request");
  const fn = (...args: any[]) => {
    return (retryRequestOverride || actual)(...args);
  };
  return fn;
});

jest.mock("../../src/helper", () => {
  const actual = jest.requireActual("../../src/helper");
  return {
    ...actual,
    replaceProjectIdToken: (...args: any[]) => {
      return (replaceProjectIdTokenOverride || actual.replaceProjectIdToken)(...args);
    },
  };
});

import {GrpcService as RealGrpcService} from "../../src/common-grpc/service";

describe('GrpcService', () => {
  // tslint:disable-next-line:variable-name
  let GrpcServiceCached;
  // tslint:disable-next-line:variable-name
  let GrpcService;
  let grpcService;

  // tslint:disable-next-line:variable-name
  let ObjectToStructConverter;

  const ROOT_DIR = '/root/dir';
  const PROTO_FILE_PATH = 'filepath.proto';
  const SERVICE_PATH = 'service.path';

  interface Config {
    proto: {};
    protosDir: string;
    protoServices: {
      Service: {
        path: string;
        service: string;
      };
    };
    packageJson: {
      name: string;
      version: string;
    };
    grpcMetadata?: {
      property: string;
    };
  }

  const CONFIG = {
    proto: {},
    protosDir: ROOT_DIR,
    protoServices: {
      Service: {
        path: PROTO_FILE_PATH,
        service: SERVICE_PATH,
      },
    },
    packageJson: {
      name: '@google-cloud/service',
      version: '0.2.0',
    },
    grpcMetadata: {
      property: 'value',
    },
  };

  const OPTIONS = {
    maxRetries: 3,
  };

  const grpcJsVersion = new GrpcClient().grpcVersion;

  const EXPECTED_API_CLIENT_HEADER = [
    'gl-node/' + process.versions.node,
    'gccl/' + CONFIG.packageJson.version,
    'grpc/' + grpcJsVersion,
  ].join(' ');

  const MOCK_GRPC_API: grpcProtoLoader.PackageDefinition = {
    [`google.${SERVICE_PATH}.Service`]: {},
  };

  beforeAll(() => {
    GrpcService = RealGrpcService;
    GrpcServiceCached = extend(true, {}, GrpcService);
    ObjectToStructConverter = GrpcService.ObjectToStructConverter;
  });

  beforeEach(() => {
    retryRequestOverride = null;
    getUserAgentFromPackageJsonOverride = null;
    grpcProtoLoadOverride = () => {
      return MOCK_GRPC_API;
    };
    Object.assign(GrpcService, GrpcServiceCached);
    grpcService = new GrpcService(CONFIG, OPTIONS);
  });

  afterEach(() => {
    grpcProtoLoadOverride = null;
    // Clear the proto object cache, to ensure that state isn't being carried
    // across tests.
    GrpcService['protoObjectCache'] = {};
    jest.restoreAllMocks();
  });

  it('should use grpc from config object', () => {
    let metadataUsed = 0;
    let credentialsUsed = 0;
    class Credentials {
      createInsecure() {
        ++credentialsUsed;
      }
    }
    class Metadata {
      add() {
        ++metadataUsed;
      }
    }
    const fakeGrpc = {
      Metadata,
      credentials: new Credentials(),
    };
    const grpcService = new GrpcService(
      Object.assign(
        {
          grpc: fakeGrpc,
          grpcVersion: 'grpc-foo/1.2.3',
          customEndpoint: 'endpoint',
        },
        CONFIG,
      ),
      OPTIONS,
    );
    expect(grpcService.grpc).toBe(fakeGrpc);
    expect(grpcService.grpcVersion).toBe('grpc-foo/1.2.3');
    expect(metadataUsed > 0).toBeTruthy();
    expect(credentialsUsed > 0).toBeTruthy();
  });

  it('should not use @grpc/grpc-js version if grpc object is passed', () => {
    class Metadata {
      add() {}
    }
    const fakeGrpc = {
      Metadata,
    };
    const grpcService = new GrpcService(
      Object.assign({grpc: fakeGrpc}, CONFIG),
      OPTIONS,
    );
    expect(grpcService.grpc).toBe(fakeGrpc);
    expect(grpcService.grpcVersion).toBe('grpc/unknown');
  });

  it('should use @grpc/grpc-js by default', () => {
    const grpcService = new GrpcService(CONFIG, OPTIONS);
    expect(grpcService.grpcVersion).toBe('grpc/' + grpcJsVersion);
    expect(grpcService.grpc).toBe(grpc);
  });

  describe('grpc error to http error map', () => {
    it('should export grpc error map', () => {
      expect(GrpcService.GRPC_ERROR_CODE_TO_HTTP).toEqual({
        0: {
          code: 200,
          message: 'OK',
        },

        1: {
          code: 499,
          message: 'Client Closed Request',
        },

        2: {
          code: 500,
          message: 'Internal Server Error',
        },

        3: {
          code: 400,
          message: 'Bad Request',
        },

        4: {
          code: 504,
          message: 'Gateway Timeout',
        },

        5: {
          code: 404,
          message: 'Not Found',
        },

        6: {
          code: 409,
          message: 'Conflict',
        },

        7: {
          code: 403,
          message: 'Forbidden',
        },

        8: {
          code: 429,
          message: 'Too Many Requests',
        },

        9: {
          code: 412,
          message: 'Precondition Failed',
        },

        10: {
          code: 409,
          message: 'Conflict',
        },

        11: {
          code: 400,
          message: 'Bad Request',
        },

        12: {
          code: 501,
          message: 'Not Implemented',
        },

        13: {
          code: 500,
          message: 'Internal Server Error',
        },

        14: {
          code: 503,
          message: 'Service Unavailable',
        },

        15: {
          code: 500,
          message: 'Internal Server Error',
        },

        16: {
          code: 401,
          message: 'Unauthorized',
        },
      });
    });
  });

  describe('grpc service options', () => {
    it('should define the correct default options', () => {
      expect(GrpcService.GRPC_SERVICE_OPTIONS).toEqual({
        'grpc.max_send_message_length': -1,
        'grpc.max_receive_message_length': -1,
        'grpc.initial_reconnect_backoff_ms': 5000,
      });
    });
  });

  describe('instantiation', () => {
        beforeEach(() => {
          });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should inherit from Service', () => {
      expect(grpcService instanceof FakeService).toBeTruthy();

      const calledWith = grpcService.calledWith_;
      expect(calledWith[0]).toBe(CONFIG);
      expect(calledWith[1]).toBe(OPTIONS);
    });

    it('should set insecure credentials if using customEndpoint', () => {
      const config = Object.assign({}, CONFIG, {customEndpoint: true});
      const spy = jest.spyOn(grpc.credentials, 'createInsecure');
      new GrpcService(config, OPTIONS);
      expect(spy).toHaveBeenCalled();
    });

    it('should default grpcMetadata to empty metadata', () => {
      const fakeGrpcMetadata = {
        'x-goog-api-client': EXPECTED_API_CLIENT_HEADER,
      };

      const config: Config = Object.assign({}, CONFIG);
      delete config.grpcMetadata;

      const grpcService = new GrpcService(config, OPTIONS);
      expect(
        grpcService.grpcMetadata.getMap()).toEqual(fakeGrpcMetadata,
      );
    });

    it('should create and localize grpcMetadata', () => {
      const fakeGrpcMetadata = Object.assign(
        {
          'x-goog-api-client': EXPECTED_API_CLIENT_HEADER,
        },
        CONFIG.grpcMetadata,
      );
      const grpcService = new GrpcService(CONFIG, OPTIONS);
      expect(
        grpcService.grpcMetadata.getMap()).toEqual(fakeGrpcMetadata,
      );
    });

    it('should localize maxRetries', () => {
      expect(grpcService.maxRetries).toBe(OPTIONS.maxRetries);
    });

    it('should set the correct user-agent', () => {
      const userAgent = 'user-agent/0.0.0';

      getUserAgentFromPackageJsonOverride = packageJson => {
        expect(packageJson).toBe(CONFIG.packageJson);
        return userAgent;
      };

      const grpcService = new GrpcService(CONFIG, OPTIONS);
      expect(grpcService.userAgent).toBe(userAgent);
    });

    it('should set the primary_user_agent from user-agent', () => {
      const userAgent = 'user-agent/0.0.0';

      getUserAgentFromPackageJsonOverride = packageJson => {
        expect(packageJson).toBe(CONFIG.packageJson);
        return userAgent;
      };

      new GrpcService(CONFIG, OPTIONS);
      expect(OPTIONS['grpc.primary_user_agent']).toBe(userAgent);
    });

    it('should localize the service', () => {
      expect(Object.keys(grpcService.protos)).toEqual(Object.keys(CONFIG.protoServices),);
    });

    it('should localize an empty Map of services', () => {
      expect(grpcService.activeServiceMap_ instanceof Map).toBeTruthy();
      expect(grpcService.activeServiceMap_.size).toBe(0);
    });

    it('should call grpc.load correctly', () => {
      grpcProtoLoadOverride = (file, options) => {
        expect(options!.includeDirs).toEqual([ROOT_DIR]);
        expect(file).toBe(PROTO_FILE_PATH);

        expect(options!.bytes).toBe(String);
        expect(options!.keepCase).toBe(false);

        return MOCK_GRPC_API;
      };

      const grpcService = new GrpcService(CONFIG, OPTIONS);

      for (const serviceName of Object.keys(CONFIG.protoServices)) {
        expect(
          grpcService.protos[serviceName]).toBe(MOCK_GRPC_API[`google.${SERVICE_PATH}.${serviceName}`],
        );
      }
    });

    it('should store the baseUrl properly', () => {
      const fakeBaseUrl = 'a.googleapis.com';

      grpcProtoLoadOverride = () => {
        return MOCK_GRPC_API;
      };

      const config = extend(true, {}, CONFIG, {
        protoServices: {
          Service: {baseUrl: fakeBaseUrl},
        },
      });

      const grpcService = new GrpcService(config, OPTIONS);

      expect(grpcService.protos.Service.baseUrl).toBe(fakeBaseUrl);
    });

    it('should not run in the gcloud sandbox environment', () => {
      glob.GCLOUD_SANDBOX_ENV = {};
      const grpcService = new GrpcService();
      expect(grpcService).toBe(glob.GCLOUD_SANDBOX_ENV);
      delete glob.GCLOUD_SANDBOX_ENV;
    });
  });

  describe('decodeValue_', () => {
    it('should decode a struct value', () => {
      const structValue = {
        kind: 'structValue',
        structValue: {},
      };

      const decodedValue = {};
      jest.spyOn(GrpcService, 'structToObj_').mockReturnValue(decodedValue as any);
      expect(GrpcService.decodeValue_(structValue)).toBe(decodedValue);
    });

    it('should decode a null value', () => {
      const nullValue = {
        kind: 'nullValue',
      };

      const decodedValue = null;

      expect(GrpcService.decodeValue_(nullValue)).toBe(decodedValue);
    });

    it('should decode a list value', () => {
      const listValue = {
        kind: 'listValue',
        listValue: {
          values: [
            {
              kind: 'nullValue',
            },
          ],
        },
      };

      expect(GrpcService.decodeValue_(listValue)).toEqual([null]);
    });

    it('should return the raw value', () => {
      const numberValue = {
        kind: 'numberValue',
        numberValue: 8,
      };

      expect(GrpcService.decodeValue_(numberValue)).toBe(8);
    });
  });

  describe('objToStruct_', () => {
    it('should convert the object using ObjectToStructConverter', () => {
      const options = {};
      const obj = {};
      const convertedObject = {};
      jest.spyOn(GrpcService, 'ObjectToStructConverter').mockImplementation(options_ => {
        expect(options_).toBe(options);
        return {
          convert(obj_) {
            expect(obj_).toBe(obj);
            return convertedObject;
          },
        };
      });
      expect(GrpcService.objToStruct_(obj, options)).toBe(convertedObject);
    });
  });

  describe('structToObj_', () => {
    it('should convert a struct to an object', () => {
      const inputValue = {};
      const decodedValue = {};

      const struct = {
        fields: {
          a: inputValue,
        },
      };

      jest.spyOn(GrpcService, 'decodeValue_').mockImplementation(value => {
        expect(value).toBe(inputValue);
        return decodedValue;
      });

      expect(GrpcService.structToObj_(struct)).toEqual({
        a: decodedValue,
      });
    });
  });

  describe('request', () => {
    const PROTO_OPTS = {service: 'service', method: 'method', timeout: 3000};
    const REQ_OPTS = {reqOpts: true};
    const GRPC_CREDENTIALS = {};

    function ProtoService() {}
    ProtoService.prototype.method = () => {};

    beforeEach(() => {
      grpcService.grpcCredentials = GRPC_CREDENTIALS;

      grpcService.getService_ = () => {
        return ProtoService;
      };
    });

    it('should not run in the gcloud sandbox environment', () => {
      glob.GCLOUD_SANDBOX_ENV = true;
      expect(grpcService.request()).toBe(glob.GCLOUD_SANDBOX_ENV);
      delete glob.GCLOUD_SANDBOX_ENV;
    });

    it('should access the specified service proto object', done => {
      retryRequestOverride = () => {};

      grpcService.getService_ = protoOpts => {
        expect(protoOpts).toBe(PROTO_OPTS);
        setImmediate(done);
        return ProtoService;
      };

      grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
    });

    it('should use and return retry-request', () => {
      const retryRequestInstance = {};

      retryRequestOverride = () => {
        return retryRequestInstance;
      };

      const request = grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
      expect(request).toBe(retryRequestInstance);
    });

    describe('getting gRPC credentials', () => {
      beforeEach(() => {
        delete grpcService.grpcCredentials;
      });

      describe('getting credentials error', () => {
        const error = new Error('Error.');

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            callback(error);
          };
        });

        it('should execute callback with error', done => {
          grpcService.request(PROTO_OPTS, REQ_OPTS, err => {
            expect(err).toBe(error);
            done();
          });
        });
      });

      describe('getting credentials success', () => {
        const authClient = {};

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            callback(null, authClient);
          };
        });

        it('should make the gRPC request again', done => {
          grpcService.getService_ = () => {
            expect(grpcService.grpcCredentials).toBe(authClient);
            setImmediate(done);
            return new ProtoService();
          };

          grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
        });
      });
    });

    describe('retry strategy', () => {
      let retryRequestReqOpts;
      let retryRequestOptions;
      let retryRequestCallback;

      beforeEach(() => {
        retryRequestOverride = (reqOpts, options, callback) => {
          retryRequestReqOpts = reqOpts;
          retryRequestOptions = options;
          retryRequestCallback = callback;
        };
      });

      it('should use retry-request', done => {
        const error = {};
        const response = {};

        grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
          expect(err).toBe(error);
          expect(resp).toBe(response);
          done();
        });

        expect(retryRequestReqOpts).toBe(null);
        expect(retryRequestOptions.retries).toBe(grpcService.maxRetries);
        expect(retryRequestOptions.currentRetryAttempt).toBe(0);

        retryRequestCallback(error, response);
      });

      it('should retry on 429, 500, 502, and 503', () => {
        grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);

        const shouldRetryFn = retryRequestOptions.shouldRetryFn;

        const retryErrors = [
          {code: 429},
          {code: 500},
          {code: 502},
          {code: 503},
        ];

        const nonRetryErrors = [
          {code: 200},
          {code: 401},
          {code: 404},
          {code: 409},
          {code: 412},
        ];

        expect(retryErrors.every(shouldRetryFn)).toBe(true);
        expect(nonRetryErrors.every(shouldRetryFn)).toBe(false);
      });

      it('should treat a retriable error as an HTTP response', done => {
        const grpcError500 = {code: 2};

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts, callback) {
              callback(grpcError500);
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);

        const onResponse = (err, resp) => {
          expect(err).toBe(null);
          expect(resp).toEqual(GrpcService.GRPC_ERROR_CODE_TO_HTTP[2]);
          done();
        };

        retryRequestOptions.request({}, onResponse);
      });

      it('should return grpc request', () => {
        const grpcRequest = {};

        grpcService.getService_ = () => {
          return {
            method() {
              return grpcRequest;
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);

        const request = retryRequestOptions.request();
        expect(request).toBe(grpcRequest);
      });

      it('should exec callback with response error as error', done => {
        const grpcError500 = {code: 2};

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts, callback) {
              callback(grpcError500);
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
          expect(err).toEqual(GrpcService.GRPC_ERROR_CODE_TO_HTTP[2]);
          expect(resp).toBe(null);
          done();
        });

        // When the gRPC error is passed to "onResponse", it will just invoke
        // the callback passed to retry-request. We will check if the grpc Error
        retryRequestOptions.request({}, retryRequestCallback);
      });

      it('should exec callback with unknown error', done => {
        const unknownError = {a: 'a'};

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts, callback) {
              callback(unknownError, null);
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
          expect(err).toBe(unknownError);
          expect(resp).toBe(null);
          done();
        });

        // When the gRPC error is passed to "onResponse", it will just invoke
        // the callback passed to retry-request. We will check if the grpc Error
        retryRequestOptions.request({}, retryRequestCallback);
      });
    });

    describe('request option decoration', () => {
      describe('decoration success', () => {
        it('should decorate the request', done => {
          const decoratedRequest = {};

          grpcService.decorateRequest_ = reqOpts => {
            expect(reqOpts).toEqual(REQ_OPTS);
            return decoratedRequest;
          };

          grpcService.getService_ = () => {
            return {
              method(reqOpts) {
                expect(reqOpts).toBe(decoratedRequest);
                done();
              },
            };
          };

          grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
        });
      });

      describe('decoration error', () => {
        const error = new Error('Error.');

        it('should return a thrown error to the callback', done => {
          grpcService.decorateRequest_ = () => {
            throw error;
          };

          grpcService.request(PROTO_OPTS, REQ_OPTS, err => {
            expect(err).toBe(error);
            done();
          });
        });
      });
    });

    describe('retry request', () => {
      it('should make the correct request on the service', done => {
        grpcService.getService_ = () => {
          return {
            method(reqOpts) {
              expect(reqOpts).toEqual(REQ_OPTS);
              done();
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
      });

      it('should pass the grpc metadata with the request', done => {
        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata) {
              expect(metadata).toBe(grpcService.grpcMetadata);
              done();
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
      });

      it('should set a deadline if a timeout is provided', done => {
        const expectedDeadlineRange = [
          Date.now() + PROTO_OPTS.timeout - 250,
          Date.now() + PROTO_OPTS.timeout + 250,
        ];

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts) {
              expect(isDate(grpcOpts.deadline)).toBeTruthy();

              expect(grpcOpts.deadline.getTime() > expectedDeadlineRange[0]).toBeTruthy();
              expect(grpcOpts.deadline.getTime() < expectedDeadlineRange[1]).toBeTruthy();

              done();
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, ifError);
      });

      describe('request response error', () => {
        it('should look up the http status from the code', () => {
          // tslint:disable-next-line:forin
          for (const grpcErrorCode in GrpcService.GRPC_ERROR_CODE_TO_HTTP) {
            const grpcError = {code: grpcErrorCode};
            const httpError =
              GrpcService.GRPC_ERROR_CODE_TO_HTTP[grpcErrorCode];

            grpcService.getService_ = () => {
              return {
                method(reqOpts, metadata, grpcOpts, callback) {
                  callback(grpcError);
                },
              };
            };

            grpcService.request(PROTO_OPTS, REQ_OPTS, err => {
              expect(err.code).toBe(httpError.code);
            });
          }
          /*jshint loopfunc:false */
        });
      });

      describe('request response success', () => {
        const RESPONSE = {};

        beforeEach(() => {
          grpcService.getService_ = () => {
            return {
              method(reqOpts, metadata, grpcOpts, callback) {
                callback(null, RESPONSE);
              },
            };
          };
        });

        it('should execute callback with response', done => {
          grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
            expect(err).toBeFalsy();
            expect(resp).toBe(RESPONSE);
            done();
          });
        });
      });
    });
  });

  describe('requestStream', () => {
    let PROTO_OPTS;
    const REQ_OPTS = {};
    const GRPC_CREDENTIALS = {};
    let fakeStream;

    function ProtoService() {}

    beforeEach(() => {
      PROTO_OPTS = {service: 'service', method: 'method', timeout: 3000};
      ProtoService.prototype.method = () => {};

      grpcService.grpcCredentials = GRPC_CREDENTIALS;
      grpcService.baseUrl = 'http://base-url';
      grpcService.proto = {};
      grpcService.proto.service = ProtoService;

      grpcService.getService_ = () => {
        return new ProtoService();
      };

      fakeStream = new PassThrough({objectMode: true});
      retryRequestOverride = () => {
        return fakeStream;
      };
    });

    afterEach(() => {
      retryRequestOverride = null;
    });

    it('should not run in the gcloud sandbox environment', () => {
      delete grpcService.grpcCredentials;

      grpcService.getGrpcCredentials_ = () => {
        throw new Error('Should not be called.');
      };

      glob.GCLOUD_SANDBOX_ENV = true;
      grpcService.requestStream();
      delete glob.GCLOUD_SANDBOX_ENV;
    });

    describe('getting gRPC credentials', () => {
      beforeEach(() => {
        delete grpcService.grpcCredentials;
      });

      describe('credentials error', () => {
        const error = new Error('err');

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            callback(error);
          };
        });

        it('should execute callback with error', done => {
          grpcService.requestStream(PROTO_OPTS, REQ_OPTS).on('error', err => {
            expect(err).toBe(error);
            done();
          });
        });
      });

      describe('credentials success', () => {
        const authClient = {};

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            callback(null, authClient);
          };
        });

        it('should make the gRPC request again', done => {
          grpcService.getService_ = () => {
            expect(grpcService.grpcCredentials).toBe(authClient);
            setImmediate(done);
            return new ProtoService();
          };

          grpcService.requestStream(PROTO_OPTS, REQ_OPTS).on('error', done);
        });
      });
    });

    it('should get the proto service', done => {
      grpcService.getService_ = protoOpts => {
        expect(protoOpts).toBe(PROTO_OPTS);
        setImmediate(done);
        return new ProtoService();
      };

      grpcService.requestStream(PROTO_OPTS, REQ_OPTS, ifError);
    });

    it('should set the deadline', done => {
      const createDeadline = GrpcService.createDeadline_;
      const fakeDeadline = createDeadline(PROTO_OPTS.timeout);

      GrpcService.createDeadline_ = timeout => {
        expect(timeout).toBe(PROTO_OPTS.timeout);
        return fakeDeadline;
      };

      ProtoService.prototype.method = (reqOpts, metadata, grpcOpts) => {
        expect(grpcOpts.deadline).toBe(fakeDeadline);

        GrpcService.createDeadline_ = createDeadline;
        setImmediate(done);

        return new PassThrough({objectMode: true});
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestStream(PROTO_OPTS, REQ_OPTS);
    });

    it('should pass the grpc metadata with the request', done => {
      ProtoService.prototype.method = (reqOpts, metadata) => {
        expect(metadata).toBe(grpcService.grpcMetadata);
        setImmediate(done);
        return new PassThrough({objectMode: true});
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestStream(PROTO_OPTS, REQ_OPTS);
    });

    describe('request option decoration', () => {
      beforeEach(() => {
        ProtoService.prototype.method = () => {
          return new PassThrough({objectMode: true});
        };

        retryRequestOverride = (reqOpts, options) => {
          return options.request();
        };
      });

      describe('requestStream() success', () => {
        it('should decorate the request', done => {
          const decoratedRequest = {};

          grpcService.decorateRequest_ = reqOpts => {
            expect(reqOpts).toBe(REQ_OPTS);
            return decoratedRequest;
          };

          ProtoService.prototype.method = reqOpts => {
            expect(reqOpts).toBe(decoratedRequest);
            setImmediate(done);
            return new PassThrough({objectMode: true});
          };

          grpcService
            .requestStream(PROTO_OPTS, REQ_OPTS)
            .on('error', ifError);
        });
      });

      describe('requestStream() error', () => {
        it('should end stream with a thrown error', done => {
          const error = new Error('Error.');

          grpcService.decorateRequest_ = () => {
            throw error;
          };

          grpcService.requestStream(PROTO_OPTS, REQ_OPTS).on('error', err => {
            expect(err).toBe(error);
            done();
          });
        });
      });
    });

    describe('retry strategy', () => {
      let retryRequestReqOpts;
      let retryRequestOptions;
      let retryStream;

      beforeEach(() => {
        retryRequestReqOpts = retryRequestOptions = null;
        retryStream = new PassThrough({objectMode: true});

        retryRequestOverride = (reqOpts, options) => {
          retryRequestReqOpts = reqOpts;
          retryRequestOptions = options;
          return retryStream;
        };
      });

      afterEach(() => {
        retryRequestOverride = null;
      });

      it('should use retry-request', () => {
        const reqOpts = Object.assign(
          {
            objectMode: true,
          },
          REQ_OPTS,
        );

        grpcService.requestStream(PROTO_OPTS, reqOpts);

        expect(retryRequestReqOpts).toBe(null);
        expect(retryRequestOptions.retries).toBe(grpcService.maxRetries);
        expect(retryRequestOptions.currentRetryAttempt).toBe(0);
        expect(retryRequestOptions.objectMode).toBe(true);
        expect(
          retryRequestOptions.shouldRetryFn).toBe(GrpcService.shouldRetryRequest_,
        );
      });

      it('should emit the metadata event as a response event', done => {
        const fakeStream = new PassThrough({objectMode: true});

        ProtoService.prototype.method = () => {
          return fakeStream;
        };

        retryRequestOverride = (reqOpts, options) => {
          return options.request();
        };

        fakeStream.on('error', done).on('response', resp => {
          expect(resp).toEqual(GrpcService.GRPC_ERROR_CODE_TO_HTTP[0]);
          done();
        });

        grpcService.requestStream(PROTO_OPTS, REQ_OPTS);
        fakeStream.emit('metadata');
      });

      it('should forward `request` events', done => {
        const requestStream = grpcService.requestStream(PROTO_OPTS, REQ_OPTS);

        requestStream.on('request', () => {
          done();
        });

        retryStream.emit('request');
      });

      it('should emit the response error', done => {
        const grpcError500 = {code: 2};
        const requestStream = grpcService.requestStream(PROTO_OPTS, REQ_OPTS);

        requestStream.destroy = err => {
          expect(err).toEqual(GrpcService.GRPC_ERROR_CODE_TO_HTTP[2]);
          done();
        };

        retryStream.emit('error', grpcError500);
      });
    });
  });

  describe('requestWritableStream', () => {
    let PROTO_OPTS;
    const REQ_OPTS = {};
    const GRPC_CREDENTIALS = {};

    function ProtoService() {}

    beforeEach(() => {
      PROTO_OPTS = {service: 'service', method: 'method', timeout: 3000};
      ProtoService.prototype.method = () => {};

      grpcService.grpcCredentials = GRPC_CREDENTIALS;
      grpcService.baseUrl = 'http://base-url';
      grpcService.proto = {};
      grpcService.proto.service = ProtoService;

      grpcService.getService_ = () => {
        return new ProtoService();
      };
    });

    it('should not run in the gcloud sandbox environment', () => {
      delete grpcService.grpcCredentials;

      grpcService.getGrpcCredentials_ = () => {
        throw new Error('Should not be called.');
      };

      glob.GCLOUD_SANDBOX_ENV = true;
      grpcService.requestWritableStream({});

      delete glob.GCLOUD_SANDBOX_ENV;
    });

    it('should get the proto service', done => {
      ProtoService.prototype.method = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (duplexify as any).obj();
      };
      grpcService.getService_ = protoOpts => {
        expect(protoOpts).toBe(PROTO_OPTS);
        setImmediate(done);
        return new ProtoService();
      };

      grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
    });

    it('should set the deadline', done => {
      const createDeadline = GrpcService.createDeadline_;
      const fakeDeadline = createDeadline(PROTO_OPTS.timeout);

      GrpcService.createDeadline_ = timeout => {
        expect(timeout).toBe(PROTO_OPTS.timeout);
        return fakeDeadline;
      };

      ProtoService.prototype.method = (reqOpts, metadata, grpcOpts) => {
        expect(grpcOpts.deadline).toBe(fakeDeadline);

        GrpcService.createDeadline_ = createDeadline;
        setImmediate(done);

        return new PassThrough({objectMode: true});
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
    });

    it('should pass the grpc metadata with the request', done => {
      ProtoService.prototype.method = (reqOpts, metadata) => {
        expect(metadata).toBe(grpcService.grpcMetadata);
        setImmediate(done);
        return new PassThrough({objectMode: true});
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
    });

    describe('getting gRPC credentials', () => {
      beforeEach(() => {
        delete grpcService.grpcCredentials;
      });

      describe('grpcCredentials error', () => {
        const error = new Error('err');

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            setImmediate(() => {
              callback(error);
            });
          };
        });

        it('should execute callback with error', done => {
          grpcService
            .requestWritableStream(PROTO_OPTS, REQ_OPTS)
            .on('error', err => {
              expect(err).toBe(error);
              done();
            });
        });
      });

      describe('grpcCredentials success', () => {
        const authClient = {};

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            callback(null, authClient);
          };
        });

        it('should make the gRPC request again', done => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stream = (duplexify as any).obj();
          ProtoService.prototype.method = () => {
            return stream;
          };
          grpcService.getService_ = () => {
            expect(grpcService.grpcCredentials).toBe(authClient);
            setImmediate(done);
            return new ProtoService();
          };

          grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
        });
      });
    });

    describe('request option decoration', () => {
      beforeEach(() => {
        ProtoService.prototype.method = () => {
          return new PassThrough({objectMode: true});
        };

        retryRequestOverride = (reqOpts, options) => {
          return options.request();
        };
      });

      describe('requestWritableStream() success', () => {
        it('should decorate the request', done => {
          const decoratedRequest = {};

          grpcService.decorateRequest_ = reqOpts => {
            expect(reqOpts).toBe(REQ_OPTS);
            return decoratedRequest;
          };

          ProtoService.prototype.method = reqOpts => {
            expect(reqOpts).toBe(decoratedRequest);
            setImmediate(done);
            return new PassThrough({objectMode: true});
          };

          grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
        });
      });

      describe('requestWritableStream() error', () => {
        const error = new Error('Error.');

        it('should end stream with a thrown error', done => {
          grpcService.decorateRequest_ = () => {
            throw error;
          };

          grpcService
            .requestWritableStream(PROTO_OPTS, REQ_OPTS)
            .on('error', err => {
              expect(err).toBe(error);
              done();
            });
        });
      });
    });

    describe('stream success', () => {
      const authClient = {};

      beforeEach(() => {
        delete grpcService.grpcCredentials;
        grpcService.getGrpcCredentials_ = callback => {
          callback(null, authClient);
        };
        jest.spyOn(GrpcService, 'decorateStatus_');
      });

      it('should emit response', done => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = (duplexify as any).obj();
        ProtoService.prototype.method = () => {
          return stream;
        };
        grpcService.getService_ = () => {
          expect(grpcService.grpcCredentials).toBe(authClient);
          return new ProtoService();
        };

        grpcService
          .requestWritableStream(PROTO_OPTS, REQ_OPTS)
          .on('response', status => {
            expect(status).toBe('foo');
            expect((GrpcService.decorateStatus_ as any).mock.calls.length).toBe(1);
            expect(GrpcService.decorateStatus_).toHaveBeenCalledWith('foo');
            (GrpcService.decorateStatus_ as any).mockRestore();
            done();
          })
          .on('error', done);

        setImmediate(() => {
          stream.emit('status', 'foo');
        });
      });
    });

    describe('stream error', () => {
      const authClient = {};

      beforeEach(() => {
        delete grpcService.grpcCredentials;
        grpcService.getGrpcCredentials_ = callback => {
          callback(null, authClient);
        };
      });

      it('should emit a decorated error', done => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const grpcStream = (duplexify as any).obj();
        ProtoService.prototype.method = () => {
          return grpcStream;
        };
        grpcService.getService_ = () => {
          expect(grpcService.grpcCredentials).toBe(authClient);
          return new ProtoService();
        };

        const error = new Error('Error.');
        const expectedDecoratedError = new Error('Decorated error.');

        jest.spyOn(GrpcService, 'decorateError_').mockImplementation(() => {
          return expectedDecoratedError;
        });

        const stream = grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);

        stream.on('error', err => {
          expect(err).toBe(expectedDecoratedError);
          expect((GrpcService.decorateError_ as any).mock.calls.length).toBe(1);
          expect(GrpcService.decorateError_).toHaveBeenCalledWith(error);
          (GrpcService.decorateError_ as any).mockRestore();
          done();
        });

        setImmediate(() => {
          grpcStream.emit('error', error);
        });
      });

      it('should emit the original error', done => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const grpcStream = (duplexify as any).obj();
        ProtoService.prototype.method = () => grpcStream;
        grpcService.getService_ = () => {
          expect(grpcService.grpcCredentials).toBe(authClient);
          return new ProtoService();
        };
        const error = new Error('Error.');
        jest.spyOn(GrpcService, 'decorateError_').mockReturnValue(null! as any);
        const stream = grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
        stream.on('error', err => {
          expect(err).toBe(error);
          expect((GrpcService.decorateError_ as any).mock.calls.length).toBe(1);
          expect(GrpcService.decorateError_).toHaveBeenCalledWith(error);
          (GrpcService.decorateError_ as any).mockRestore();
          done();
        });

        setImmediate(() => {
          grpcStream.emit('error', error);
        });
      });
    });
  });

  describe('encodeValue_', () => {
    it('should encode value using ObjectToStructConverter fn', () => {
      const obj = {};
      const convertedObject = {};
      jest.spyOn(GrpcService, 'ObjectToStructConverter').mockReturnValue({
        encodeValue_(obj_) {
          expect(obj_).toBe(obj);
          return convertedObject;
        },
      });
      expect(GrpcService.encodeValue_(obj)).toBe(convertedObject);
    });
  });

  describe('createDeadline_', () => {
    const nowTimestamp = Date.now();
    let now;

    beforeAll(() => {
      now = Date.now;

      Date.now = () => {
        return nowTimestamp;
      };
    });

    afterAll(() => {
      Date.now = now;
    });

    it('should create a deadline', () => {
      const timeout = 3000;
      const deadline = GrpcService.createDeadline_(timeout);

      expect(deadline.getTime()).toBe(nowTimestamp + timeout);
    });
  });

  describe('decorateError_', () => {
    const expectedDecoratedError = new Error('err.');

    beforeEach(() => {
      jest.spyOn(GrpcService, 'decorateGrpcResponse_').mockImplementation(() => {
        return expectedDecoratedError;
      });
    });

    it('should decorate an Error object', () => {
      const grpcError = new Error('Hello');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (grpcError as any).code = 2;

      const decoratedError = GrpcService.decorateError_(grpcError);
      const decorateArgs = (GrpcService.decorateGrpcResponse_ as any).mock.calls[0];

      expect(decoratedError).toBe(expectedDecoratedError);
      expect(decorateArgs[0] instanceof Error).toBe(true);
      expect(decorateArgs[1]).toBe(grpcError);
    });

    it('should decorate a plain object', () => {
      const grpcMessage = {code: 2};

      const decoratedError = GrpcService.decorateError_(grpcMessage);
      const decorateArgs = (GrpcService.decorateGrpcResponse_ as any).mock.calls[0];

      expect(decoratedError).toBe(expectedDecoratedError);
      expect(decorateArgs[0]).toEqual({});
      expect(decorateArgs[0] instanceof Error).toBe(false);
      expect(decorateArgs[1]).toBe(grpcMessage);
    });
  });

  describe('decorateGrpcResponse_', () => {
    it('should retrieve the HTTP code from the gRPC error map', () => {
      const errorMap = GrpcService.GRPC_ERROR_CODE_TO_HTTP;
      const codes = Object.keys(errorMap);

      codes.forEach(code => {
        const error = new Error();
        const extended = GrpcService.decorateGrpcResponse_(error, {code});

        expect(extended).not.toBe(errorMap[code]);
        expect(extended.code).toBe(errorMap[code].code);
        expect(extended.message).toBe(errorMap[code].message);
        expect(error).toBe(extended);
      });
    });

    it('should use the message from the error', () => {
      const errorMessage = 'This is an error message.';

      const err = {
        code: 1,
        message: errorMessage,
      };

      const error = new Error();
      const extended = GrpcService.decorateGrpcResponse_(error, err);

      expect(extended.message).toBe(errorMessage);
    });

    it('should use a stringified JSON message from the error', () => {
      const errorMessage = 'This is an error message.';

      const err = {
        code: 1,
        message: JSON.stringify({
          description: errorMessage,
        }),
      };

      const error = new Error();
      const extended = GrpcService.decorateGrpcResponse_(error, err);

      expect(extended.message).toBe(errorMessage);
    });

    it('should return null for unknown errors', () => {
      const error = new Error();
      const extended = GrpcService.decorateGrpcResponse_(error, {code: 9999});

      expect(extended).toBe(null);
    });
  });

  describe('decorateStatus_', () => {
    const fakeStatus = {status: 'a'};

    beforeEach(() => {
      jest.spyOn(GrpcService, 'decorateGrpcResponse_').mockImplementation(() => {
        return fakeStatus;
      });
    });

    it('should call decorateGrpcResponse_ with an object', () => {
      const grpcStatus = {code: 2};

      const status = GrpcService.decorateStatus_(grpcStatus);
      const args = (GrpcService.decorateGrpcResponse_ as any).mock.calls[0];

      expect(status).toBe(fakeStatus);
      expect(args[0]).toEqual({});
      expect(args[1]).toBe(grpcStatus);
    });
  });

  describe('shouldRetryRequest_', () => {
    it('should retry on 429, 500, 502, and 503', () => {
      const shouldRetryFn = GrpcService.shouldRetryRequest_;

      const retryErrors = [{code: 429}, {code: 500}, {code: 502}, {code: 503}];

      const nonRetryErrors = [
        {code: 200},
        {code: 401},
        {code: 404},
        {code: 409},
        {code: 412},
      ];

      expect(retryErrors.every(shouldRetryFn)).toBe(true);
      expect(nonRetryErrors.every(shouldRetryFn)).toBe(false);
    });
  });

  describe('decorateRequest_', () => {
    it('should delete custom API values without modifying object', () => {
      const reqOpts = {
        autoPaginate: true,
        autoPaginateVal: true,
        objectMode: true,
      };

      const originalReqOpts = Object.assign({}, reqOpts);

      expect(grpcService.decorateRequest_(reqOpts)).toEqual({});
      expect(reqOpts).toEqual(originalReqOpts);
    });

    it('should execute and return replaceProjectIdToken', () => {
      const reqOpts = {
        a: 'b',
        c: 'd',
      };

      const replacedReqOpts = {};

      replaceProjectIdTokenOverride = (reqOpts_, projectId) => {
        expect(reqOpts_).toEqual(reqOpts);
        expect(projectId).toBe(grpcService.projectId);
        return replacedReqOpts;
      };

      expect(
        grpcService.decorateRequest_(reqOpts)).toBe(replacedReqOpts,
      );
    });
  });

  describe('getGrpcCredentials_', () => {
    it('should get credentials from the auth client', done => {
      grpcService.authClient = {
        async getClient() {
          return '';
        },
      };

      grpcService.getGrpcCredentials_(done);
    });

    describe('credential fetching error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        grpcService.authClient = {
          async getClient() {
            throw error;
          },
        };
      });

      it('should execute callback with error', done => {
        grpcService.getGrpcCredentials_(err => {
          expect(err).toBe(error);
          done();
        });
      });
    });

    describe('credential fetching success', () => {
      const AUTH_CLIENT = {
        projectId: 'project-id',
      };

      beforeEach(() => {
        grpcService.authClient = {
          async getClient() {
            return AUTH_CLIENT;
          },
        };
      });

      it('should return grpcCredentials', done => {
        grpcService.getGrpcCredentials_((err, grpcCredentials) => {
          expect(err).toBeFalsy();
          expect(grpcCredentials.constructor.name.match(/credentials/i)).toBeTruthy();
          done();
        });
      });

      it('should set projectId', done => {
        grpcService.getGrpcCredentials_(err => {
          expect(err).toBeFalsy();
          expect(grpcService.projectId).toBe(AUTH_CLIENT.projectId);
          done();
        });
      });

      it('should not change projectId that was already set', done => {
        grpcService.projectId = 'project-id';

        grpcService.getGrpcCredentials_(err => {
          expect(err).toBeFalsy();
          expect(grpcService.projectId).toBe(AUTH_CLIENT.projectId);
          done();
        });
      });

      it('should change placeholder projectId', done => {
        grpcService.projectId = '{{projectId}}';

        grpcService.getGrpcCredentials_(err => {
          expect(err).toBeFalsy();
          expect(grpcService.projectId).toBe(AUTH_CLIENT.projectId);
          done();
        });
      });

      it('should not update projectId if it was not found', done => {
        grpcService.projectId = 'project-id';

        grpcService.authClient = {
          async getClient() {
            return {
              projectId: undefined,
            };
          },
        };

        grpcService.getGrpcCredentials_(err => {
          expect(err).toBeFalsy();
          expect(grpcService.projectId).toBe(grpcService.projectId);
          done();
        });
      });
    });
  });

  describe('loadProtoFile', () => {
    const fakeServices: grpcProtoLoader.PackageDefinition = {
      'google.FakeService': {},
    };

    it('should load a proto file', () => {
      const fakeProtoPath = '/root/dir/path';

      const fakeMainConfig = {
        protosDir: ROOT_DIR,
      };

      grpcProtoLoadOverride = (file, options) => {
        expect(options!.includeDirs).toEqual([
          fakeMainConfig.protosDir,
          gaxProtosDir,
        ]);
        expect(file).toBe(fakeProtoPath);

        expect(options!.bytes).toBe(String);
        expect(options!.keepCase).toBe(false);

        return fakeServices;
      };

      const services = grpcService.loadProtoFile(fakeProtoPath, fakeMainConfig);
      expect(services).toEqual(fakeServices);
    });

    it('should cache the expensive proto object creation', () => {
      const protoPath = '/root/dir/path';

      const mainConfig = {
        service: 'OtherFakeService',
        apiVersion: 'v2',
      };

      let gprcLoadCalled = 0;
      grpcProtoLoadOverride = () => {
        gprcLoadCalled++;
        return fakeServices;
      };

      const services1 = grpcService.loadProtoFile(protoPath, mainConfig);
      const services2 = grpcService.loadProtoFile(protoPath, mainConfig);
      expect(services1).toBe(services2);
      expect(gprcLoadCalled).toBe(1);
    });

    it('should return the services object if invalid version', () => {
      const fakeProtoPath = '/root/dir/path';

      const fakeMainConfig = {
        service: 'OtherFakeService',
        apiVersion: 'v2',
      };

      grpcProtoLoadOverride = () => {
        return fakeServices;
      };

      const services = grpcService.loadProtoFile(fakeProtoPath, fakeMainConfig);
      expect(services).toEqual(fakeServices);
    });
  });

  describe('getService_', () => {
    it('should get a new service instance', () => {
      const fakeService = {};
      grpcService.protos = {
        Service: {
          Service: class Service {
            constructor(baseUrl, grpcCredentials, userAgent) {
              expect(baseUrl).toBe(grpcService.baseUrl);
              expect(grpcCredentials).toBe(grpcService.grpcCredentials);
              expect(userAgent).toEqual(Object.assign(
                  {
                    'grpc.primary_user_agent': grpcService.userAgent,
                  },
                  GrpcService.GRPC_SERVICE_OPTIONS,
                ),);

              return fakeService;
            }
          },
        },
      };

      const service = grpcService.getService_({service: 'Service'});
      expect(service).toBe(fakeService);

      const cachedService = grpcService.activeServiceMap_.get('Service');
      expect(cachedService).toBe(fakeService);
    });

    it('should return the cached version of a service', () => {
      const fakeService = {};

      grpcService.protos = {
        Service: {
          Service() {
            throw new Error('should not be called');
          },
        },
      };

      grpcService.activeServiceMap_.set('Service', fakeService);

      const service = grpcService.getService_({service: 'Service'});
      expect(service).toBe(fakeService);

      const cachedService = grpcService.activeServiceMap_.get('Service');
      expect(cachedService).toBe(fakeService);
    });

    it('should use the baseUrl override if applicable', () => {
      const fakeBaseUrl = 'a.googleapis.com';
      const fakeService = {};

      grpcService.protos = {
        Service: {
          baseUrl: fakeBaseUrl,
          Service: class Service {
            constructor(baseUrl) {
              expect(baseUrl).toBe(fakeBaseUrl);
              return fakeService;
            }
          },
        },
      };

      const service = grpcService.getService_({service: 'Service'});
      expect(service).toBe(fakeService);
    });
  });

  describe('ObjectToStructConverter', () => {
    let objectToStructConverter;

    beforeEach(() => {
      objectToStructConverter = new ObjectToStructConverter(OPTIONS);
    });

    describe('instantiation', () => {
      it('should not require an options object', () => {
        expect(() => {
          new ObjectToStructConverter().not.toThrow();
        });
      });

      it('should localize an empty Set for seenObjects', () => {
        expect(objectToStructConverter.seenObjects instanceof Set).toBeTruthy();
        expect(objectToStructConverter.seenObjects.size).toBe(0);
      });

      it('should localize options', () => {
        const objectToStructConverter = new ObjectToStructConverter({
          removeCircular: true,
          stringify: true,
        });

        expect(objectToStructConverter.removeCircular).toBe(true);
        expect(objectToStructConverter.stringify).toBe(true);
      });

      it('should set correct defaults', () => {
        expect(objectToStructConverter.removeCircular).toBe(false);
        expect(objectToStructConverter.stringify).toBe(false);
      });
    });

    describe('convert', () => {
      it('should encode values in an Object', () => {
        const inputValue = {};
        const convertedValue = {};

        objectToStructConverter.encodeValue_ = value => {
          expect(value).toBe(inputValue);
          return convertedValue;
        };

        const struct = objectToStructConverter.convert({
          a: inputValue,
        });

        expect(struct.fields.a).toBe(convertedValue);
      });

      it('should support host objects', () => {
        const hostObject = {hasOwnProperty: null};

        objectToStructConverter.encodeValue_ = () => {};

        expect(() => {
          objectToStructConverter.convert(hostObject).not.toThrow();
        });
      });

      it('should not include undefined values', done => {
        objectToStructConverter.encodeValue_ = () => {
          done(new Error('Should not be called'));
        };

        const struct = objectToStructConverter.convert({
          a: undefined,
        });

        expect(struct.fields).toEqual({});

        done();
      });

      it('should add seen objects to set then empty set', done => {
        const obj = {};
        let objectAdded;

        objectToStructConverter.seenObjects = {
          add(obj) {
            objectAdded = obj;
          },
          delete(obj_) {
            expect(obj_).toBe(obj);
            expect(objectAdded).toBe(obj);
            done();
          },
        };

        objectToStructConverter.convert(obj);
      });
    });

    describe('encodeValue_', () => {
      it('should convert primitive values correctly', () => {
        const buffer = Buffer.from('Value');

        expect(objectToStructConverter.encodeValue_(null)).toEqual({
          nullValue: 0,
        });

        expect(objectToStructConverter.encodeValue_(1)).toEqual({
          numberValue: 1,
        });

        expect(objectToStructConverter.encodeValue_('Hi')).toEqual({
          stringValue: 'Hi',
        });

        expect(objectToStructConverter.encodeValue_(true)).toEqual({
          boolValue: true,
        });

        expect(
          objectToStructConverter.encodeValue_(buffer).blobValue.toString()).toBe('Value',
        );
      });

      it('should convert arrays', () => {
        const convertedValue = objectToStructConverter.encodeValue_([1, 2, 3]);

        expect(convertedValue.listValue).toEqual({
          values: [
            objectToStructConverter.encodeValue_(1),
            objectToStructConverter.encodeValue_(2),
            objectToStructConverter.encodeValue_(3),
          ],
        });
      });

      it('should throw if a type is not recognized', () => {
        expect(() => {
          objectToStructConverter.encodeValue_();
        }).toThrow(/Value of type undefined not recognized./);
      });

      describe('objects', () => {
        const VALUE: {circularReference?: {}} = {};
        VALUE.circularReference = VALUE;

        it('should convert objects', () => {
          const convertedValue = {};

          objectToStructConverter.convert = value => {
            expect(value).toBe(VALUE);
            return convertedValue;
          };

          expect(objectToStructConverter.encodeValue_(VALUE)).toEqual({
            structValue: convertedValue,
          });
        });

        describe('circular references', () => {
          it('should throw if circular', () => {
            const errorMessage = [
              'This object contains a circular reference. To automatically',
              'remove it, set the `removeCircular` option to true.',
            ].join(' ');

            objectToStructConverter.seenObjects.add(VALUE);

            expect(() => {
              objectToStructConverter.encodeValue_(VALUE);
            }).toThrow(new RegExp(errorMessage));
          });

          describe('options.removeCircular', () => {
            let objectToStructConverter;

            beforeEach(() => {
              objectToStructConverter = new ObjectToStructConverter({
                removeCircular: true,
              });

              objectToStructConverter.seenObjects.add(VALUE);
            });

            it('should replace circular reference with [Circular]', () => {
              expect(
                objectToStructConverter.encodeValue_(VALUE)).toEqual({stringValue: '[Circular]'},
              );
            });
          });
        });
      });

      describe('options.stringify', () => {
        let objectToStructConverter;

        beforeEach(() => {
          objectToStructConverter = new ObjectToStructConverter({
            stringify: true,
          });
        });

        it('should return a string if the value is not recognized', () => {
          const date = new Date();

          expect(objectToStructConverter.encodeValue_(date, OPTIONS)).toEqual({stringValue: String(date)});
        });
      });
    });
  });
});
