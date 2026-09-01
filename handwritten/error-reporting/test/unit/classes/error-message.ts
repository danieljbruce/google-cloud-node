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

import {ErrorMessage} from '../../../src/classes/error-message';
import {RequestInformationContainer} from '../../../src/classes/request-information-container';
import {deepStrictEqual} from '../../util';

describe('Instantiating a new ErrorMessage', () => {
  let em: ErrorMessage;
  beforeEach(() => {
    em = new ErrorMessage();
  });

  it('Should have a default service context', () => {
    deepStrictEqual(em.serviceContext, {service: 'node', version: undefined});
  });
  it('Should have a default message', () => {
    expect(em.message).toBe('');
  });
  it('Should have a default http context', () => {
    deepStrictEqual(em.context.httpRequest, {
      method: '',
      url: '',
      userAgent: '',
      referrer: '',
      responseStatusCode: 0,
      remoteIp: '',
    });
  });
  it('Should have a default reportLocation', () => {
    deepStrictEqual(em.context.reportLocation, {
      filePath: '',
      lineNumber: 0,
      functionName: '',
    });
  });
});

describe('Calling against setEventTimeToNow', () => {
  let em: ErrorMessage;
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set the eventTime property', () => {
    em.setEventTimeToNow();
    expect(typeof em.eventTime).toBe('string');
  });
});

describe('Fuzzing against setServiceContext', () => {
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const DEFAULT_TEST_VALUE = 'DEFAULT';
  const DEFAULT_VERSION_VALUE = undefined;
  const DEFAULT_SERVICE_VALUE = 'node';
  let em: ErrorMessage;
  beforeEach(() => {
    em = new ErrorMessage();
  });

  it('Should set the value for service context', () => {
    em.setServiceContext(AFFIRMATIVE_TEST_VALUE, AFFIRMATIVE_TEST_VALUE);
    deepStrictEqual(
      em.serviceContext,
      {
        service: AFFIRMATIVE_TEST_VALUE,
        version: AFFIRMATIVE_TEST_VALUE,
      },
      [
        'In the affirmative case the value should be settable to a valid string',
        'and by setting this value this should mutate the instance',
      ].join(' '),
    );
  });
  it('Should set the default values', () => {
    em.setServiceContext(DEFAULT_TEST_VALUE, DEFAULT_TEST_VALUE);
    deepStrictEqual(
      em.serviceContext,
      {
        service: DEFAULT_TEST_VALUE,
        version: DEFAULT_TEST_VALUE,
      },
      [
        'In resetting to default valid values the instance should reflect the',
        'value update',
      ].join(' '),
    );
  });
  it('Should still set version with affirmative value', () => {
    em.setServiceContext(null!, AFFIRMATIVE_TEST_VALUE);
    deepStrictEqual(
      em.serviceContext,
      {
        service: DEFAULT_SERVICE_VALUE,
        version: AFFIRMATIVE_TEST_VALUE,
      },
      [
        'Providing only a valid value to the second argument of',
        'setServiceContext should set the service property as an empty string',
        'but set the version property to the affirmative value.',
      ].join(' '),
    );
  });
  it('Should still set service with affirmative value', () => {
    em.setServiceContext(AFFIRMATIVE_TEST_VALUE, null!);
    deepStrictEqual(
      em.serviceContext,
      {
        service: AFFIRMATIVE_TEST_VALUE,
        version: DEFAULT_VERSION_VALUE,
      },
      [
        'Providing only a valid value to the first argument of',
        'setServiceContext should set the version property as an empty string',
        'but set the service property to the affirmative value.',
      ].join(' '),
    );
  });
  it('Should set default values on both', () => {
    em.setServiceContext(null!, null!);
    deepStrictEqual(
      em.serviceContext,
      {
        service: DEFAULT_SERVICE_VALUE,
        version: DEFAULT_VERSION_VALUE,
      },
      [
        'Providing null as the value to both arguments should set both',
        'properties as empty strings.',
      ].join(' '),
    );
  });
  it('Should set default values on both', () => {
    em.setServiceContext(2 as {} as string, 1.3 as {} as string);
    deepStrictEqual(
      em.serviceContext,
      {
        service: DEFAULT_SERVICE_VALUE,
        version: DEFAULT_VERSION_VALUE,
      },
      [
        'Providing numbers as the value to both arguments should set both',
        'properties as empty strings.',
      ].join(' '),
    );
  });
  it('Should set as default', () => {
    em.setServiceContext({test: 'true'} as {} as string, [] as {} as string);
    deepStrictEqual(
      em.serviceContext,
      {
        service: DEFAULT_SERVICE_VALUE,
        version: DEFAULT_VERSION_VALUE,
      },
      [
        'Providing arrays or objects as the value to both arguments',
        'should set both properties as empty strings.',
      ].join(' '),
    );
  });
  it('Should set as default', () => {
    em.setServiceContext();
    deepStrictEqual(
      em.serviceContext,
      {
        service: DEFAULT_SERVICE_VALUE,
        version: DEFAULT_VERSION_VALUE,
      },
      'Providing no arguments should set both properties as empty strings',
    );
  });
});

