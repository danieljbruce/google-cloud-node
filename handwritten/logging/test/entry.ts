// Copyright 2015 Google LLC
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

import * as extend from 'extend';
import * as entryTypes from '../src/entry';
import * as common from '../src/utils/common';
import * as http from 'http';
import {InMemorySpanExporter} from '@opentelemetry/sdk-trace-base';
import {trace} from '@opentelemetry/api';
import {Resource} from '@opentelemetry/resources';
import {SEMRESATTRS_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {NodeSDK} from '@opentelemetry/sdk-node';

let fakeEventIdNewOverride: Function | null = null;
jest.mock('../src/utils/event-id', () => {
  return {
    EventId: class FakeEventId {
      new(...args: any[]) {
        const func = fakeEventIdNewOverride || (() => {});
        return func(null, args);
      }
    },
  };
});

let fakeObjToStruct: Function | null = null;
let fakeStructToObj: Function | null = null;
jest.mock('../src/utils/common', () => {
  const actual = jest.requireActual('../src/utils/common');
  return {
    ...actual,
    objToStruct: (obj: {}, opts: {}) => {
      return (fakeObjToStruct || actual.objToStruct)(obj, opts);
    },
    structToObj: (struct: {}) => {
      return (fakeStructToObj || actual.structToObj)(struct);
    },
  };
});

import {Entry} from '../src/entry';

// Allows for a 1000ms margin of error when comparing timestamps
function withinExpectedTimeBoundaries(result?: Date): boolean {
  if (result) {
    const now = Date.now();
    const expectedTimestampBoundaries = {
      start: new Date(now - 1000),
      end: new Date(now + 1000),
    };
    if (
      result >= expectedTimestampBoundaries.start &&
      result <= expectedTimestampBoundaries.end
    )
      return true;
  }
  return false;
}

function nanosAndSecondsToDate(timestamp: entryTypes.Timestamp) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seconds = (timestamp as any).seconds;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nanos = (timestamp as any).nanos;
  return new Date(seconds * 1000 + nanos / 1e9);
}

