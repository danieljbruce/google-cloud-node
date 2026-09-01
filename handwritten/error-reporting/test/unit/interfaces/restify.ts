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

import {EventEmitter} from 'events';
import * as restify from 'restify';

import {Configuration} from '../../../src/configuration';
import {RequestHandler} from '../../../src/google-apis/auth-client';
import {handlerSetup as restifyInterface} from '../../../src/interfaces/restify';

// node v0.12 compatibility
if (!EventEmitter.prototype.listenerCount) {
  EventEmitter.prototype.listenerCount = function (this, eventName) {
    return this.listeners(eventName as string).length;
  };
}

describe('restifyInterface', () => {
  const UNCAUGHT_EVENT = 'uncaughtException';
  const FINISH = 'finish';
  const noOp = () => {
    return;
  };
  describe('Attachment to the uncaughtException event', () => {
    it('Should attach one listener after instantiation', () => {
      const ee = new EventEmitter();
      expect(ee.listenerCount(UNCAUGHT_EVENT)).toBe(0);
      // return the bound function which the user will actually interface with
      const errorHandlerInstance = restifyInterface(null!, null!);
      // execute the handler the user will use with the stubbed server instance
      errorHandlerInstance(ee as restify.Server);
      expect(ee.listenerCount(UNCAUGHT_EVENT)).toBe(1);
    });
  });
  describe('Request handler lifecycle events', () => {
    const ee = new EventEmitter();
    const errorHandlerInstance = restifyInterface(null!, null!);
    const requestHandlerInstance = errorHandlerInstance(ee as restify.Server);
    describe('default path on invalid input', () => {
      it('Should not throw', () => {
        expect(() => {
          requestHandlerInstance(null!, null!, noOp);
        }).not.toThrow();
      });
    });
    describe('default path without req/res error', () => {
      ee.removeAllListeners();
      const req = new EventEmitter();
      const res = new EventEmitter();
      (res as {} as {statusCode: number}).statusCode = 200;
      it('Should have 0 listeners on the finish event', () => {
        expect(res.listenerCount(FINISH)).toBe(0);
      });
      it('Should not throw while handling the req/res objects', () => {
        expect(() => {
          requestHandlerInstance(
            req as restify.Request,
            res as restify.Response,
            noOp,
          );
        }).not.toThrow();
      });
      it('Should have 1 listener', () => {
        expect(res.listenerCount(FINISH)).toBe(1);
      });
      it('Should not throw when emitting the finish event', () => {
        expect(() => {
          res.emit(FINISH);
        }).not.toThrow();
      });
    });
    describe('default path with req/res error', () => {
      ee.removeAllListeners();
      const client = {
        sendError() {
          expect(true).toBe(true);
        },
      };
      const config = {
        getServiceContext() {
          expect(true).toBe(true);
          return {
            service: 'stub-service',
            version: 'stub-version',
          };
        },
        lacksCredentials() {
          return false;
        },
        getVersion() {
          return '1';
        },
      } as {} as Configuration;
      const errorHandlerInstance = restifyInterface(
        client as {} as RequestHandler,
        config,
      );
      const requestHandlerInstance = errorHandlerInstance(ee as restify.Server);
      const req = new EventEmitter();
      const res = new EventEmitter();
      (res as {} as {statusCode: number}).statusCode = 500;
      it('Should have 0 Listeners on the finish event', () => {
        expect(res.listenerCount(FINISH)).toBe(0);
      });
      it('Should not throw on instantiation', () => {
        expect(() => {
          requestHandlerInstance(
            req as restify.Request,
            res as restify.Response,
            noOp,
          );
        }).not.toThrow();
      });
      it('Should have 1 listener on the finish event', () => {
        expect(res.listenerCount(FINISH)).toBe(1);
      });
      it('Should not throw on emission of the finish event', () => {
        expect(() => {
          res.emit(FINISH);
        }).not.toThrow();
      });
      describe('Exercise the uncaughtException event path', () => {
        it('Should call the sendError function property', done => {
          client.sendError = () => {
            expect(true).toBe(true);
            done();
          };
          expect(() => {
            ee.emit(UNCAUGHT_EVENT);
          }).not.toThrow();
        });
      });
    });
  });
});
