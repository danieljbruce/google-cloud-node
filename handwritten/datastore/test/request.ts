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

import * as pfy from '@google-cloud/promisify';
import * as extend from 'extend';
import * as gax from 'google-gax';
import * as is from 'is';
import {PassThrough, Transform} from 'stream';

import {google} from '../src/protos';
import * as ds from '../src';
import {entity, Entity, KeyProto} from '../src/entity';
import {IntegerTypeCastOptions, Query, QueryProto} from '../src/query';

function outOfBoundsError(opts: {
  propertyName?: string;
  integerValue: string | number;
}) {
  return new Error(
    'We attempted to return all of the numeric values, but ' +
      (opts.propertyName ? opts.propertyName + ' ' : '') +
      'value ' +
      opts.integerValue +
      " is out of bounds of 'Number.MAX_SAFE_INTEGER'.\n" +
      "To prevent this error, please consider passing 'options.wrapNumbers=true' or\n" +
      "'options.wrapNumbers' as\n" +
      '{\n' +
      '  integerTypeCastFunction: provide <your_custom_function>\n' +
      '  properties: optionally specify property name(s) to be custom casted\n' +
      '}\n',
  );
}
import {
  AllocateIdsResponse,
  RequestConfig,
  RequestOptions,
  PrepareEntityObjectResponse,
  CommitResponse,
  GetResponse,
  RequestCallback,
} from '../src/request';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

import {DatastoreRequest} from '../src/request';
import {Transaction} from '../src/transaction';

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll(klass: Function) {
      if (klass.name === 'DatastoreRequest') {
        (global as any).__mockPromisified = true;
      }
    },
  };
});

// eslint-disable-next-line no-var
var mockV1FakeClientOverride: Function | null;
jest.mock('../src/v1', () => {
  const actual = jest.requireActual('../src/v1');
  return {
    ...actual,
    FakeClient: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        return (mockV1FakeClientOverride || (() => {}))(...args);
      }
    },
  };
});

