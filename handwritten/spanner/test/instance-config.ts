/**
 * Copyright 2022 Google LLC
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

import {grpc} from 'google-gax';

import * as instConfig from '../src/instance-config';
import {Spanner, GetInstanceConfigResponse} from '../src';
import {CLOUD_RESOURCE_HEADER} from '../src/common';


jest.mock("@google-cloud/promisify", () => {
  const actual = jest.requireActual("@google-cloud/promisify");
  return {
    ...actual,
    promisifyAll: (klass: any, options: any) => {
      if (klass.name === "InstanceConfig") {
        (global as any).__promisified = true;
        expect(options.exclude).toEqual(["exists"]);
      }
    },
  };
});

class FakeGrpcServiceObject {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
}

jest.mock("../src/common-grpc/service-object", () => {
  class MockGrpcServiceObject {
    calledWith_: any[];
    constructor(...args: any[]) {
      this.calledWith_ = args;
    }
  }
  return {
    GrpcServiceObject: MockGrpcServiceObject,
  };
});

describe('InstanceConfig', () => {
  // tslint:disable-next-line variable-name
  let InstanceConfig: typeof instConfig.InstanceConfig;
  let instanceConfig: instConfig.InstanceConfig;


  const SPANNER = {
    request: () => {},
    requestStream: () => {},
    getInstanceConfig: () => {},
    projectId: 'project-id',
    instances_: new Map(),
    instanceConfigs_: new Map(),
    projectFormattedName_: 'projects/project-id',
  } as {} as Spanner;

  const NAME = 'instance-config-name';

  beforeAll(() => {
    InstanceConfig = instConfig.InstanceConfig;
  });

  beforeEach(() => {
    instanceConfig = new InstanceConfig(SPANNER, NAME);
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).__promisified).toBeTruthy();
    });

    it('should format the name', () => {
      const formatName_ = InstanceConfig.formatName_;
      const formattedName = 'formatted-name';

      InstanceConfig.formatName_ = (projectId, name) => {
        InstanceConfig.formatName_ = formatName_;

        expect(projectId).toBe(SPANNER.projectId);
        expect(name).toBe(NAME);

        return formattedName;
      };

      const instanceConfig = new InstanceConfig(SPANNER, NAME);
      expect(instanceConfig.formattedName_).toBeTruthy();
    });

    it('should localize the request function', done => {
      const spannerInstance = Object.assign({}, SPANNER);

      spannerInstance.request = function () {
        expect(this).toBe(spannerInstance);
        done();
      };

      const instanceConfig = new InstanceConfig(spannerInstance, NAME);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (instanceConfig as any).request();
    });

    it('should inherit from ServiceObject', done => {
      const options = {};
      const spannerInstance = Object.assign({}, SPANNER, {
        createInstanceConfig(name, options_, callback) {
          expect(name).toBe(instanceConfig.formattedName_);
          expect(options_).toBe(options);
          callback(); // done()
        },
      });

      const instanceConfig = new InstanceConfig(spannerInstance, NAME);
      expect(instanceConfig.calledWith_).toBeDefined();

      const calledWith = instanceConfig.calledWith_[0];

      expect(calledWith.parent).toBe(spannerInstance);
      expect(calledWith.id).toBe(NAME);
      expect(calledWith.methods).toEqual({create: true});

      calledWith.createMethod(null, options, done);
    });

    it('should set the resourceHeader_', () => {
      expect(instanceConfig.resourceHeader_).toEqual({
        [CLOUD_RESOURCE_HEADER]: instanceConfig.formattedName_,
      });
    });
  });

  describe('formatName_', () => {
    const PATH = 'projects/' + SPANNER.projectId + '/instanceConfigs/' + NAME;

    it('should return the name if already formatted', () => {
      expect(InstanceConfig.formatName_(SPANNER.projectId, PATH)).toBe(PATH);
    });

    it('should format the name', () => {
      const formattedName = InstanceConfig.formatName_(SPANNER.projectId, NAME);
      expect(formattedName).toBe(PATH);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      instanceConfig.parent = SPANNER;
    });

    it('should make the correct request', done => {
      instanceConfig.request = (config, callback: Function) => {
        expect(config.client).toBe('InstanceAdminClient');
        expect(config.method).toBe('deleteInstanceConfig');
        expect(config.reqOpts).toEqual({
          name: instanceConfig.formattedName_,
        });
        expect(config.gaxOpts).toEqual({});
        expect(config.headers).toEqual(instanceConfig.resourceHeader_);
        callback(); // done()
      };

      instanceConfig.delete(done);
    });

    it('should remove the InstanceConfig from the cache', done => {
      const cache = instanceConfig.parent.instanceConfigs_;

      instanceConfig.request = (config, callback) => {
        callback(null);
      };

      cache.set(instanceConfig.id, instanceConfig);
      expect(cache.get(instanceConfig.id)).toBe(instanceConfig);

      instanceConfig.delete(err => {
        (err => { expect(err).toBeFalsy(); })(err);
        expect(cache.has(instanceConfig.id)).toBe(false);
        done();
      });
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      instanceConfig.request = (config, callback: Function) => {
        expect(config.gaxOpts).toEqual(gaxOptions);
        callback(); // done()
      };

      instanceConfig.delete(gaxOptions, done);
    });
  });

  describe('exists', () => {
    beforeEach(() => (instanceConfig.parent = SPANNER));
    afterEach(() => jest.restoreAllMocks());

    it('should return any non-404 like errors', async () => {
      const err = {code: grpc.status.INTERNAL};
      instanceConfig.get = async () => {
        throw err;
      };

      try {
        await instanceConfig.exists();
        fail('Should have rethrown error');
      } catch (thrown) {
        expect(thrown).toEqual(err);
      }
    });

    it('should return true if error is absent', async () => {
      const INSTANCE_CONFIG_INFO_RESPONSE: GetInstanceConfigResponse = [{}];
      instanceConfig.get = async () => INSTANCE_CONFIG_INFO_RESPONSE;

      const doesExist = await instanceConfig.exists();
      expect(doesExist).toBe(true);
    });

    it('should return false if instance config does not exist', async () => {
      instanceConfig.get = async () => {
        throw {code: grpc.status.NOT_FOUND};
      };

      const doesExist = await instanceConfig.exists();
      expect(doesExist).toBe(false);
    });
  });

  describe('get', () => {
    beforeEach(() => {
      instanceConfig.parent = SPANNER;
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should call getInstanceConfig', done => {
      const options = {};

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      jest.spyOn(SPANNER, 'getInstanceConfig').mockImplementation(_ => done());

      instanceConfig.get(options, (err => { expect(err).toBeFalsy(); }));
    });

    it('should accept and pass gaxOptions to getInstanceConfig', done => {
      const gaxOptions = {};

      jest.spyOn(SPANNER, 'getInstanceConfig').mockImplementation((_, options) => {
        expect(options.gaxOptions).toBe(gaxOptions);
        done();
      });

      instanceConfig.get({gaxOptions}, (err => { expect(err).toBeFalsy(); }));
    });

    it('should not require an options object', done => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      jest.spyOn(SPANNER, 'getInstanceConfig').mockImplementation(_ => done());
      instanceConfig.get((err => { expect(err).toBeFalsy(); }));
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.') as grpc.ServiceError;

      jest.spyOn(SPANNER, 'getInstanceConfig').mockImplementation((_, opts_: {}, callback) => callback!(error));

      instanceConfig.get(err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return self and API response', done => {
      const apiResponse = {} as instConfig.IInstanceConfig;
      jest.spyOn(SPANNER, 'getInstanceConfig').mockImplementation((_, opts_: {}, callback) => callback!(null, apiResponse));

      instanceConfig.get((err, instanceConfigMetadata_) => {
        (err => { expect(err).toBeFalsy(); })(err);
        expect(instanceConfigMetadata_).toBe(apiResponse);
        done();
      });
    });
  });

  describe('setMetadata', () => {
    const METADATA = {
      needsToBeSnakeCased: true,
    } as instConfig.IInstanceConfig;
    const ORIGINAL_METADATA = Object.assign({}, METADATA);

    it('should make and return the request', () => {
      const requestReturnValue = {};

      function callback() {}

      instanceConfig.request = (config, callback_) => {
        expect(config.client).toBe('InstanceAdminClient');
        expect(config.method).toBe('updateInstanceConfig');

        const expectedReqOpts = Object.assign(
          {},
          Object.assign({}, METADATA, {
            name: instanceConfig.formattedName_,
          }),
        ) as instConfig.IInstanceConfig as instConfig.SetInstanceConfigMetadataRequest;

        expect(config.reqOpts.instanceConfig).toEqual(expectedReqOpts);
        expect(config.reqOpts.updateMask).toEqual({
          paths: ['needs_to_be_snake_cased'],
        });

        expect(METADATA).toEqual(ORIGINAL_METADATA);
        expect(config.gaxOpts).toEqual({});
        expect(config.headers).toEqual(instanceConfig.resourceHeader_);

        expect(callback_).toBe(callback);

        return requestReturnValue;
      };

      const returnValue = instanceConfig.setMetadata(
        Object.assign({}, {instanceConfig: METADATA}),
        callback,
      );
      expect(returnValue).toBe(requestReturnValue);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      instanceConfig.request = config => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };
      instanceConfig.setMetadata(
        Object.assign({}, {instanceConfig: METADATA}, {gaxOpts: gaxOptions}),
        (err => { expect(err).toBeFalsy(); }),
      );
    });

    it('should not require a callback', () => {
      expect(async () => {
        await instanceConfig.setMetadata(
          Object.assign({}, {instanceConfig: METADATA}),
        );
      }).not.toThrow();
    });
  });
});
