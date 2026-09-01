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

import * as nodeutil from 'util';
import {Options} from '../src';
import {Entry, Logging, LogSync, Log} from '@google-cloud/logging';
import * as instrumentation from '@google-cloud/logging/build/src/utils/instrumentation';
import {
  LoggingCommon,
  LOGGING_TRACE_KEY,
  LOGGING_SPAN_KEY,
  LOGGING_SAMPLED_KEY,
} from '../src/common';

declare const global: {[index: string]: {} | null};

interface Metadata {
  value(): void;
  labels?: {label2?: string};
}

let fakeLogInstance: any;
let fakeLoggingOptions_: Options | null = null;
let fakeLogName_: string | null = null;
let fakeLogOptions_: object | null = null;

jest.mock('@google-cloud/logging', () => {
  const actual = jest.requireActual('@google-cloud/logging');
  return {
    ...actual,
    Logging: jest.fn().mockImplementation((options: Options) => {
      fakeLoggingOptions_ = options;
      return {
        log: (logName: string, logOptions: object) => {
          fakeLogName_ = logName;
          fakeLogOptions_ = logOptions;
          return fakeLogInstance;
        },
        logSync: (logName: string, _options: any, logSyncOptions: any) => {
          return new actual.LogSync(
            new actual.Logging(options),
            logName,
            _options,
            logSyncOptions,
          );
        },
      };
    }),
  };
});

