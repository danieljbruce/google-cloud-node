// Copyright 2017 Google LLC
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

import * as common from '@google-cloud/common';
import * as extend from 'extend';
import * as nock from 'nock';
import {heap as heapProfiler, time as timeProfiler} from 'pprof';
import {promisify} from 'util';
import * as zlib from 'zlib';

import {perftools} from 'pprof/proto/profile';
import {ProfilerConfig} from '../src/config';
import {Profiler, Retryer, BackoffResponseError} from '../src/profiler';

import {
  decodedHeapProfile,
  decodedTimeProfile,
  heapProfile,
  timeProfile,
} from './profiles-for-tests';

import * as ms from 'ms';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fakeCredentials = require('../../test/fixtures/gcloud-credentials.json');

const API = 'cloudprofiler.googleapis.com';
const TEST_API = 'test-cloudprofiler.sandbox.googleapis.com';

const FULL_API = `https://${API}/v2`;
const FULL_TEST_API = `https://${TEST_API}/v2`;

const testConfig: ProfilerConfig = {
  projectId: 'test-projectId',
  logLevel: 0,
  serviceContext: {service: 'test-service', version: 'test-version'},
  instance: 'test-instance',
  zone: 'test-zone',
  disableTime: false,
  disableHeap: false,
  credentials: fakeCredentials,
  timeIntervalMicros: 1000,
  heapIntervalBytes: 512 * 1024,
  heapMaxStackDepth: 64,
  ignoreHeapSamplesPath: '@google-cloud/profiler',
  initialBackoffMillis: 1000,
  backoffCapMillis: ms('1h')!,
  backoffMultiplier: 1.3,
  serverBackoffCapMillis: ms('7d')!,
  localProfilingPeriodMillis: 1000,
  localTimeDurationMillis: 1000,
  localLogPeriodMillis: 1000,
  sourceMapSearchPath: [],
  disableSourceMaps: true,
  apiEndpoint: API,
};

nock.disableNetConnect();
function nockOauth2(): nock.Scope {
  return nock('https://oauth2.googleapis.com')
    .post(/\/token/, () => true)
    .once()
    .reply(200, {
      refresh_token: 'hello',
      access_token: 'goodbye',
      expiry_date: new Date(9999, 1, 1),
    });
}

describe('Retryer', () => {
  it('should backoff until max-backoff reached', () => {
    const retryer = new Retryer(1000, 1000000, 5, () => 0.5);
    expect(retryer.getBackoff()).toBe(0.5 * 1000);
    expect(retryer.getBackoff()).toBe(0.5 * 5000);
    expect(retryer.getBackoff()).toBe(0.5 * 25000);
    expect(retryer.getBackoff()).toBe(0.5 * 125000);
    expect(retryer.getBackoff()).toBe(0.5 * 625000);
    expect(retryer.getBackoff()).toBe(0.5 * 1000000);
    expect(retryer.getBackoff()).toBe(0.5 * 1000000);
    expect(retryer.getBackoff()).toBe(0.5 * 1000000);
    expect(retryer.getBackoff()).toBe(0.5 * 1000000);
    expect(retryer.getBackoff()).toBe(0.5 * 1000000);
  });
});

