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

import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as Constants from "../../src/metrics/constants";
import {MetricsTracerFactory} from "../../src/metrics/metrics-tracer-factory";
import {CloudMonitoringMetricsExporter} from "../../src/metrics/spanner-metrics-exporter";

describe("MetricsTracerFactory", () => {
  let mockExporter: CloudMonitoringMetricsExporter;
  let recordAttemptLatencyStub: jest.Mock;
  let addAttemptCounterStub: jest.Mock;
  let recordOperationLatencyStub: jest.Mock;
  let addOperationCounterStub: jest.Mock;
  let recordGfeLatencyStub: jest.Mock;
  let addGfeConnectivityErrorCountStub: jest.Mock;

  beforeAll(() => {
    recordAttemptLatencyStub = jest.fn();
    addAttemptCounterStub = jest.fn();
    recordOperationLatencyStub = jest.fn();
    addOperationCounterStub = jest.fn();
    recordGfeLatencyStub = jest.fn();
    addGfeConnectivityErrorCountStub = jest.fn();

    const meterStub = {
      createHistogram: jest.fn((name: string) => {
        if (name === Constants.METRIC_NAME_ATTEMPT_LATENCIES) return {record: recordAttemptLatencyStub};
        if (name === Constants.METRIC_NAME_OPERATION_LATENCIES) return {record: recordOperationLatencyStub};
        if (name === Constants.METRIC_NAME_GFE_LATENCIES) return {record: recordGfeLatencyStub};
        return {record: jest.fn()};
      }),
      createCounter: jest.fn((name: string) => {
        if (name === Constants.METRIC_NAME_ATTEMPT_COUNT) return {add: addAttemptCounterStub};
        if (name === Constants.METRIC_NAME_OPERATION_COUNT) return {add: addOperationCounterStub};
        if (name === Constants.METRIC_NAME_GFE_CONNECTIVITY_ERROR_COUNT) return {add: addGfeConnectivityErrorCountStub};
        return {add: jest.fn()};
      }),
    };

    jest.spyOn(MeterProvider.prototype, "getMeter").mockReturnValue(meterStub as any);

    mockExporter = {
      export: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(undefined),
      forceFlush: jest.fn().mockResolvedValue(undefined),
    } as any;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await MetricsTracerFactory.resetInstance();
  });

  beforeEach(async () => {
    MetricsTracerFactory.enabled = true;
    jest.clearAllMocks();
    await MetricsTracerFactory.resetInstance();
    const provider =
      MetricsTracerFactory.getInstance("project-id")!.getMeterProvider();
    const reader = new PeriodicExportingMetricReader({
      exporter: mockExporter,
      exportIntervalMillis: 60000,
    });
    provider.addMetricReader(reader);
  });

  afterEach(async () => {
    await MetricsTracerFactory.resetInstance();
  });

  it("should use the set meter provider", async () => {
    const factory = MetricsTracerFactory.getInstance("project-id");
    const tracer = factory!.createMetricsTracer(
      "some-method",
      "projects/project/instances/instance/databases/database",
      "1.1a2bc3d4.1.1.1.1",
    );

    const operations = 3;
    const attempts = 5;
    for (let i = 0; i < operations; i++) {
      tracer!.recordOperationStart();
      for (let j = 0; j < attempts; j++) {
        tracer!.recordAttemptStart();
        // Simulate processing time during attempt
        await new Promise(resolve => {
          setTimeout(resolve, 50);
        });
        tracer!.recordAttemptCompletion();
      }
      tracer!.recordOperationCompletion();
    }

    expect(recordOperationLatencyStub).toHaveBeenCalledWith(expect.any(Number), expect.any(Object));
    expect(recordOperationLatencyStub).toHaveBeenCalledTimes(operations);

    expect(recordAttemptLatencyStub).toHaveBeenCalledWith(expect.any(Number), expect.any(Object));
    expect(recordAttemptLatencyStub).toHaveBeenCalledTimes(
      operations * attempts,
    );
  });

  it("should initialize metric instruments when enabled", () => {
    const factory = MetricsTracerFactory.getInstance("project-id");

    expect(factory!.instrumentAttemptLatency).toEqual({
      record: recordAttemptLatencyStub,
    });
    expect(factory!.instrumentAttemptCounter).toEqual({
      add: addAttemptCounterStub,
    });
    expect(factory!.instrumentOperationLatency).toEqual({
      record: recordOperationLatencyStub,
    });
    expect(factory!.instrumentOperationCounter).toEqual({
      add: addOperationCounterStub,
    });
    expect(factory!.instrumentGfeLatency).toEqual({
      record: recordGfeLatencyStub,
    });
    expect(factory!.instrumentGfeConnectivityErrorCount).toEqual({
      add: addGfeConnectivityErrorCountStub,
    });
  });

  it("should create a MetricsTracer instance", () => {
    const factory = MetricsTracerFactory.getInstance("project-id");
    const tracer = factory!.createMetricsTracer(
      "some-method",
      "method-name",
      "1.1a2bc3d4.1.1.1.1",
    );
    expect(tracer).toBeTruthy();
  });

  it("should clear a MetricsTracer using an extracted operation request id", () => {
    const factory = MetricsTracerFactory.getInstance("project-id");
    factory!.createMetricsTracer(
      "some-method",
      "method-name",
      "1.1a2bc3d4.1.1.1.1",
    );

    expect((factory as any)._currentOperationTracers.size).toBe(1);

    factory!.clearCurrentTracer("1.1a2bc3d4.1.1.1");

    expect((factory as any)._currentOperationTracers.size).toBe(0);
    expect((factory as any)._currentOperationLastUpdatedMs.size).toBe(0);
  });

  it("should correctly set default attributes", () => {
    const factory = MetricsTracerFactory.getInstance("project-id");
    const tracer = factory!.createMetricsTracer(
      "test-method",
      "projects/project/instances/instance/databases/database",
      "1.1a2bc3d4.1.1.1.1",
    );
    expect(
      tracer!.clientAttributes[Constants.METRIC_LABEL_KEY_DATABASE],
    ).toBe("database");
    expect(
      tracer!.clientAttributes[Constants.METRIC_LABEL_KEY_METHOD],
    ).toBe("test-method");
    expect(
      tracer!.clientAttributes[Constants.MONITORED_RES_LABEL_KEY_INSTANCE],
    ).toBe("instance");
  });
});

