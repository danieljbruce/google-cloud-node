// Copyright 2025 Google LLC
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

import {grpc} from 'google-gax';
import * as mock from '../mockserver/mockspanner';
import {MockError, SimulatedExecutionTime} from '../mockserver/mockspanner';
import {Database, Instance, Spanner} from '../../src';
import {MetricsTracerFactory} from '../../src/metrics/metrics-tracer-factory';
import {MetricsTracer} from '../../src/metrics/metrics-tracer';
import {MetricReader} from '@opentelemetry/sdk-metrics';
import {CloudMonitoringMetricsExporter} from '../../src/metrics/spanner-metrics-exporter';
import {
  METRIC_NAME_OPERATION_LATENCIES,
  METRIC_NAME_ATTEMPT_LATENCIES,
  METRIC_NAME_OPERATION_COUNT,
  METRIC_NAME_ATTEMPT_COUNT,
  METRIC_NAME_GFE_LATENCIES,
  METRIC_NAME_GFE_CONNECTIVITY_ERROR_COUNT,
  METRIC_NAME_AFE_LATENCIES,
  METRIC_NAME_AFE_CONNECTIVITY_ERROR_COUNT,
} from '../../src/metrics/constants';

describe('Test metrics with mock server', () => {
  let instance: Instance;
  let spanner: Spanner;
  let port: number;
  let dbCounter = 0;
  const selectSql = 'SELECT NUM, NAME FROM NUMBERS';
  const server = new grpc.Server();
  const spannerMock = mock.createMockSpanner(server);
  const PROJECT_ID = 'test-project';

  class InMemoryMetricReader extends MetricReader {
    protected async onForceFlush(): Promise<void> {}
    protected async onShutdown(): Promise<void> {}
  }

  function newTestDatabase(): Database {
    return instance.database(`database-${++dbCounter}`, undefined);
  }

  function assertApprox(expected: number, actual: number, delta: number) {
    expect(Math.abs(expected - actual)).toBeLessThanOrEqual(Math.max(delta, 500));
  }

  function compareAttributes(expected: object, actual: object): boolean {
    // Check that all expected keys match in actual
    for (const key of Object.keys(expected)) {
      if ((actual as any)[key] !== (expected as any)[key]) {
        return false;
      }
    }
    // Check that actual does not contain extra keys
    for (const key of Object.keys(actual)) {
      // Check if the key in 'actual' is not present in 'expected'
      if (!Object.prototype.hasOwnProperty.call(expected, key)) {
        return false;
      }
    }
    return true;
  }

  function getMetricData(resourceMetrics, metricName: string) {
    const filteredMetrics = resourceMetrics.scopeMetrics.flatMap(scopeMetric =>
      scopeMetric.metrics.filter(
        metric => metric.descriptor.name === metricName,
      ),
    );
    expect(filteredMetrics.length > 0).toBeTruthy();
    expect(filteredMetrics.length).toBe(1);
    return filteredMetrics[0];
  }

  function hasMetricData(resourceMetrics, metricName: string): boolean {
    const filteredMetrics = resourceMetrics.scopeMetrics.flatMap(scopeMetric =>
      scopeMetric.metrics.filter(
        metric => metric.descriptor.name === metricName,
      ),
    );
    return filteredMetrics.length > 0;
  }

  function getAggregatedValue(metricsData: any, attributes: any) {
    const dataPoint = metricsData.dataPoints.filter(dp =>
      compareAttributes(dp.attributes, attributes),
    );
    expect(dataPoint.length).toBe(1);
    switch (metricsData.descriptor.type) {
      case 'HISTOGRAM':
        return dataPoint[0].value.sum / dataPoint[0].value.count;
      case 'COUNTER':
        return dataPoint[0].value;
      default:
        return 0;
    }
  }

  async function setupMockSpanner() {
    port = await new Promise((resolve, reject) => {
      server.bindAsync(
        '0.0.0.0:0',
        grpc.ServerCredentials.createInsecure(),
        (err, assignedPort) => {
          if (err) {
            reject(err);
          } else {
            resolve(assignedPort);
          }
        },
      );
    });
    spannerMock.putStatementResult(
      selectSql,
      mock.StatementResult.resultSet(mock.createSimpleResultSet()),
    );
    jest.spyOn(MetricsTracerFactory as any, '_detectClientLocation').mockResolvedValue('test-location');
    await MetricsTracerFactory.resetInstance();
    process.env['SPANNER_DISABLE_BUILTIN_METRICS'] = 'false';
    await MetricsTracerFactory.resetInstance();
    MetricsTracerFactory.enabled = true;
    spanner = new Spanner({
      projectId: PROJECT_ID,
      servicePath: 'localhost',
      port,
      sslCreds: grpc.credentials.createInsecure(),
    });
    (spanner as any)._metricsEnabled = true;
    instance = spanner.instance('instance');
  }

  beforeAll(async () => {
    await MetricsTracerFactory.resetInstance();
    await setupMockSpanner();
  });

  afterAll(async () => {
    await spanner.close();
    server.tryShutdown(() => {});
    jest.restoreAllMocks();
    await MetricsTracerFactory.resetInstance();
    MetricsTracerFactory.enabled = false;
  });

  describe('With InMemMetricReader', () => {
    let reader: InMemoryMetricReader;
    let factory: MetricsTracerFactory | null;
    let gfeStub;
    let afeStub;
    let exporterStub;
    const MIN_LATENCY = 0;
    const commonAttributes = {
      instance_id: 'instance',
      status: 'OK',
    };

    beforeAll(() => {
      exporterStub = jest.spyOn(
        CloudMonitoringMetricsExporter.prototype,
        'export',
      ).mockImplementation(() => {});
    });

    afterAll(async () => {
      exporterStub.mockRestore();
    });

    beforeEach(async function () {
      // Increase the timeout because the MeterProvider shutdown exceed
      // the default 10s timeout.
      jest.setTimeout(50000);
      spannerMock.resetRequests();
      spannerMock.removeExecutionTimes();
      // Reset the MetricsFactoryReader to an in-memory reader for the tests
      MetricsTracerFactory.enabled = true;
      factory = MetricsTracerFactory.getInstance(PROJECT_ID);
      await factory!.resetMeterProvider();
      reader = new InMemoryMetricReader();
      factory!.getMeterProvider([reader]);
    });

    afterEach(async () => {
      gfeStub?.mockRestore();
      afeStub?.mockRestore();
      await factory?.resetMeterProvider();
      await MetricsTracerFactory.resetInstance();
    });

    it('should have correct latency values in metrics', async () => {
      gfeStub = jest.spyOn(MetricsTracer.prototype, 'extractGfeLatency').mockImplementation(() => 123);
      afeStub = jest.spyOn(MetricsTracer.prototype, 'extractAfeLatency').mockImplementation(() => 30);
      const database = newTestDatabase();
      const startTime = new Date();
      await database.run(selectSql);
      const endTime = new Date();

      const elapsedTime = endTime.valueOf() - startTime.valueOf();

      const methods = ['createSession', 'executeStreamingSql'];

      const {resourceMetrics} = await reader.collect();
      const operationCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_COUNT,
      );
      const gfeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_LATENCIES,
      );
      const afeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_LATENCIES,
      );
      const attemptCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_COUNT,
      );
      const operationLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_LATENCIES,
      );
      const attemptLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_LATENCIES,
      );

      let totalOperationLatency = 0;
      methods.forEach(method => {
        const attributes = {
          ...commonAttributes,
          database: `database-${dbCounter}`,
          method: method,
        };
        const operationCount = getAggregatedValue(
          operationCountData,
          attributes,
        );
        expect(operationCount).toBe(1);

        const attemptCount = getAggregatedValue(attemptCountData, attributes);
        expect(attemptCount).toBe(1);

        const operationLatency = getAggregatedValue(
          operationLatenciesData,
          attributes,
        );
        totalOperationLatency += operationLatency;

        const attemptLatency = getAggregatedValue(
          attemptLatenciesData,
          attributes,
        );
        // Since we only have one attempt, the attempt latency should be fairly close to the operation latency
        assertApprox(operationLatency, attemptLatency, 30);

        const gfeLatency = getAggregatedValue(gfeLatenciesData, attributes);
        expect(gfeLatency).toBe(123);

        const afeLatency = getAggregatedValue(afeLatenciesData, attributes);
        expect(afeLatency).toBe(30);
      });

      // check that the latency matches up with the measured elapsed time within 10ms
      assertApprox(elapsedTime, totalOperationLatency, 10);

      // Make sure no GFE/AFE connectivity errors ar emitted since we got GFE latencies
      const gfeMissingData = hasMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_CONNECTIVITY_ERROR_COUNT,
      );
      const afeMissingData = hasMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_CONNECTIVITY_ERROR_COUNT,
      );

      expect(gfeMissingData).toBeFalsy();
      expect(afeMissingData).toBeFalsy();

      await database.close();
    });

    it('should increase attempts on retries', async () => {
      gfeStub = jest.spyOn(MetricsTracer.prototype, 'extractGfeLatency').mockImplementation(() => 123);
      afeStub = jest.spyOn(MetricsTracer.prototype, 'extractAfeLatency').mockImplementation(() => 30);
      const database = newTestDatabase();
      const err = {
        message: 'Temporary unavailable',
        code: grpc.status.UNAVAILABLE,
      } as MockError;
      spannerMock.setExecutionTime(
        spannerMock.executeStreamingSql,
        SimulatedExecutionTime.ofError(err),
      );

      await database.run(selectSql);
      const {resourceMetrics} = await reader.collect();

      const operationCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_COUNT,
      );
      const attemptCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_COUNT,
      );
      const operationLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_LATENCIES,
      );
      const attemptLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_LATENCIES,
      );
      const gfeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_LATENCIES,
      );
      const afeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_LATENCIES,
      );

      const sessionAttributes = {
        ...commonAttributes,
        database: `database-${dbCounter}`,
        method: 'createSession',
      };
      // Verify batchCreateSession metrics are unaffected
      expect(getAggregatedValue(operationCountData, sessionAttributes)).toBe(1);
      getAggregatedValue(operationLatenciesData, sessionAttributes);
      expect(getAggregatedValue(attemptCountData, sessionAttributes)).toBe(1);
      getAggregatedValue(attemptLatenciesData, sessionAttributes);
      expect(getAggregatedValue(gfeLatenciesData, sessionAttributes)).toBe(123);
      expect(getAggregatedValue(afeLatenciesData, sessionAttributes)).toBe(30);

      const executeAttributes = {
        ...commonAttributes,
        database: `database-${dbCounter}`,
        method: 'executeStreamingSql',
      };
      const executeUnavailableAttributes = {
        ...commonAttributes,
        database: `database-${dbCounter}`,
        method: 'executeStreamingSql',
        status: 'UNAVAILABLE',
      };
      // Verify executeStreamingSql has 2 attempts and 1 operation
      expect(getAggregatedValue(operationCountData, executeAttributes)).toBe(1);
      getAggregatedValue(operationLatenciesData, executeAttributes);
      expect(getAggregatedValue(attemptCountData, executeAttributes)).toBe(1);
      expect(getAggregatedValue(attemptCountData, executeUnavailableAttributes)).toBe(1);
      getAggregatedValue(attemptLatenciesData, executeAttributes);
      expect(getAggregatedValue(gfeLatenciesData, executeAttributes)).toBe(123);
      expect(getAggregatedValue(afeLatenciesData, executeAttributes)).toBe(30);
    });

    it('should create connectivity error count metric if GFE/AFE latency is not in header', async () => {
      gfeStub = jest.spyOn(MetricsTracer.prototype, 'extractGfeLatency').mockImplementation(() => null as any);
      afeStub = jest.spyOn(MetricsTracer.prototype, 'extractAfeLatency').mockImplementation(() => null as any);
      const database = newTestDatabase();
      await database.run(selectSql);
      const {resourceMetrics} = await reader.collect();

      const operationCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_COUNT,
      );
      const attemptCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_COUNT,
      );
      const operationLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_LATENCIES,
      );
      const attemptLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_LATENCIES,
      );
      const connectivityErrorCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_CONNECTIVITY_ERROR_COUNT,
      );
      const afeConnectivityErrorCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_CONNECTIVITY_ERROR_COUNT,
      );

      // Verify GFE AFE latency doesn't exist
      expect(hasMetricData(resourceMetrics, METRIC_NAME_GFE_LATENCIES)).toBeFalsy();
      expect(hasMetricData(resourceMetrics, METRIC_NAME_AFE_LATENCIES)).toBeFalsy();
      const methods = ['createSession', 'executeStreamingSql'];
      methods.forEach(method => {
        const attributes = {
          ...commonAttributes,
          database: `database-${dbCounter}`,
          method: method,
        };
        // Verify attempt and operational metrics are unaffected
        expect(getAggregatedValue(operationCountData, attributes)).toBe(1);
        getAggregatedValue(operationLatenciesData, attributes);
        expect(getAggregatedValue(attemptCountData, attributes)).toBe(1);
        getAggregatedValue(attemptLatenciesData, attributes);

        // Verify that GFE AFE connectivity error count increased
        expect(getAggregatedValue(connectivityErrorCountData, attributes)).toBe(1);
        expect(getAggregatedValue(afeConnectivityErrorCountData, attributes)).toBe(1);
      });
    });

    it('should increase attempts on retries for non streaming calls with gax options', async () => {
      gfeStub = jest.spyOn(MetricsTracer.prototype, 'extractGfeLatency').mockImplementation(() => 123);
      afeStub = jest.spyOn(MetricsTracer.prototype, 'extractAfeLatency').mockImplementation(() => 30);
      const database = newTestDatabase();
      const err = {
        message: 'Temporary unavailable',
        code: grpc.status.UNAVAILABLE,
      } as MockError;
      spannerMock.setExecutionTime(
        spannerMock.commit,
        SimulatedExecutionTime.ofError(err),
      );

      const GAX_OPTIONS = {
        retry: {
          retryCodes: [4, 8, 14],
          backoffSettings: {
            initialRetryDelayMillis: 1000,
            retryDelayMultiplier: 1.3,
            maxRetryDelayMillis: 32000,
            initialRpcTimeoutMillis: 60000,
            rpcTimeoutMultiplier: 1,
            maxRpcTimeoutMillis: 60000,
            totalTimeoutMillis: 600000,
          },
        },
      };
      await database.runTransactionAsync(async tx => {
        await tx.run(selectSql);
        // Commit RPC will be retried by GAX
        await tx.commit({gaxOptions: GAX_OPTIONS});
      });

      const {resourceMetrics} = await reader.collect();

      const operationCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_COUNT,
      );
      // Attempt count is correct here but status of attempts are not correct
      const attemptCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_COUNT,
      );
      const operationLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_LATENCIES,
      );
      const attemptLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_LATENCIES,
      );
      const gfeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_LATENCIES,
      );
      const afeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_LATENCIES,
      );

      const sessionAttributes = {
        ...commonAttributes,
        database: `database-${dbCounter}`,
        method: 'createSession',
      };
      // Verify createSession metrics are unaffected
      expect(getAggregatedValue(operationCountData, sessionAttributes)).toBe(1);
      expect(getAggregatedValue(operationLatenciesData, sessionAttributes)).toBeTruthy();
      expect(getAggregatedValue(attemptCountData, sessionAttributes)).toBe(1);
      expect(getAggregatedValue(attemptLatenciesData, sessionAttributes)).toBeTruthy();
      expect(getAggregatedValue(gfeLatenciesData, sessionAttributes)).toBe(123);
      expect(getAggregatedValue(afeLatenciesData, sessionAttributes)).toBe(30);

      const executeAttributes = {
        ...commonAttributes,
        database: `database-${dbCounter}`,
        method: 'executeStreamingSql',
      };

      // Verify executeStreamingSql metrics are unaffected
      expect(getAggregatedValue(operationCountData, executeAttributes)).toBe(1);
      expect(getAggregatedValue(operationLatenciesData, executeAttributes)).toBeTruthy();
      expect(getAggregatedValue(attemptCountData, executeAttributes)).toBe(1);
      expect(getAggregatedValue(attemptLatenciesData, executeAttributes)).toBeTruthy();
      expect(getAggregatedValue(gfeLatenciesData, executeAttributes)).toBe(123);
      expect(getAggregatedValue(afeLatenciesData, executeAttributes)).toBe(30);

      // Verify that commit metrics have 2 attempts and 1 operation
      const commitOkAttributes = {
        ...commonAttributes,
        database: `database-${dbCounter}`,
        method: 'commit',
      };
      const commitUnavailableAttributes = {
        ...commitOkAttributes,
        status: 'UNAVAILABLE',
      };

      expect(getAggregatedValue(operationCountData, commitOkAttributes)).toBe(1);
      expect(getAggregatedValue(operationLatenciesData, commitOkAttributes)).toBeTruthy();
      expect(getAggregatedValue(attemptCountData, commitOkAttributes)).toBe(1);
      expect(getAggregatedValue(attemptCountData, commitUnavailableAttributes)).toBe(1);
      expect(getAggregatedValue(attemptLatenciesData, commitOkAttributes)).toBeTruthy();
      expect(getAggregatedValue(attemptLatenciesData, commitUnavailableAttributes)).toBeTruthy();
      expect(getAggregatedValue(gfeLatenciesData, commitOkAttributes)).toBe(123);
      expect(getAggregatedValue(afeLatenciesData, commitOkAttributes)).toBe(30);
    });

    it('should have correct latency values in metrics except AFE when AFE Server timing is disabled', async () => {
      Spanner._resetAFEServerTimingForTest();
      process.env['SPANNER_DISABLE_AFE_SERVER_TIMING'] = 'true';
      gfeStub = jest.spyOn(MetricsTracer.prototype, 'extractGfeLatency').mockImplementation(() => 123);
      afeStub = jest.spyOn(MetricsTracer.prototype, 'extractAfeLatency').mockImplementation(() => 30);
      const database = newTestDatabase();
      const startTime = new Date();
      await database.run(selectSql);
      const endTime = new Date();

      const elapsedTime = endTime.valueOf() - startTime.valueOf();

      const methods = ['createSession', 'executeStreamingSql'];

      const {resourceMetrics} = await reader.collect();
      const operationCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_COUNT,
      );
      const gfeLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_LATENCIES,
      );
      const attemptCountData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_COUNT,
      );
      const operationLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_OPERATION_LATENCIES,
      );
      const attemptLatenciesData = getMetricData(
        resourceMetrics,
        METRIC_NAME_ATTEMPT_LATENCIES,
      );

      let totalOperationLatency = 0;
      methods.forEach(method => {
        const attributes = {
          ...commonAttributes,
          database: `database-${dbCounter}`,
          method: method,
        };
        const operationCount = getAggregatedValue(
          operationCountData,
          attributes,
        );
        expect(operationCount).toBe(1);

        const attemptCount = getAggregatedValue(attemptCountData, attributes);
        expect(attemptCount).toBe(1);

        const operationLatency = getAggregatedValue(
          operationLatenciesData,
          attributes,
        );
        totalOperationLatency += operationLatency;

        const attemptLatency = getAggregatedValue(
          attemptLatenciesData,
          attributes,
        );
        // Since we only have one attempt, the attempt latency should be fairly close to the operation latency
        assertApprox(operationLatency, attemptLatency, 30);

        const gfeLatency = getAggregatedValue(gfeLatenciesData, attributes);
        expect(gfeLatency).toBe(123);
      });

      // check that the latency matches up with the measured elapsed time within 10ms
      assertApprox(elapsedTime, totalOperationLatency, 10);

      // Make sure no GFE connectivity errors are not emitted since we got GFE latencies
      const gfeMissingData = hasMetricData(
        resourceMetrics,
        METRIC_NAME_GFE_CONNECTIVITY_ERROR_COUNT,
      );
      expect(gfeMissingData).toBeFalsy();

      // Make sure no AFE metrics are not emitted since AFE is disabled.
      const afeMissingData = hasMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_CONNECTIVITY_ERROR_COUNT,
      );
      const afeLatencyMissingData = hasMetricData(
        resourceMetrics,
        METRIC_NAME_AFE_LATENCIES,
      );
      expect(afeMissingData).toBeFalsy();
      expect(afeLatencyMissingData).toBeFalsy();

      await database.close();
      Spanner._resetAFEServerTimingForTest();
      process.env['SPANNER_DISABLE_AFE_SERVER_TIMING'] = 'false';
    });
  });
});
