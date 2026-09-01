// Copyright 2026 Google LLC
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
  Metadata,
  ServiceObject,
  ServiceObjectConfig,
} from '@google-cloud/common';
import * as promisify from '@google-cloud/promisify';

let promisified = false;

jest.mock('@google-cloud/common', () => {
  const common = jest.requireActual('@google-cloud/common');
  return {
    ...common,
    ServiceObject: class FakeServiceObject extends common.ServiceObject {
      calledWith_: unknown[];
      constructor(config: ServiceObjectConfig, ...args: unknown[]) {
        super(config);
        this.calledWith_ = [config, ...args];
      }
    },
  };
});

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll(esClass: Function, options?: promisify.PromisifyAllOptions) {
      if (esClass.name === 'Change') {
        promisified = true;
      }
      return actual.promisifyAll(esClass, options);
    },
  };
});

import {Change} from '../src/change';

describe('Change', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let change: any;

  const ZONE = {
    name: 'zone-name',
    createChange() {},
  };

  const CHANGE_ID = 'change-id';

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    change = new Change(ZONE as any, CHANGE_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should inherit from ServiceObject', () => {
      expect(change).toBeInstanceOf(ServiceObject);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calledWith = (change as any).calledWith_[0];

      expect(calledWith.parent).toBe(ZONE);
      expect(calledWith.baseUrl).toBe('/changes');
      expect(calledWith.id).toBe(CHANGE_ID);
      expect(calledWith.methods).toEqual({
        exists: true,
        get: true,
        getMetadata: true,
      });
    });

    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });
  });

  describe('change', () => {
    it('should call the parent change method', done => {
      const config = {};

      change.parent.createChange = (config_: {}) => {
        try {
          expect(config_).toBe(config);
          done();
        } catch (e) {
          done(e);
        }
      };

      change.create(config, (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {};

      beforeEach(() => {
        change.parent.createChange = (config: {}, callback: Function) => {
          callback(error, null, apiResponse);
        };
      });

      it('should execute callback with error & apiResponse', done => {
        change.create(
          {},
          (err: Error, change: Change, apiResponse_: Metadata) => {
            try {
              expect(err).toBe(error);
              expect(change).toBeNull();
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });

    describe('success', () => {
      const changeInstance = {
        id: 'id',
        metadata: {},
      };
      const apiResponse = {};

      beforeEach(() => {
        change.parent.createChange = (config: {}, callback: Function) => {
          callback(null, changeInstance, apiResponse);
        };
      });

      it('should execute callback with self & API response', done => {
        change.create(
          {},
          (err: Error, change_: Change, apiResponse_: Metadata) => {
            try {
              expect(err).toBeNull();
              expect(change_).toBe(change);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });

      it('should assign the ID and metadata from the change', done => {
        change.create({}, (err: Error, change_: Change) => {
          try {
            expect(err).toBeNull();
            expect(change_.id).toBe(changeInstance.id);
            expect(change_.metadata).toBe(changeInstance.metadata);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });
});