describe('logging-common', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loggingCommon: any;

  const OPTIONS: Options = {
    logName: 'log-name',
    levels: {
      one: 1,
      six: 6,
    },
    resource: {},
    serviceContext: {
      service: 'fake-service',
    },
  };

  beforeEach(() => {
    fakeLogInstance = Object.create(Log.prototype);
    fakeLoggingOptions_ = null;
    fakeLogName_ = null;
    fakeLogOptions_ = null;
    fakeLogInstance.entry = jest.fn();
    fakeLogInstance.emergency = jest.fn();
    fakeLogInstance.alert = jest.fn();
    fakeLogInstance.critical = jest.fn();
    fakeLogInstance.error = jest.fn();
    fakeLogInstance.warning = jest.fn();
    fakeLogInstance.notice = jest.fn();
    fakeLogInstance.info = jest.fn();
    fakeLogInstance.debug = jest.fn();
    loggingCommon = new LoggingCommon(OPTIONS);
  });

  describe('instantiation', () => {
    it('should default to logging.write scope', () => {
      expect((fakeLoggingOptions_ as Options).scopes).toEqual([
        'https://www.googleapis.com/auth/logging.write',
      ]);
    });

    it('should initialize Log instance using provided scopes', () => {
      const fakeScope = 'fake scope';

      const optionsWithScopes: Options = Object.assign({}, OPTIONS);
      optionsWithScopes.scopes = fakeScope;

      new LoggingCommon(optionsWithScopes);

      expect(fakeLoggingOptions_).toEqual(optionsWithScopes);
    });

    it('should localize inspectMetadata to default value', () => {
      expect((loggingCommon as any).inspectMetadata).toBe(false);
    });

    it('should localize the provided options.inspectMetadata', () => {
      const optionsWithInspectMetadata = Object.assign({}, OPTIONS, {
        inspectMetadata: true,
      });

      const lc = new LoggingCommon(
        optionsWithInspectMetadata,
      );
      expect((lc as any).inspectMetadata).toBe(true);
    });

    it('should localize provided levels', () => {
      expect((loggingCommon as any).levels).toEqual(OPTIONS.levels);
    });

    it('should default to npm levels', () => {
      const optionsWithoutLevels = Object.assign({}, OPTIONS);
      delete optionsWithoutLevels.levels;

      const lc = new LoggingCommon(
        optionsWithoutLevels,
      );
      expect((lc as any).levels).toEqual({
        error: 3,
        warn: 4,
        info: 6,
        http: 6,
        verbose: 7,
        debug: 7,
        silly: 7,
      });
    });

    it('should localize Log instance using default name', () => {
      const logName = 'log-name-override';

      const optionsWithLogName = Object.assign({}, OPTIONS);
      optionsWithLogName.logName = logName;

      const lc = new LoggingCommon(
        optionsWithLogName,
      );

      const loggingOptions = Object.assign({}, fakeLoggingOptions_);
      delete (loggingOptions as Options).scopes;

      expect(loggingOptions).toEqual(optionsWithLogName);
      expect(fakeLogName_).toBe(logName);
      expect(lc.logName).toBe(logName);
    });

    it('should set removeCircular to true', () => {
      new LoggingCommon(OPTIONS);

      expect(fakeLogOptions_).toEqual({
        removeCircular: true,
        maxEntrySize: 250000,
      });
    });

    it('should localize the provided resource', () => {
      expect((loggingCommon as any).resource).toBe(OPTIONS.resource);
    });

    it('should localize the provided service context', () => {
      expect((loggingCommon as any).serviceContext).toBe(OPTIONS.serviceContext);
    });

    it('should create LogCommon with LogSync', () => {
      const optionsWithRedirectToStdout = Object.assign({}, OPTIONS, {
        redirectToStdout: true,
      });
      const lc = new LoggingCommon(optionsWithRedirectToStdout);
      expect(lc.cloudLog instanceof LogSync).toBe(true);
    });

    it('should create LogCommon with LogSync and useMessage is on', () => {
      const optionsWithRedirectToStdoutAndUseMessage = Object.assign(
        {},
        OPTIONS,
        {
          redirectToStdout: true,
          useMessageField: true,
        },
      );
      const lc = new LoggingCommon(
        optionsWithRedirectToStdoutAndUseMessage,
      );
      expect(lc.cloudLog instanceof LogSync).toBe(true);
      expect((lc.cloudLog as any).useMessageField_).toBe(true);
    });

    it('should create LogCommon with Log', () => {
      const lc = new LoggingCommon(OPTIONS);
      expect(lc.cloudLog instanceof Log).toBe(true);
    });
  });

  describe('log', () => {
    const LEVEL = Object.keys(OPTIONS.levels as {[name: string]: number})[0];
    const INFO = Object.keys(OPTIONS.levels as {[name: string]: number})[1];
    const STACKDRIVER_LEVEL = 'alert'; // (code 1)
    const MESSAGE = 'message';
    const METADATA = {
      value: () => {},
    };

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeLogInstance.entry = (() => {}) as any;
      loggingCommon.cloudLog.emergency = () => {};
      loggingCommon.cloudLog[STACKDRIVER_LEVEL] = () => {};
    });

    it('should throw on a bad log level', () => {
      expect(() => {
        loggingCommon.log(
          'non-existent-level',
          MESSAGE,
          METADATA,
          (err: Error | null) => {
            if (err) throw err;
          },
        );
      }).toThrow(/Unknown log level: non-existent-level/);
    });

    it('should not throw on `0` log level', () => {
      const options = Object.assign({}, OPTIONS, {
        levels: {
          zero: 0,
        },
      });

      loggingCommon = new LoggingCommon(options);

      expect(() => {
        loggingCommon.log('zero', 'test message');
      }).not.toThrow();
    });

    it('should properly create an entry', done => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        }
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should append stack when metadata is an error', done => {
      const error = {
        stack: 'the stack',
      };

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(data).toEqual({
            message: MESSAGE + ' ' + error.stack,
            metadata: error,
            serviceContext: OPTIONS.serviceContext,
          });
          done();
        } catch (e) {
          done(e);
        }
      };

      loggingCommon.log(LEVEL, MESSAGE, error, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should use stack when metadata is err without message', done => {
      const error = {
        stack: 'the stack',
      };

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(data).toEqual({
            message: error.stack,
            metadata: error,
            serviceContext: OPTIONS.serviceContext,
          });
          done();
        } catch (e) {
          done(e);
        }
      };

      loggingCommon.log(LEVEL, '', error, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should inspect metadata when inspectMetadata is set', done => {
      (loggingCommon as any).inspectMetadata = true;

      loggingCommon.cloudLog.entry = (_: {}, data: {}) => {
        try {
          const expectedWinstonMetadata: Record<string, any> = {};

          for (const prop of Object.keys(METADATA)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (expectedWinstonMetadata as any)[prop] =
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              nodeutil.inspect((METADATA as any)[prop]);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((data as any).metadata).toEqual(expectedWinstonMetadata);

          done();
        } catch (e) {
          done(e);
        }
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should promote httpRequest property to metadata', done => {
      const HTTP_REQUEST = {
        statusCode: 418,
      };
      const metadataWithRequest = Object.assign(
        {
          httpRequest: HTTP_REQUEST,
        },
        METADATA,
      );

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
            httpRequest: HTTP_REQUEST,
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        }
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithRequest, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should promote timestamp property to metadata', done => {
      const date = new Date();
      const metadataWithRequest = Object.assign(
        {
          timestamp: date,
        },
        METADATA,
      );

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
            timestamp: date,
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        }
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithRequest, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should promote labels from metadata to log entry', done => {
      const LABELS = {labelKey: 'labelValue'};
      const metadataWithLabels = Object.assign({labels: LABELS}, METADATA);

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
            labels: LABELS,
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        }
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithLabels, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should promote prefixed trace properties to metadata', done => {
      const metadataWithTrace = Object.assign({}, METADATA);
      const loggingTraceKey = LOGGING_TRACE_KEY;
      const loggingSpanKey = LOGGING_SPAN_KEY;
      const loggingSampledKey = LOGGING_SAMPLED_KEY;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingTraceKey] = 'trace1';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingSpanKey] = 'span1';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingSampledKey] = true;

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
            trace: 'trace1',
            spanId: 'span1',
            traceSampled: true,
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        }
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithTrace, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should promote a false traceSampled value to metadata', done => {
      const metadataWithTrace = Object.assign({}, METADATA);
      const loggingSampledKey = LOGGING_SAMPLED_KEY;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingSampledKey] = '0';

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
            traceSampled: false,
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        }
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithTrace, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should set trace metadata from agent if available', done => {
      const oldTraceAgent = global._google_trace_agent;
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        try {
          expect(entryMetadata).toEqual({
            resource: (loggingCommon as any).resource,
            trace: 'projects/project1/traces/trace1',
          });
          expect(data).toEqual({
            message: MESSAGE,
            metadata: METADATA,
          });
          done();
        } catch (e) {
          done(e);
        } finally {
          global._google_trace_agent = oldTraceAgent;
        }
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, (err: Error | null) => {
        if (err) done(err);
      });
    });

    it('should leave out trace metadata if trace unavailable', () => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        expect(entryMetadata).toEqual({
          resource: (loggingCommon as any).resource,
        });
        expect(data).toEqual({
          message: MESSAGE,
          metadata: METADATA,
        });
      };

      const oldTraceAgent = global._google_trace_agent;

      global._google_trace_agent = {};
      loggingCommon.log(LEVEL, MESSAGE, METADATA, () => {});

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return null;
        },
        getWriterProjectId: () => {
          return null;
        },
      };
      loggingCommon.log(LEVEL, MESSAGE, METADATA, () => {});

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return null;
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      loggingCommon.log(LEVEL, MESSAGE, METADATA, () => {});

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return null;
        },
      };
      loggingCommon.log(LEVEL, MESSAGE, METADATA, () => {});
      global._google_trace_agent = oldTraceAgent;
    });

    it('should write to the log', done => {
      const entry = {};

      loggingCommon.cloudLog.entry = () => {
        return entry;
      };

      loggingCommon.cloudLog[STACKDRIVER_LEVEL] = (
        entry_: Entry[],
        callback: () => void,
      ) => {
        try {
          expect(entry_[0]).toEqual(entry);
          callback(); // done()
        } catch (e) {
          done(e);
        }
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, done);
    });

    it('should add instrumentation log entry', done => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        return new Entry(entryMetadata, data);
      };
      loggingCommon.cloudLog['info'] = (
        entry_: Entry[],
        callback: () => void,
      ) => {
        try {
          expect(entry_.length).toBe(2);
          expect(
            (entry_[1].data as any)[instrumentation.DIAGNOSTIC_INFO_KEY][
              instrumentation.INSTRUMENTATION_SOURCE_KEY
            ][0].name,
          ).toBe('nodejs-winston');
          callback(); // done()
        } catch (e) {
          done(e);
        }
      };
      instrumentation.setInstrumentationStatus(false);
      loggingCommon.log(INFO, MESSAGE, METADATA, done);
    });

    it('should add instrumentation log entry with info log level', done => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        return new Entry(entryMetadata, data);
      };
      loggingCommon.cloudLog['info'] = (entry_: Entry[]) => {
        expect(entry_.length).toBe(1);
        expect(
          (entry_[0].data as any)[instrumentation.DIAGNOSTIC_INFO_KEY][
            instrumentation.INSTRUMENTATION_SOURCE_KEY
          ][0].name,
        ).toBe('nodejs-winston');
      };
      loggingCommon.cloudLog[STACKDRIVER_LEVEL] = (entry_: Entry[]) => {
        expect(entry_.length).toBe(1);
        expect((entry_[0].data as any)).toEqual({
          message: MESSAGE,
          metadata: METADATA,
        });
      };
      instrumentation.setInstrumentationStatus(false);
      loggingCommon.log(LEVEL, MESSAGE, METADATA);
      done();
    });
  });

  describe('label and labels', () => {
    const LEVEL = Object.keys(OPTIONS.levels as {[name: string]: number})[0];
    const MESSAGE = 'message';
    const PREFIX = 'prefix';
    const LABELS = {label1: 'value1'};
    const METADATA: Metadata = {value: () => {}, labels: {label2: 'value2'}};

    beforeEach(() => {
      const opts = Object.assign({}, OPTIONS, {
        prefix: PREFIX,
        labels: LABELS,
      });

      loggingCommon = new LoggingCommon(opts);
    });

    it('should properly create an entry with labels and [prefix] message', done => {
      loggingCommon.cloudLog.entry = (entryMetadata1: {}, data1: {}) => {
        try {
          expect(entryMetadata1).toEqual({
            resource: (loggingCommon as any).resource,
            // labels should have been merged.
            labels: {
              label1: 'value1',
              label2: 'value2',
            },
          });
          expect(data1).toEqual({
            message: `[${PREFIX}] ${MESSAGE}`,
            metadata: METADATA,
          });
        } catch (e) {
          return done(e);
        }

        const metadataWithoutLabels = Object.assign({}, METADATA);
        delete metadataWithoutLabels.labels;

        loggingCommon.cloudLog.entry = (entryMetadata2: {}, data2: {}) => {
          try {
            expect(entryMetadata2).toEqual({
              resource: (loggingCommon as any).resource,
              labels: {label1: 'value1'},
            });
            expect(data2).toEqual({
              message: `[${PREFIX}] ${MESSAGE}`,
              metadata: METADATA,
            });
            done();
          } catch (e) {
            done(e);
          }
        };

        loggingCommon.log(
          LEVEL,
          MESSAGE,
          metadataWithoutLabels,
          (err: Error | null) => {
            if (err) done(err);
          },
        );
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, (err: Error | null) => {
        if (err) done(err);
      });
    });
  });
});
