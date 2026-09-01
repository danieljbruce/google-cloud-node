// Copyright 2016 Google LLC
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

import {FakeConfiguration as Configuration} from '../fixtures/configuration';
import {ConfigurationOptions, Logger} from '../../src/configuration';
import {Fuzzer} from '../../utils/fuzzer';
import {deepStrictEqual} from '../util';
const level = process.env.GCLOUD_ERRORS_LOGLEVEL;
import {createLogger} from '../../src/logger';
const logger = createLogger({
  logLevel: typeof level === 'number' ? level : 4,
});
import * as nock from 'nock';

const METADATA_URL =
  'http://metadata.google.internal/computeMetadata/v1/project';

const configEnv = {
  NODE_ENV: process.env.NODE_ENV,
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
  GAE_MODULE_NAME: process.env.GAE_MODULE_NAME,
  GAE_MODULE_VERSION: process.env.GAE_MODULE_VERSION,
};
function sterilizeConfigEnv() {
  delete process.env.NODE_ENV;
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GAE_MODULE_NAME;
  delete process.env.GAE_MODULE_VERSION;
}
function restoreConfigEnv() {
  process.env.NODE_ENV = configEnv.NODE_ENV;
  process.env.GCLOUD_PROJECT = configEnv.GCLOUD_PROJECT;
  process.env.GAE_MODULE_NAME = configEnv.GAE_MODULE_NAME;
  process.env.GAE_MODULE_VERSION = configEnv.GAE_MODULE_VERSION;
}
function createDeadMetadataService() {
  return nock(METADATA_URL).get('/project-id').times(1).reply(500);
}

