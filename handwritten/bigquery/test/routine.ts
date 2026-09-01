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

import {ServiceObject, util} from '@google-cloud/common';
import * as extend from 'extend';

let promisified = false;

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll: (c: Function, options: any) => {
      if (c.name === 'Routine') {
        expect(typeof options).toBe('undefined');
        promisified = true;
      }
      return actual.promisifyAll(c, options);
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

import {Routine, Dataset} from '../src';

interface CalledWithRoutine extends ServiceObject {
  calledWith_: Array<{
    parent: {};
    baseUrl: string;
    id: string;
    methods: Record<string, any>;
    createMethod: Function;
  }>;
}

describe('BigQuery/Routine', () => {
  const DATASET = {
    id: 'kittens',
    parent: {},
    createRoutine: util.noop,
  } as {} as Dataset;
  const ROUTINE_ID = 'my_routine';

  let routine: any;

  beforeEach(() => {
    routine = new Routine(DATASET, ROUTINE_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should inherit from ServiceObject', () => {
      expect(routine instanceof ServiceObject).toBe(true);

      const calledWith = (routine as CalledWithRoutine).calledWith_[0];

      expect(calledWith.parent).toBe(DATASET);
      expect(calledWith.baseUrl).toBe('/routines');
      expect(calledWith.id).toBe(ROUTINE_ID);
      expect(calledWith.methods).toEqual({
        create: true,
        delete: true,
        exists: true,
        get: true,
        getMetadata: true,
        setMetadata: {
          reqOpts: {
            method: 'PUT',
          },
        },
      });
    });

    it('should configure create method', done => {
      const config = {a: 'b'};

      const dataset = extend(true, {}, DATASET, {
        createRoutine: function (config_: {}, callback: Function) {
          try {
            expect(this).toBe(dataset);
            expect(config_).toEqual(config);
            callback();
          } catch (e) {
            done(e);
          }
        },
      });

      const routine = new Routine(dataset, ROUTINE_ID);
      const calledWith = (routine as CalledWithRoutine).calledWith_[0];

      calledWith.createMethod(config, done);
    });
  });

  describe('setMetadata', () => {
    it('should update the metadata', done => {
      const currentMetadata = {a: 'b'};
      const newMetadata = {c: 'd'};
      const expectedMetadata = Object.assign({}, currentMetadata, newMetadata);

      routine.getMetadata = (callback: Function) => {
        callback(null, currentMetadata);
      };

      (ServiceObject.prototype as any).setMetadata = function (
        metadata: {},
        callback: Function,
      ) {
        try {
          expect(this).toBe(routine);
          expect(metadata).toEqual(expectedMetadata);
          callback!();
        } catch (e) {
          done(e);
        }
      };

      routine.setMetadata(newMetadata, done);
    });

    it('should return an error if getting metadata fails', done => {
      const error = new Error('Error.');
      routine.getMetadata = (callback: Function) => {
        callback(error);
      };

      routine.setMetadata({}, (err: Error) => {
        try {
          expect(err).toBe(error);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });
});
