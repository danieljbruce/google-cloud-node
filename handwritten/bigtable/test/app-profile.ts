// Copyright 2018 Google LLC
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

import {CallOptions} from 'google-gax';
import {AppProfile as RealAppProfile} from '../src/app-profile';

import {Cluster} from '../src/cluster';
const FakeCluster: any = Cluster;

(global as any).mockPromisified = (global as any).mockPromisified || false;
jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (klass: Function) => {
    if (klass.name === 'AppProfile') {
      (global as any).mockPromisified = true;
    }
  },
}));

jest.mock('../src/cluster', () => ({
  Cluster: class FakeCluster {
    instance: any;
    id: any;
    name: string;
    bigtable: any;
    constructor(instance: any, id: any) {
      this.instance = instance;
      this.id = id;
      this.name = 'cluster-name';
      this.bigtable = instance.bigtable;
    }
  },
}));

const AppProfile: any = RealAppProfile;

describe('Bigtable/AppProfile', () => {
  const APP_PROFILE_ID = 'my-app-profile';
  const PROJECT_ID = 'grape-spaceship-123';

  const INSTANCE = {
    name: `projects/${PROJECT_ID}/instances/i`,
    bigtable: {projectId: PROJECT_ID},
  };

  const APP_PROFILE_NAME = `${INSTANCE.name}/appProfiles/${APP_PROFILE_ID}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let appProfile: any;

  
  
  beforeEach(() => {
    appProfile = new AppProfile(INSTANCE, APP_PROFILE_NAME);
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).mockPromisified).toBeTruthy();
    });

    it('should localize Bigtable instance', () => {
      expect(appProfile.bigtable).toBe(INSTANCE.bigtable);
    });

    it('should localize Instance instance', () => {
      expect(appProfile.instance).toBe(INSTANCE);
    });

    it('should expand name into full resource path', () => {
      expect(appProfile.name).toBe(APP_PROFILE_NAME);
    });

    it('should leave full app profile name unaltered', () => {
      const appProfile = new AppProfile(INSTANCE, APP_PROFILE_NAME);
      expect(appProfile.name).toBe(APP_PROFILE_NAME);
    });

    it('should localize the name from the ID', () => {
      expect(appProfile.id).toBe(APP_PROFILE_ID);
    });

    it('should leave full app profile name unaltered and localize the id from the name', () => {
      const appProfile = new AppProfile(INSTANCE, APP_PROFILE_NAME);
      expect(appProfile.name).toBe(APP_PROFILE_NAME);
      expect(appProfile.id).toBe(APP_PROFILE_ID);
    });

    it('should throw if cluster id in wrong format', () => {
      const id = `appProfiles/${APP_PROFILE_ID}`;
      expect(() => { new AppProfile(INSTANCE, id);
       }).toThrow(Error);
    });
  });

  describe('formatAppProfile_', () => {
    const errorReg =
      /An app profile routing policy can only contain "any" for multi cluster routing, a `Cluster` for single routing, or a set of clusterIds as strings or `Clusters` for multi cluster routing\./;

    it("should accept an 'any' cluster routing policy", () => {
      const formattedAppProfile = AppProfile.formatAppProfile_({
        routing: 'any',
      });
      expect(formattedAppProfile.multiClusterRoutingUseAny).toEqual({});
    });

    describe('with a single cluster routing policy', () => {
      const clusterId = 'my-cluster';
      const cluster = new FakeCluster(INSTANCE, clusterId);

      it('should accept allowTransactionalWrites not being set', () => {
        const formattedAppProfile = AppProfile.formatAppProfile_({
          routing: cluster,
        });
        expect(formattedAppProfile.singleClusterRouting).toEqual({
          clusterId,
        });
      });

      it('should accept allowTransactionalWrites', () => {
        const formattedAppProfile = AppProfile.formatAppProfile_({
          routing: cluster,
          allowTransactionalWrites: true,
        });
        expect(formattedAppProfile.singleClusterRouting).toEqual({
          clusterId,
          allowTransactionalWrites: true,
        });
      });

      it('should accept description', () => {
        const description = 'my-description';
        const formattedAppProfile = AppProfile.formatAppProfile_({
          description,
        });
        expect(formattedAppProfile.description).toBe(description);
      });

      it('should throw for an invalid routing policy', () => {
        expect(() => {
          AppProfile.formatAppProfile_({
            routing: 'not-any',
          });
        }).toThrow(errorReg);
      });
    });

    describe('with a multi cluster routing policy', () => {
      it('should use multi cluster routing when providing an array of clusters', () => {
        const clusterIds = ['clusterId1', 'clusterId2'];
        const clusters = clusterIds.map(
          clusterId => new FakeCluster(INSTANCE, clusterId),
        );
        const formattedAppProfile = AppProfile.formatAppProfile_({
          routing: new Set(clusters),
        });
        expect(
          new Set(formattedAppProfile.multiClusterRoutingUseAny.clusterIds),
        ).toEqual(new Set(clusterIds));
      });
      it('should ensure elements in the array are clusters', () => {
        const notAllClusters = [
          new FakeCluster(INSTANCE, 'clusterId'),
          'not a cluster',
        ];
        expect(() => {
          AppProfile.formatAppProfile_({
            routing: notAllClusters,
          });
        }).toThrow(errorReg);
      });
    });
  });

  describe('create', () => {
    it('should call createAppProfile from instance', done => {
      const options = {};

      appProfile.instance.createAppProfile = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options_: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: any,
      ) => {
        expect(id).toBe(appProfile.id);
        expect(options_).toBe(options);
        callback();
      };

      appProfile.create(options, done);
    });

    it('should not require options', done => {
      appProfile.instance.createAppProfile = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: any,
      ) => {
        expect(options).toEqual({});
        callback();
      };

      appProfile.create(done);
    });
  });

  describe('delete', () => {
    it('should make the correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any, callback: any) => {
        expect(config.client).toBe('BigtableInstanceAdminClient');
        expect(config.method).toBe('deleteAppProfile');

        expect(config.reqOpts).toEqual({
          name: appProfile.name,
        });

        callback();
      };

      appProfile.delete(done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      appProfile.delete({gaxOptions}, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept ignoreWarnings', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any) => {
        expect(config.reqOpts.ignoreWarnings).toBe(true);
        done();
      };

      appProfile.delete({ignoreWarnings: true}, ((err: any) => { expect(err).toBeFalsy(); }));
    });
  });

  describe('exists', () => {
    it('should not require gaxOptions', done => {
      appProfile.getMetadata = (gaxOptions: CallOptions) => {
        expect(gaxOptions).toEqual({});
        done();
      };

      appProfile.exists(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should pass gaxOptions to getMetadata', done => {
      const gaxOptions = {};

      appProfile.getMetadata = (gaxOptions_: CallOptions) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      };

      appProfile.exists(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return false if error code is 5', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error('Error.');
      error.code = 5;

      appProfile.getMetadata = (
        gaxOptions: CallOptions,
        callback: Function,
      ) => {
        callback(error);
      };

      appProfile.exists((err: Error, exists: boolean) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(false);
        done();
      });
    });

    it('should return error if code is not 5', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error('Error.');
      error.code = 'NOT-5';

      appProfile.getMetadata = (
        gaxOptions: CallOptions,
        callback: Function,
      ) => {
        callback(error);
      };

      appProfile.exists((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return true if no error', done => {
      appProfile.getMetadata = (
        gaxOptions: CallOptions,
        callback: Function,
      ) => {
        callback(null, {});
      };

      appProfile.exists((err: Error, exists: boolean) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(true);
        done();
      });
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const gaxOptions = {};

      appProfile.getMetadata = (gaxOptions_: CallOptions) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      };

      appProfile.get(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should not require gaxOptions', done => {
      appProfile.getMetadata = (gaxOptions: CallOptions) => {
        expect(gaxOptions).toEqual({});
        done();
      };

      appProfile.get(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.');

      appProfile.getMetadata = (
        gaxOptions: CallOptions,
        callback: Function,
      ) => {
        callback(error);
      };

      appProfile.get((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return self and API response', done => {
      const metadata = {};

      appProfile.getMetadata = (
        gaxOptions: CallOptions,
        callback: Function,
      ) => {
        callback(null, metadata);
      };

      appProfile.get((err: Error, appProfile_: {}, metadata_: {}) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(appProfile_).toBe(appProfile);
        expect(metadata_).toBe(metadata);
        done();
      });
    });
  });

  describe('getMetadata', () => {
    it('should make correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableInstanceAdminClient');
        expect(config.method).toBe('getAppProfile');

        expect(config.reqOpts).toEqual({
          name: appProfile.name,
        });

        expect(config.gaxOpts).toEqual({});

        done();
      };

      appProfile.getMetadata(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      appProfile.getMetadata(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should update metadata', done => {
      const metadata = {};

      appProfile.bigtable.request = (config: {}, callback: Function) => {
        callback(null, metadata);
      };

      appProfile.getMetadata(() => {
        expect(appProfile.metadata).toBe(metadata);
        done();
      });
    });

    it('should execute callback with original arguments', done => {
      const args = [{}, {}, {}];

      appProfile.bigtable.request = (config: {}, callback: Function) => {
        callback(...args);
      };

      appProfile.getMetadata((...argies: Array<{}>) => {
        expect([].slice.call(argies)).toEqual(args);
        done();
      });
    });
  });

  describe('setMetadata', () => {
    it('should provide the proper request options', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any, callback: Function) => {
        expect(config.client).toBe('BigtableInstanceAdminClient');
        expect(config.method).toBe('updateAppProfile');
        expect(config.reqOpts.appProfile.name).toBe(APP_PROFILE_NAME);
        callback();
      };

      appProfile.setMetadata({}, done);
    });

    it('should respect the description option', done => {
      const options = {description: 'my-description'};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any) => {
        expect(
          config.reqOpts.updateMask.paths.indexOf('description') !== -1).toBeTruthy();
        expect(
          config.reqOpts.appProfile.description).toBe(options.description,
        );
        done();
      };

      appProfile.setMetadata(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect the ignoreWarnings option', done => {
      const options = {ignoreWarnings: true};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appProfile.bigtable.request = (config: any) => {
        expect(config.reqOpts.ignoreWarnings).toBe(true);
        done();
      };

      appProfile.setMetadata(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    describe('should respect the routing option when', () => {
      const clusterId = 'my-cluster';
      const cluster = new FakeCluster(INSTANCE, clusterId);

      it("has an 'any' value", done => {
        const options = {routing: 'any'};

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        appProfile.bigtable.request = (config: any) => {
          expect(
            config.reqOpts.updateMask.paths.indexOf(
              'multi_cluster_routing_use_any',
            ) !== -1,
          ).toBeTruthy();
          expect(
            config.reqOpts.appProfile.multiClusterRoutingUseAny).toEqual({},
          );
          done();
        };

        appProfile.setMetadata(options, ((err: any) => { expect(err).toBeFalsy(); }));
      });

      it('has a cluster value', done => {
        const options = {routing: cluster};

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        appProfile.bigtable.request = (config: any) => {
          expect(
            config.reqOpts.updateMask.paths.indexOf(
              'single_cluster_routing',
            ) !== -1,
          ).toBeTruthy();
          expect(
            config.reqOpts.appProfile.singleClusterRouting).toEqual({clusterId},
          );
          done();
        };

        appProfile.setMetadata(options, ((err: any) => { expect(err).toBeFalsy(); }));
      });
    });

    it('should execute callback with all arguments', done => {
      const args = [{}, {}, {}];
      appProfile.bigtable.request = (config: {}, callback: Function) => {
        callback(...args);
      };
      appProfile.setMetadata({}, (...argies: Array<{}>) => {
        expect([].slice.call(argies)).toEqual(args);
        done();
      });
    });
  });
});