describe('Fuzzing against setMessage', () => {
  let em: ErrorMessage;
  beforeEach(() => {
    em = new ErrorMessage();
  });
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';

  it('Should set the message', () => {
    em.setMessage(AFFIRMATIVE_TEST_VALUE);
    expect(em.message).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setMessage();
    expect(em.message).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setHttpMethod', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set the method', () => {
    em.setHttpMethod(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.httpRequest.method).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setHttpMethod();
    expect(em.context.httpRequest.method).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setUrl', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set url', () => {
    em.setUrl(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.httpRequest.url).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setUrl();
    expect(em.context.httpRequest.url).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setUserAgent', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set userAgent', () => {
    em.setUserAgent(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.httpRequest.userAgent).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setUserAgent();
    expect(em.context.httpRequest.userAgent).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setReferrer', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set referrer', () => {
    em.setReferrer(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.httpRequest.referrer).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setReferrer();
    expect(em.context.httpRequest.referrer).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setResponseStatusCode', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 200;
  const NEGATIVE_TEST_VALUE = 0;
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set responseStatusCode', () => {
    em.setResponseStatusCode(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.httpRequest.responseStatusCode).toBe(
      AFFIRMATIVE_TEST_VALUE,
    );
  });
  it('Should default', () => {
    em.setResponseStatusCode();
    expect(em.context.httpRequest.responseStatusCode).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setRemoteIp', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set remoteIp', () => {
    em.setRemoteIp(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.httpRequest.remoteIp).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setRemoteIp();
    expect(em.context.httpRequest.remoteIp).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setUser', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set user', () => {
    em.setUser(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.user).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setUser();
    expect(em.context.user).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setFilePath', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set filePath', () => {
    em.setFilePath(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.reportLocation.filePath).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setFilePath();
    expect(em.context.reportLocation.filePath).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setLineNumber', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 27;
  const NEGATIVE_TEST_VALUE = 0;
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set lineNumber', () => {
    em.setLineNumber(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.reportLocation.lineNumber).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setLineNumber();
    expect(em.context.reportLocation.lineNumber).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against setFunctionName', () => {
  let em: ErrorMessage;
  const AFFIRMATIVE_TEST_VALUE = 'VALID_INPUT_AND_TYPE';
  const NEGATIVE_TEST_VALUE = '';
  beforeEach(() => {
    em = new ErrorMessage();
  });
  it('Should set functionName', () => {
    em.setFunctionName(AFFIRMATIVE_TEST_VALUE);
    expect(em.context.reportLocation.functionName).toBe(AFFIRMATIVE_TEST_VALUE);
  });
  it('Should default', () => {
    em.setFunctionName();
    expect(em.context.reportLocation.functionName).toBe(NEGATIVE_TEST_VALUE);
  });
});

describe('Fuzzing against consumeRequestInformation', () => {
  const em = new ErrorMessage();
  const A_VALID_STRING = 'A_VALID_STRING';
  const A_VALID_NUMBER = 201;
  const NEGATIVE_STRING_CASE = '';
  const NEGATIVE_NUMBER_CASE = 0;

  const AFFIRMATIVE_TEST_VALUE = {
    method: A_VALID_STRING,
    url: A_VALID_STRING,
    userAgent: A_VALID_STRING,
    referrer: A_VALID_STRING,
    statusCode: A_VALID_NUMBER,
    remoteAddress: A_VALID_STRING,
  };
  const NEGATIVE_TEST_VALUE = {
    method: null,
    url: A_VALID_NUMBER,
    userAgent: {},
    referrer: [],
    statusCode: A_VALID_STRING,
    remoteAddress: undefined,
  };
  it('Should consume the stubbed request object', () => {
    em.consumeRequestInformation(
      AFFIRMATIVE_TEST_VALUE as RequestInformationContainer,
    );
    expect(em.context.httpRequest.method).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.url).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.userAgent).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.referrer).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.responseStatusCode).toBe(A_VALID_NUMBER);
    expect(em.context.httpRequest.remoteIp).toBe(A_VALID_STRING);
  });
  it('Should default when consuming a malformed request object', () => {
    em.consumeRequestInformation(null!);
    expect(em.context.httpRequest.method).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.url).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.userAgent).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.referrer).toBe(A_VALID_STRING);
    expect(em.context.httpRequest.responseStatusCode).toBe(A_VALID_NUMBER);
    expect(em.context.httpRequest.remoteIp).toBe(A_VALID_STRING);
  });
  it('Should default when consuming mistyped response object properties', () => {
    em.consumeRequestInformation(
      NEGATIVE_TEST_VALUE as {} as RequestInformationContainer,
    );
    expect(em.context.httpRequest.method).toBe(NEGATIVE_STRING_CASE);
    expect(em.context.httpRequest.url).toBe(NEGATIVE_STRING_CASE);
    expect(em.context.httpRequest.userAgent).toBe(NEGATIVE_STRING_CASE);
    expect(em.context.httpRequest.referrer).toBe(NEGATIVE_STRING_CASE);
    expect(em.context.httpRequest.responseStatusCode).toBe(NEGATIVE_NUMBER_CASE);
    expect(em.context.httpRequest.remoteIp).toBe(NEGATIVE_STRING_CASE);
  });
  it('Should return the instance on calling consumeRequestInformation', () => {
    expect(
      em.consumeRequestInformation(
        AFFIRMATIVE_TEST_VALUE as RequestInformationContainer,
      ) instanceof ErrorMessage,
    ).toBe(true);
    expect(
      em.consumeRequestInformation(undefined!) instanceof ErrorMessage,
    ).toBe(true);
  });
});