describe('Profiler', () => {
  beforeEach(() => {
    jest
      .spyOn(timeProfiler, 'start')
      .mockImplementation((() => (() => ({}))) as any);
    jest
      .spyOn(timeProfiler, 'profile')
      .mockReturnValue(Promise.resolve(timeProfile) as any);

    jest.spyOn(heapProfiler, 'stop').mockImplementation(() => {});
    jest.spyOn(heapProfiler, 'start').mockImplementation(() => {});
    jest.spyOn(heapProfiler, 'profile').mockReturnValue(heapProfile as any);
  });

  afterEach(() => {
    nock.cleanAll();
    jest.restoreAllMocks();
  });

  describe('profile', () => {
    it('should return expected profile when profile type is WALL.', async () => {
      const profiler = new Profiler(testConfig);
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        labels: {instance: 'test-instance'},
      };
      const prof = await profiler.profile(requestProf);
      const decodedBytes = Buffer.from(prof.profileBytes as 'string', 'base64');
      const unzippedBytes = (await promisify(zlib.gunzip)(
        decodedBytes
      )) as Uint8Array;
      const outProfile = perftools.profiles.Profile.decode(unzippedBytes);
      expect(outProfile).toEqual(decodedTimeProfile);
    });

    it('should return expected profile when profile type is HEAP.', async () => {
      const profiler = new Profiler(testConfig);
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'HEAP',
        labels: {instance: 'test-instance'},
      };
      const prof = await profiler.profile(requestProf);
      const decodedBytes = Buffer.from(prof.profileBytes as 'string', 'base64');
      const unzippedBytes = (await promisify(zlib.gunzip)(
        decodedBytes
      )) as Uint8Array;
      const outProfile = perftools.profiles.Profile.decode(unzippedBytes);
      expect(outProfile).toEqual(decodedHeapProfile);
    });

    it('should throw error when unexpected profile type is requested.', async () => {
      const profiler = new Profiler(testConfig);
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'UNKNOWN',
        duration: '10s',
        labels: {instance: 'test-instance'},
      };
      await expect(profiler.profile(requestProf)).rejects.toThrow(
        'Unexpected profile type UNKNOWN.'
      );
    });
  });

  describe('writeTimeProfile', () => {
    it(
      'should return request with base64-encoded profile when time profiling' +
        ' enabled',
      async () => {
        const profiler = new Profiler(testConfig);

        const requestProf = {
          name: 'projects/12345678901/test-projectId',
          profileType: 'WALL',
          duration: '10s',
          labels: {instance: 'test-instance'},
        };

        const outRequestProfile = await profiler.writeTimeProfile(requestProf);
        const encodedBytes = outRequestProfile.profileBytes;

        expect(encodedBytes).toBeDefined();

        const decodedBytes = Buffer.from(encodedBytes as string, 'base64');
        const unzippedBytes = (await promisify(zlib.gunzip)(
          decodedBytes
        )) as Uint8Array;
        const outProfile = perftools.profiles.Profile.decode(unzippedBytes);

        // compare to decodedTimeProfile, which is equivalent to timeProfile,
        // but numbers are replaced with longs.
        expect(outProfile).toEqual(decodedTimeProfile);
      }
    );

    it('should throw error when time profiling is not enabled.', async () => {
      const config = extend(true, {}, testConfig);
      config.disableTime = true;
      const profiler = new Profiler(config);
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        labels: {instance: 'test-instance'},
      };
      await expect(profiler.writeTimeProfile(requestProf)).rejects.toThrow(
        'Cannot collect time profile, time profiler not enabled.'
      );
    });
  });

  describe('writeHeapProfile', () => {
    it(
      'should return request with base64-encoded profile when time profiling' +
        ' enabled',
      async () => {
        const profiler = new Profiler(testConfig);

        const requestProf = {
          name: 'projects/12345678901/test-projectId',
          profileType: 'HEAP',
          labels: {instance: 'test-instance'},
        };

        const outRequestProfile = await profiler.writeHeapProfile(requestProf);
        const encodedBytes = outRequestProfile.profileBytes;

        expect(encodedBytes).toBeDefined();

        const decodedBytes = Buffer.from(encodedBytes as string, 'base64');
        const unzippedBytes = (await promisify(zlib.gunzip)(
          decodedBytes
        )) as Uint8Array;
        const outProfile = perftools.profiles.Profile.decode(unzippedBytes);

        // compare to decodedTimeProfile, which is equivalent to timeProfile,
        // but numbers are replaced with longs.
        expect(outProfile).toEqual(decodedHeapProfile);
      }
    );

    it('should throw error when heap profiling is not enabled.', async () => {
      const config = extend(true, {}, testConfig);
      config.disableHeap = true;
      const profiler = new Profiler(config);
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'HEAP',
        labels: {instance: 'test-instance'},
      };
      await expect(profiler.writeHeapProfile(requestProf)).rejects.toThrow(
        'Cannot collect heap profile, heap profiler not enabled.'
      );
    });
  });

  describe('profileAndUpload', () => {
    it('should send request to upload time profile.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'WALL',
        labels: {instance: 'test-instance'},
      };

      const requestSpy = jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(null, {}, {statusCode: 200});
        }) as any);

      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);

      const uploaded = requestSpy.mock.calls[0][0].body as {
        profileBytes?: string;
      };
      const decodedBytes = Buffer.from(
        uploaded.profileBytes as string,
        'base64'
      );
      const unzippedBytes = (await promisify(zlib.gunzip)(
        decodedBytes
      )) as Uint8Array;
      const outProfile = perftools.profiles.Profile.decode(unzippedBytes);
      expect(outProfile).toEqual(decodedTimeProfile);

      uploaded.profileBytes = undefined;
      expect(uploaded).toEqual(requestProf);
    });

    it('should send request to upload heap profile.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'HEAP',
        labels: {instance: 'test-instance'},
      };

      const requestSpy = jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(null, {}, {statusCode: 200});
        }) as any);

      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);
      const uploaded = requestSpy.mock.calls[0][0].body as {
        profileBytes?: string;
      };
      const decodedBytes = Buffer.from(
        uploaded.profileBytes as string,
        'base64'
      );
      const unzippedBytes = (await promisify(zlib.gunzip)(
        decodedBytes
      )) as Uint8Array;
      const outProfile = perftools.profiles.Profile.decode(unzippedBytes);
      expect(outProfile).toEqual(decodedHeapProfile);

      uploaded.profileBytes = undefined;
      expect(uploaded).toEqual(requestProf);
    });

    it('should not uploaded when profile type unknown.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'UNKNOWN_PROFILE_TYPE',
        labels: {instance: 'test-instance'},
      };
      const requestSpy = jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(null, {}, {});
        }) as any);
      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('should ignore error thrown by http request.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'WALL',
        labels: {instance: 'test-instance'},
      };
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(new Error('Network error'), {}, {});
        }) as any);
      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);
    });

    it('should ignore when non-200 status code returned.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'WALL',
        labels: {instance: 'test-instance'},
      };
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(null, {}, {statusCode: 500, statusMessage: 'Error 500'});
        }) as any);
      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);
    });

    it('should not retry on non-200 status codes', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'WALL',
        labels: {instance: 'test-instance'},
      };
      nockOauth2();
      const apiMock = nock(FULL_API)
        .patch('/' + requestProf.name)
        .once()
        .reply(500)
        .patch('/' + requestProf.name)
        .once()
        .reply(200);
      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);
      expect(apiMock.isDone()).toBe(false);
    });

    it('should send request to upload profile to default API without error.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'HEAP',
        labels: {instance: 'test-instance'},
      };
      nockOauth2();
      const apiMock = nock(FULL_API)
        .patch('/' + requestProf.name)
        .once()
        .reply(200);
      const profiler = new Profiler(testConfig);
      await profiler.profileAndUpload(requestProf);
      expect(apiMock.isDone()).toBe(true);
    });

    it('should send request to upload profile to non-default API without error.', async () => {
      const requestProf = {
        name: 'projects/12345678901/test-projectId',
        duration: '10s',
        profileType: 'HEAP',
        labels: {instance: 'test-instance'},
      };
      nockOauth2();
      const apiMock = nock(FULL_TEST_API)
        .patch('/' + requestProf.name)
        .once()
        .reply(200);
      const config = extend(true, {}, testConfig);
      config.apiEndpoint = TEST_API;
      const profiler = new Profiler(config);
      await profiler.profileAndUpload(requestProf);
      expect(apiMock.isDone()).toBe(true);
    });
  });

  describe('createProfile', () => {
    it('should successfully create wall profile', async () => {
      const response = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        deployment: {
          labels: {version: 'test-version', language: 'nodejs'},
          projectId: 'test-projectId',
          target: 'test-service',
        },
        labels: {version: testConfig.serviceContext.version},
      };
      nockOauth2();
      const requestProfileMock = nock(FULL_API)
        .post('/projects/' + testConfig.projectId + '/profiles')
        .once()
        .reply(200, response);
      const profiler = new Profiler(testConfig);
      const actualResponse = await profiler.createProfile();
      expect(actualResponse).toEqual(response);
      expect(requestProfileMock.isDone()).toBe(true);
    });

    it('should successfully create profile using non-default api', async () => {
      const config = extend(true, {}, testConfig);
      config.apiEndpoint = TEST_API;
      const response = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        deployment: {
          labels: {version: 'test-version', language: 'nodejs'},
          projectId: 'test-projectId',
          target: 'test-service',
        },
        labels: {version: config.serviceContext.version},
      };
      nockOauth2();
      const requestProfileMock = nock(FULL_TEST_API)
        .post('/projects/' + config.projectId + '/profiles')
        .once()
        .reply(200, response);
      const profiler = new Profiler(config);
      const actualResponse = await profiler.createProfile();
      expect(actualResponse).toEqual(response);
      expect(requestProfileMock.isDone()).toBe(true);
    });

    it('should successfully create heap profile', async () => {
      const response = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'HEAP',
        deployment: {
          labels: {version: 'test-version', language: 'nodejs'},
          projectId: 'test-projectId',
          target: 'test-service',
        },
        labels: {version: testConfig.serviceContext.version},
      };
      nockOauth2();
      const requestProfileMock = nock(FULL_API)
        .post('/projects/' + testConfig.projectId + '/profiles')
        .once()
        .reply(200, response);
      const profiler = new Profiler(testConfig);
      const actualResponse = await profiler.createProfile();
      expect(actualResponse).toEqual(response);
      expect(requestProfileMock.isDone()).toBe(true);
    });

    it('should throw error when invalid profile created', async () => {
      const response = {name: 'projects/12345678901/test-projectId'};
      nockOauth2();
      nock(FULL_API)
        .post('/projects/' + testConfig.projectId + '/profiles')
        .once()
        .reply(200, response);
      const profiler = new Profiler(testConfig);
      await expect(profiler.createProfile()).rejects.toThrow(
        'Profile not valid: ' +
          '{"name":"projects/12345678901/test-projectId"}.'
      );
    });

    it('should not retry on non-200 status codes', async () => {
      const response = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'HEAP',
        deployment: {
          labels: {version: 'test-version', language: 'nodejs'},
          projectId: 'test-projectId',
          target: 'test-service',
        },
        labels: {version: testConfig.serviceContext.version},
      };
      nockOauth2();
      nock(FULL_API)
        .post('/projects/' + testConfig.projectId + '/profiles')
        .once()
        .reply(503, {})
        .post('/projects/' + testConfig.projectId + '/profiles')
        .once()
        .reply(200, response);
      const profiler = new Profiler(testConfig);
      await expect(profiler.createProfile()).rejects.toThrow();
    });

    it(
      'should not have instance and zone in request body when instance and' +
        ' zone undefined',
      async () => {
        const config = extend(true, {}, testConfig);
        config.instance = undefined;
        config.zone = undefined;
        const response = {
          name: 'projects/12345678901/test-projectId',
          profileType: 'WALL',
          duration: '10s',
        };
        const requestSpy = jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(undefined, response, {statusCode: 200});
          }) as any);
        const expRequestBody = {
          deployment: {
            labels: {version: 'test-version', language: 'nodejs'},
            projectId: 'test-projectId',
            target: 'test-service',
          },
          profileType: ['WALL', 'HEAP'],
        };
        const profiler = new Profiler(config);
        const actualResponse = await profiler.createProfile();
        expect(actualResponse).toEqual(response);
        expect(requestSpy.mock.calls[0][0].body).toEqual(expRequestBody);
      }
    );

    it(
      'should not have instance and zone in request body when instance and' +
        ' zone empty strings',
      async () => {
        const config = extend(true, {}, testConfig);
        config.instance = '';
        config.zone = '';
        const response = {
          name: 'projects/12345678901/test-projectId',
          profileType: 'WALL',
          duration: '10s',
        };
        const requestSpy = jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(undefined, response, {statusCode: 200});
          }) as any);
        const expRequestBody = {
          deployment: {
            labels: {version: 'test-version', language: 'nodejs'},
            projectId: 'test-projectId',
            target: 'test-service',
          },
          profileType: ['WALL', 'HEAP'],
        };
        const profiler = new Profiler(config);
        const actualResponse = await profiler.createProfile();
        expect(actualResponse).toEqual(response);
        expect(requestSpy.mock.calls[0][0].body).toEqual(expRequestBody);
      }
    );

    it('should keep additional fields in request profile.', async () => {
      const response = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        labels: {version: testConfig.serviceContext.version},
        additionalField: 'additionalField',
      };
      nockOauth2();
      nock(FULL_API)
        .post('/projects/' + testConfig.projectId + '/profiles')
        .once()
        .reply(200, response);
      const profiler = new Profiler(testConfig);
      const actualResponse = await profiler.createProfile();
      expect(actualResponse).toEqual(response);
    });

    it('should throw error when error thrown by http request.', async () => {
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(new Error('Network error'), undefined, undefined);
        }) as any);
      const profiler = new Profiler(testConfig);
      await expect(profiler.createProfile()).rejects.toThrow('Network error');
    });

    it('should throw status message when response has non-200 status.', async () => {
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(undefined, undefined, {
            statusCode: 500,
            statusMessage: '500 status code',
          });
        }) as any);

      const profiler = new Profiler(testConfig);
      await expect(profiler.createProfile()).rejects.toThrow('500 status code');
    });

    it(
      'should throw error with server-specified backoff when non-200 error' +
        ' and backoff specified',
      async () => {
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(
              undefined,
              {error: {details: [{retryDelay: '50s'}]}},
              {statusCode: 409}
            );
          }) as any);

        const profiler = new Profiler(testConfig);
        try {
          await profiler.createProfile();
          throw new Error('expected error, no error thrown');
        } catch (err) {
          expect((err as BackoffResponseError).backoffMillis).toBe(50000);
        }
      }
    );

    it('should throw error when response undefined', async () => {
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          callback(undefined, undefined, {status: 200});
        }) as any);

      const profiler = new Profiler(testConfig);
      await expect(profiler.createProfile()).rejects.toThrow(
        'Profile not valid: undefined.'
      );
    });
  });

  describe('collectProfile', () => {
    const RANDOM_VALUE = 0.5;
    // Retryer calculates expected backoff as RANDOM_VALUE * testConfig.initialBackoffMillis => 0.5 * 1000
    const EXPECTED_BACKOFF = 500;

    beforeEach(() => {
      jest.spyOn(Math, 'random').mockReturnValue(RANDOM_VALUE);
    });

    it('should indicate collectProfile should be called immediately when no errors', async () => {
      const requestProfileResponseBody = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        labels: {version: testConfig.serviceContext.version},
      };
      let callCount = 0;
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          if (callCount === 0) {
            callCount++;
            callback(undefined, requestProfileResponseBody, {
              statusCode: 200,
            });
          } else {
            callback(undefined, undefined, {statusCode: 200});
          }
        }) as any);

      const profiler = new Profiler(testConfig);
      const delayMillis = await profiler.collectProfile();
      expect(delayMillis).toBe(0);
    });

    it(
      'should return expect backoff when non-200 response and no backoff' +
        ' indicated',
      async () => {
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(undefined, undefined, {statusCode: 404});
          }) as any);

        const profiler = new Profiler(testConfig);
        const delayMillis = await profiler.collectProfile();
        expect(delayMillis).toEqual(EXPECTED_BACKOFF);
      }
    );

    it('should reset backoff after success', async () => {
      const createProfileResponseBody = {
        name: 'projects/12345678901/test-projectId',
        profileType: 'WALL',
        duration: '10s',
        labels: {instance: testConfig.instance},
      };
      let callCount = 0;
      jest
        .spyOn(common.ServiceObject.prototype, 'request')
        .mockImplementation(((reqOpts: any, callback: any) => {
          const call = callCount++;
          if (call === 0 || call === 1 || call === 2) {
            callback(undefined, undefined, {statusCode: 404});
          } else if (call === 3) {
            callback(undefined, createProfileResponseBody, {statusCode: 200});
          } else if (call === 4) {
            callback(undefined, undefined, {statusCode: 200});
          } else {
            callback(new Error('error creating profile'), undefined, undefined);
          }
        }) as any);
      const profiler = new Profiler(testConfig);
      let delayMillis = await profiler.collectProfile();
      expect(delayMillis).toEqual(500);
      delayMillis = await profiler.collectProfile();
      expect(delayMillis).toEqual(650);
      delayMillis = await profiler.collectProfile();
      expect(delayMillis).toEqual(845);
      delayMillis = await profiler.collectProfile();
      expect(delayMillis).toEqual(0);
      delayMillis = await profiler.collectProfile();
      expect(delayMillis).toEqual(500);
    });

    it(
      'should return server-specified backoff when non-200 error and backoff' +
        ' specified',
      async () => {
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(
              undefined,
              {error: {details: [{retryDelay: '50s'}]}},
              {statusCode: 409}
            );
          }) as any);
        const profiler = new Profiler(testConfig);
        const delayMillis = await profiler.collectProfile();
        expect(delayMillis).toBe(50000);
      }
    );

    it(
      'should return expected backoff when non-200 error and invalid server backoff' +
        ' specified',
      async () => {
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(
              undefined,
              {message: 'some message'},
              {
                statusCode: 409,
                body: {message: 'some message'},
              }
            );
          }) as any);
        const profiler = new Profiler(testConfig);
        const delayMillis = await profiler.collectProfile();
        expect(delayMillis).toBe(EXPECTED_BACKOFF);
      }
    );

    it(
      'should return expected backoff when non-200 error and invalid server backoff' +
        ' string specified',
      async () => {
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(
              undefined,
              {error: {details: [{retryDelay: 'not a duration'}]}},
              {statusCode: 409}
            );
          }) as any);
        const profiler = new Profiler(testConfig);
        const delayMillis = await profiler.collectProfile();
        expect(delayMillis).toBe(EXPECTED_BACKOFF);
      }
    );

    it(
      'should return backoff limit, when server specified backoff is greater' +
        ' then backoff limit',
      async () => {
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            callback(
              undefined,
              {error: {details: [{retryDelay: '1000h'}]}},
              {statusCode: 409}
            );
          }) as any);
        const profiler = new Profiler(testConfig);
        const delayMillis = await profiler.collectProfile();
        expect(delayMillis).toBe(ms('7d'));
      }
    );

    it(
      'should indicate collectProfile should be called immediately if there' +
        ' is an error when collecting and uploading profile.',
      async () => {
        const createProfileResponseBody = {
          name: 'projects/12345678901/test-projectId',
          profileType: 'WALL',
          duration: '10s',
          labels: {instance: testConfig.instance},
        };
        let callCount = 0;
        jest
          .spyOn(common.ServiceObject.prototype, 'request')
          .mockImplementation(((reqOpts: any, callback: any) => {
            if (callCount === 0) {
              callCount++;
              callback(undefined, createProfileResponseBody, {
                statusCode: 200,
              });
            } else {
              callback(new Error('Error uploading'), undefined, undefined);
            }
          }) as any);

        const profiler = new Profiler(testConfig);
        const delayMillis = await profiler.collectProfile();
        expect(delayMillis).toBe(0);
      }
    );
  });
});
