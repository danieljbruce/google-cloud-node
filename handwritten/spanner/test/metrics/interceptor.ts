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

import {grpc} from "google-gax";
import {status as Status} from "@grpc/grpc-js";
import {MetricsTracerFactory} from "../../src/metrics/metrics-tracer-factory";
import {MetricsTracer} from "../../src/metrics/metrics-tracer";
import {MetricInterceptor} from "../../src/metrics/interceptor";

describe("MetricInterceptor", () => {
  let mockMetricsTracer: any;
  let mockFactory: any;
  let mockNextCall: jest.Mock;
  let mockInterceptingCall: any;
  let mockListener: any;
  let serverTimingMetadata: any;
  let emptyMetadata: any;
  let mockStatus: any;
  let mockOptions: any;
  let capturedListener: any;
  let testMetadata: grpc.Metadata;

  beforeEach(() => {
    // Mock MetricsTracer
    mockMetricsTracer = {
      recordAttemptStart: jest.fn(),
      recordAttemptCompletion: jest.fn(),
      extractGfeLatency: jest.fn((header: string) => {
        if (header === "gfet4t7; dur=90, afe; dur=30") {
          return 90;
        }
        return null;
      }),
      extractAfeLatency: jest.fn((header: string) => {
        if (header === "gfet4t7; dur=90, afe; dur=30") {
          return 30;
        }
        return null;
      }),
      recordGfeLatency: jest.fn(),
      recordAfeLatency: jest.fn(),
      recordGfeConnectivityErrorCount: jest.fn(),
      recordAfeConnectivityErrorCount: jest.fn(),
    };

    // Mock MetricsTracerFactory
    mockFactory = {
      getCurrentTracer: jest.fn().mockReturnValue(mockMetricsTracer),
    };
    jest.spyOn(MetricsTracerFactory, "getInstance").mockReturnValue(mockFactory);

    // Mock GRPC call components
    mockInterceptingCall = {
      start: jest.fn((metadata: grpc.Metadata, listener: grpc.Listener) => {
        capturedListener = listener;
      }),
    };

    mockNextCall = jest.fn().mockReturnValue(mockInterceptingCall);

    mockListener = {
      onReceiveMetadata: jest.fn(),
      onReceiveMessage: jest.fn(),
      onReceiveStatus: jest.fn(),
    };

    serverTimingMetadata = new grpc.Metadata();
    serverTimingMetadata.set("content-type", "application/grpc");
    serverTimingMetadata.set("date", "Thu, 19 Jun 2020 00:01:02 GMT");
    serverTimingMetadata.set("server-timing", "gfet4t7; dur=90, afe; dur=30");
    serverTimingMetadata.set(
      "alt-svc",
      "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
    );

    emptyMetadata = new grpc.Metadata();

    mockStatus = {
      code: Status.OK,
      details: "OK",
      metadata: new grpc.Metadata(),
    };

    mockOptions = {
      method_definition: {
        path: "/google.spanner.v1.Spanner/ExecuteSql",
      },
    };
    testMetadata = new grpc.Metadata();
    testMetadata.set(
      "google-cloud-resource-prefix",
      "projects/test-project/instances/instance/databases/database-1",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Metrics recorded from interceptor", () => {
    it("AttemptMetrics", () => {
      const interceptingCall = MetricInterceptor(mockOptions, mockNextCall);

      // Start recording attempt metrics at the beginning of the gRPC call
      interceptingCall.start(testMetadata, mockListener);
      expect(mockMetricsTracer.recordAttemptStart).toHaveBeenCalledTimes(1);
      expect(mockMetricsTracer.recordAttemptCompletion).toHaveBeenCalledTimes(0);

      capturedListener.onReceiveStatus(mockStatus);

      // Complete attempt recording when status is received back from the call
      expect(mockMetricsTracer.recordAttemptStart).toHaveBeenCalledTimes(1);
      expect(mockMetricsTracer.recordAttemptCompletion).toHaveBeenCalledTimes(1);
    });

    it("GFE Metrics - Latency", () => {
      const interceptingCall = MetricInterceptor(mockOptions, mockNextCall);
      interceptingCall.start(testMetadata, mockListener);

      // duration value from the header's gfet4t7 value should be recorded as GFE latency
      capturedListener.onReceiveMetadata(serverTimingMetadata);
      capturedListener.onReceiveStatus(mockStatus);
      expect(mockMetricsTracer.recordGfeLatency).toHaveBeenCalledTimes(1);
      expect(mockMetricsTracer.recordGfeLatency).toHaveBeenCalledWith(Status.OK);
      expect(mockMetricsTracer.recordGfeConnectivityErrorCount).toHaveBeenCalledTimes(0);
    });

    it("AFE Metrics - Latency", () => {
      const interceptingCall = MetricInterceptor(mockOptions, mockNextCall);
      interceptingCall.start(testMetadata, mockListener);

      // duration value from the header's afe value should be recorded as AFE latency
      capturedListener.onReceiveMetadata(serverTimingMetadata);
      capturedListener.onReceiveStatus(mockStatus);
      expect(mockMetricsTracer.recordAfeLatency).toHaveBeenCalledTimes(1);
      expect(mockMetricsTracer.recordAfeLatency).toHaveBeenCalledWith(Status.OK);
      expect(mockMetricsTracer.recordAfeConnectivityErrorCount).toHaveBeenCalledTimes(0);
    });

    it("GFE Metrics - Connectivity Error Count", () => {
      const interceptingCall = MetricInterceptor(mockOptions, mockNextCall);
      interceptingCall.start(testMetadata, mockListener);

      // Calls received without latency values should increase connectivity error count
      capturedListener.onReceiveMetadata(emptyMetadata);
      capturedListener.onReceiveStatus(mockStatus);
      expect(mockMetricsTracer.recordGfeLatency).toHaveBeenCalledTimes(0);
      expect(mockMetricsTracer.recordGfeConnectivityErrorCount).toHaveBeenCalledTimes(1);
      expect(mockMetricsTracer.recordGfeConnectivityErrorCount).toHaveBeenCalledWith(Status.OK);
    });

    it("AFE Metrics - Connectivity Error Count", () => {
      const interceptingCall = MetricInterceptor(mockOptions, mockNextCall);
      interceptingCall.start(testMetadata, mockListener);

      // Calls received without latency values should increase connectivity error count
      capturedListener.onReceiveMetadata(emptyMetadata);
      capturedListener.onReceiveStatus(mockStatus);
      expect(mockMetricsTracer.recordAfeLatency).toHaveBeenCalledTimes(0);
      expect(mockMetricsTracer.recordAfeConnectivityErrorCount).toHaveBeenCalledTimes(1);
      expect(mockMetricsTracer.recordAfeConnectivityErrorCount).toHaveBeenCalledWith(Status.OK);
    });
  });
});
