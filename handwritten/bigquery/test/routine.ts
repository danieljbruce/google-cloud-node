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

// eslint-disable-next-line no-var
var mockPromisified = false;

jest.mock('@google-cloud/common', () => {
  const common = jest.requireActual('@google-cloud/common');
  class FakeServiceObject extends common.ServiceObject {
    calledWith_: IArguments;
    constructor(config: any) {
      super(config);
      // eslint-disable-next-line prefer-rest-params
      this.calledWith_ = arguments;
    }
  }
  return {
    ...common,
    ServiceObject: FakeServiceObject,
  };
});

jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (c: Function, options?: pfy.PromisifyAllOptions) => {
    if (c.name === 'Routine') {
      expect(typeof options).toBe('undefined');
      mockPromisified = true;
    }
  },
}));

import {ServiceObject, ServiceObjectConfig, util} from '@google-cloud/common';
import * as pfy from '@google-cloud/promisify';
import * as extend from 'extend';

import * as _root from '../src';
import {Routine} from '../src/routine';

interface CalledWithRoutine extends ServiceObject {
  calledWith_: Array<{
    parent: {};
    baseUrl: string;
    id: string;
    methods: string[];
    createMethod: Function;
  }>;
}

describe('BigQuery/Routine', () => {
  const DATASET = {
    id: 'kittens',
    parent: {},
    createRoutine: util.noop,
  } as {} as _root.Dataset;
  const ROUTINE_ID = 'my_routine';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let routine: any;

  beforeEach(() => {
    routine = new Routine(DATASET, ROUTINE_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(mockPromisified).toBe(true);
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
            callback(); // done()
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ServiceObject.prototype as any).setMetadata = function (
        metadata: {},
        callback: Function,
      ) {
        try {
          expect(this).toBe(routine);
          expect(metadata).toEqual(expectedMetadata);
          callback!(); // done()
        } catch (e) {
          callback!(e);
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
