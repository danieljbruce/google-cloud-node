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

import {inspect} from 'util';
import {Writable} from 'stream';
import * as types from '../src/types/core';

interface Options {
  logName?: string;
  resource: {};
  serviceContext: {
    service: string;
  };
  apiEndpoint: string;
  jsonFieldsToTruncate: string[];
}
interface FakeLogType {
  entry?: () => void;
  write?: () => void;
  logging: {auth: {getEnv: Function}};
}

let fakeLoggingOptions_: types.Options | null = null;
let fakeLogName_: string | null = null;
let fakeLogOptions_: types.Options;
let fakeDetectedServiceContext: types.ServiceContext | null = null;

const FAKE_LOG_INSTANCE: FakeLogType = {
  logging: {
    auth: {
      getEnv: () => {
        return 'foo';
      },
    },
  },
};
let fakeLogInstance: FakeLogType;

jest.mock('@google-cloud/logging', () => {
  const actual = jest.requireActual('@google-cloud/logging');
  return {
    ...actual,
    Logging: class FakeLogging {
      constructor(options: types.Options) {
        fakeLoggingOptions_ = options;
      }
      log(logName: string, options: types.Options) {
        fakeLogName_ = logName;
        fakeLogOptions_ = options;
        return fakeLogInstance;
      }
    },
    detectServiceContext: () => {
      if (fakeDetectedServiceContext === null) {
        return Promise.reject(new Error('fake error'));
      }
      return Promise.resolve(fakeDetectedServiceContext);
    },
  };
});

import {
  LoggingBunyan,
  LOGGING_TRACE_KEY,
  LOGGING_SPAN_KEY,
  LOGGING_SAMPLED_KEY,
} from '../src';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {BUNYAN_TO_STACKDRIVER} = require('../src');

