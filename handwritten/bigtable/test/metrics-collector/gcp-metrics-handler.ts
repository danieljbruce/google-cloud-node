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

import {ResourceMetrics} from '@opentelemetry/sdk-metrics';
import {
  ExportResult,
  metricsToRequest,
} from '../../src/client-side-metrics/exporter';
import {MetricExporter} from '@google-cloud/opentelemetry-cloud-monitoring-exporter';
import {expectedRequestsHandled} from '../../test-common/metrics-handler-fixture';
import {
  OnAttemptCompleteData,
  OnOperationCompleteData,
} from '../../src/client-side-metrics/metrics-handler';
import {
  expectedOtelExportConvertedValue,
  expectedOtelExportInput,
} from '../../test-common/expected-otel-export-input';
import {replaceTimestamps} from '../../test-common/replace-timestamps';

jest.mock('../../src/client-side-metrics/exporter', () => {
  const actual = jest.requireActual('../../src/client-side-metrics/exporter');
  const {MetricExporter} = require('@google-cloud/opentelemetry-cloud-monitoring-exporter');
  class TestExporter extends MetricExporter {
    export(metrics: any, resultCallback: any): void {
      if ((global as any).mockExportCallback) {
        (global as any).mockExportCallback(metrics, resultCallback);
      } else {
        resultCallback({code: 0});
      }
    }
  }
  return {
    ...actual,
    CloudMonitoringExporter: TestExporter,
  };
});

jest.mock('@opentelemetry/sdk-metrics', () => {
  const sdkMetrics = jest.requireActual('@opentelemetry/sdk-metrics');
  class FastPeriodicExportingMetricReader extends sdkMetrics.PeriodicExportingMetricReader {
    constructor(options: any) {
      super({
        ...options,
        exportIntervalMillis: 1000,
      });
    }
  }
  return {
    ...sdkMetrics,
    PeriodicExportingMetricReader: FastPeriodicExportingMetricReader,
  };
});

import {GCPMetricsHandler} from '../../src/client-side-metrics/gcp-metrics-handler';

/**
 * Cleans a ResourceMetrics object by replacing client UUIDs with a placeholder.
 *
 * This function creates a deep copy of the input ResourceMetrics object and
 * then iterates through its metrics, replacing any existing client_uid attribute
 * in the data points with the string 'fake-uuid'.  This is primarily used in
 * testing to ensure consistent metric output by removing the variability of
 * randomly generated client UUIDs.
 *
 * @param {ResourceMetrics} metrics The ResourceMetrics object to clean.
 * @returns {ResourceMetrics} A new ResourceMetrics object with client UUIDs replaced by 'fake-uuid'.
 */
function cleanMetrics(metrics: ResourceMetrics): ResourceMetrics {
  const newMetrics = JSON.parse(JSON.stringify(metrics)); // Deep copy to avoid modifying the original object

  if (newMetrics.resource && newMetrics.resource._attributes) {
    newMetrics.resource._attributes = {
      'service.name': 'Cloud Bigtable Table',
      'telemetry.sdk.language': 'nodejs',
      'telemetry.sdk.name': 'opentelemetry',
      'telemetry.sdk.version': '1.30.1',
    };
  }

  newMetrics.scopeMetrics.forEach((scopeMetric: any) => {
    scopeMetric.metrics.forEach((metric: any) => {
      if (metric.dataPoints) {
        metric.dataPoints.forEach((dataPoint: any) => {
          if (dataPoint.attributes && dataPoint.attributes.client_uid) {
            dataPoint.attributes.client_uid = 'fake-uuid';
          }
        });
      }
    });
  });

  return newMetrics;
}

describe('Bigtable/GCPMetricsHandler', () => {
  it('Should export a value ready for sending to the CloudMonitoringExporter', done => {
    /*
    We need to create a timeout here because if we don't then mocha shuts down
    the test as it is sleeping before the GCPMetricsHandler has a chance to
    export the data.
     */
    const timeout = setTimeout(() => {}, 120000);
    /*
    The exporter is called every x seconds, but we only want to test the value
    it receives once. Since done cannot be called multiple times in mocha,
    exporter ensures we only test the value export receives one time.
    */
    let exported = false;

    (global as any).mockExportCallback = (
      metrics: ResourceMetrics,
      resultCallback: (result: ExportResult) => void,
    ) => {
      if (!exported) {
        exported = true;
        try {
          metrics = cleanMetrics(metrics);
          replaceTimestamps(
            metrics as unknown as typeof expectedOtelExportInput,
            [123, 789],
            [456, 789],
          );
          const parsedExportInput: ResourceMetrics = JSON.parse(
            JSON.stringify(metrics),
          );
          expect(parsedExportInput.scopeMetrics[0].metrics.length).toBe(
            expectedOtelExportInput.scopeMetrics[0].metrics.length,
          );
          for (
            let index = 0;
            index < parsedExportInput.scopeMetrics[0].metrics.length;
            index++
          ) {
            expect(parsedExportInput.scopeMetrics[0].metrics[index]).toEqual(
              expectedOtelExportInput.scopeMetrics[0].metrics[index],
            );
          }
          expect(JSON.parse(JSON.stringify(metrics))).toEqual(
            expectedOtelExportInput,
          );
          const convertedRequest = metricsToRequest(parsedExportInput);
          expect(convertedRequest.timeSeries.length).toBe(
            expectedOtelExportConvertedValue.timeSeries.length,
          );
          for (
            let index = 0;
            index < convertedRequest.timeSeries.length;
            index++
          ) {
            expect(convertedRequest.timeSeries[index]).toEqual(
              expectedOtelExportConvertedValue.timeSeries[index],
            );
          }
          clearTimeout(timeout);
          resultCallback({code: 0});
          done();
        } catch (e) {
          done(e);
        }
      } else {
        resultCallback({code: 0});
      }
    };

    const handler = new GCPMetricsHandler('my-project' as any);

    for (const request of expectedRequestsHandled) {
      if (request.attemptLatency) {
        handler.onAttemptComplete(request as OnAttemptCompleteData);
      } else {
        handler.onOperationComplete(request as OnOperationCompleteData);
      }
    }
  });
});