describe('Request', () => {
  const Request = DatastoreRequest;
  let request: Any;
  let key: entity.Key;

  beforeEach(() => {
    key = new entity.Key({
      namespace: 'namespace',
      path: ['Company', 123],
    });
    mockV1FakeClientOverride = null;
    request = new Request();
  });

  afterEach(() => {
    mockV1FakeClientOverride = null;
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).__mockPromisified).toBeTruthy();
    });
  });

  describe('prepareEntityObject_', () => {
    it('should clone an object', () => {
      const obj = {
        data: {
          nested: {
            obj: true,
          },
        },
        method: 'insert',
      };
      const expectedPreparedEntityObject = extend(true, {}, obj);
      const preparedEntityObject = Request.prepareEntityObject_(obj) as Any;
      expect(preparedEntityObject).not.toBe(obj);
      expect(preparedEntityObject.data.nested).not.toBe(obj.data.nested);
      expect(preparedEntityObject).toEqual(expectedPreparedEntityObject);
    });

    it('should format an entity', () => {
      const key = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entityObject: any = {data: true};
      entityObject[entity.KEY_SYMBOL] = key;
      const preparedEntityObject = Request.prepareEntityObject_(
        entityObject,
      ) as Any;
      expect(preparedEntityObject.key).toBe(key);
      expect(preparedEntityObject.data.data).toBe(entityObject.data);
    });
  });

  describe('allocateIds', () => {
    const INCOMPLETE_KEY = {} as entity.Key;
    const ALLOCATIONS = 2;
    const OPTIONS = {
      allocations: ALLOCATIONS,
    };
    const keyProto = {} as KeyProto;

    beforeEach(() => {
      jest.spyOn(entity, 'isKeyComplete').mockReturnValue(false);
      jest.spyOn(entity, 'keyToKeyProto').mockReturnValue(keyProto);
    });

    it('should throw if the key is complete', () => {
      jest.spyOn(entity, 'isKeyComplete').mockImplementation(key => {
        expect(key).toBe(INCOMPLETE_KEY);
        return true;
      });

      expect(() => {
        request.allocateIds(INCOMPLETE_KEY, OPTIONS, () => {});
      }).toThrow(new RegExp('An incomplete key should be provided.'));
    });

    it('should make the correct request', done => {
      const keyProto = {} as KeyProto;
      jest.spyOn(entity, 'isKeyComplete');
      jest.spyOn(entity, 'keyToKeyProto').mockImplementation(key => {
        expect(key).toBe(INCOMPLETE_KEY);
        return keyProto;
      });

      request.request_ = (config: RequestConfig) => {
        expect(config.client).toBe('DatastoreClient');
        expect(config.method).toBe('allocateIds');

        const expectedKeys: Array<{}> = [];
        expectedKeys.length = ALLOCATIONS;
        expectedKeys.fill(keyProto);
        expect(config.reqOpts!.keys).toEqual(expectedKeys);
        expect(config.gaxOpts).toBe(undefined);
        done();
      };

      request.allocateIds(INCOMPLETE_KEY, OPTIONS, () => {});
    });

    it('should allow a numeric shorthand for allocations', done => {
      jest.spyOn(entity, 'isKeyComplete');
      jest.spyOn(entity, 'keyToKeyProto');
      request.request_ = (config: RequestConfig) => {
        expect(config.reqOpts!.keys.length).toBe(ALLOCATIONS);
        done();
      };
      request.allocateIds(INCOMPLETE_KEY, ALLOCATIONS, () => {});
    });

    it('should allow customization of GAX options', done => {
      jest.spyOn(entity, 'isKeyComplete');
      jest.spyOn(entity, 'keyToKeyProto');
      const options = Object.assign({}, OPTIONS, {
        gaxOptions: {},
      });

      request.request_ = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(options.gaxOptions);
        done();
      };

      request.allocateIds(INCOMPLETE_KEY, options, () => {});
    });

    describe('error', () => {
      const ERROR = new Error('Error.');
      const API_RESPONSE = {};

      beforeEach(() => {
        request.request_ = (_: object, callback: Function) => {
          callback(ERROR, API_RESPONSE);
        };
      });

      it('should exec callback with error & API response', done => {
        jest.spyOn(entity, 'isKeyComplete');
        jest.spyOn(entity, 'keyToKeyProto');
        request.allocateIds(
          INCOMPLETE_KEY,
          OPTIONS,
          (err: Error, keys: null, resp: {}) => {
            expect(err).toBe(ERROR);
            expect(keys).toBe(null);
            expect(resp).toBe(API_RESPONSE);
            done();
          },
        );
      });
    });

    describe('success', () => {
      const KEY = {};
      const API_RESPONSE = {
        keys: [KEY],
      };

      beforeEach(() => {
        request.request_ = (_: object, callback: Function) => {
          callback(null!, API_RESPONSE);
        };
      });

      it('should create and return Keys & API response', done => {
        const key = {} as entity.Key;
        jest.spyOn(entity, 'isKeyComplete');
        jest.spyOn(entity, 'keyToKeyProto');
        jest.spyOn(entity, 'keyFromKeyProto').mockImplementation(keyProto => {
          expect(keyProto).toBe(API_RESPONSE.keys[0]);
          return key;
        });
        request.allocateIds(
          INCOMPLETE_KEY,
          OPTIONS,
          (err: Error, keys: entity.Key[], resp: AllocateIdsResponse) => {
            expect(err).toBeFalsy();
            expect(keys).toEqual([key]);
            expect(resp).toBe(API_RESPONSE);
            done();
          },
        );
      });
    });
  });

  describe('createReadStream', () => {
    beforeEach(() => {
      request.request_ = () => {};
    });

    it('should throw if no keys are provided', () => {
      expect(() => {
        request.createReadStream(null!);
      }).toThrow(/At least one Key object is required/);
    });

    it('should convert key to key proto', done => {
      jest.spyOn(entity, 'keyToKeyProto').mockImplementation(key_ => {
        expect(key_).toBe(key);
        done();
        return {} as KeyProto;
      });

      request.createReadStream(key).on('error', done);
    });

    it('should make correct request when stream is ready', done => {
      request.request_ = (config: RequestConfig) => {
        expect(config.client).toBe('DatastoreClient');
        expect(config.method).toBe('lookup');
        expect(config.reqOpts!.keys[0]).toEqual(entity.keyToKeyProto(key));
        done();
      };
      const stream = request.createReadStream(key);
      stream.emit('reading');
    });

    it('should allow customization of GAX options', done => {
      const options = {
        gaxOptions: {},
      };

      request.request_ = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(options.gaxOptions);
        done();
      };

      request.createReadStream(key, options).on('error', done).emit('reading');
    });

    it('should allow setting strong read consistency', done => {
      request.request_ = (config: RequestConfig) => {
        expect(config.reqOpts!.readOptions!.readConsistency).toBe(1);
        done();
      };

      request
        .createReadStream(key, {consistency: 'strong'})
        .on('error', done)
        .emit('reading');
    });

    it('should allow setting strong eventual consistency', done => {
      request.request_ = (config: RequestConfig) => {
        expect(config.reqOpts!.readOptions!.readConsistency).toBe(2);
        done();
      };

      request
        .createReadStream(key, {consistency: 'eventual'})
        .on('error', done)
        .emit('reading');
    });

    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {a: 'b', c: 'd'};

      beforeEach(() => {
        request.request_ = (_: object, callback: Function) => {
          setImmediate(() => {
            callback(error, apiResponse);
          });
        };
      });

      it('should emit error', done => {
        request
          .createReadStream(key)
          .on('data', () => {})
          .on('error', (err: Error) => {
            expect(err).toBe(error);
            done();
          });
      });

      it('should end stream', done => {
        const stream = request.createReadStream(key);
        stream
          .on('data', () => {})
          .on('error', () => {
            setImmediate(() => {
              expect(stream.destroyed).toBe(true);
              done();
            });
          });
      });

      it('should emit an error from results decoding', done => {
        const largeInt = '922337203685477850';
        const propertyName = 'points';
        request.request_ = (config: RequestConfig, callback: Function) => {
          callback(null, {
            found: [
              {
                entity: {
                  properties: {
                    [propertyName]: {
                      integerValue: largeInt,
                      valueType: 'integerValue',
                    },
                  },
                },
              },
            ],
          });
        };

        const stream = request.createReadStream(key);

        stream
          .on('data', () => {})
          .on('error', (err: Error) => {
            expect(err).toEqual(outOfBoundsError({integerValue: largeInt, propertyName}));
            setImmediate(() => {
              expect(stream.destroyed).toBe(true);
              done();
            });
          });
      });
    });

    describe('success', () => {
      const apiResponse = {
        found: [
          {
            entity: {
              key: {
                partitionId: {
                  projectId: 'grape-spaceship-123',
                },
                path: [
                  {
                    kind: 'Post',
                    name: 'post1',
                  },
                ],
              },
              properties: {
                title: {
                  stringValue: 'How to make the perfect pizza in your grill',
                },
                tags: {
                  arrayValue: {
                    values: [
                      {
                        stringValue: 'pizza',
                      },
                      {
                        stringValue: 'grill',
                      },
                    ],
                  },
                },
                rating: {
                  integerValue: '5',
                },
                author: {
                  stringValue: 'Silvano',
                },
                wordCount: {
                  integerValue: '400',
                },
                isDraft: {
                  booleanValue: false,
                },
              },
            },
          },
        ],
      };

      const expectedResult = entity.formatArray(apiResponse.found as Any)[0];

      const apiResponseWithMultiEntities = extend(true, {}, apiResponse);
      const entities = apiResponseWithMultiEntities.found;
      entities.push(entities[0]);

      const apiResponseWithDeferred = extend(true, {}, apiResponse) as Any;
      apiResponseWithDeferred.deferred = [
        apiResponseWithDeferred.found[0].entity.key,
      ];

      beforeEach(() => {
        request.request_ = (_: object, callback: Function) => {
          callback(null!, apiResponse);
        };
      });

      it('should format the results', done => {
        jest.spyOn(entity, 'formatArray').mockImplementation(arr => {
          expect(arr).toBe(apiResponse.found);
          setImmediate(done);
          return arr;
        });

        request.createReadStream(key).on('error', done).emit('reading');
      });

      describe('should pass `wrapNumbers` to formatArray', () => {
        let wrapNumbersOpts: boolean | IntegerTypeCastOptions | undefined;
        let formtArrayStub: Any;

        beforeEach(() => {
          formtArrayStub = jest.spyOn(entity, 'formatArray')
            .mockImplementation(arr => {
              expect(arr).toBe(apiResponse.found);
              return arr;
            });
        });

        afterEach(() => {
          formtArrayStub.mockRestore();
        });

        it('should pass `wrapNumbers` to formatArray as undefined by default', done => {
          request.createReadStream(key).on('error', done).resume();

          setImmediate(() => {
            wrapNumbersOpts = formtArrayStub.mock.calls[0][1];
            expect(wrapNumbersOpts).toBe(undefined);
            done();
          });
        });

        it('should pass `wrapNumbers` to formatArray as bolean', done => {
          request
            .createReadStream(key, {wrapNumbers: true})
            .on('error', done)
            .resume();

          setImmediate(() => {
            wrapNumbersOpts = formtArrayStub.mock.calls[0][1];
            expect(typeof wrapNumbersOpts).toBe('boolean');
            done();
          });
        });

        it('should pass `wrapNumbers` to formatArray as IntegerTypeCastOptions', done => {
          const integerTypeCastOptions = {
            integerTypeCastFunction: () => {},
            properties: 'that',
          };

          request
            .createReadStream(key, {wrapNumbers: integerTypeCastOptions})
            .on('error', done)
            .resume();

          setImmediate(() => {
            wrapNumbersOpts = formtArrayStub.mock.calls[0][1];
            expect(wrapNumbersOpts).toBe(integerTypeCastOptions);
            expect(wrapNumbersOpts).toEqual(integerTypeCastOptions);
            done();
          });
        });
      });

      it('should continue looking for deferred results', done => {
        let numTimesCalled = 0;

        request.request_ = (config: RequestConfig, callback: Function) => {
          numTimesCalled++;

          if (numTimesCalled === 1) {
            callback(null!, apiResponseWithDeferred);
            return;
          }

          const expectedKeys = apiResponseWithDeferred.deferred
            .map(entity.keyFromKeyProto)
            .map(entity.keyToKeyProto);

          expect(config.reqOpts!.keys).toEqual(expectedKeys);
          done();
        };

        request.createReadStream(key).on('error', done).emit('reading');
      });

      it('should push results to the stream', done => {
        request
          .createReadStream(key)
          .on('error', done)
          .on('data', (entity: Entity) => {
            expect(entity).toEqual(expectedResult);
          })
          .on('end', done)
          .emit('reading');
      });

      it('should not push more results if stream was ended', done => {
        let entitiesEmitted = 0;

        request.request_ = (config: RequestConfig, callback: Function) => {
          setImmediate(() => {
            callback(null!, apiResponseWithMultiEntities);
          });
        };

        const stream = request.createReadStream([key, key]);
        stream
          .on('data', () => {
            entitiesEmitted++;
            stream.end();
          })
          .on('end', () => {
            expect(entitiesEmitted).toBe(1);
            done();
          })
          .emit('reading');
      });

      it('should not get more results if stream was ended', done => {
        let lookupCount = 0;

        request.request_ = (config: RequestConfig, callback: Function) => {
          lookupCount++;
          setImmediate(() => {
            callback(null!, apiResponseWithDeferred);
          });
        };

        const stream = request.createReadStream(key);
        stream
          .on('error', done)
          .on('data', () => stream.end())
          .on('end', () => {
            expect(lookupCount).toBe(1);
            done();
          })
          .emit('reading');
      });
    });
  });

  describe('delete', () => {
    it('should delete by key', done => {
      request.request_ = (config: RequestConfig, callback: Function) => {
        expect(config.client).toBe('DatastoreClient');
        expect(config.method).toBe('commit');
        expect(is.object((config.reqOpts as Any).mutations[0].delete)).toBeTruthy();
        callback(null!);
      };
      request.delete(key, done);
    });

    it('should return apiResponse in callback', done => {
      const resp = {success: true};
      request.request_ = (config: RequestConfig, callback: Function) => {
        callback(null!, resp);
      };
      request.delete(
        key,
        (err: Error, apiResponse: [google.datastore.v1.CommitResponse]) => {
          expect(err).toBeFalsy();
          expect(resp).toEqual(apiResponse);
          done();
        },
      );
    });

    it('should multi delete by keys', done => {
      request.request_ = (config: RequestConfig, callback: Function) => {
        expect(config.reqOpts!.mutations!.length).toBe(2);
        callback(null!);
      };
      request.delete([key, key], done);
    });

    it('should allow customization of GAX options', done => {
      const gaxOptions = {};
      request.request_ = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };
      request.delete(key, gaxOptions, () => {});
    });

    describe('transactions', () => {
      beforeEach(() => {
        // Trigger transaction mode.
        request.id = 'transaction-id';
        request.requests_ = [];
      });

      it('should queue request', () => {
        request.delete(key);
        expect(is.object(request.requests_[0].mutations[0].delete)).toBeTruthy();
      });
    });
  });

  describe('get', () => {
    it('should pass along readTime for reading snapshots', done => {
      const savedTime = Date.now();
      request.request_ = (config: RequestConfig, callback: RequestCallback) => {
        expect(config).toEqual({
          client: 'DatastoreClient',
          method: 'lookup',
          gaxOpts: undefined,
          reqOpts: {
            keys: [
              {
                path: [
                  {
                    kind: 'Company',
                    id: 123,
                  },
                ],
                partitionId: {namespaceId: 'namespace'},
              },
            ],
            readOptions: {
              readTime: {
                seconds: Math.floor(savedTime / 1000),
              },
            },
          },
        });
        callback(null, {
          deferred: [],
          found: [],
          missing: [],
          readTime: {seconds: Math.floor(savedTime / 1000), nanos: 0},
        });
      };
      request.get(key, {readTime: savedTime}, (err: any) => {
        if (err) {
          throw err;
        }
        done();
      });
    });

    describe('success', () => {
      const keys = [key];
      const fakeEntities = [{a: 'a'}, {b: 'b'}];

      beforeEach(() => {
        request.createReadStream = jest.fn(() => {
          const stream = new Transform({objectMode: true});
          setImmediate(() => {
            fakeEntities.forEach(entity => stream.push(entity));
            stream.push(null);
          });
          return stream;
        });
      });

      it('should return an array of entities', done => {
        const options = {};

        request.get(keys, options, (err: Error, entities: Entity[]) => {
          expect(err).toBeFalsy();
          expect(entities).toEqual(fakeEntities);
          const spy = (request.createReadStream as Any).mock.calls[0];
          expect(spy[0]).toBe(keys);
          expect(spy[1]).toBe(options);
          done();
        });
      });

      it('should return a single entity', done => {
        request.get(key, (err: Error, entity: Entity) => {
          expect(err).toBeFalsy();
          expect(entity).toBe(fakeEntities[0]);
          done();
        });
      });

      it('should allow options to be omitted', done => {
        request.get(keys, (err: Error) => {
          expect(err).toBeFalsy();
          done();
        });
      });

      it('should default options to an object', done => {
        request.get(keys, null!, (err: Error) => {
          expect(err).toBeFalsy();
          const spy = (request.createReadStream as Any).mock.calls[0];
          expect(spy[1]).toEqual({});
          done();
        });
      });

      describe('should pass `wrapNumbers` to createReadStream', () => {
        it('should pass `wrapNumbers` to createReadStream as undefined by default', done => {
          request.get(keys, (err: Error) => {
            expect(err).toBeFalsy();

            const createReadStreamOptions =
              request.createReadStream.mock.calls[0][1];
            expect(createReadStreamOptions.wrapNumbers).toBe(undefined);
            done();
          });
        });

        it('should pass `wrapNumbers` to createReadStream as boolean', done => {
          request.get(keys, {wrapNumbers: true}, (err: Error) => {
            expect(err).toBeFalsy();

            const createReadStreamOptions =
              request.createReadStream.mock.calls[0][1];
            expect(typeof createReadStreamOptions.wrapNumbers).toBe('boolean');
            done();
          });
        });

        it('should pass `wrapNumbers` to createReadStream as IntegerTypeCastOptions', done => {
          const integerTypeCastOptions = {
            integerTypeCastFunction: () => {},
            properties: 'that',
          };

          request.get(
            keys,
            {wrapNumbers: integerTypeCastOptions},
            (err: Error) => {
              expect(err).toBeFalsy();

              const createReadStreamOptions =
                request.createReadStream.mock.calls[0][1];
              expect(createReadStreamOptions.wrapNumbers).toBe(integerTypeCastOptions);
              expect(createReadStreamOptions.wrapNumbers).toEqual(integerTypeCastOptions);
              done();
            },
          );
        });
      });
    });

    describe('error', () => {
      const error = new Error('err');

      beforeEach(() => {
        request.createReadStream = jest.fn(() => {
          const stream = new Transform({objectMode: true});
          setImmediate(() => {
            stream.emit('error', error);
          });
          return stream;
        });
      });

      it('send an error to the callback', done => {
        request.get(key, (err: Error) => {
          expect(err).toBe(error);
          done();
        });
      });
    });
  });

  describe('runQueryStream', () => {
    beforeEach(() => {
      request.request_ = () => {};
      jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
    });

    it('should clone the query', done => {
      let query = new Query(request.datastore);
      query.namespace = 'namespace';
      query = extend(true, new Query(request.datastore), query);

      jest.spyOn(entity, 'queryToQueryProto').mockImplementation(query_ => {
        expect(query_).not.toBe(query);
        expect(query_).toEqual(query);
        done();
        return {} as QueryProto;
      });

      request.runQueryStream(query).on('error', done).emit('reading');
    });

    it('should make correct request when the stream is ready', done => {
      const query = {namespace: 'namespace'};
      const queryProto = {} as QueryProto;

      jest.spyOn(entity, 'queryToQueryProto').mockReturnValue(queryProto);

      request.request_ = (config: RequestConfig) => {
        expect(config.client).toBe('DatastoreClient');
        expect(config.method).toBe('runQuery');
        expect(is.empty(config.reqOpts!.readOptions)).toBeTruthy();
        expect(config.reqOpts!.query).toBe(queryProto);
        expect(config.reqOpts!.partitionId!.namespaceId).toBe(query.namespace);
        expect(config.gaxOpts).toBe(undefined);

        done();
      };

      request.runQueryStream(query).on('error', done).emit('reading');
    });

    it('should allow customization of GAX options', done => {
      jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
      const options = {
        gaxOptions: {},
      };

      request.request_ = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(options.gaxOptions);
        done();
      };

      request.runQueryStream({}, options).on('error', done).emit('reading');
    });

    it('should allow setting strong read consistency', done => {
      jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
      request.request_ = (config: RequestConfig) => {
        expect(config.reqOpts!.readOptions!.readConsistency).toBe(1);
        done();
      };

      request
        .runQueryStream({}, {consistency: 'strong'})
        .on('error', done)
        .emit('reading');
    });

    it('should allow setting strong eventual consistency', done => {
      jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
      request.request_ = (config: RequestConfig) => {
        expect(config.reqOpts!.readOptions!.readConsistency).toBe(2);
        done();
      };

      request
        .runQueryStream({}, {consistency: 'eventual'})
        .on('error', done)
        .emit('reading');
    });

    describe('error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        request.request_ = (config: RequestConfig, callback: Function) => {
          callback(error);
        };
      });

      it('should emit error on a stream', done => {
        jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
        request
          .runQueryStream({})
          .on('error', (err: Error) => {
            expect(err).toBe(error);
            done();
          })
          .emit('reading');
      });

      it('should emit an error when encoding fails', done => {
        const error = new Error('Encoding error.');
        jest.spyOn(entity, 'queryToQueryProto').mockImplementation(() => {
          throw error;
        });
        request
          .runQueryStream({})
          .on('error', (err: Error) => {
            expect(err).toBe(error);
            done();
          })
          .emit('reading');
      });

      it('should emit an error from results decoding', done => {
        const largeInt = '922337203685477850';
        const propertyName = 'points';
        jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);

        request.request_ = (config: RequestConfig, callback: Function) => {
          callback(null, {
            batch: {
              entityResults: [
                {
                  entity: {
                    properties: {
                      [propertyName]: {
                        integerValue: largeInt,
                        valueType: 'integerValue',
                      },
                    },
                  },
                },
              ],
            },
          });
        };

        const stream = request.runQueryStream({});

        stream
          .on('error', (err: Error) => {
            expect(err).toEqual(outOfBoundsError({integerValue: largeInt, propertyName}));
            setImmediate(() => {
              expect(stream.destroyed).toBe(true);
              done();
            });
          })
          .emit('reading');
      });
    });

    describe('success', () => {
      const entityResultsPerApiCall: Any = {
        1: [{a: true}],
        2: [{b: true}, {c: true}],
      };

      const apiResponse = {
        batch: {
          entityResults: [{a: true}, {b: true}, {c: true}],
          endCursor: Buffer.from('abc'),
          moreResults: 'MORE_RESULTS_AFTER_LIMIT',
          skippedResults: 0,
        },
      };

      let formatArrayStub: Any;
      beforeEach(() => {
        request.request_ = (config: RequestConfig, callback: Function) => {
          callback(null, apiResponse);
        };

        formatArrayStub = jest.spyOn(entity, 'formatArray')
          .mockImplementation(array => {
            return array;
          });
      });

      it('should format results', done => {
        jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
        formatArrayStub.mockRestore();
        jest.spyOn(entity, 'formatArray').mockImplementation(array => {
          expect(array).toBe(apiResponse.batch.entityResults);
          return array;
        });

        const entities: Array<{}> = [];

        request
          .runQueryStream({})
          .on('error', done)
          .on('data', (entity: Entity) => entities.push(entity))
          .on('end', () => {
            expect(entities).toEqual(apiResponse.batch.entityResults);
            done();
          });
      });

      describe('should pass `wrapNumbers` to formatArray', () => {
        let wrapNumbersOpts: boolean | IntegerTypeCastOptions | undefined;

        beforeEach(() => {
          jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
          formatArrayStub.mockRestore();
          formatArrayStub = jest.spyOn(entity, 'formatArray')
            .mockImplementation(array => {
              return array;
            });
        });

        it('should pass `wrapNumbers` to formatArray as undefined by default', done => {
          request.runQueryStream({}).on('error', () => {}).resume();

          setImmediate(() => {
            wrapNumbersOpts = formatArrayStub.mock.calls[0][1];
            expect(wrapNumbersOpts).toBe(undefined);
            done();
          });
        });

        it('should pass `wrapNumbers` to formatArray as boolean', done => {
          request
            .runQueryStream({}, {wrapNumbers: true})
            .on('error', () => {})
            .resume();

          setImmediate(() => {
            wrapNumbersOpts = formatArrayStub.mock.calls[0][1];
            expect(typeof wrapNumbersOpts).toBe('boolean');
            done();
          });
        });

        it('should pass `wrapNumbers` to formatArray as IntegerTypeCastOptions', done => {
          const integerTypeCastOptions = {
            integerTypeCastFunction: () => {},
            properties: 'that',
          };

          request
            .runQueryStream({}, {wrapNumbers: integerTypeCastOptions})
            .on('error', () => {})
            .resume();

          setImmediate(() => {
            wrapNumbersOpts = formatArrayStub.mock.calls[0][1];
            expect(wrapNumbersOpts).toBe(integerTypeCastOptions);
            expect(wrapNumbersOpts).toEqual(integerTypeCastOptions);
            done();
          });
        });
      });

      it('should re-run query if not finished', done => {
        const query = {
          limitVal: 1,
          offsetVal: 8,
        };
        const queryProto = {
          limit: {
            value: query.limitVal,
          },
        } as {} as QueryProto;

        let timesRequestCalled = 0;
        let startCalled = false;
        let offsetCalled = false;

        formatArrayStub.mockRestore();
        jest.spyOn(entity, 'formatArray').mockImplementation(array => {
          expect(array).toBe(entityResultsPerApiCall[timesRequestCalled]);
          return entityResultsPerApiCall[timesRequestCalled];
        });

        request.request_ = (config: RequestConfig, callback: Function) => {
          timesRequestCalled++;

          const resp = extend(true, {}, apiResponse);
          resp.batch.entityResults =
            entityResultsPerApiCall[timesRequestCalled];

          if (timesRequestCalled === 1) {
            expect(config.client).toBe('DatastoreClient');
            expect(config.method).toBe('runQuery');
            resp.batch.moreResults = 'NOT_FINISHED';
            callback(null, resp);
          } else {
            expect(startCalled).toBe(true);
            expect(offsetCalled).toBe(true);
            expect(config.reqOpts!.query).toBe(queryProto);
            resp.batch.moreResults = 'MORE_RESULTS_AFTER_LIMIT';
            callback(null, resp);
          }
        };

        jest.spyOn(Query.prototype, 'start').mockImplementation(function (this: any, endCursor: any) {
          expect(endCursor).toBe(apiResponse.batch.endCursor.toString('base64'));
          startCalled = true;
          return this;
        });

        jest.spyOn(Query.prototype, 'offset').mockImplementation((offset_: any) => {
          const offset = query.offsetVal - apiResponse.batch.skippedResults;
          expect(offset_).toBe(offset);
          offsetCalled = true;
          return {} as Query;
        });

        jest.spyOn(Query.prototype, 'limit').mockImplementation((limit_: any) => {
          if (timesRequestCalled === 1) {
            expect(limit_).toBe(entityResultsPerApiCall[1].length - query.limitVal);
          } else {
            // Should restore the original limit.
            expect(limit_).toBe(query.limitVal);
          }
          return {} as Query;
        });

        jest.spyOn(entity, 'queryToQueryProto').mockImplementation(query_ => {
          if (timesRequestCalled > 1) {
            expect(query_).toBe(query);
          }
          return queryProto;
        });

        const entities: Array<{}> = [];
        let info: Any;

        request
          .runQueryStream(query)
          .on('error', done)
          .on('info', (_info: object) => {
            info = _info;
          })
          .on('data', (entity: Entity) => {
            entities.push(entity);
          })
          .on('end', () => {
            const allResults = ([] as Array<{}>).slice
              .call(entityResultsPerApiCall[1])
              .concat(entityResultsPerApiCall[2]);

            expect(entities).toEqual(allResults);

            expect(info).toEqual({
              endCursor: apiResponse.batch.endCursor.toString('base64'),
              moreResults: apiResponse.batch.moreResults,
            });

            done();
          });
      });

      it('should handle large limitless queries', done => {
        let timesRequestCalled = 0;

        const query = {
          limitVal: -1,
        };

        request.request_ = (_: object, callback: Function) => {
          let batch;
          if (++timesRequestCalled === 2) {
            batch = {};
          } else {
            batch = {
              moreResults: 'NOT_FINISHED',
              endCursor: Buffer.from('abc'),
            };
          }
          callback(null, {batch});
        };

        jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as QueryProto);
        const limitStub = jest.spyOn(Query.prototype, 'limit');

        request
          .runQueryStream(query)
          .on('error', done)
          .on('data', () => {})
          .on('end', () => {
            expect(timesRequestCalled).toBe(2);
            expect(limitStub).not.toHaveBeenCalled();
            done();
          });
      });

      it('should not push more results if stream was ended', done => {
        let timesRequestCalled = 0;
        let entitiesEmitted = 0;

        jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);

        request.request_ = (config: RequestConfig, callback: Function) => {
          timesRequestCalled++;

          const resp = extend(true, {}, apiResponse);
          resp.batch.entityResults =
            entityResultsPerApiCall[timesRequestCalled];

          if (timesRequestCalled === 1) {
            resp.batch.moreResults = 'NOT_FINISHED';
            callback(null, resp);
          } else {
            resp.batch.moreResults = 'MORE_RESULTS_AFTER_LIMIT';
            callback(null, resp);
          }
        };

        const stream = request
          .runQueryStream({})
          .on('data', () => {
            entitiesEmitted++;
            stream.end();
          })
          .on('end', () => {
            expect(entitiesEmitted).toBe(1);
            done();
          });
      });

      it('should not get more results if stream was ended', done => {
        let timesRequestCalled = 0;
        jest.spyOn(entity, 'queryToQueryProto').mockReturnValue({} as any);
        request.request_ = (config: RequestConfig, callback: Function) => {
          timesRequestCalled++;
          callback(null!, apiResponse);
        };

        const stream = request.runQueryStream({});
        stream
          .on('error', done)
          .on('data', () => stream.end())
          .on('end', () => {
            expect(timesRequestCalled).toBe(1);
            done();
          });
      });
    });
  });

  describe('runQuery', () => {
    const query = {};

    describe('success', () => {
      const fakeInfo = {};
      const fakeEntities = [{a: 'a'}, {b: 'b'}];

      beforeEach(() => {
        request.runQueryStream = jest.fn(() => {
          const stream = new Transform({objectMode: true});

          setImmediate(() => {
            stream.emit('info', fakeInfo);

            fakeEntities.forEach(entity => {
              stream.push(entity);
            });

            stream.push(null);
          });

          return stream;
        });
      });

      it('should return an array of entities', done => {
        const options = {};

        request.runQuery(
          query,
          options,
          (err: Error | null, entities: Entity[], info: {}) => {
            expect(err).toBeFalsy();
            expect(entities).toEqual(fakeEntities);
            expect(info).toBe(fakeInfo);

            const spy = (request.runQueryStream as Any).mock.calls[0];
            expect(spy[0]).toBe(query);
            expect(spy[1]).toBe(options);
            done();
          },
        );
      });

      describe('should pass `wrapNumbers` to runQueryStream', () => {
        it('should pass `wrapNumbers` to runQueryStream as undefined by default', done => {
          request.runQuery(query, (err: Error) => {
            expect(err).toBeFalsy();

            const runQueryOptions = request.runQueryStream.mock.calls[0][1];
            expect(runQueryOptions.wrapNumbers).toBe(undefined);
            done();
          });
        });

        it('should pass `wrapNumbers` to runQueryStream boolean', done => {
          request.runQuery(query, {wrapNumbers: true}, (err: Error) => {
            expect(err).toBeFalsy();

            const runQueryOptions = request.runQueryStream.mock.calls[0][1];
            expect(typeof runQueryOptions.wrapNumbers).toBe('boolean');
            done();
          });
        });

        it('should pass `wrapNumbers` to runQueryStream as IntegerTypeCastOptions', done => {
          const integerTypeCastOptions = {
            integerTypeCastFunction: () => {},
            properties: 'that',
          };

          request.runQuery(
            query,
            {wrapNumbers: integerTypeCastOptions},
            (err: Error) => {
              expect(err).toBeFalsy();

              const runQueryOptions = request.runQueryStream.mock.calls[0][1];
              expect(runQueryOptions.wrapNumbers).toBe(integerTypeCastOptions);
              expect(runQueryOptions.wrapNumbers).toEqual(integerTypeCastOptions);
              done();
            },
          );
        });
      });

      it('should allow options to be omitted', done => {
        request.runQuery(query, (err: Error) => {
          expect(err).toBeFalsy();
          done();
        });
      });

      it('should default options to an object', done => {
        request.runQuery(query, null, (err: Error) => {
          expect(err).toBeFalsy();

          const spy = (request.runQueryStream as Any).mock.calls[0];
          expect(spy[0]).toEqual({});
          done();
        });
      });
    });

    describe('error', () => {
      const error = new Error('err');

      beforeEach(() => {
        request.runQueryStream = jest.fn(() => {
          const stream = new Transform({objectMode: true});

          setImmediate(() => {
            stream.emit('error', error);
          });

          return stream;
        });
      });

      it('send an error to the callback', done => {
        request.runQuery(query, (err: Error) => {
          expect(err).toBe(error);
          done();
        });
      });
    });
  });

  describe('merge', () => {
    const Transaction = ds.Transaction;
    let transaction: any;
    const PROJECT_ID = 'project-id';
    const NAMESPACE = 'a-namespace';

    const DATASTORE = {
      request_() {},
      projectId: PROJECT_ID,
      namespace: NAMESPACE,
    } as {} as ds.Datastore;

    const key = {
      namespace: 'ns',
      kind: 'Company',
      path: ['Company', null],
    };
    const entityObject = {};

    beforeEach(() => {
      transaction = new Transaction(DATASTORE);

      transaction.request_ = () => {};

      transaction.commit = async () => {
        return [{}] as CommitResponse;
      };
      request.datastore = {
        transaction: () => transaction,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transaction as any).run = (callback?: Function) => {
        callback!(null);
      };

      transaction.get = async () => {
        return [entityObject] as GetResponse;
      };

      transaction.commit = async () => {
        return [{}] as CommitResponse;
      };
    });

    afterEach(() => jest.restoreAllMocks());

    it('should return merge object for entity', done => {
      const updatedEntityObject = {
        status: 'merged',
      };

      transaction.save = (modifiedData: PrepareEntityObjectResponse) => {
        expect(modifiedData.data).toEqual(Object.assign({}, entityObject, updatedEntityObject));
      };

      request.merge({key, data: updatedEntityObject}, done);
    });

    it('should return merge objects for entities', done => {
      const updatedEntityObject = [
        {
          id: 1,
          status: 'merged',
        },
        {
          id: 2,
          status: 'merged',
        },
      ];

      transaction.commit = async () => {
        transaction.modifiedEntities_.forEach((entity: any, index: number) => {
          expect(entity.args[0].data).toEqual(Object.assign({}, entityObject, updatedEntityObject[index]));
        });
        return [{}] as CommitResponse;
      };

      request.merge(
        [
          {key, data: updatedEntityObject[0]},
          {key, data: updatedEntityObject[1]},
        ],
        done,
      );
    });

    it('transaction should rollback if error on transaction run!', done => {
      (jest.spyOn(transaction, 'run') as any)
        .mockImplementation((gaxOption: any, callback?: Function) => {
          callback = typeof gaxOption === 'function' ? gaxOption : callback!;
          callback!(new Error('Error'));
        });

      request.merge({key, data: null}, (err: Error) => {
        expect(err.message).toBe('Error');
        done();
      });
    });

    it('transaction should rollback if error for for transaction get!', done => {
      (jest.spyOn(transaction, 'get') as any).mockRejectedValue(new Error('Error'));

      request.merge({key, data: null}, (err: Error) => {
        expect(err.message).toBe('Error');
        done();
      });
    });

    it('transaction should rollback if error for for transaction commit!', done => {
      (jest.spyOn(transaction, 'commit') as any).mockRejectedValue(new Error('Error'));

      request.merge({key, data: null}, (err: Error) => {
        expect(err.message).toBe('Error');
        done();
      });
    });

    it('should avoid the rollback exception in transaction.run', done => {
      (jest.spyOn(transaction, 'run') as any)
        .mockImplementation((gaxOption: any, callback?: Function) => {
          callback = typeof gaxOption === 'function' ? gaxOption : callback!;
          callback!(new Error('Error.'));
        });

      (jest.spyOn(transaction, 'rollback') as any)
        .mockRejectedValue(new Error('Rollback Error.'));

      request.merge({key, data: null}, (err: Error) => {
        expect(err.message).toBe('Error.');
        done();
      });
    });

    it('should avoid the rollback exception in transaction.get/commit', done => {
      jest.restoreAllMocks();
      (jest.spyOn(transaction, 'get') as any).mockRejectedValue(new Error('Error.'));

      (jest.spyOn(transaction, 'rollback') as any)
        .mockRejectedValue(new Error('Rollback Error.'));

      request.merge({key, data: null}, (err: Error) => {
        expect(err.message).toBe('Error.');
        done();
      });
    });
  });

  describe('prepareGaxRequest_', () => {
    const CONFIG = {
      client: 'FakeClient', // name set at top of file
      method: 'method',
      reqOpts: {
        a: 'b',
        c: 'd',
      },
      gaxOpts: {
        a: 'b',
        c: 'd',
      },
    };

    const PROJECT_ID = 'project-id';

    beforeEach(() => {
      const clients_ = new Map();
      clients_.set(CONFIG.client, {
        [CONFIG.method]() {},
      });
      request.datastore = {
        clients_,
        auth: {
          getProjectId(callback: Function) {
            callback(null, PROJECT_ID);
          },
        },
      };
    });

    it('should get the project ID', done => {
      request.datastore.auth.getProjectId = () => {
        done();
      };
      request.prepareGaxRequest_(CONFIG, () => {});
    });

    it('should return error if getting project ID failed', done => {
      const error = new Error('Error.');

      request.datastore.auth.getProjectId = (callback: Function) => {
        callback(error);
      };
      request.prepareGaxRequest_(CONFIG, (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should initiate and cache the client', () => {
      const fakeClient = {
        [CONFIG.method]() {},
      };
      mockV1FakeClientOverride = (options: object) => {
        expect(options).toEqual(request.datastore.options);
        return fakeClient;
      };
      request.datastore.clients_ = new Map();
      request.prepareGaxRequest_(CONFIG, () => {});
      const client = request.datastore.clients_.get(CONFIG.client);
      expect(client).toBe(fakeClient);
    });

    it('should return the cached client', done => {
      mockV1FakeClientOverride = () => {
        done(new Error('Should not re-instantiate a GAX client.'));
      };

      request.prepareGaxRequest_(CONFIG, (err: Error, requestFn: Function) => {
        expect(err).toBeFalsy();
        requestFn();
        done();
      });
    });

    it('should send gaxOpts', done => {
      request.datastore.clients_ = new Map();
      request.datastore.clients_.set(CONFIG.client, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [CONFIG.method](_: object, gaxO: any) {
          delete gaxO.headers;
          expect(gaxO).toEqual(CONFIG.gaxOpts);
          done();
        },
      });

      request.prepareGaxRequest_(CONFIG, (err: Error, requestFn: Function) => {
        expect(err).toBeFalsy();
        requestFn();
      });
    });

    it('should send google-cloud-resource-prefix', done => {
      request.datastore.clients_ = new Map();
      request.datastore.clients_.set(CONFIG.client, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [CONFIG.method](_: object, gaxO: any) {
          expect(gaxO.headers).toEqual({
            'google-cloud-resource-prefix': 'projects/' + PROJECT_ID,
          });
          done();
        },
      });

      request.prepareGaxRequest_(CONFIG, (err: Error, requestFn: Function) => {
        expect(err).toBeFalsy();
        requestFn();
      });
    });

    describe('commit', () => {
      it('should set the mode', done => {
        request.datastore.clients_ = new Map();
        request.datastore.clients_.set(CONFIG.client, {
          commit(reqOpts: RequestOptions) {
            expect(reqOpts.mode).toBe('NON_TRANSACTIONAL');
            done();
          },
        });
        const config = Object.assign({}, CONFIG, {
          method: 'commit',
        });
        request.prepareGaxRequest_(
          config,
          (err: Error, requestFn: Function) => {
            expect(err).toBeFalsy();
            requestFn();
          },
        );
      });
    });

    describe('transaction', () => {
      const TRANSACTION_ID = 'transaction';

      beforeEach(() => {
        request.id = TRANSACTION_ID;
      });

      it('should set the commit transaction info', done => {
        request.datastore.clients_ = new Map();
        request.datastore.clients_.set(CONFIG.client, {
          commit(reqOpts: RequestOptions) {
            expect(reqOpts.mode).toBe('TRANSACTIONAL');
            expect(reqOpts.transaction).toBe(TRANSACTION_ID);
            done();
          },
        });

        const config = Object.assign({}, CONFIG, {
          method: 'commit',
        });
        request.prepareGaxRequest_(
          config,
          (err: Error, requestFn: Function) => {
            expect(err).toBeFalsy();
            requestFn();
          },
        );
      });

      it('should set the rollback transaction info', done => {
        request.datastore.clients_ = new Map();
        request.datastore.clients_.set(CONFIG.client, {
          rollback(reqOpts: RequestOptions) {
            expect(reqOpts.transaction).toBe(TRANSACTION_ID);
            done();
          },
        });

        const config = Object.assign({}, CONFIG, {
          method: 'rollback',
        });
        request.prepareGaxRequest_(
          config,
          (err: Error, requestFn: Function) => {
            expect(err).toBeFalsy();
            requestFn();
          },
        );
      });

      it('should set the lookup transaction info', done => {
        const config = extend(true, {}, CONFIG, {
          method: 'lookup',
        });

        request.datastore.clients_ = new Map();
        request.datastore.clients_.set(CONFIG.client, {
          lookup(reqOpts: RequestOptions) {
            expect(reqOpts.readOptions!.transaction).toBe(TRANSACTION_ID);
            done();
          },
        });

        request.prepareGaxRequest_(
          config,
          (err: Error, requestFn: Function) => {
            expect(err).toBeFalsy();
            requestFn();
          },
        );
      });

      it('should set the runQuery transaction info', done => {
        const config = extend(true, {}, CONFIG, {
          method: 'runQuery',
        });

        request.datastore.clients_ = new Map();
        request.datastore.clients_.set(CONFIG.client, {
          runQuery(reqOpts: RequestOptions) {
            expect(reqOpts.readOptions!.transaction).toBe(TRANSACTION_ID);
            done();
          },
        });

        request.prepareGaxRequest_(
          config,
          (err: Error, requestFn: Function) => {
            expect(err).toBeFalsy();
            requestFn();
          },
        );
      });

      it('should throw if read consistency is specified', () => {
        const config = extend(true, {}, CONFIG, {
          method: 'runQuery',
          reqOpts: {
            readOptions: {
              readConsistency: 1,
            },
          },
        });

        expect(() => {
          request.prepareGaxRequest_(config, () => {});
        }).toThrow(/Read consistency cannot be specified in a transaction\./);
      });
    });
  });

  describe('request_', () => {
    const CONFIG = {};

    it('should pass config to prepare function', done => {
      request.prepareGaxRequest_ = (config: {}) => {
        expect(config).toBe(CONFIG);
        done();
      };

      request.request_(CONFIG, () => {});
    });

    it('should execute callback with error from prepare function', done => {
      const error = new Error('Error.');

      request.prepareGaxRequest_ = (config: {}, callback: Function) => {
        callback(error);
      };

      request.request_(CONFIG, (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should execute returned request function with callback', done => {
      const requestFn = (callback: Function) => {
        callback(); // done()
      };

      request.prepareGaxRequest_ = (config: {}, callback: Function) => {
        callback(null, requestFn);
      };

      request.request_(CONFIG, done);
    });
  });

  describe('requestStream_', () => {
    let GAX_STREAM: gax.CancellableStream = {} as gax.CancellableStream;
    const CONFIG = {};

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (GAX_STREAM as any) = new PassThrough();
      request.prepareGaxRequest_ = (config: {}, callback: Function) => {
        callback(null, () => GAX_STREAM);
      };
    });

    it('should expose an abort function', done => {
      GAX_STREAM.cancel = done;

      const requestStream = request.requestStream_(CONFIG);
      requestStream.emit('reading');
      requestStream.abort();
    });

    it('should prepare the request once reading', done => {
      request.prepareGaxRequest_ = (config: {}) => {
        expect(config).toBe(CONFIG);
        done();
      };

      const requestStream = request.requestStream_(CONFIG);
      requestStream.emit('reading');
    });

    it('should destroy the stream with prepare error', done => {
      const error = new Error('Error.');
      request.prepareGaxRequest_ = (config: {}, callback: Function) => {
        callback(error);
      };
      const requestStream = request.requestStream_(CONFIG);
      requestStream.emit('reading');
      requestStream.on('error', (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should destroy the stream with GAX error', done => {
      const error = new Error('Error.');
      const requestStream = request.requestStream_(CONFIG);
      requestStream.emit('reading');
      GAX_STREAM.emit('error', error);
      requestStream.on('error', (err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should emit response from GAX stream', done => {
      const response = {};
      const requestStream = request.requestStream_(CONFIG);
      requestStream.emit('reading');
      requestStream.on('response', (resp: {}) => {
        expect(resp).toBe(response);
        done();
      });
      GAX_STREAM.emit('response', response);
    });
  });
});