describe('Entry', () => {
  let entry: entryTypes.Entry;

  const METADATA = {};
  const DATA = {};

  beforeEach(() => {
    fakeEventIdNewOverride = null;
    entry = new Entry(METADATA, DATA);
  });

  afterEach(() => {
    fakeObjToStruct = null;
    fakeStructToObj = null;
  });

  describe('instantiation', () => {
    it('should assign timestamp to metadata', () => {
      expect(withinExpectedTimeBoundaries(entry.metadata.timestamp! as Date)).toBe(true);
    });

    it('should not assign timestamp if one is already set', () => {
      const timestamp = new Date('2012') as entryTypes.Timestamp;
      const entry = new Entry({timestamp});
      expect(entry.metadata.timestamp).toBe(timestamp);
    });

    it('should assign insertId to metadata', () => {
      const eventId = 'event-id';
      fakeEventIdNewOverride = () => eventId;
      const entry = new Entry();
      expect(entry.metadata.insertId).toBe(eventId);
    });

    it('should not assign insertId if one is already set', () => {
      const eventId = 'event-id';
      fakeEventIdNewOverride = () => eventId;
      const userDefinedInsertId = 'user-defined-insert-id';
      const entry = new Entry({
        insertId: userDefinedInsertId,
      });
      expect(entry.metadata.insertId).toBe(userDefinedInsertId);
    });

    it('should localize data', () => {
      expect(entry.data).toBe(DATA);
    });
  });

  describe('fromApiResponse_', () => {
    const RESOURCE = {};
    let entry: entryTypes.Entry;
    const date = new Date();

    beforeEach(() => {
      const seconds = date.getTime() / 1000;
      const secondsRounded = Math.floor(seconds);
      fakeStructToObj = (data: {}) => data;
      entry = Entry.fromApiResponse_({
        resource: RESOURCE,
        payload: 'jsonPayload',
        jsonPayload: DATA,
        extraProperty: true,
        timestamp: {
          seconds: secondsRounded,
          nanos: Math.floor((seconds - secondsRounded) * 1e9),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });

    it('should create an Entry', () => {
      expect(entry).toBeInstanceOf(Entry);
      expect(entry.metadata.resource).toBe(RESOURCE);
      expect(entry.data).toBe(DATA);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((entry.metadata as any).extraProperty).toBe(true);
      expect(entry.metadata.timestamp).toEqual(date);
    });

    it('should extend the entry with proto data', () => {
      const entry = Entry.fromApiResponse_({
        resource: RESOURCE,
        payload: 'protoPayload',
        protoPayload: DATA,
        extraProperty: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      expect(entry.data).toBe(DATA);
    });

    it('should extend the entry with json data', () => {
      expect(entry.data).toBe(DATA);
    });

    it('should extend the entry with text data', () => {
      const entry = Entry.fromApiResponse_({
        resource: RESOURCE,
        payload: 'textPayload',
        textPayload: DATA as string,
        extraProperty: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(entry.data).toBe(DATA);
    });
  });

  describe('toJSON', () => {
    beforeEach(() => {
      fakeObjToStruct = () => {};
    });

    it('should not modify the original instance', () => {
      const entryBefore = extend(true, {}, entry);
      entry.toJSON();
      const entryAfter = extend(true, {}, entry);
      expect(entryBefore).toEqual(entryAfter);
    });

    it('should convert data as a struct and assign to jsonPayload', () => {
      const input = {};
      const converted = {};

      fakeObjToStruct = (obj: {}, options: {}) => {
        expect(obj).toBe(input);
        expect(options).toEqual({
          removeCircular: false,
          stringify: true,
        });
        return converted;
      };

      entry.data = input;
      const json = entry.toJSON();
      expect(json.jsonPayload).toBe(converted);
    });

    it('should pass removeCircular to objToStruct_', done => {
      fakeObjToStruct = (
        obj: {},
        options: common.ObjectToStructConverterConfig,
      ) => {
        try {
          expect(options.removeCircular).toBe(true);
          done();
        } catch (e) {
          done(e);
        }
      };
      entry.data = {};
      entry.toJSON({removeCircular: true});
    });

    it('should assign string data as textPayload', () => {
      entry.data = 'string';
      const json = entry.toJSON();
      expect(json.textPayload).toBe(entry.data);
    });

    it('should convert a date timestamp', () => {
      const date = new Date();
      entry.metadata.timestamp = date as entryTypes.Timestamp;
      const json = entry.toJSON();
      const seconds = date.getTime() / 1000;
      const secondsRounded = Math.floor(seconds);
      expect(json.timestamp).toEqual({
        seconds: secondsRounded,
        nanos: Math.floor((seconds - secondsRounded) * 1e9),
      });
    });

    it('should convert a string timestamp', () => {
      const test = {
        inputTime: '2020-01-01T00:00:00.999999999Z',
        expectedSeconds: 1577836800,
        expectedNanos: 999999999,
      };
      entry.metadata.timestamp = test.inputTime;
      const json = entry.toJSON();
      expect(json.timestamp).toEqual({
        seconds: test.expectedSeconds,
        nanos: test.expectedNanos,
      });
    });

    it('should convert a raw incoming HTTP request', () => {
      const req = {
        method: 'GET',
      } as http.IncomingMessage;
      req.headers = {};
      entry.metadata.httpRequest = req;
      const json = entry.toJSON();
      expect(json.httpRequest?.requestMethod).toBe('GET');
    });

    it('should detect trace and span if headers present', () => {
      const req = {
        method: 'GET',
      } as unknown as http.IncomingMessage;
      // To mock http message.headers, we must use lowercased keys.
      req.headers = {
        'x-cloud-trace-context': '0000/1111;o=1',
      };
      entry.metadata.httpRequest = req;
      const json = entry.toJSON();
      expect(json.trace).toBe('projects//traces/0000');
      expect(json.spanId).toBe('1111');
      expect(json.traceSampled).toBe(true);
    });

    it('should not overwrite user defined trace and span with detected', () => {
      const req = {
        method: 'GET',
      } as unknown as http.IncomingMessage;
      // Mock raw http headers with lowercased keys.
      req.headers = {
        'x-cloud-trace-context': '105445aa7843bc8bf206b120001000/000000001;o=1',
      };
      entry.metadata.spanId = '1';
      entry.metadata.trace = '1';
      entry.metadata.traceSampled = false;
      const expected = {
        trace: '1',
        spanId: '1',
        traceSampled: false,
      };
      entry.metadata.httpRequest = req;
      const json = entry.toJSON();
      expect(json.trace).toBe(expected.trace);
      expect(json.spanId).toBe(expected.spanId);
      expect(json.traceSampled).toBe(expected.traceSampled);
    });

    describe('toJSONWithOtel', () => {
      let sdk: NodeSDK;
      beforeAll(() => {
        sdk = new NodeSDK({
          resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: 'nodejs-logging-entry-test',
          }),
          traceExporter: new InMemorySpanExporter(),
        });

        sdk.start();
      });

      afterAll(async () => {
        await sdk.shutdown();
      });

      it('should detect open telemetry trace and span if open telemetry context present', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', span => {
            const json = entry.toJSON();
            expect(json.trace).toBe(
              `projects//traces/${span.spanContext().traceId}`,
            );
            expect(json.spanId).toBe(span.spanContext().spanId);
            expect(json.traceSampled).toBe(
              (span.spanContext().traceFlags & 1) !== 0,
            );
          });
      });

      it('should  detect open telemetry trace and span if open telemetry context and headers present', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', span => {
            const req = {
              method: 'GET',
            } as unknown as http.IncomingMessage;
            // To mock http message.headers, we must use lowercased keys.
            req.headers = {
              'x-cloud-trace-context': '0000/1111;o=1',
            };
            entry.metadata.httpRequest = req;
            const json = entry.toJSON();
            expect(json.trace).toBe(
              `projects//traces/${span.spanContext().traceId}`,
            );
            expect(json.spanId).toBe(span.spanContext().spanId);
            expect(json.traceSampled).toBe(
              (span.spanContext().traceFlags & 1) !== 0,
            );
          });
      });

      it('should not overwrite user defined trace and span when open telemetry context detected', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', span => {
            entry.metadata.spanId = '1';
            entry.metadata.trace = '1';
            entry.metadata.traceSampled = false;
            const expected = {
              trace: '1',
              spanId: '1',
              traceSampled: false,
            };

            const json = entry.toJSON();
            expect(json.trace).toBe(expected.trace);
            expect(json.spanId).toBe(expected.spanId);
            expect(json.traceSampled).toBe(expected.traceSampled);
          });
      });
    });
  });

  describe('toStructuredJSON', () => {
    it('should not modify the original instance', () => {
      const entryBefore = extend(true, {}, entry);
      entry.toStructuredJSON();
      const entryAfter = extend(true, {}, entry);
      expect(entryBefore).toEqual(entryAfter);
    });

    it('should include properties not in StructuredJson', () => {
      entry.metadata.severity = 'CRITICAL';
    });

    it('should re-map new keys and delete old keys', () => {
      entry.metadata.insertId = '👀';
      entry.metadata.labels = {foo: '⌛️'};
      entry.metadata.spanId = '🍓';
      entry.metadata.trace = '🍝';
      entry.metadata.traceSampled = false;
      entry.data = 'this is a log';
      const json = entry.toStructuredJSON();
      expect(
        withinExpectedTimeBoundaries(nanosAndSecondsToDate(json.timestamp!)),
      ).toBe(true);
      delete json.timestamp;
      const expectedJSON = {
        [entryTypes.INSERT_ID_KEY]: '👀',
        [entryTypes.TRACE_KEY]: '🍝',
        [entryTypes.SPAN_ID_KEY]: '🍓',
        [entryTypes.TRACE_SAMPLED_KEY]: false,
        [entryTypes.LABELS_KEY]: {foo: '⌛️'},
        message: 'this is a log',
      };
      expect(json).toEqual(expectedJSON);
    });

    it('should assign payloads to message in priority', () => {
      entry = new Entry(METADATA);
      entry.metadata.textPayload = 'test log';
      let json = entry.toStructuredJSON();
      expect(json.message).toBe('test log');
      entry.data = 'new test log';
      json = entry.toStructuredJSON();
      expect(json.message).toBe('new test log');
    });

    it('should convert a string timestamp', () => {
      entry.metadata.timestamp = new Date();
      const json = entry.toStructuredJSON();
      expect(
        withinExpectedTimeBoundaries(nanosAndSecondsToDate(json.timestamp!)),
      ).toBe(true);
    });

    it('should convert a raw http to httprequest', () => {
      entry.metadata.httpRequest = {
        method: 'POST',
      } as http.IncomingMessage;
      const json = entry.toStructuredJSON();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((json.httpRequest as any).requestMethod).toBe('POST');
    });

    it('should extract trace and span from headers', () => {
      entry.metadata.httpRequest = {
        headers: {
          ['x-cloud-trace-context']: '1/1',
        },
      } as unknown as http.IncomingMessage;
      const json = entry.toStructuredJSON();
      expect(json[entryTypes.TRACE_KEY]).toBe('projects//traces/1');
      expect(json[entryTypes.SPAN_ID_KEY]).toBe('1');
      expect(json[entryTypes.TRACE_SAMPLED_KEY]).toBe(false);
    });

    it('should add message field for structured data', () => {
      entry.data = {message: 'message', test: 'test'};
      let json = entry.toStructuredJSON();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((json.message as any).message).toBe('message');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((json.message as any).test).toBe('test');
      json = entry.toStructuredJSON(undefined, false);
      expect(json.message).toBe('message');
      expect((json as any).test).toBe('test');
    });

    it('should add message field only when needed', () => {
      entry.data = 1;
      let json = entry.toStructuredJSON();
      expect(json.message).toBe(1);
      json = entry.toStructuredJSON(undefined, false);
      expect(json.message).toBe('1');
      entry.data = 'test';
      json = entry.toStructuredJSON(undefined, false);
      expect(json.message).toBe('test');
    });

    describe('toStructuredJSONWithOtel', () => {
      let sdk: NodeSDK;
      beforeAll(() => {
        sdk = new NodeSDK({
          resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: 'nodejs-logging-entry-test',
          }),
          traceExporter: new InMemorySpanExporter(),
        });

        sdk.start();
      });

      afterAll(async () => {
        await sdk.shutdown();
      });

      it('should detect open telemetry trace and span if open telemetry context present', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', span => {
            const json = entry.toStructuredJSON();
            expect(json[entryTypes.TRACE_KEY]).toBe(
              `projects//traces/${span.spanContext().traceId}`,
            );
            expect(json[entryTypes.SPAN_ID_KEY]).toBe(
              span.spanContext().spanId,
            );
            expect(json[entryTypes.TRACE_SAMPLED_KEY]).toBe(
              (span.spanContext().traceFlags & 1) !== 0,
            );
          });
      });

      it('should  detect open telemetry trace and span if open telemetry context and headers present', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', span => {
            const req = {
              method: 'GET',
            } as unknown as http.IncomingMessage;
            // To mock http message.headers, we must use lowercased keys.
            req.headers = {
              'x-cloud-trace-context': '0000/1111;o=1',
            };
            entry.metadata.httpRequest = req;
            const json = entry.toStructuredJSON();
            expect(json[entryTypes.TRACE_KEY]).toBe(
              `projects//traces/${span.spanContext().traceId}`,
            );
            expect(json[entryTypes.SPAN_ID_KEY]).toBe(
              span.spanContext().spanId,
            );
            expect(json[entryTypes.TRACE_SAMPLED_KEY]).toBe(
              (span.spanContext().traceFlags & 1) !== 0,
            );
          });
      });

      it('should not overwrite user defined trace and span when open telemetry context detected', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', span => {
            entry.metadata.spanId = '1';
            entry.metadata.trace = '1';
            entry.metadata.traceSampled = false;
            const expected = {
              trace: '1',
              spanId: '1',
              traceSampled: false,
            };
            const json = entry.toStructuredJSON();
            expect(json[entryTypes.TRACE_KEY]).toBe(expected.trace);
            expect(json[entryTypes.SPAN_ID_KEY]).toBe(expected.spanId);
            expect(json[entryTypes.TRACE_SAMPLED_KEY]).toBe(
              expected.traceSampled,
            );
          });
      });
    });
  });
});