describe('Configuration class', () => {
  beforeAll(() => {
    sterilizeConfigEnv();
  });
  afterAll(() => {
    restoreConfigEnv();
  });
  describe('Initialization', () => {
    const f = new Fuzzer();
    describe('fuzzing the constructor', () => {
      it('Should return default values', () => {
        let c;
        f.fuzzFunctionForTypes(
          (givenConfigFuzz: ConfigurationOptions) => {
            c = new Configuration(givenConfigFuzz, logger);
            deepStrictEqual(c._givenConfiguration, {});
          },
          ['object'],
        );
      });
    });
    describe('valid config and default values', () => {
      let c: Configuration;
      const validConfig = {reportMode: 'always'} as {reportMode: 'always'};
      beforeAll(() => {
        process.env.NODE_ENV = 'development';
      });
      afterAll(() => {
        sterilizeConfigEnv();
      });
      it('Should not throw with a valid configuration', () => {
        expect(() => {
          c = new Configuration(validConfig, logger);
        }).not.toThrow();
      });
      it('Should have a property reflecting the config argument', () => {
        deepStrictEqual(c._givenConfiguration, validConfig);
      });
      it('Should not have a project id', () => {
        expect(c._projectId).toBeNull();
      });
      it('Should not have a key', () => {
        expect(c.getKey()).toBeNull();
      });
      it('Should have a default service context', () => {
        deepStrictEqual(c.getServiceContext(), {
          service: 'node',
          version: undefined,
        });
      });
      it('Should specify to not report unhandledRejections', () => {
        expect(c.getReportUnhandledRejections()).toBe(false);
      });
    });
    describe('reportMode', () => {
      let nodeEnv: string | undefined;
      beforeEach(() => {
        nodeEnv = process.env.NODE_ENV;
      });

      afterEach(() => {
        if (nodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = nodeEnv;
        }
      });

      it('Should print a deprecation warning if "ignoreEvnironmentCheck" is used', () => {
        let warnText = '';
        const logger = {
          warn: (text: string) => {
            warnText += text + '\n';
          },
        } as Logger;
        new Configuration({ignoreEnvironmentCheck: true}, logger);
        expect(warnText).toBe(
          'The "ignoreEnvironmentCheck" config option is deprecated.  ' +
            'Use the "reportMode" config option instead.\n',
        );
      });

      it('Should print a warning if both "ignoreEnvironmentCheck" and "reportMode" are specified', () => {
        let warnText = '';
        const logger = {
          warn: (text: string) => {
            warnText += text + '\n';
          },
        } as Logger;
        new Configuration(
          {ignoreEnvironmentCheck: true, reportMode: 'never'},
          logger,
        );
        expect(warnText).toBe(
          'The "ignoreEnvironmentCheck" config option is deprecated.  ' +
            'Use the "reportMode" config option instead.\nBoth the "ignoreEnvironmentCheck" ' +
            'and "reportMode" configuration options have been specified.  The "reportMode" ' +
            'option will take precedence.\n',
        );
      });

      it('Should set "reportMode" to "always" if "ignoreEnvironmentCheck" is true', () => {
        const conf = new Configuration({ignoreEnvironmentCheck: true}, logger);
        expect(conf._reportMode).toBe('always');
      });

      it('Should set "reportMode" to "production" if "ignoreEnvironmentCheck" is false', () => {
        const conf = new Configuration({ignoreEnvironmentCheck: false}, logger);
        expect(conf._reportMode).toBe('production');
      });

      it('Should prefer "reportMode" config if "ignoreEnvironmentCheck" is also set', () => {
        const conf = new Configuration(
          {ignoreEnvironmentCheck: true, reportMode: 'never'},
          logger,
        );
        expect(conf._reportMode).toBe('never');
      });

      it('Should be set to "production" by default', () => {
        const conf = new Configuration({}, logger);
        expect(conf._reportMode).toBe('production');
      });

      it('Should state reporting is enabled with mode "production"', () => {
        const conf = new Configuration({reportMode: 'production'}, logger);
        expect(conf.isReportingEnabled()).toBe(true);
      });

      it('Should state reporting is enabled with mode "always"', () => {
        const conf = new Configuration({reportMode: 'always'}, logger);
        expect(conf.isReportingEnabled()).toBe(true);
      });

      it('Should state reporting is not enabled with mode "never"', () => {
        const conf = new Configuration({reportMode: 'never'}, logger);
        expect(conf.isReportingEnabled()).toBe(false);
      });

      it('Should state reporting should proceed with mode "production" and env "production"', () => {
        process.env.NODE_ENV = 'production';
        const conf = new Configuration({reportMode: 'production'}, logger);
        expect(conf.getShouldReportErrorsToAPI()).toBe(true);
      });

      it('Should state reporting should not proceed with mode "production" and env not "production"', () => {
        process.env.NODE_ENV = 'dev';
        const conf = new Configuration({reportMode: 'production'}, logger);
        expect(conf.getShouldReportErrorsToAPI()).toBe(false);
      });

      it('Should state reporting should proceed with mode "always" and env "production"', () => {
        process.env.NODE_ENV = 'production';
        const conf = new Configuration({reportMode: 'always'}, logger);
        expect(conf.getShouldReportErrorsToAPI()).toBe(true);
      });

      it('Should state reporting should proceed with mode "always" and env not "production"', () => {
        process.env.NODE_ENV = 'dev';
        const conf = new Configuration({reportMode: 'always'}, logger);
        expect(conf.getShouldReportErrorsToAPI()).toBe(true);
      });

      it('Should state reporting should not proceed with mode "never" and env "production"', () => {
        process.env.NODE_ENV = 'production';
        const conf = new Configuration({reportMode: 'never'}, logger);
        expect(conf.getShouldReportErrorsToAPI()).toBe(false);
      });

      it('Should state reporting should not proceed with mode "never" and env not "production"', () => {
        process.env.NODE_ENV = 'dev';
        const conf = new Configuration({reportMode: 'never'}, logger);
        expect(conf.getShouldReportErrorsToAPI()).toBe(false);
      });
    });
    describe('with ignoreEnvironmentCheck', () => {
      const conf = Object.assign(
        {},
        {projectId: 'some-id'},
        {ignoreEnvironmentCheck: true},
      );
      const c = new Configuration(conf, logger);
      it('Should reportErrorsToAPI', () => {
        expect(c.getShouldReportErrorsToAPI()).toBe(true);
      });
    });
    describe('without ignoreEnvironmentCheck', () => {
      describe('report behaviour with production env', () => {
        let c: Configuration;
        beforeAll(() => {
          sterilizeConfigEnv();
          process.env.NODE_ENV = 'production';
          c = new Configuration(undefined, logger);
        });
        afterAll(() => {
          sterilizeConfigEnv();
        });
        it('Should reportErrorsToAPI', () => {
          expect(c.getShouldReportErrorsToAPI()).toBe(true);
        });
      });
    });
    describe('exception behaviour', () => {
      it('Should throw if invalid type for reportMode', () => {
        expect(() => {
          new Configuration(
            {reportMode: new Date()} as {} as ConfigurationOptions,
            logger,
          );
        }).toThrow();
      });
      it('Should throw if invalid value for reportMode', () => {
        expect(() => {
          new Configuration(
            {reportMode: 'invalid-mode'} as {} as ConfigurationOptions,
            logger,
          );
        }).toThrow();
      });
      it('Should throw if invalid type for key', () => {
        expect(() => {
          new Configuration({key: null} as {} as ConfigurationOptions, logger);
        }).toThrow();
      });
      it('Should throw if invalid for ignoreEnvironmentCheck', () => {
        expect(() => {
          new Configuration(
            {ignoreEnvironmentCheck: null} as {} as ConfigurationOptions,
            logger,
          );
        }).toThrow();
      });
      it('Should throw if invalid for serviceContext.service', () => {
        expect(() => {
          new Configuration(
            {serviceContext: {service: false}} as {} as ConfigurationOptions,
            logger,
          );
        }).toThrow();
      });
      it('Should throw if invalid for serviceContext.version', () => {
        expect(() => {
          new Configuration(
            {serviceContext: {version: true}} as {} as ConfigurationOptions,
            logger,
          );
        }).toThrow();
      });
      it('Should throw if invalid for reportUnhandledRejections', () => {
        expect(() => {
          new Configuration(
            {
              reportUnhandledRejections: 'INVALID',
            } as {} as ConfigurationOptions,
            logger,
          );
        }).toThrow();
      });
      it('Should not throw given an empty object for serviceContext', () => {
        expect(() => {
          new Configuration({serviceContext: {}}, logger);
        }).not.toThrow();
      });
    });
    describe('Configuration resource aquisition', () => {
      beforeAll(() => {
        sterilizeConfigEnv();
      });
      describe('project id from configuration instance', () => {
        const pi = 'test';
        let c: Configuration;
        beforeAll(() => {
          c = new Configuration({projectId: pi}, logger);
        });
        afterAll(() => {
          nock.cleanAll();
        });
        it('Should return the project id', () => {
          expect(c.getProjectId()).toBe(pi);
        });
      });
      describe('project number from configuration instance', () => {
        const pn = 1234;
        let c: Configuration;
        beforeAll(() => {
          sterilizeConfigEnv();
          c = new Configuration(
            {projectId: pn} as {} as ConfigurationOptions,
            logger,
          );
        });
        afterAll(() => {
          nock.cleanAll();
          sterilizeConfigEnv();
        });
        it('Should return the project number', () => {
          expect(c.getProjectId()).toBe(pn.toString());
        });
      });
    });
    describe('Exception behaviour', () => {
      describe('While lacking a project id', () => {
        let c: Configuration;
        beforeAll(() => {
          sterilizeConfigEnv();
          createDeadMetadataService();
          c = new Configuration(undefined, logger);
        });
        afterAll(() => {
          nock.cleanAll();
          sterilizeConfigEnv();
        });
        it('Should return null', () => {
          expect(c.getProjectId()).toBeNull();
        });
      });
      describe('Invalid type for projectId in runtime config', () => {
        let c: Configuration;
        beforeAll(() => {
          sterilizeConfigEnv();
          createDeadMetadataService();
          c = new Configuration(
            {projectId: null} as {} as ConfigurationOptions,
            logger,
          );
        });
        afterAll(() => {
          nock.cleanAll();
          sterilizeConfigEnv();
        });
        it('Should return null', () => {
          expect(c.getProjectId()).toBeNull();
        });
      });
    });
    describe('Resource aquisition', () => {
      afterAll(() => {
        /*
         * !! IMPORTANT !!
         * THE restoreConfigEnv FUNCTION SHOULD BE CALLED LAST AS THIS TEST FILE
         * EXITS AND SHOULD THEREFORE BE THE LAST THING TO EXECUTE FROM THIS
         * FILE.
         * !! IMPORTANT !!
         */
        restoreConfigEnv();
      });
      describe('via env', () => {
        beforeAll(() => {
          sterilizeConfigEnv();
        });
        afterEach(() => {
          sterilizeConfigEnv();
        });
        describe('no longer tests env itself', () => {
          let c: Configuration;
          const projectId = 'test-xyz';
          beforeAll(() => {
            process.env.GCLOUD_PROJECT = projectId;
            c = new Configuration(undefined, logger);
          });
          it('Should assign', () => {
            expect(c.getProjectId()).toBeNull();
          });
        });
        describe('serviceContext', () => {
          let c: Configuration;
          const projectId = 'test-abc';
          const serviceContext = {
            service: 'test',
            version: '1.x',
          };
          beforeAll(() => {
            process.env.GCLOUD_PROJECT = projectId;
            process.env.GAE_MODULE_NAME = serviceContext.service;
            process.env.GAE_MODULE_VERSION = serviceContext.version;
            c = new Configuration(undefined, logger);
          });
          it('Should assign', () => {
            deepStrictEqual(c.getServiceContext(), serviceContext);
          });
        });
      });
      describe('via runtime configuration', () => {
        beforeAll(() => {
          sterilizeConfigEnv();
        });
        describe('serviceContext', () => {
          let c: Configuration;
          const projectId = 'xyz123';
          const serviceContext = {
            service: 'evaluation',
            version: '2.x',
          };
          beforeAll(() => {
            c = new Configuration({
              projectId,
              serviceContext,
            });
          });
          it('Should assign', () => {
            deepStrictEqual(c.getServiceContext(), serviceContext);
          });
        });
        describe('api key', () => {
          let c: Configuration;
          const projectId = '987abc';
          const key = '1337-api-key';
          beforeAll(() => {
            c = new Configuration(
              {
                key,
                projectId,
              },
              logger,
            );
          });
          it('Should assign', () => {
            expect(c.getKey()).toBe(key);
          });
        });
        describe('reportUnhandledRejections', () => {
          let c: Configuration;
          const reportRejections = false;
          beforeAll(() => {
            c = new Configuration({
              reportUnhandledRejections: reportRejections,
            });
          });
          it('Should assign', () => {
            expect(c.getReportUnhandledRejections()).toBe(reportRejections);
          });
        });
      });
    });
  });
});
