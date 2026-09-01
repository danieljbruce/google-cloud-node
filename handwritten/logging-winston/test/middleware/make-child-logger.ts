// Copyright 2018 Google LLC
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

import * as winston from 'winston';
import {
  LOGGING_TRACE_KEY,
  LOGGING_SPAN_KEY,
  LOGGING_SAMPLED_KEY,
} from '../../src/common';

import {makeChildLogger} from '../../src/middleware/make-child-logger';

describe('makeChildLogger', () => {
  const FAKE_TRACE = '🤥';
  const FAKE_SPAN = '☂️';
  const FAKE_SAMPLE = true;
  const LOGGER = winston.createLogger({
    transports: [new winston.transports.Console({silent: true})],
  });
  const origWrite = LOGGER.write;

  afterEach(() => {
    LOGGER.write = origWrite;
  });

  it('should return a winston-like logger', () => {
    const child = makeChildLogger(LOGGER, FAKE_TRACE);
    let logEntry: winston.LogEntry;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (LOGGER.write as any) = (logEntry_: winston.LogEntry) => {
      logEntry = logEntry_;
    };

    child.info('hello');
    expect(logEntry!.message).toBe('hello');
    expect(logEntry!.level).toBe('info');

    child.error('👾', {key: '🎃'});
    expect(logEntry!.message).toBe('👾');
    expect(logEntry!.level).toBe('error');
    expect(logEntry!.key).toBe('🎃');

    child.warn('hello %d', 56, {key: 'value'});
    expect(logEntry!.message).toBe('hello %d');
    expect(logEntry!.level).toBe('warn');
    expect(logEntry!.key).toBeUndefined();

    child.log('silly', '🎈');
    expect(logEntry!.message).toBe('🎈');
    expect(logEntry!.level).toBe('silly');
  });

  it('should override only the write function', () => {
    const child = makeChildLogger(LOGGER, FAKE_TRACE);
    expect(child.warn).toBe(LOGGER.warn);
    expect(child.write).not.toBe(LOGGER.write);
  });

  it('should inject LOGGING_TRACE_KEY only into the metadata', () => {
    const child = makeChildLogger(LOGGER, FAKE_TRACE);
    let trace;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (LOGGER.write as any) = (info: winston.LogEntry) => {
      trace = info[LOGGING_TRACE_KEY];
    };
    child.debug('hello world');
    expect(trace).toBe(FAKE_TRACE);
  });

  it('should inject the LOGGING_SPAN_KEY into the metadata', () => {
    const child = makeChildLogger(LOGGER, FAKE_TRACE, FAKE_SPAN);
    let trace, span;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (LOGGER.write as any) = (info: winston.LogEntry) => {
      trace = info[LOGGING_TRACE_KEY];
      span = info[LOGGING_SPAN_KEY];
    };
    child.debug('hello world');
    expect(trace).toBe(FAKE_TRACE);
    expect(span).toBe(FAKE_SPAN);
  });

  it('should inject the LOGGING_SAMPLED_KEY into the metadata', () => {
    const child = makeChildLogger(LOGGER, FAKE_TRACE, FAKE_SPAN, FAKE_SAMPLE);
    let trace, span, sample;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (LOGGER.write as any) = (info: winston.LogEntry) => {
      trace = info[LOGGING_TRACE_KEY];
      span = info[LOGGING_SPAN_KEY];
      sample = info[LOGGING_SAMPLED_KEY];
    };
    child.debug('hello world');
    expect(trace).toBe(FAKE_TRACE);
    expect(span).toBe(FAKE_SPAN);
    expect(sample).toBe(FAKE_SAMPLE);
  });

  it('should not overwrite existing LOGGING_X_KEY values', () => {
    const child = makeChildLogger(LOGGER, FAKE_TRACE, FAKE_SPAN, FAKE_SAMPLE);
    let trace, span, sample;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (LOGGER.write as any) = (info: winston.LogEntry) => {
      trace = info[LOGGING_TRACE_KEY];
      span = info[LOGGING_SPAN_KEY];
      sample = info[LOGGING_SAMPLED_KEY];
    };
    child.debug('hello world', {
      [LOGGING_TRACE_KEY]: 'to-be-clobbered',
      [LOGGING_SPAN_KEY]: 'to-be-clobbered',
      [LOGGING_SAMPLED_KEY]: false,
    });
    expect(trace).not.toBe(FAKE_TRACE);
    expect(span).not.toBe(FAKE_SPAN);
    expect(sample).not.toBe(FAKE_SAMPLE);
  });
});
