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

import {ErrorMessage} from '../../src/classes/error-message';
import {populateErrorMessage} from '../../src/populate-error-message';
import {deepStrictEqual} from '../util';

const TEST_USER_INVALID = 12;
const TEST_MESSAGE = 'This is a test';
const TEST_SERVICE_DEFAULT = {
  service: 'node',
  version: undefined,
};
const TEST_STACK_DEFAULT = {
  filePath: '',
  lineNumber: 0,
  functionName: '',
};

/*
 * The type of each property is {} to allow the tests to set values
 * of various types to test the outcome.
 */
interface AnnotatedError {
  user?: {};
  serviceContext?: {};
  stack?: {};
  filePath?: {};
  lineNumber?: {};
  functionName?: {};
}

describe('populate-error-message', () => {
  let em: ErrorMessage;
  const adversarialObjectInput = {
    stack: {},
  };
  const adversarialObjectInputTwo = {
    stack: [],
  };
  beforeEach(() => {
    em = new ErrorMessage();
  });

  it('Should not throw given undefined', () => {
    expect(() => populateErrorMessage(undefined, em)).not.toThrow();
  });

  it('Should not throw given null', () => {
    expect(() => populateErrorMessage(null, em)).not.toThrow();
  });

  it('Should not throw given a string', () => {
    expect(() => populateErrorMessage('string_test', em)).not.toThrow();
  });

  it('Should not throw given a number', () => {
    expect(() => populateErrorMessage(1.2, em)).not.toThrow();
  });

  it('Should not throw given an array', () => {
    expect(() => populateErrorMessage([], em)).not.toThrow();
  });

  it('Should not throw given an object', () => {
    expect(() => populateErrorMessage({}, em)).not.toThrow();
  });

  it('Should not throw given an instance of Error', () => {
    expect(() => populateErrorMessage(new Error(), em)).not.toThrow();
  });

  it('Should not throw given an object of invalid form', () => {
    expect(() =>
      populateErrorMessage(adversarialObjectInput, em),
    ).not.toThrow();
    expect(() =>
      populateErrorMessage(adversarialObjectInputTwo, em),
    ).not.toThrow();
  });

  it('Message Field: Should set the message as the stack given an Error', () => {
    const err = new Error(TEST_MESSAGE);
    populateErrorMessage(err, em);
    deepStrictEqual(
      em.message,
      err.stack,
      'Given a valid message the ' +
        'error message should absorb the error stack as the message',
    );
  });

  it('Message Field: Should set the field given valid input given an object', () => {
    let err = {};
    const MESSAGE = 'test';
    err = {message: MESSAGE};
    populateErrorMessage(err, em);
    expect(em.message).toBe(MESSAGE);
  });

  it(
    'Message Field: Should default the field given lack-of input given ' +
      'an object',
    () => {
      const err = {error: 'some error message'};
      populateErrorMessage(err, em);
      expect(em.message.startsWith("{ error: 'some error message' }")).toBe(
        true,
      );
    },
  );

  it('User Field: Should set the field given valid input given an Error', () => {
    const err: AnnotatedError = new Error();
    const TEST_USER_VALID = 'TEST_USER';
    err.user = TEST_USER_VALID;
    populateErrorMessage(err, em);
    expect(em.context.user).toBe(TEST_USER_VALID);
  });

  it('User Field: Should default the field given invalid input given an Error', () => {
    const err: AnnotatedError = new Error();
    err.user = TEST_USER_INVALID;
    populateErrorMessage(err, em);
    expect(em.context.user).toBe('');
  });

  it('User Field: Should set the field given valid input given an object', () => {
    const err: AnnotatedError = {};
    const USER = 'test';
    err.user = USER;
    populateErrorMessage(err, em);
    expect(em.context.user).toBe(USER);
  });

  it(
    'User Field: Should default the field given lack-of input given an ' +
      'object',
    () => {
      const err = {};
      populateErrorMessage(err, em);
      expect(em.context.user).toBe('');
    },
  );

  it(
    'ServiceContext Field: Should set the field given valid input given ' +
      'an Error',
    () => {
      const err: AnnotatedError = new Error();
      const TEST_SERVICE_VALID = {service: 'test', version: 'test'};
      err.serviceContext = TEST_SERVICE_VALID;
      populateErrorMessage(err, em);
      deepStrictEqual(err.serviceContext, TEST_SERVICE_VALID);
    },
  );

  it(
    'ServiceContext Field: Should default the field given invalid input ' +
      'given an Error',
    () => {
      const err: AnnotatedError = new Error();
      const TEST_SERVICE_INVALID = 12;
      err.serviceContext = TEST_SERVICE_INVALID;
      populateErrorMessage(err, em);
      deepStrictEqual(em.serviceContext, TEST_SERVICE_DEFAULT);
    },
  );

  it(
    'ServiceContext Field: Should default the field if not given input ' +
      'given an Error',
    () => {
      const err = new Error();
      populateErrorMessage(err, em);
      deepStrictEqual(em.serviceContext, TEST_SERVICE_DEFAULT);
    },
  );

  it(
    'ServiceContext Field: Should set the field given valid input given an ' +
      'object',
    () => {
      const err: AnnotatedError = {};
      const TEST_SERVICE_VALID = {service: 'test', version: 'test'};
      err.serviceContext = TEST_SERVICE_VALID;
      populateErrorMessage(err, em);
      deepStrictEqual(em.serviceContext, TEST_SERVICE_VALID);
    },
  );

  it(
    'ServiceContext Field: Should default the field given invalid input ' +
      'given an object',
    () => {
      const err: AnnotatedError = {};
      const TEST_SERVICE_INVALID = 12;
      err.serviceContext = TEST_SERVICE_INVALID;
      populateErrorMessage(err, em);
      deepStrictEqual(em.serviceContext, TEST_SERVICE_DEFAULT);
    },
  );

  it(
    'ServiceContext Field: Should default the field given lack-of input ' +
      'given an object',
    () => {
      const err = {};
      populateErrorMessage(err, em);
      deepStrictEqual(em.serviceContext, TEST_SERVICE_DEFAULT);
    },
  );

  it(
    'Report location Field: Should default the field if given invalid input ' +
      'given an Error',
    () => {
      const TEST_STACK_INVALID_CONTENTS = {
        filePath: null,
        lineNumber: '2',
        functionName: {},
      };
      const err: AnnotatedError = new Error();
      err.stack = TEST_STACK_INVALID_CONTENTS;
      populateErrorMessage(err, em);
      deepStrictEqual(em.context.reportLocation, TEST_STACK_DEFAULT);
    },
  );

  it(
    'Report location Field: Should default field if not given a valid type ' +
      'given an Error',
    () => {
      const err: AnnotatedError = new Error();
      const TEST_STACK_INVALID_TYPE = [] as {};
      err.stack = TEST_STACK_INVALID_TYPE;
      populateErrorMessage(err, em);
      deepStrictEqual(em.context.reportLocation, TEST_STACK_DEFAULT);
    },
  );

  it('FilePath Field: Should set the field given valid input given an object', () => {
    const err: AnnotatedError = {};
    const PATH = 'test';
    err.filePath = PATH;
    populateErrorMessage(err, em);
    expect(em.context.reportLocation.filePath).toBe(PATH);
  });

  it(
    'FilePath Field: Should default the field given lack-of input given ' +
      'an object',
    () => {
      const err = {};
      populateErrorMessage(err, em);
      expect(em.context.reportLocation.filePath).toBe('');
    },
  );

  it('LineNumber Field: Should set the field given valid input given an object', () => {
    const err: AnnotatedError = {};
    const LINE_NUMBER = 10;
    err.lineNumber = LINE_NUMBER;
    populateErrorMessage(err, em);
    expect(em.context.reportLocation.lineNumber).toBe(LINE_NUMBER);
  });

  it(
    'LineNumber Field: Should default the field given lack-of input given ' +
      'an object',
    () => {
      const err = {};
      populateErrorMessage(err, em);
      expect(em.context.reportLocation.lineNumber).toBe(0);
    },
  );

  it(
    'FunctionName Field: Should set the field given valid input given ' +
      'an object',
    () => {
      const err: AnnotatedError = {};
      const FUNCTION_NAME = 'test';
      err.functionName = FUNCTION_NAME;
      populateErrorMessage(err, em);
      expect(em.context.reportLocation.functionName).toBe(FUNCTION_NAME);
    },
  );

  it(
    'FunctionName Field: Should default the field given lack-of input given ' +
      'an object',
    () => {
      const err = {};
      populateErrorMessage(err, em);
      expect(em.context.reportLocation.functionName).toBe('');
    },
  );
});
