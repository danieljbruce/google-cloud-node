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

import * as iamTypes from '../src/iam';
import {PubSub, RequestConfig} from '../src/pubsub';
import * as util from '../src/util';
import {IAM} from '../src/iam';

describe('IAM', () => {
  let iam: iamTypes.IAM;

  const PUBSUB = {
    options: {},
    request: util.noop,
  } as {} as PubSub;
  const ID = 'id';

  beforeEach(() => {
    iam = new IAM(PUBSUB, ID);
  });

  describe('initialization', () => {
    it('should localize pubsub', () => {
      expect(iam.pubsub).toBe(PUBSUB);
    });

    it('should localize pubsub#request', () => {
      const fakeRequest = () => {};
      const fakePubsub = {
        request: {
          bind(context: PubSub) {
            expect(context).toBe(fakePubsub);
            return fakeRequest;
          },
        },
      } as {} as PubSub;
      const iam = new IAM(fakePubsub, ID);

      expect(iam.request).toBe(fakeRequest);
    });

    it('should localize the ID string', () => {
      expect(iam.id).toBe(ID);
    });

    it('should localize the ID getter', () => {
      iam = new IAM(PUBSUB, {
        get name() {
          return 'test';
        },
      });
      expect(iam.id).toBe('test');
    });
  });

  describe('getPolicy', () => {
    it('should make the correct API request', done => {
      iam.request = config => {
        const reqOpts = {resource: iam.id};
        expect(config.client).toBe('SubscriberClient');
        expect(config.method).toBe('getIamPolicy');
        expect(config.reqOpts).toEqual(reqOpts);

        done();
      };

      iam.getPolicy(err => {
        expect(err).toBeNull();
      });
    });

    it('should accept gax options', done => {
      const gaxOpts = {};

      iam.request = config => {
        expect(config.gaxOpts).toBe(gaxOpts);
        done();
      };

      iam.getPolicy(gaxOpts, err => {
        expect(err).toBeNull();
      });
    });
  });

  describe('setPolicy', () => {
    const policy: iamTypes.Policy = {etag: 'ACAB', bindings: []};

    it('should throw an error if a policy is not supplied', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (iam as any).setPolicy(util.noop);
      }).toThrow(/A policy object is required\./);
    });

    it('should make the correct API request', done => {
      iam.request = config => {
        const reqOpts = {resource: iam.id, policy};
        expect(config.client).toBe('SubscriberClient');
        expect(config.method).toBe('setIamPolicy');
        expect(config.reqOpts).toEqual(reqOpts);

        done();
      };

      iam.setPolicy(policy, err => {
        expect(err).toBeNull();
      });
    });

    it('should accept gax options', done => {
      const gaxOpts = {};

      iam.request = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(gaxOpts);
        done();
      };

      iam.setPolicy(policy, gaxOpts, err => {
        expect(err).toBeNull();
      });
    });
  });

  describe('testPermissions', () => {
    it('should throw an error if permissions are missing', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (iam as any).testPermissions(util.noop);
      }).toThrow(/Permissions are required\./);
    });

    it('should make the correct API request', done => {
      const permissions = 'storage.bucket.list';
      const reqOpts = {resource: iam.id, permissions: [permissions]};

      iam.request = config => {
        expect(config.client).toBe('SubscriberClient');
        expect(config.method).toBe('testIamPermissions');
        expect(config.reqOpts).toEqual(reqOpts);

        done();
      };

      iam.testPermissions(permissions, err => {
        expect(err).toBeNull();
      });
    });

    it('should accept gax options', done => {
      const permissions = 'storage.bucket.list';
      const gaxOpts = {};

      iam.request = config => {
        expect(config.gaxOpts).toBe(gaxOpts);
        done();
      };

      iam.testPermissions(permissions, gaxOpts, err => {
        expect(err).toBeNull();
      });
    });

    it('should send an error back if the request fails', done => {
      const permissions = ['storage.bucket.list'];
      const error = new Error('Error.');
      const apiResponse = {};

      iam.request = (config, callback: Function) => {
        callback(error, apiResponse);
      };

      iam.testPermissions(permissions, (err, permissions, apiResp) => {
        expect(err).toBe(error);
        expect(permissions).toBeNull();
        expect(apiResp).toBe(apiResponse);
        done();
      });
    });

    it('should pass back a hash of permissions the user has', done => {
      const permissions = ['storage.bucket.list', 'storage.bucket.consume'];
      const apiResponse = {
        permissions: ['storage.bucket.consume'],
      };

      iam.request = (config, callback: Function) => {
        callback(null, apiResponse);
      };

      iam.testPermissions(permissions, (err, permissions, apiResp) => {
        expect(err).toBeNull();
        expect(permissions).toEqual({
          'storage.bucket.list': false,
          'storage.bucket.consume': true,
        });
        expect(apiResp).toBe(apiResponse);

        done();
      });
    });
  });
});
