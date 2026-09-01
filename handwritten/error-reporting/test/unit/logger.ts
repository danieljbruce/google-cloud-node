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

import {createLogger} from '../../src/logger';

describe('logger', () => {
  describe('Initialization', () => {
    let oldEnv: string | undefined;
    beforeAll(() => {
      oldEnv = process.env.GCLOUD_ERRORS_LOGLEVEL;
      delete process.env.GCLOUD_ERRORS_LOGLEVEL;
    });
    afterAll(() => {
      process.env.GCLOUD_ERRORS_LOGLEVEL = oldEnv;
    });
    describe('Exception handling', () => {
      it('Should not throw given undefined', () => {
        expect(() => createLogger()).not.toThrow();
      });
      it('Should not throw given an empty object', () => {
        expect(() => createLogger({})).not.toThrow();
      });
      it('Should not throw given logLevel as a number', () => {
        expect(() => createLogger({logLevel: 3})).not.toThrow();
      });
      it('Should not throw given logLevel as a string', () => {
        expect(() =>
          createLogger({logLevel: '3' as unknown as number}),
        ).not.toThrow();
      });
      it('Should not throw given an env variable to use', () => {
        process.env.GCLOUD_ERRORS_LOGLEVEL = '4';
        expect(() =>
          createLogger({
            logLevel: 4,
          }),
        ).not.toThrow();
        delete process.env.GCLOUD_ERRORS_LOGLEVEL;
      });
      it('Should thow given logLevel as null', () => {
        expect(() => createLogger({logLevel: null!})).toThrow();
      });
    });
    describe('Default log level', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let oldLog: (text: any, args: string[]) => void;
      let text: string | undefined;
      beforeEach(() => {
        // eslint-disable-next-line no-console
        oldLog = console.error;
        text = '';
        // eslint-disable-next-line no-console
        console.error = function (this, ...args: string[]) {
          oldLog(this, args);
          for (let i = 0; i < args.length; i++) {
            text += args[i];
          }
        };
      });
      afterEach(() => {
        text = undefined;
        // eslint-disable-next-line no-console
        console.error = oldLog;
      });
      it('Should print WARN logs by default', () => {
        const logger = createLogger();
        logger.warn('test warning message');
        expect(text).toBe(
          'WARN:@google-cloud/error-reporting: test warning message',
        );
      });
      it('Should print ERROR logs by default', () => {
        const logger = createLogger();
        logger.error('test error message');
        expect(text).toBe(
          'ERROR:@google-cloud/error-reporting: test error message',
        );
      });
    });
  });
});
