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

import * as TransportStream from 'winston-transport';
import {Options, LoggingWinston} from '../src';

let fakeLoggingOptions_: Options | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastFakeLoggingArgs: any[] = [];

jest.mock('../src/common', () => {
  const actual = jest.requireActual('../src/common');
  return {
    ...actual,
    LoggingCommon: class FakeLogging {
      constructor(options: {}) {
        fakeLoggingOptions_ = options;
      }
      log(
        level: string,
        message: string,
        metadata: {} | undefined,
        callback: () => void,
      ): void {
        // eslint-disable-next-line prefer-rest-params
        lastFakeLoggingArgs = Array.from(arguments);
        if (callback) setImmediate(callback);
      }
    },
  };
});

describe('logging-winston', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loggingWinston: any;

  const OPTIONS: Options = {
    logName: 'log-name',
    levels: {
      one: 1,
    },
    resource: {},
    serviceContext: {
      service: 'fake-service',
    },
    apiEndpoint: 'fake.local',
  };

  beforeEach(() => {
    fakeLoggingOptions_ = null;
    loggingWinston = new LoggingWinston(OPTIONS);
  });

  describe('instantiation/options', () => {
    it('should inherit from winston-transport.TransportStream', () => {
      const loggingWinston = new LoggingWinston(OPTIONS);
      expect(loggingWinston instanceof TransportStream).toBe(true);
    });

    it('should initialize Log instance using provided scopes', () => {
      const fakeScope = 'fake scope';

      const optionsWithScopes: Options = Object.assign({}, OPTIONS);
      optionsWithScopes.scopes = fakeScope;
      new LoggingWinston(optionsWithScopes);

      expect(fakeLoggingOptions_).toEqual(optionsWithScopes);
    });

    it('should initialize Log instance using provided apiEndpoint', () => {
      const options = Object.assign({}, OPTIONS);
      new LoggingWinston(options);
      expect(fakeLoggingOptions_).toEqual(options);
    });

    it('should pass the provided options.inspectMetadata', () => {
      const optionsWithInspectMetadata = Object.assign({}, OPTIONS, {
        inspectMetadata: true,
      });

      new LoggingWinston(optionsWithInspectMetadata);
      expect(fakeLoggingOptions_!.inspectMetadata).toBe(true);
    });

    it('should pass provided levels', () => {
      expect(fakeLoggingOptions_!.levels).toEqual(OPTIONS.levels);
    });

    it('should pass Log instance using provided name', () => {
      const logName = 'log-name-override';

      const optionsWithLogName = Object.assign({}, OPTIONS);
      optionsWithLogName.logName = logName;
      new LoggingWinston(optionsWithLogName);

      expect(fakeLoggingOptions_!.logName).toBe(logName);
    });

    it('should pass the provided resource', () => {
      expect(fakeLoggingOptions_!.resource).toEqual(OPTIONS.resource);
    });

    it('should pass the provided service context', () => {
      expect(fakeLoggingOptions_!.serviceContext).toEqual(
        OPTIONS.serviceContext,
      );
    });

    it('should pass all parameters to TransportStream', () => {
      const level = 'INFO';
      const format = 'FORMAT';
      const optionsWithTransportStreamparameters = Object.assign({}, OPTIONS, {
        level: level,
        format: format,
        silent: true,
        handleExceptions: true,
        handleRejections: false,
      });
      new LoggingWinston(
        optionsWithTransportStreamparameters,
      );
      expect(fakeLoggingOptions_!.level).toBe(level);
      expect(fakeLoggingOptions_!.format).toBe(format);
      expect(fakeLoggingOptions_!.silent).toBe(true);
      expect(fakeLoggingOptions_!.handleExceptions).toBe(true);
      expect(fakeLoggingOptions_!.handleRejections).toBe(false);
    });
  });

  describe('log', () => {
    const LEVEL = Object.keys(OPTIONS.levels as {[name: string]: number})[0];
    const MESSAGE = 'message';
    const METADATA = {a: 1};

    const loggingWinston: any = new LoggingWinston();

    beforeEach(() => {
      lastFakeLoggingArgs = [];
    });

    it('should properly call common.log', done => {
      const args = Object.assign({}, METADATA, {
        level: LEVEL,
        message: MESSAGE,
      });

      loggingWinston.log(args);

      const [level, message, meta] = lastFakeLoggingArgs;
      expect(level).toBe('one');
      expect(message).toBe('message');
      expect(meta).toEqual({a: 1});
      done();
    });

    it('should prefer Symbol for level', () => {
      const info = {
        ...METADATA,
        message: MESSAGE,
        level: `\u001b[34m${LEVEL}\u001b[39m`,
        [Symbol.for('level')]: LEVEL,
      };
      loggingWinston.log(info);
      const [level, message, meta] = lastFakeLoggingArgs;
      expect(level).toBe('one');
      expect(message).toBe('message');
      expect(meta).toEqual({a: 1, [Symbol.for('level')]: LEVEL});
    });
  });
});
