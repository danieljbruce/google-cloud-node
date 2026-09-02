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

import * as EventEmitter from 'events';
import {makeMiddleware} from '../../../src/middleware/express/make-middleware';

const FAKE_PROJECT_ID = 'project-🦄';

function makeFakeRequest() {
  return {headers: {'content-type': 'application/🍰'}};
}

function makeFakeResponse() {
  const ee = new EventEmitter.EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ee as any).getHeader = () => {};
  return ee;
}

let getOrInjectContextValue: {} | undefined;
jest.mock('../../../src/utils/context', () => ({
  getOrInjectContext: () => {
    return getOrInjectContextValue;
  },
}));

describe('middleware/express/make-middleware', () => {
  describe('makeMiddleware', () => {
    it('should return a function accepting 3 arguments', () => {
      const middleware = makeMiddleware(FAKE_PROJECT_ID, () => {});
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3);
    });

    describe('middleware', () => {
      const FAKE_TRACE_CONTEXT = {trace: 'traceId-🥑'};
      const FAKE_TRACE_AND_SPAN_CONTEXT = {
        trace: 'traceId-🥑',
        spanId: 'spanId-🥑',
      };

      beforeEach(() => {
        getOrInjectContextValue = undefined;
      });

      it('should call the next middleware synchronously', () => {
        getOrInjectContextValue = FAKE_TRACE_CONTEXT;
        const fakeRequest = makeFakeRequest();
        const fakeResponse = makeFakeResponse();
        let called = false;

        const middleware = makeMiddleware(FAKE_PROJECT_ID, () => {});

        middleware(fakeRequest as any, fakeResponse as any, () => {
          called = true;
        });
        expect(called).toBe(true);
      });

      it('should call makeChildLogger with trace context only', () => {
        const FAKE_CHILD_LOGGER = {log: '🍌'};
        getOrInjectContextValue = FAKE_TRACE_CONTEXT;
        const fakeRequest = makeFakeRequest();
        const fakeResponse = makeFakeResponse();

        function makeChild(trace: {}) {
          expect(trace).toBe(`${FAKE_TRACE_CONTEXT.trace}`);
          return FAKE_CHILD_LOGGER;
        }

        const middleware = makeMiddleware(FAKE_PROJECT_ID, makeChild as any);
        middleware(fakeRequest as any, fakeResponse as any, () => {});

        // Should annotate the request with the child logger.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((fakeRequest as any).log).toBe(FAKE_CHILD_LOGGER);
      });

      it('should call makeChildLogger with correct span context', () => {
        const FAKE_CHILD_LOGGER = {log: '🍌'};
        getOrInjectContextValue = FAKE_TRACE_AND_SPAN_CONTEXT;
        const fakeRequest = makeFakeRequest();
        const fakeResponse = makeFakeResponse();

        function makeChild(trace: {}, span: {}) {
          expect(trace).toBe(`${FAKE_TRACE_CONTEXT.trace}`);
          expect(span).toBe(FAKE_TRACE_AND_SPAN_CONTEXT.spanId);
          return FAKE_CHILD_LOGGER;
        }

        const middleware = makeMiddleware(FAKE_PROJECT_ID, makeChild as any);
        middleware(fakeRequest as any, fakeResponse as any, () => {});

        // Should annotate the request with the child logger.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((fakeRequest as any).log).toBe(FAKE_CHILD_LOGGER);
      });

      it('should emit a request log when response is finished', done => {
        getOrInjectContextValue = FAKE_TRACE_CONTEXT;
        const fakeRequest = makeFakeRequest();
        const fakeResponse = makeFakeResponse();
        let emitRequestLogCalled = false;

        function emitRequestLog(httpRequest: {}, trace: {}) {
          try {
            expect(trace).toBe(`${FAKE_TRACE_CONTEXT.trace}`);
            // TODO: check httpRequest properties.
            emitRequestLogCalled = true;
          } catch (e) {
            done(e);
          }
        }

        const middleware = makeMiddleware(
          FAKE_PROJECT_ID,
          () => {},
          emitRequestLog as any,
        );
        middleware(fakeRequest as any, fakeResponse as any, () => {});

        setTimeout(() => {
          try {
            fakeResponse.emit('finished');
            expect(emitRequestLogCalled).toBe(true);
            done();
          } catch (e) {
            done(e);
          }
        }, 10);
      });
    });
  });
});
