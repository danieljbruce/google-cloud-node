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

import {Logger} from '../../../src/configuration';
import * as manual from '../../../src/interfaces/manual';
import {FakeConfiguration as Configuration} from '../../fixtures/configuration';

const config = new Configuration({});
(config as {} as {lacksCredentials: Function}).lacksCredentials = () => {
  return false;
};
import {ErrorMessage} from '../../../src/classes/error-message';
import {RequestHandler} from '../../../src/google-apis/auth-client';
import {RequestInformationContainer} from '../../../src/classes/request-information-container';
import {Request} from '../../../src/request-extractors/manual';

describe('Manual handler', () => {
  // Mocked client
  const client: RequestHandler = {
    sendError(e: ErrorMessage, cb: () => void) {
      // immediately callback
      if (cb) {
        setImmediate(cb);
      }
    },
  } as {} as RequestHandler;
  const report = manual.handlerSetup(client, config, {
    warn(message: string) {
      // The use of `report` in this class should issue the following
      // warning becasue the `report` class is used directly and, as such,
      // cannot by itself have information where a ErrorMessage was
      // constructed.  It only knows that an error has been reported. Thus,
      // the ErrorMessage objects given to the `report` method in the tests
      // do not have construction site information to verify that if that
      // information is not available, the user is issued a warning.
      expect(message).toBe(
        'Encountered a manually constructed error ' +
          'with message "builder test" but without a construction site stack ' +
          'trace.  This error might not be visible in the error reporting ' +
          'console.',
      );
    },
  } as {} as Logger);
  describe('Report invocation behaviour', () => {
    it('Should allow argument-less invocation', () => {
      const r = report(null!);
      expect(r instanceof ErrorMessage).toBe(true);
    });
    it('Should allow single string', () => {
      const r = report('doohickey');
      expect(r instanceof ErrorMessage).toBe(true);
      expect(r.message).toMatch(/doohickey/);
    });
    it('Should allow single inst of Error', () => {
      const r = report(new Error('hokeypokey'));
      expect(r.message).toMatch(/hokeypokey/);
    });
    it(
      'Should allow a function as a malformed error input',
      done => {
        const r = report(() => {
          expect(false).toBe(true);
        });
        expect(r instanceof ErrorMessage).toBe(true);
        setTimeout(() => {
          done();
        }, 1000);
      },
      2000,
    );
    it('Should callback to the supplied function', done => {
      const r = report('malarkey', () => {
        done();
      });
      expect(r.message).toMatch(/malarkey/);
    });
    it('replace the error string with the additional message', done => {
      const r = report('monkey', 'wrench', () => {
        done();
      });
      expect(r.message).toBe('wrench');
    });
    it('Should allow a full array of optional arguments', done => {
      const r = report('donkey', {method: 'FETCH'}, 'cart', () => {
        done();
      });
      expect(r.message).toBe('cart');
      expect(r.context.httpRequest.method).toBe('FETCH');
    });
    it('Should allow all optional arguments except the callback', () => {
      const r = report('whiskey', {method: 'SIP'}, 'sour');
      expect(r.message).toBe('sour');
      expect(r.context.httpRequest.method).toBe('SIP');
    });
    it('Should allow a lack of additional message', done => {
      const r = report('ticky', {method: 'TACKEY'}, () => {
        done();
      });
      expect(r.message).toMatch(/ticky/);
      expect(r.message).not.toMatch(/TACKEY/);
      expect(r.context.httpRequest.method).toBe('TACKEY');
    });
    it('Should ignore arguments', done => {
      const r = report(
        'hockey',
        (() => {
          done();
        }) as unknown as string,
        'field' as unknown as manual.Callback,
      );
      expect(r.message).toMatch('hockey');
      expect(r.message).not.toMatch('field');
    });
    it('Should ignore arguments', done => {
      const r = report(
        'passkey',
        (() => {
          done();
        }) as unknown as string,
        {method: 'HONK'} as unknown as manual.Callback,
      );
      expect(r.context.httpRequest.method).not.toBe('HONK');
    });
    it('Should allow null arguments as placeholders', done => {
      const r = report('pokey', null!, null!, () => {
        done();
      });
      expect(r.message).toMatch(/pokey/);
    });
    it('Should allow explicit undefined', done => {
      const r = report(
        'Turkey',
        undefined as unknown as Request,
        undefined as unknown as string,
        () => {
          done();
        },
      );
      expect(r.message).toMatch(/Turkey/);
    });
    it('Should allow request to be supplied as undefined', done => {
      const r = report(
        'turnkey',
        undefined as unknown as Request,
        'solution',
        () => {
          done();
        },
      );
      expect(r.message).toBe('solution');
    });
    it('Should allow additional message', done => {
      const r = report(
        'Mickey',
        {method: 'SNIFF'},
        undefined as unknown as string,
        () => {
          done();
        },
      );
      expect(r.message).toMatch(/Mickey/);
      expect(r.message).not.toMatch(/SNIFF/);
      expect(r.context.httpRequest.method).toBe('SNIFF');
    });
  });

  describe('Custom Payload Builder', () => {
    it('Should accept builder inst as only argument', () => {
      const msg = 'builder test';
      const r = report(new ErrorMessage().setMessage(msg));
      expect(r.message.startsWith(msg)).toBe(true);
    });
    it('Should accept builder and request as arguments', () => {
      const msg = 'builder test';
      const oldReq = {method: 'GET'};
      const newReq = {method: 'POST'};
      const r = report(
        new ErrorMessage()
          .setMessage(msg)
          .consumeRequestInformation(oldReq as RequestInformationContainer),
        newReq,
      );
      expect(r.message.startsWith(msg)).toBe(true);
      expect(r.context.httpRequest.method).toBe(newReq.method);
    });
    it('Should accept message and additional message params as', () => {
      const oldMsg = 'builder test';
      const newMsg = 'analysis';
      const r = report(new ErrorMessage().setMessage(oldMsg), newMsg);
      expect(r.message).toBe(newMsg);
    });
    it('Should accept message and callback function', done => {
      const oldMsg = 'builder test';
      report(new ErrorMessage().setMessage(oldMsg), () => {
        done();
      });
    });
  });
});
