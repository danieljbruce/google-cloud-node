/*!
 * Copyright 2021 Google LLC
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

import * as http from 'http';
import {
  getOrInjectContext,
  makeHeaderWrapper,
  parseXCloudTraceHeader,
  parseTraceParentHeader,
} from '../../src/utils/context';
import {InMemorySpanExporter} from '@opentelemetry/sdk-trace-base';
import {trace} from '@opentelemetry/api';
import {Resource} from '@opentelemetry/resources';
import {SEMRESATTRS_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {NodeSDK} from '@opentelemetry/sdk-node';

describe('context', () => {
  describe('makeHeaderWrapper', () => {
    const HEADER_NAME = 'Content-Type';
    const HEADER_VALUE = 'application/🎂';

    it('should correctly get request headers', () => {
      const req = {headers: {[HEADER_NAME]: HEADER_VALUE}};
      const wrapper = makeHeaderWrapper(req as unknown as http.IncomingMessage);
      expect(wrapper!.getHeader(HEADER_NAME)).toBe(HEADER_VALUE);
    });

    it('should correctly set request headers', () => {
      const req = {headers: {} as http.IncomingHttpHeaders};
      const wrapper = makeHeaderWrapper(req as unknown as http.IncomingMessage);
      wrapper!.setHeader(HEADER_NAME, HEADER_VALUE);
      expect(req.headers[HEADER_NAME]).toBe(HEADER_VALUE);
    });

    it('should return null if header property is not in http request', () => {
      const req = {
        method: 'GET',
      } as http.IncomingMessage;
      const wrapper = makeHeaderWrapper(req as unknown as http.IncomingMessage);
      expect(wrapper).toBeNull();
    });
  });

  describe('getOrInjectContext', () => {
    it('should return a default trace context when all detection fails', () => {
      const req = {
        method: 'GET',
      } as http.IncomingMessage;
      const context = getOrInjectContext(req, 'myProj');
      expect(context.trace).toBe('');
      expect(context.spanId).toBeUndefined();
      expect(context.traceSampled).toBeUndefined();
    });

    it('should return a formatted W3C trace context first', () => {
      const req = {
        headers: {
          ['traceparent']:
            '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        },
      } as unknown as http.IncomingMessage;
      const context = getOrInjectContext(req, 'myProj');
      expect(context.trace).toBe(
        'projects/myProj/traces/0af7651916cd43dd8448eb211c80319c',
      );
      expect(context.spanId).toBe('b7ad6b7169203331');
      expect(context.traceSampled).toBe(true);
    });

    it('should return a formatted Google trace context next', () => {
      const req = {
        headers: {['x-cloud-trace-context']: '1/2;o=1'},
      } as unknown as http.IncomingMessage;
      const projectId = 'myProj';
      const context = getOrInjectContext(req, projectId);
      expect(context.trace).toBe(`projects/${projectId}/traces/1`);
      expect(context.spanId).toBe('2');
      expect(context.traceSampled).toBe(true);
    });

    it('should intentionally inject a Google trace context', () => {
      const req = {headers: {}} as http.IncomingMessage;
      const projectId = 'myProj';
      // This should generate a span and trace if not available.
      const context = getOrInjectContext(req, projectId, true);
      expect(context.trace).toContain(`projects/${projectId}/traces/`);
      expect(context.spanId!.length).toBeGreaterThan(0);
      expect(context.traceSampled).toBe(false);
    });

    describe('getOrInjectContextWithOtel', () => {
      let sdk: NodeSDK;
      beforeAll(() => {
        sdk = new NodeSDK({
          resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: 'nodejs-logging-context-test',
          }),
          traceExporter: new InMemorySpanExporter(),
        });

        sdk.start();
      });

      afterAll(async () => {
        await sdk.shutdown();
      });

      it('should ignore a default trace context when open telemetry context detected', () => {
        trace
          .getTracer('nodejs-logging-context-test')
          .startActiveSpan('foo', parentSpan => {
            const req = {
              method: 'GET',
            } as http.IncomingMessage;
            const projectId = 'myProj';
            const context = getOrInjectContext(req, projectId);
            const traceId = parentSpan.spanContext().traceId;
            const spanId = parentSpan.spanContext().spanId;
            const traceSampled =
              (parentSpan.spanContext().traceFlags & 1) !== 0;
            expect(context.trace).toBe(
              `projects/${projectId}/traces/${traceId}`,
            );
            expect(context.spanId).toBe(spanId);
            expect(context.traceSampled).toBe(traceSampled);
          });
      });

      it('should return a formatted open telemetry trace context', () => {
        trace
          .getTracer('nodejs-context-test')
          .startActiveSpan('foo', parentSpan => {
            const req = {headers: {}} as http.IncomingMessage;
            const projectId = 'myProj';
            const context = getOrInjectContext(req, projectId);
            const traceId = parentSpan.spanContext().traceId;
            const spanId = parentSpan.spanContext().spanId;
            const traceSampled =
              (parentSpan.spanContext().traceFlags & 1) !== 0;
            expect(context.trace).toBe(
              `projects/${projectId}/traces/${traceId}`,
            );
            expect(context.spanId).toBe(spanId);
            expect(context.traceSampled).toBe(traceSampled);
          });
      });

      it('should ignore W3C trace context and return open telemetry context', () => {
        trace
          .getTracer('nodejs-context-test')
          .startActiveSpan('foo', parentSpan => {
            const projectId = 'myProj';
            const req = {
              headers: {
                ['traceparent']:
                  '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
              },
            } as unknown as http.IncomingMessage;
            const context = getOrInjectContext(req, projectId);
            const traceId = parentSpan.spanContext().traceId;
            const spanId = parentSpan.spanContext().spanId;
            const traceSampled =
              (parentSpan.spanContext().traceFlags & 1) !== 0;
            expect(context.trace).toBe(
              `projects/${projectId}/traces/${traceId}`,
            );
            expect(context.spanId).toBe(spanId);
            expect(context.traceSampled).toBe(traceSampled);
          });
      });

      it('should ignore google trace context and return open telemetry context', () => {
        trace
          .getTracer('nodejs-context-test')
          .startActiveSpan('foo', parentSpan => {
            const projectId = 'myProj';
            const req = {
              headers: {['x-cloud-trace-context']: '1/2;o=1'},
            } as unknown as http.IncomingMessage;
            const context = getOrInjectContext(req, projectId);
            const traceId = parentSpan.spanContext().traceId;
            const spanId = parentSpan.spanContext().spanId;
            const traceSampled =
              (parentSpan.spanContext().traceFlags & 1) !== 0;
            expect(context.trace).toBe(
              `projects/${projectId}/traces/${traceId}`,
            );
            expect(context.spanId).toBe(spanId);
            expect(context.traceSampled).toBe(traceSampled);
          });
      });

      it('should ignore injecting Google trace context option', () => {
        trace
          .getTracer('nodejs-context-test')
          .startActiveSpan('foo', parentSpan => {
            const projectId = 'myProj';
            const req = {headers: {}} as http.IncomingMessage;
            const context = getOrInjectContext(req, projectId, true);
            const traceId = parentSpan.spanContext().traceId;
            const spanId = parentSpan.spanContext().spanId;
            const traceSampled =
              (parentSpan.spanContext().traceFlags & 1) !== 0;
            expect(context.trace).toBe(
              `projects/${projectId}/traces/${traceId}`,
            );
            expect(context.spanId).toBe(spanId);
            expect(context.traceSampled).toBe(traceSampled);
          });
      });
    });

    describe('parseXCloudTraceHeader', () => {
      it('should extract trace properties from X-Cloud-Trace-Context', () => {
        const tests = [
          {
            header: '105445aa7843bc8bf206b120001000/000000001;o=1',
            expected: {
              trace: '105445aa7843bc8bf206b120001000',
              spanId: '000000001',
              traceSampled: true,
            },
          },
          // TraceSampled is false
          {
            header: '105445aa7843bc8bf206b120001000/000000001;o=0',
            expected: {
              trace: '105445aa7843bc8bf206b120001000',
              spanId: '000000001',
              traceSampled: false,
            },
          },
          {
            // No span
            header: '105445aa7843bc8bf206b120001000;o=1',
            expected: {
              trace: '105445aa7843bc8bf206b120001000',
              spanId: undefined,
              traceSampled: true,
            },
          },
          {
            // No trace
            header: '/105445aa7843bc8bf206b120001000;o=0',
            expected: {
              trace: undefined,
              spanId: '105445aa7843bc8bf206b120001000',
              traceSampled: false,
            },
          },
          {
            // No traceSampled
            header: '105445aa7843bc8bf206b120001000/0',
            expected: {
              trace: '105445aa7843bc8bf206b120001000',
              spanId: '0',
              traceSampled: false,
            },
          },
          {
            // No input
            header: '',
            expected: {
              trace: undefined,
              spanId: undefined,
              traceSampled: false,
            },
          },
        ];
        for (const test of tests) {
          const req = {
            method: 'GET',
          } as unknown as http.IncomingMessage;
          req.headers = {
            'x-cloud-trace-context': test.header,
          };

          const wrapper = makeHeaderWrapper(req);
          const context = parseXCloudTraceHeader(wrapper!);
          if (context) {
            expect(context.trace).toBe(test.expected.trace);
            expect(context.spanId).toBe(test.expected.spanId);
            expect(context.traceSampled).toBe(test.expected.traceSampled);
          } else {
            expect(context).toBeNull();
          }
        }
      });
    });

    describe('parseOtelContext', () => {
      let sdk: NodeSDK;
      beforeAll(() => {
        sdk = new NodeSDK({
          resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: 'nodejs-context-test',
          }),
          traceExporter: new InMemorySpanExporter(),
        });

        sdk.start();
      });

      afterAll(async () => {
        await sdk.shutdown();
      });

      it('should extract trace context from open telemetry context', () => {
        trace
          .getTracer('nodejs-context-test')
          .startActiveSpan('boo', parentSpan => {
            const req = {headers: {}} as http.IncomingMessage;
            const projectId = 'myProj';
            const context = getOrInjectContext(req, projectId);
            const traceId = parentSpan.spanContext().traceId;
            const spanId = parentSpan.spanContext().spanId;
            const traceSampled =
              (parentSpan.spanContext().traceFlags & 1) !== 0;
            expect(context.trace).toBe(
              `projects/${projectId}/traces/${traceId}`,
            );
            expect(context.spanId).toBe(spanId);
            expect(context.traceSampled).toBe(traceSampled);
          });
      });
    });

    describe('parseTraceParentHeader', () => {
      it('should extract trace properties from traceparent', () => {
        const tests = [
          {
            header: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
            expected: {
              trace: '0af7651916cd43dd8448eb211c80319c',
              spanId: 'b7ad6b7169203331',
              traceSampled: true,
            },
          },
          // TraceSampled is false
          {
            header: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00',
            expected: {
              trace: '0af7651916cd43dd8448eb211c80319c',
              spanId: 'b7ad6b7169203331',
              traceSampled: false,
            },
          },
          {
            // No input
            header: '',
            expected: {
              trace: undefined,
              spanId: undefined,
              traceSampled: false,
            },
          },
        ];
        for (const test of tests) {
          const req = {
            method: 'GET',
          } as unknown as http.IncomingMessage;
          req.headers = {
            traceparent: test.header,
          };

          const wrapper = makeHeaderWrapper(req);
          const context = parseTraceParentHeader(wrapper!);
          if (context) {
            expect(context.trace).toBe(test.expected.trace);
            expect(context.spanId).toBe(test.expected.spanId);
            expect(context.traceSampled).toBe(test.expected.traceSampled);
          } else {
            // This is the header: '' test case;
            expect(test.header).toBe('');
          }
        }
      });
    });
  });
});