describe('logging-bunyan', () => {
  // loggingBunyan is loggingBunyan namespace which cannot be determined type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loggingBunyan: any;

  const TRUNCATE_FIELD =
    'jsonPayload.fields.metadata.structValue.fields.custom.stringValue';

  const OPTIONS = {
    logName: 'log-name',
    resource: {},
    serviceContext: {
      service: 'fake-service',
    },
    apiEndpoint: 'fake.local',
    jsonFieldsToTruncate: [TRUNCATE_FIELD],
  };

  const RECORD = {
    level: 30,
    time: '2012-06-19T21:34:19.906Z',
  };

  beforeEach(() => {
    fakeLogInstance = {...FAKE_LOG_INSTANCE};
    fakeLoggingOptions_ = null;
    fakeLogName_ = null;
    fakeDetectedServiceContext = null;

    loggingBunyan = new LoggingBunyan(OPTIONS);
  });

  describe('instantiation', () => {
    it('should be an object mode Writable', () => {
      expect(loggingBunyan instanceof Writable).toBe(true);
      expect((loggingBunyan as any)._writableState.objectMode).toBe(true);
    });

    it('should localize the provided resource', () => {
      expect(loggingBunyan.resource).toBe(OPTIONS.resource);
    });

    it('should localize the provided service context', () => {
      expect(loggingBunyan.serviceContext).toBe(OPTIONS.serviceContext);
    });

    it('should localize Log instance using provided name', () => {
      expect(fakeLoggingOptions_).toEqual(OPTIONS);
      expect(fakeLogName_).toBe(OPTIONS.logName);
    });

    it('should localize Log instance using provided jsonFieldsToTruncate in options', () => {
      expect(fakeLoggingOptions_).toEqual(OPTIONS);
      expect(fakeLogOptions_.jsonFieldsToTruncate).toEqual(
        OPTIONS.jsonFieldsToTruncate,
      );
    });

    it('should localize Log instance using default name, removeCircular and maxEntrySize options', () => {
      const optionsWithoutLogName: Options = Object.assign({}, OPTIONS);
      delete optionsWithoutLogName.logName;
      new LoggingBunyan(optionsWithoutLogName);
      expect(fakeLoggingOptions_).toEqual(optionsWithoutLogName);
      expect(fakeLogName_).toBe('bunyan_log');
      expect(fakeLogOptions_).toEqual({
        removeCircular: true,
        maxEntrySize: 250000,
        jsonFieldsToTruncate: [TRUNCATE_FIELD],
      });
    });

    it('should not throw if a serviceContext is not specified', () => {
      expect(() => {
        new LoggingBunyan();
      }).not.toThrow();
    });

    it('should throw if a serviceContext is specified without a service', done => {
      try {
        new LoggingBunyan({serviceContext: {} as any});
        done(new Error('Expected to throw'));
      } catch (err) {
        expect((err as Error).message).toBe(
          "If 'serviceContext' is specified then " +
            "'serviceContext.service' is required.",
        );
        done();
      }
    });

    it('should not attempt to discover service context if passed', () => {
      const serviceContext = {service: 'foo'};
      expect(() => {
        new LoggingBunyan({serviceContext});
      }).not.toThrow();
    });

    it('should attempt to discover service context if not passed', done => {
      const serviceContext = {service: 'foo'};
      fakeDetectedServiceContext = serviceContext;
      const lb = new LoggingBunyan();
      expect((lb as any).serviceContext).toBeUndefined();
      setTimeout(() => {
        expect((lb as any).serviceContext).toEqual(serviceContext);
        done();
      }, 10);
    });

    it('should handle errors in discovering service context', done => {
      fakeDetectedServiceContext = null;
      const lb = new LoggingBunyan();
      expect((lb as any).serviceContext).toBeUndefined();
      setTimeout(() => {
        expect((lb as any).serviceContext).toBeUndefined();
        done();
      }, 10);
    });
  });

  describe('stream', () => {
    it('should return a properly formatted object', () => {
      const level = 'info';
      const stream = loggingBunyan.stream(level);

      expect(stream.level).toBe(level);
      expect(stream.type).toBe('raw');
      expect(stream.stream).toBe(loggingBunyan);
    });
  });

  describe('properLabels', () => {
    it('should validate labels correctly', () => {
      const properLabels = [
        {},
        [],
        {key: 'value'},
        ['a', 'b'],
        {a: 'b', c: 'd'},
        {
          key: 'value',
          [Symbol('symbolKey')]: 'value2',
        }, // symbol gets ignored.
      ];
      const improperLabels = [
        true,
        false,
        undefined,
        -1,
        NaN,
        () => {},
        'a string',
        Symbol('a symbol'),
        {key: {nested: 'object'}},
        {key: -1},
        {key: false},
        {key: Symbol('another symbol')},
      ];

      for (const labels of properLabels) {
        expect(LoggingBunyan.properLabels(labels)).toBe(true);
      }
      for (const labels of improperLabels) {
        expect(LoggingBunyan.properLabels(labels)).toBe(false);
      }
    });
  });

  describe('formatEntry_', () => {
    it('should throw an error if record is a string', () => {
      expect(() => {
        loggingBunyan.formatEntry_('string record');
      }).toThrow(
        '@google-cloud/logging-bunyan only works as a raw bunyan stream type.',
      );
    });

    it('should properly create an entry', done => {
      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: types.StackdriverEntryMetadata,
      ) => {
        expect(entryMetadata).toEqual({
          resource: loggingBunyan.resource,
          timestamp: RECORD.time,
          severity: 'INFO',
        });
        expect(record).toEqual(RECORD);
        done();
      };

      loggingBunyan.formatEntry_(RECORD);
    });

    it('should rename the msg property to message', done => {
      const recordWithMsg = Object.assign({msg: 'msg'}, RECORD);
      const recordWithMessage = Object.assign({message: 'msg'}, RECORD);

      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: types.StackdriverEntryMetadata,
      ) => {
        expect(record).toEqual(recordWithMessage);
        done();
      };

      loggingBunyan.formatEntry_(recordWithMsg);
    });

    it('should inject the error stack as the message', done => {
      const record = Object.assign(
        {
          msg: 'msg',
          err: {
            stack: 'the stack',
          },
        },
        RECORD,
      );
      const expectedRecord = Object.assign(
        {
          msg: 'msg',
          err: {
            stack: 'the stack',
          },
          message: 'the stack',
          serviceContext: OPTIONS.serviceContext,
        },
        RECORD,
      );

      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record_: types.StackdriverEntryMetadata,
      ) => {
        expect(record_).toEqual(expectedRecord);
        done();
      };

      loggingBunyan.formatEntry_(record);
    });

    it('should leave message property intact when present', done => {
      const record = Object.assign(
        {
          msg: 'msg',
          message: 'message',
          err: {
            stack: 'the stack',
          },
        },
        RECORD,
      );

      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record_: types.StackdriverEntryMetadata,
      ) => {
        expect(record_).toEqual(record);
        done();
      };

      loggingBunyan.formatEntry_(record);
    });

    it('should promote the httpRequest property to metadata', done => {
      const HTTP_REQUEST = {
        statusCode: 418,
      };
      const recordWithRequest = Object.assign(
        {
          httpRequest: HTTP_REQUEST,
        },
        RECORD,
      );

      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: string | types.BunyanLogRecord,
      ) => {
        expect(entryMetadata).toEqual({
          resource: loggingBunyan.resource,
          timestamp: RECORD.time,
          severity: 'INFO',
          httpRequest: HTTP_REQUEST,
        });
        expect(record).toEqual(RECORD);
        done();
      };

      loggingBunyan.formatEntry_(recordWithRequest);
    });

    it('should promote properly formatted labels to metadata', done => {
      const labels = {key: 'value', 0: 'value2'};
      const recordWithLabels = {...RECORD, labels};
      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: string | types.BunyanLogRecord,
      ) => {
        expect(entryMetadata.labels).toEqual(labels);
        expect(record).toEqual(RECORD);
        done();
      };
      loggingBunyan.formatEntry_(recordWithLabels);
    });

    it('should not promote ill-formatted labels to metadata', done => {
      const labels = {key: -1}; // values must be strings.
      const recordWithLabels = {...RECORD, labels};
      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: string | types.BunyanLogRecord,
      ) => {
        expect(entryMetadata.labels).toBeUndefined();
        expect(record).toEqual(recordWithLabels);
        done();
      };
      loggingBunyan.formatEntry_(recordWithLabels);
    });

    it('should promote prefixed trace properties to metadata', done => {
      const recordWithTrace = Object.assign({}, RECORD);
      // recordWithTrace does not have index signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recordWithTrace as any)[LOGGING_TRACE_KEY] = 'trace1';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recordWithTrace as any)[LOGGING_SPAN_KEY] = 'span1';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recordWithTrace as any)[LOGGING_SAMPLED_KEY] = true;

      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: string | types.BunyanLogRecord,
      ) => {
        expect(entryMetadata).toEqual({
          resource: loggingBunyan.resource,
          timestamp: RECORD.time,
          severity: 'INFO',
          trace: 'trace1',
          spanId: 'span1',
          traceSampled: true,
        });
        expect(record).toEqual(RECORD);
        done();
      };

      loggingBunyan.formatEntry_(recordWithTrace);
    });

    it('should promote a `false` traceSampled property to metadata', done => {
      const recordWithTrace = Object.assign({}, RECORD);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recordWithTrace as any)[LOGGING_SAMPLED_KEY] = false;

      loggingBunyan.cloudLog.entry = (
        entryMetadata: types.StackdriverEntryMetadata,
        record: string | types.BunyanLogRecord,
      ) => {
        expect(entryMetadata).toEqual({
          resource: loggingBunyan.resource,
          timestamp: RECORD.time,
          severity: 'INFO',
          traceSampled: false,
        });
        expect(record).toEqual(RECORD);
        done();
      };

      loggingBunyan.formatEntry_(recordWithTrace);
    });
  });

  describe('write', () => {
    let writeSpy: jest.SpyInstance;
    const oldTraceAgent = global._google_trace_agent;

    afterEach(() => {
      if (writeSpy) {
        writeSpy.mockRestore();
      }
      global._google_trace_agent = oldTraceAgent;
    });

    it('should not set trace property if trace unavailable', done => {
      global._google_trace_agent = undefined;

      writeSpy = jest
        .spyOn(Writable.prototype, 'write')
        .mockImplementation(function (
          this: any,
          record: any,
          encoding?: any,
          callback?: any,
        ) {
          expect(record).toEqual(RECORD);
          expect(encoding).toBe('encoding');
          expect(typeof callback).toBe('function');
          expect(this).toBe(loggingBunyan);
          done();
          return true;
        });

      loggingBunyan.write(RECORD, 'encoding', () => {});
    });

    it('should set prefixed trace property if trace available', done => {
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      const recordWithoutTrace = Object.assign({}, RECORD);
      const recordWithTrace = Object.assign({}, RECORD);
      // recordWithTrace does not have index signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recordWithTrace as any)[LOGGING_TRACE_KEY] =
        'projects/project1/traces/trace1';

      writeSpy = jest
        .spyOn(Writable.prototype, 'write')
        .mockImplementation(function (
          this: any,
          record: any,
          encoding?: any,
          callback?: any,
        ) {
          // Check that trace field added to record before calling Writable.write
          expect(record).toEqual(recordWithTrace);

          // Check that the original record passed in was not mutated
          expect(recordWithoutTrace).toEqual(RECORD);

          expect(encoding).toBe('encoding');
          expect(typeof callback).toBe('function');
          expect(this).toBe(loggingBunyan);
          done();
          return true;
        });

      loggingBunyan.write(recordWithoutTrace, 'encoding', () => {});
    });

    it('should leave prefixed trace property as is if set', done => {
      const oldTraceAgent = global._google_trace_agent;
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace-from-agent';
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      const recordWithTraceAlreadySet = Object.assign({}, RECORD);
      // recordWithTraceAlreadySet does not have index signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recordWithTraceAlreadySet as any)[LOGGING_TRACE_KEY] =
        'trace1';

      writeSpy = jest
        .spyOn(Writable.prototype, 'write')
        .mockImplementation(function (
          this: any,
          record: any,
          encoding?: any,
          callback?: any,
        ) {
          expect(record).toEqual(recordWithTraceAlreadySet);
          expect(encoding).toBe('');
          expect(typeof callback).toBe('function');
          expect(this).toBe(loggingBunyan);
          done();
          return true;
        });

      loggingBunyan.write(recordWithTraceAlreadySet, '', () => {});

      global._google_trace_agent = oldTraceAgent;
    });

    it('should not set prefixed trace property if trace unavailable', () => {
      const fn = jest.fn();
      writeSpy = jest
        .spyOn(Writable.prototype, 'write')
        .mockImplementation(function (
          this: any,
          record: any,
          encoding?: any,
          callback?: any,
        ) {
          expect(record).toEqual(RECORD);
          expect(encoding).toBe('');
          expect(this).toBe(loggingBunyan);
          fn();
          return true;
        });
      const oldTraceAgent = global._google_trace_agent;

      const noop = () => {};
      global._google_trace_agent = {};
      loggingBunyan.write(RECORD, '', noop);

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return null;
        },
        getWriterProjectId: () => {
          return null;
        },
      };
      loggingBunyan.write(RECORD, '', noop);
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return null;
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      loggingBunyan.write(RECORD, '', noop);

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return null;
        },
      };
      loggingBunyan.write(RECORD, '', noop);

      expect(fn).toHaveBeenCalledTimes(4);

      global._google_trace_agent = oldTraceAgent;
    });
  });

  describe('_write', () => {
    beforeEach(() => {
      fakeLogInstance.entry = () => {};
      fakeLogInstance.write = () => {};
    });

    it('should format the record', done => {
      loggingBunyan.formatEntry_ = (record: string | types.BunyanLogRecord) => {
        expect(record).toEqual(RECORD);
        done();
      };

      loggingBunyan._write(RECORD, '', () => {});
    });

    it('should write the record to the log instance', done => {
      const entry = {};

      loggingBunyan.cloudLog.entry = () => {
        return entry;
      };

      loggingBunyan.cloudLog.write =
        // Writable.write used 'any' in function signature.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entries: any, callback: Function) => {
          expect(entries).toBe(entry);
          callback(); // done()
        };

      loggingBunyan._write(RECORD, '', done);
    });

    it('should write the record and call default callback', done => {
      let isCallbackCalled = false;
      loggingBunyan.cloudLog.entry = () => {
        return {};
      };
      loggingBunyan.defaultCallback = () => {
        isCallbackCalled = true;
      };
      loggingBunyan.cloudLog.write =
        // Writable.write used 'any' in function signature.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entries: any, callback: Function) => {
          callback();
        };
      loggingBunyan._write(RECORD, '', () => {});
      expect(isCallbackCalled).toBe(true);
      done();
    });
  });

  describe('_writev', () => {
    const RECORDS = [{chunk: RECORD}, {chunk: RECORD}];
    beforeEach(() => {
      fakeLogInstance.entry = () => {};
      fakeLogInstance.write = () => {};
    });

    it('should format the records', done => {
      let numFormatted = 0;
      loggingBunyan.formatEntry_ = (record: string | types.BunyanLogRecord) => {
        expect(record).toEqual(RECORD);
        if (++numFormatted === RECORDS.length) {
          done();
        }
      };

      loggingBunyan._writev(RECORDS, () => {});
    });

    it('should write the records to the log instance', done => {
      const entry = {};

      loggingBunyan.cloudLog.entry = () => {
        return entry;
      };

      loggingBunyan.cloudLog.write =
        // Writable.write used 'any' in function signature.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entries: any, callback: Function) => {
          expect(entries).toEqual([entry, entry]);
          callback(); // done()
        };

      loggingBunyan._writev(RECORDS, done);
    });
  });

  describe('BUNYAN_TO_STACKDRIVER', () => {
    it('should correctly map to Stackdriver Logging levels', () => {
      const bunyanToStackdriver: Map<number, string> = new Map([
        [60, 'CRITICAL'],
        [50, 'ERROR'],
        [40, 'WARNING'],
        [30, 'INFO'],
        [20, 'DEBUG'],
        [10, 'DEBUG'],
      ]);
      expect(BUNYAN_TO_STACKDRIVER).toEqual(bunyanToStackdriver);
    });
  });
});

