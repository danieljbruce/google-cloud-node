// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {status as Status} from '@grpc/grpc-js';
import * as Constants from '../../src/metrics/constants';
import {MetricsTracer} from '../../src/metrics/metrics-tracer';

import {MetricsTracerFactory} from '../../src/metrics/metrics-tracer-factory';
import {Spanner} from '../../src';

const DATABASE = 'test-db';
const INSTANCE = 'instance';
const PROJECT_ID = 'project_id';
const METHOD = 'test-method';
const REQUEST = 'test-request';

describe('MetricsTracer', () => {
  let tracer: MetricsTracer;
  let fakeAttemptCounter: any;
  let fakeAttemptLatency: any;
  let fakeOperationCounter: any;
  let fakeOperationLatency: any;
  let fakeGfeCounter: any;
  let fakeGfeLatency: any;
  let fakeAfeCounter: any;
  let fakeAfeLatency: any;
  
  beforeEach(() => {
    
    fakeAttemptCounter = {
      add: jest.fn(),
    };

    fakeAttemptLatency = {
      record: jest.fn(),
    };

    fakeOperationCounter = {
      add: jest.fn(),
    };

    fakeOperationLatency = {
      record: jest.fn(),
    };

    fakeGfeCounter = {
      add: jest.fn(),
    };

    fakeGfeLatency = {
      record: jest.fn(),
    };

    fakeAfeCounter = {
      add: jest.fn(),
    };

    fakeAfeLatency = {
      record: jest.fn(),
    };

    tracer = new MetricsTracer(
      fakeAttemptCounter,
      fakeAttemptLatency,
      fakeOperationCounter,
      fakeOperationLatency,
      fakeGfeCounter,
      fakeGfeLatency,
      fakeAfeCounter,
      fakeAfeLatency,
      true, // enabled,
      DATABASE,
      INSTANCE,
      PROJECT_ID,
      METHOD,
      REQUEST,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('recordAttemptCompletion', () => {
    it('should record attempt latency when enabled', () => {
      tracer.recordOperationStart();
      tracer.recordAttemptStart();
      expect(tracer.currentOperation!.currentAttempt).toBeTruthy();
      expect(tracer.currentOperation!.currentAttempt!.startTime).toBeTruthy();
      expect(tracer.currentOperation!.attemptCount).toBe(1);

      tracer.recordAttemptCompletion(Status.OK);

      expect(fakeAttemptLatency.record).toHaveBeenCalledTimes(1);
      const [[latency, otelAttrs]] = fakeAttemptLatency.record.mock.calls;
      expect(typeof latency).toBe('number');
      expect(otelAttrs[Constants.METRIC_LABEL_KEY_STATUS]).toBe(Status[Status.OK]);
    });

    it('should record fractional latency with sub-millisecond precision', () => {
      const nowStub = jest.spyOn(performance, 'now');
      nowStub.mockReturnValueOnce(100.0);
      nowStub.mockReturnValueOnce(200.5);
      nowStub.mockReturnValueOnce(202.75);

      tracer.recordOperationStart();
      tracer.recordAttemptStart();
      tracer.recordAttemptCompletion(Status.OK);

      expect(fakeAttemptLatency.record).toHaveBeenCalledTimes(1);
      const [[latency]] = fakeAttemptLatency.record.mock.calls;
      expect(latency).toBe(2.25); // 202.75 - 200.5
    });

    it('should do nothing if disabled', () => {
      tracer.enabled = false;
      tracer.recordAttemptStart();
      tracer.recordAttemptCompletion(Status.OK);
      expect(fakeAttemptLatency.record).not.toHaveBeenCalled();
    });
  });

  describe('recordOperationCompletion', () => {
    it('should record operation and attempt metrics when enabled', () => {
      jest.spyOn(MetricsTracerFactory, 'getInstance').mockReturnValue({
        clearCurrentTracer: jest.fn(),
      } as any);
      tracer.recordOperationStart();
      expect(tracer.currentOperation!.startTime).toBeTruthy();
      tracer.recordAttemptStart();
      tracer.recordAttemptCompletion(Status.OK);
      tracer.recordOperationCompletion();

      expect(fakeOperationCounter.add).toHaveBeenCalledTimes(1);
      expect(fakeAttemptCounter.add).toHaveBeenCalledTimes(1);
      expect(fakeOperationLatency.record).toHaveBeenCalledTimes(1);

      const [[_, opAttrs]] = fakeOperationLatency.record.mock.calls;
      expect(opAttrs[Constants.METRIC_LABEL_KEY_STATUS]).toBe('OK');
    });

    it('should record fractional operation latency with sub-millisecond precision', () => {
      const nowStub = jest.spyOn(performance, 'now');
      nowStub.mockReturnValueOnce(100.5);
      nowStub.mockReturnValueOnce(105.0);
      nowStub.mockReturnValueOnce(108.0);
      nowStub.mockReturnValueOnce(110.25);

      jest.spyOn(MetricsTracerFactory, 'getInstance').mockReturnValue({
        clearCurrentTracer: jest.fn(),
      } as any);

      tracer.recordOperationStart();
      tracer.recordAttemptStart();
      tracer.recordAttemptCompletion(Status.OK);
      tracer.recordOperationCompletion();

      expect(fakeOperationLatency.record).toHaveBeenCalledTimes(1);
      const [[latency]] = fakeOperationLatency.record.mock.calls;
      expect(latency).toBe(9.75); // 110.25 - 100.5
    });

    it('should do nothing if disabled', () => {
      tracer.enabled = false;
      tracer.recordOperationCompletion();
      expect(fakeOperationCounter.add).not.toHaveBeenCalled();
      expect(fakeOperationLatency.record).not.toHaveBeenCalled();
    });
  });

  describe('recordGfeLatency', () => {
    it('should record GFE latency if enabled', () => {
      tracer.enabled = true;
      tracer.gfeLatency = 123;
      tracer.recordGfeLatency(Status.OK);
      expect(fakeGfeLatency.record).toHaveBeenCalledTimes(1);
    });

    it('should not record if disabled', () => {
      tracer.enabled = false;
      tracer.gfeLatency = 123;
      tracer.recordGfeLatency(Status.OK);
      expect(fakeGfeLatency.record).not.toHaveBeenCalled();
    });
  });

  describe('recordGfeConnectivityErrorCount', () => {
    it('should increment GFE error counter if enabled', () => {
      tracer.recordGfeConnectivityErrorCount(Status.OK);
      expect(fakeGfeCounter.add).toHaveBeenCalledTimes(1);
    });

    it('should not increment if disabled', () => {
      tracer.enabled = false;
      tracer.recordGfeConnectivityErrorCount(Status.OK);
      expect(fakeGfeCounter.add).not.toHaveBeenCalled();
    });
  });

  describe('recordAfeLatency', () => {
    afterEach(() => {
      Spanner._resetAFEServerTimingForTest();
      process.env['SPANNER_DISABLE_AFE_SERVER_TIMING'] = 'false';
    });

    it('should record AFE latency if enabled', () => {
      tracer.enabled = true;
      tracer.afeLatency = 123;
      tracer.recordAfeLatency(Status.OK);
      expect(fakeAfeLatency.record).toHaveBeenCalledTimes(1);
    });

    it('should not record if AFE server timing is disabled', () => {
      tracer.enabled = true;
      Spanner._resetAFEServerTimingForTest();
      process.env['SPANNER_DISABLE_AFE_SERVER_TIMING'] = 'true';
      tracer.afeLatency = 123;
      tracer.recordAfeLatency(Status.OK);
      expect(fakeAfeLatency.record).not.toHaveBeenCalled();
    });

    it('should not record if metrics are disabled', () => {
      tracer.enabled = false;
      tracer.afeLatency = 123;
      tracer.recordAfeLatency(Status.OK);
      expect(fakeAfeLatency.record).not.toHaveBeenCalled();
    });
  });

  describe('recordGfeConnectivityErrorCount', () => {
    afterEach(() => {
      Spanner._resetAFEServerTimingForTest();
      process.env['SPANNER_DISABLE_AFE_SERVER_TIMING'] = 'false';
    });

    it('should increment AFE error counter if enabled', () => {
      tracer.enabled = true;
      tracer.recordAfeConnectivityErrorCount(Status.OK);
      expect(fakeAfeCounter.add).toHaveBeenCalledTimes(1);
    });

    it('should not increment if metrics are disabled', () => {
      tracer.enabled = false;
      tracer.recordAfeConnectivityErrorCount(Status.OK);
      expect(fakeAfeCounter.add).not.toHaveBeenCalled();
    });

    it('should not increment if AFE server timing is disabled', () => {
      tracer.enabled = true;
      Spanner._resetAFEServerTimingForTest();
      process.env['SPANNER_DISABLE_AFE_SERVER_TIMING'] = 'true';
      tracer.recordAfeConnectivityErrorCount(Status.OK);
      expect(fakeAfeCounter.add).not.toHaveBeenCalled();
    });
  });

  describe('extractGfeLatency & extractAfeLatency', () => {
    let tracer: MetricsTracer;
    beforeEach(() => {
      tracer = new MetricsTracer(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        true,
        DATABASE,
        INSTANCE,
        PROJECT_ID,
        METHOD,
        REQUEST,
      );
    });

    it('should extract afe and gfe latency from a valid server-timing header', () => {
      const header = 'gfet4t7; dur=123, afe; dur=30, other=value';
      const gfeLatency = tracer.extractGfeLatency(header);
      expect(gfeLatency).toBe(123);
      const afeLatency = tracer.extractAfeLatency(header);
      expect(afeLatency).toBe(30);
    });

    it('should return null if header is undefined', () => {
      const gfeLatency = tracer.extractGfeLatency(undefined as any);
      expect(gfeLatency).toBe(null);
      const afeLatency = tracer.extractAfeLatency(undefined as any);
      expect(afeLatency).toBe(null);
    });

    it('should return null if header does not match expected format', () => {
      const header = 'some-other-header';
      const gfeLatency = tracer.extractGfeLatency(header);
      expect(gfeLatency).toBe(null);
      const afeLatency = tracer.extractAfeLatency(header);
      expect(afeLatency).toBe(null);
    });

    it('should extract only the gfe latency if extra data is present', () => {
      const header = 'gfet4t7; dur=456; other=value';
      const gfeLatency = tracer.extractGfeLatency(header);
      expect(gfeLatency).toBe(456);
      const afeLatency = tracer.extractAfeLatency(header);
      expect(afeLatency).toBe(null);
    });

    it('should extract only the afe latency if extra data is present', () => {
      const header = 'other=value, afe; dur=30; ';
      const gfeLatency = tracer.extractGfeLatency(header);
      expect(gfeLatency).toBe(null);
      const afeLatency = tracer.extractAfeLatency(header);
      expect(afeLatency).toBe(30);
    });
  });
});
