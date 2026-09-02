/*!
 * Copyright 2018 Google LLC
 *
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

import {GCPEnv} from 'google-auth-library';

// types-only import. Actual require is done through jest.mock below.
import {MiddlewareOptions} from '../../src/middleware/express';

const FAKE_PROJECT_ID = 'project-🦄';
const FAKE_GENERATED_MIDDLEWARE = () => {};

const FAKE_ENVIRONMENT = 'FAKE_ENVIRONMENT';

let authEnvironment: string;
let passedOptions: Array<MiddlewareOptions | undefined> = [];

class FakeLoggingBunyan {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cloudLog: any;
  constructor(options: MiddlewareOptions) {
    passedOptions.push(options);
    this.cloudLog = {
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
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream(level: any) {
    return {level, type: 'raw', stream: this};
  }
}

let passedProjectId: string | undefined;
let passedEmitRequestLog: Function | undefined;

jest.mock('../../src/index', () => ({
  LoggingBunyan: FakeLoggingBunyan,
}));

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

import {middleware, APP_LOG_SUFFIX} from '../../src/middleware/express';

describe('middleware/express', () => {
  beforeEach(() => {
    passedOptions = [];
    passedProjectId = undefined;
    passedEmitRequestLog = undefined;
    authEnvironment = FAKE_ENVIRONMENT;
  });

  it('should create and return a middleware', async () => {
    const {mw} = await middleware();
    expect(mw).toBe(FAKE_GENERATED_MIDDLEWARE);
  });

  it('should generate two loggers with default logName and level', async () => {
    await middleware();
    // Should generate two loggers with the expected names.
    expect(passedOptions).toBeDefined();
    expect(passedOptions.length).toBe(2);
    expect(
      passedOptions.some(
        option => option!.logName === `bunyan_log_${APP_LOG_SUFFIX}`,
      ),
    ).toBe(true);
    expect(passedOptions.some(option => option!.logName === 'bunyan_log')).toBe(
      true,
    );
    expect(passedOptions.every(option => option!.level === 'info')).toBe(true);
  });

  it('should prefer user-provided logName and level', async () => {
    const LOGNAME = '㏒';
    const LEVEL = 'fatal';
    const OPTIONS: MiddlewareOptions = {logName: LOGNAME, level: LEVEL};
    await middleware(OPTIONS);
    expect(passedOptions).toBeDefined();
    expect(passedOptions.length).toBe(2);
    expect(
      passedOptions.some(
        option => option!.logName === `${LOGNAME}_${APP_LOG_SUFFIX}`,
      ),
    ).toBe(true);
    expect(passedOptions.some(option => option!.logName === LOGNAME)).toBe(true);
    expect(passedOptions.every(option => option!.level === LEVEL)).toBe(true);
  });

  it('should acquire the projectId and pass to makeMiddleware', async () => {
    await middleware();
    expect(passedProjectId).toBe(FAKE_PROJECT_ID);
  });

  [GCPEnv.APP_ENGINE, GCPEnv.CLOUD_FUNCTIONS, GCPEnv.CLOUD_RUN].forEach(env => {
    it(`should not generate the request logger on ${env}`, async () => {
      authEnvironment = env;
      if (env === GCPEnv.CLOUD_RUN) {
        // Cloud Run needs explicit option flag to enable this behavior until we can make breaking change in next major version
        await middleware({skipParentEntryForCloudRun: true});
      } else {
        await middleware();
      }
      expect(passedOptions).toBeDefined();
      expect(passedOptions.length).toBe(1);
      // emitRequestLog parameter to makeChildLogger should be undefined.
      expect(passedEmitRequestLog).toBeUndefined();
    });
  });
});