describe("getInstanceAttributes", () => {
  let factory: MetricsTracerFactory;
  beforeEach(() => {
    factory = new (MetricsTracerFactory as any)();
  });

  afterEach(async () => {
    await factory.resetMeterProvider();
    clearInterval(factory["_intervalTracerCleanup"]);
  });

  it("should extract project, instance, and database from full resource path", () => {
    const formattedName = "projects/proj1/instances/inst1/databases/db1";
    const attrs = factory.getInstanceAttributes(formattedName);
    expect(attrs).toEqual({
      project: "proj1",
      instance: "inst1",
      database: "db1",
    });
  });

  it("should extract project and instance, and unknown database if database is missing", () => {
    const formattedName = "projects/proj2/instances/inst2";
    const attrs = factory.getInstanceAttributes(formattedName);
    expect(attrs).toEqual({
      project: "proj2",
      instance: "inst2",
      database: "unknown",
    });
  });

  it("should return unknown strings for all if input is empty", () => {
    const attrs = factory.getInstanceAttributes("");
    expect(attrs).toEqual({
      project: "unknown",
      instance: "unknown",
      database: "unknown",
    });
  });

  it("should return unknown strings for all if input is malformed", () => {
    const attrs = factory.getInstanceAttributes("foo/bar/baz");
    expect(attrs).toEqual({
      project: "unknown",
      instance: "unknown",
      database: "unknown",
    });
  });
});

describe("MetricsTracerFactory with set clock", () => {
  beforeEach(async () => {
    MetricsTracerFactory.enabled = true;
    await MetricsTracerFactory.resetInstance();
    // Use fake timers to control the clock
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Restore the real timers
    jest.useRealTimers();
  });

  describe("_cleanMetricTracers", () => {
    it("should prune stale tracers", () => {
      const factory = MetricsTracerFactory.getInstance("test-project");
      expect(factory).toBeTruthy();

      factory!.createMetricsTracer(
        "method1",
        "projects/p/instances/i/databases/d",
        "1.1a2b3c.1.1.1.1",
      );

      // Advance the clock to make the tracer stale
      jest.advanceTimersByTime(Constants.TRACER_CLEANUP_THRESHOLD_MS);

      // Add another tracer to trigger pruning
      factory!.createMetricsTracer(
        "method2",
        "projects/p/instances/i/databases/d",
        "2.1a2b3c.1.1.1.1",
      );
      // Only most recent tracer should remain
      expect(factory!["_currentOperationTracers"].size).toBe(1);
      expect(factory!["_currentOperationTracers"].has("2.1a2b3c.1.1.1")).toBeTruthy();
    });

    it("should not prune recent tracers", () => {
      const factory = MetricsTracerFactory.getInstance("test-project");
      expect(factory).toBeTruthy();

      factory!.createMetricsTracer(
        "method1",
        "projects/p/instances/i/databases/d",
        "1.1a2b3c.1.1.1.1",
      );

      // Advance the clock, but not enough to hit the threshold
      jest.advanceTimersByTime(Constants.TRACER_CLEANUP_INTERVAL_MS);

      // Add another tracer to trigger pruning
      factory!.createMetricsTracer(
        "method2",
        "projects/p/instances/i/databases/d",
        "2.1a2b3c.1.1.1.1",
      );

      // Both tracers should be available
      expect(factory!["_currentOperationTracers"].size).toBe(2);
      expect(factory!["_currentOperationTracers"].has("1.1a2b3c.1.1.1")).toBeTruthy();
      expect(factory!["_currentOperationTracers"].has("2.1a2b3c.1.1.1")).toBeTruthy();
    });
  });
});
