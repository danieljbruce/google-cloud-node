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

import {GCPEnv} from 'google-auth-library';
import {LogEntry} from 'winston';
import * as TransportStream from 'winston-transport';
import * as winston from 'winston';
import {Options, LoggingWinston as FakeLoggingWinston} from '../../src';
import {makeMiddleware} from '../../src/middleware/express';

const FAKE_PROJECT_ID = 'project-🦄';
const FAKE_GENERATED_MIDDLEWARE = () => {};
const FAKE_ENVIRONMENT = 'FAKE_ENVIRONMENT';

let authEnvironment: string;
let passedOptions: Array<Options | undefined> = [];
let transport: any;

let passedProjectId: string | undefined;
let passedEmitRequestLog: Function | undefined;

jest.mock('../../src/index', () => {
  const TransportStream = require('winston-transport');
  return {
    LoggingWinston: class FakeLoggingWinston extends TransportStream {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      common: any;

      constructor(options: Options) {
        super(options);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        transport = this;
        passedOptions.push(options);
        this.common = {
          cloudLog: {
            logging: {
              auth: {
                async getProjectId() {
                  return FAKE_PROJECT_ID;
                },
                async getEnv() {
                  return authEnvironment;
                },
              },
            },
          },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log(info: LogEntry, cb: Function) {
        cb();
      }
    },
  };
});

jest.mock('@google-cloud/logging', () => {
  const actual = jest.requireActual('@google-cloud/logging');
  return {
    ...actual,
    middleware: {
      express: {
        makeMiddleware: (
          projectId: string,
          makeChildLogger: Function,
          emitRequestLog: Function,
        ) => {
          passedProjectId = projectId;
          passedEmitRequestLog = emitRequestLog;
          return FAKE_GENERATED_MIDDLEWARE;
        },
      },
    },
  };
});

describe('middleware/express', () => {
  let logger: winston.Logger;

  beforeEach(() => {
    logger = winston.createLogger();
    transport = undefined;
    passedOptions = [];
    passedProjectId = undefined;
    passedEmitRequestLog = undefined;
    authEnvironment = FAKE_ENVIRONMENT;
  });

  it('should create and return a middleware', async () => {
    const mw = await makeMiddleware(logger);
    expect(mw).toBe(FAKE_GENERATED_MIDDLEWARE);
  });

  it('should not allocate a transport when passed', async () => {
    const t = new FakeLoggingWinston({});
    expect(transport).toBe(t);
    await makeMiddleware(logger, t as any);
    expect(transport).toBe(t);
  });

  it('should not allocate a transport when it can be inferred', async () => {
    const t = new FakeLoggingWinston({});
    logger = winston.createLogger({
      transports: [t],
    });
    await makeMiddleware(logger);
    expect(logger.transports.length).toBe(1);
    expect(logger.transports[0]).toBe(t);
  });

  it('should add a transport to the logger when not provided', async () => {
    await makeMiddleware(logger);
    expect(logger.transports.length).toBe(1);
    expect(logger.transports[0]).toBe(transport);
  });

  it('should add a user provided transport to the logger', async () => {
    const t = new FakeLoggingWinston({});
    await makeMiddleware(logger, t as any);
    expect(logger.transports.length).toBe(1);
    expect(logger.transports[0]).toBe(t);
  });

  it('should create a transport with the correct logName', async () => {
    await makeMiddleware(logger);
    expect(passedOptions).toBeDefined();
    expect(passedOptions.length).toBe(1);
    const [options] = passedOptions;
    expect(options!.logName).toBe('winston_log');
  });

  it('should acquire the projectId and pass to makeMiddleware', async () => {
    await makeMiddleware(logger);
    expect(passedProjectId).toBe(FAKE_PROJECT_ID);
  });

  [GCPEnv.APP_ENGINE, GCPEnv.CLOUD_FUNCTIONS, GCPEnv.CLOUD_RUN].forEach(env => {
    it(`should not generate the request logger on ${env}`, async () => {
      authEnvironment = env;
      const t = new FakeLoggingWinston({});
      if (env === GCPEnv.CLOUD_RUN) {
        // Cloud Run needs explicit set skipParentEntryForCloudRun flag to enable this behavior until we can make breaking change in next major version
        await makeMiddleware(logger, t as any, /*skipParentEntryForCloudRun=*/ true);
      } else {
        await makeMiddleware(logger, t as any);
      }
      expect(passedOptions).toBeDefined();
      expect(passedOptions.length).toBe(1);
      // emitRequestLog parameter to makeChildLogger should be undefined.
      expect(passedEmitRequestLog).toBeUndefined();
    });
  });
});
