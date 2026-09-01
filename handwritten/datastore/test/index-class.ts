// Copyright 2020 Google LLC
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

let promisified = false;
jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll(klass: Function) {
      if (klass.name === 'Index') {
        promisified = true;
      }
    },
  };
});

import * as ds from '../src';
import {Index} from '../src/index-class';

describe('Index', () => {
  const INDEX_ID = 'my-index';
  let DATASTORE: ds.Datastore;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let index: any;

  beforeEach(() => {
    DATASTORE = {} as ds.Datastore;
    index = new Index(DATASTORE, INDEX_ID);
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should localize datastore instance', () => {
      expect(index.datastore).toBe(DATASTORE);
    });

    it('should localize id from name', () => {
      const name = 'long/formatted/name';
      const index = new Index(DATASTORE, name);
      expect(index.id).toBe(name.split('/').pop());
    });

    it('should localize id from id', () => {
      expect(index.id).toBe(INDEX_ID);
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const gaxOptions = {};
      index.getMetadata = (options: {}) => {
        try {
          expect(options).toBe(gaxOptions);
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      index.get(gaxOptions, () => {});
    });

    it('should not require an options object', done => {
      index.getMetadata = (options: {}) => {
        try {
          expect(options).toEqual({});
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      index.get(() => {});
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.');
      index.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(error);
      };
      index.get((err: Error | null) => {
        try {
          expect(err).toBe(error);
          done();
        } catch (e) {
          done(e as Error);
        }
      });
    });

    it('should return self and API response', done => {
      const apiResponse = {};
      index.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(null, apiResponse);
      };
      index.get((err: Error | null, _index: {}, _apiResponse: {}) => {
        try {
          expect(err).toBeFalsy();
          expect(_index).toBe(index);
          expect(_apiResponse).toBe(apiResponse);
          done();
        } catch (e) {
          done(e as Error);
        }
      });
    });
  });

  describe('getMetadata', () => {
    it('should make the correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      index.datastore.request_ = (config: any) => {
        try {
          expect(config.client).toBe('DatastoreAdminClient');
          expect(config.method).toBe('getIndex');
          expect(config.reqOpts).toEqual({
            indexId: index.id,
          });
          expect(config.gaxOpts).toEqual({});
          done();
        } catch (e) {
          done(e as Error);
        }
      };

      index.getMetadata(() => {});
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      index.datastore.request_ = (config: {gaxOpts: {}}) => {
        try {
          expect(config.gaxOpts).toBe(gaxOptions);
          done();
        } catch (e) {
          done(e as Error);
        }
      };

      index.getMetadata(gaxOptions, () => {});
    });

    it('should update the metadata', done => {
      const response = {};
      index.datastore.request_ = (config: {}, callback: Function) => {
        callback(null, response);
      };
      index.getMetadata((err: Error | null, metadata: {}) => {
        try {
          expect(err).toBeFalsy();
          expect(metadata).toBe(response);
          expect(index.metadata).toBe(response);
          done();
        } catch (e) {
          done(e as Error);
        }
      });
    });
  });
});
