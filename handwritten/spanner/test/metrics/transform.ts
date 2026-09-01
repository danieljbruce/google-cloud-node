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

import {_TEST_ONLY} from '../../src/metrics/transform';
import {
  AggregationTemporality,
  DataPoint,
  DataPointType,
  ExponentialHistogramMetricData,
  GaugeMetricData,
  HistogramMetricData,
  SumMetricData,
  Histogram,
  ExponentialHistogram,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import {Resource} from '@opentelemetry/resources';
import {
  Attributes,
  Counter,
  Meter,
  ValueType as OTValueType,
} from '@opentelemetry/api';
import {
  SPANNER_RESOURCE_TYPE,
  SPANNER_METER_NAME,
  METRIC_NAME_ATTEMPT_COUNT,
} from '../../src/metrics/constants';
import {MetricKind, ValueType} from '../../src/metrics/external-types';
import {MetricsTracerFactory} from '../../src/metrics/metrics-tracer-factory';

const {
  _normalizeLabelKey,
  _transformMetricKind,
  _extractLabels,
  _formatHrTimeToGcmTime,
  _transformResource,
  _transformValueType,
  _transformPoint,
  transformResourceMetricToTimeSeriesArray,
} = _TEST_ONLY;

describe('transform', () => {
  let reader: MetricReader;
  let meterProvider: MeterProvider;
  let attributes: Attributes;
  let resource: Resource;
  let metricSum: SumMetricData;
  let metricGauge: GaugeMetricData;
  let metricHistogram: HistogramMetricData;
  let metricExponentialHistogram: ExponentialHistogramMetricData;
  let metricUnknown;
  let sumDataPoint: DataPoint<number>;
  let gaugeDataPoint: DataPoint<number>;
  let histogramDataPoint: DataPoint<Histogram>;
  let exponentialHistogramDataPoint: DataPoint<ExponentialHistogram>;
  let sandbox;
  let mockFactory;

  class InMemoryMetricReader extends MetricReader {
    protected async onShutdown(): Promise<void> {}
    protected async onForceFlush(): Promise<void> {}
  }

  beforeAll(() => {
    mockFactory = {
      clientUid: 'test_uid',
      clientName: 'test_name',
    };
    jest.spyOn(MetricsTracerFactory, 'getInstance').mockReturnValue(mockFactory as any);

    reader = new InMemoryMetricReader();
    resource = new Resource({
      ['project_id']: 'project_id',
      ['client_hash']: 'test_hash',
      ['location']: 'test_location',
      ['instance_id']: 'instance_id',
      ['instance_config']: 'test_config',
    });
    meterProvider = new MeterProvider({
      resource: resource,
      readers: [reader],
    });
    attributes = {
      client_uid: 'test_uid',
      client_name: 'test_name',
      database: 'database_id',
      method: 'test_method',
      status: 'test_status',
      other: 'ignored',
    } as Attributes;

    metricSum = {
      dataPoints: [],
      aggregationTemporality: AggregationTemporality.DELTA,
      isMonotonic: true,
      dataPointType: DataPointType.SUM,
      descriptor: {valueType: OTValueType.INT, name: 'some_count'} as any,
    };

    metricGauge = {
      dataPoints: [],
      aggregationTemporality: '' as any,
      dataPointType: DataPointType.GAUGE,
      descriptor: {valueType: OTValueType.DOUBLE, name: 'a_count'} as any,
    };

    metricHistogram = {
      dataPoints: [],
      aggregationTemporality: '' as any,
      dataPointType: DataPointType.HISTOGRAM,
      descriptor: {} as any,
    };

    metricExponentialHistogram = {
      dataPoints: [],
      aggregationTemporality: '' as any,
      dataPointType: DataPointType.EXPONENTIAL_HISTOGRAM,
      descriptor: {} as any,
    };

    metricUnknown = {
      dataPoints: [],
      aggregationTemporality: '' as any,
      dataPointType: 'UNKNOWN_TYPE' as any,
      descriptor: {name: ''} as any,
    };

    sumDataPoint = {
      attributes,
      value: 0,
      startTime: process.hrtime(),
      endTime: process.hrtime(),
    };

    gaugeDataPoint = {
      attributes,
      value: 0.0,
      startTime: process.hrtime(),
      endTime: process.hrtime(),
    };

    histogramDataPoint = {
      attributes,
      startTime: process.hrtime(),
      endTime: process.hrtime(),
      value: {
        count: 1,
        buckets: {
          boundaries: [
            0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500,
            10000,
          ],
          counts: [0, 0, 0, 0, 1, 0],
        },
      },
    };

    exponentialHistogramDataPoint = {
      attributes: {},
      startTime: [1687103020, 679000000],
      endTime: [1687103020, 680000000],
      value: {
        count: 7,
        sum: 12.5,
        scale: -1,
        zeroCount: 1,
        positive: {
          offset: -1,
          bucketCounts: [1, 3, 1],
        },
        negative: {
          bucketCounts: [1],
          offset: 0,
        },
      },
    };
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('normalizes label keys', () => {
    [
      ['valid_key_1', 'valid_key_1'],
      ['hellø', 'hellø'],
      ['123', 'key_123'],
      ['key!321', 'key_321'],
      ['hyphens-dots.slashes/', 'hyphens_dots_slashes_'],
      ['non_letters_:£¢$∞', 'non_letters______'],
    ].map(([key, expected]) => {
      expect(_normalizeLabelKey(key)).toBe(expected);
    });
  });

  it('should convert metric types to GCM metric kinds', () => {
    expect(_transformMetricKind(metricSum)).toBe(MetricKind.CUMULATIVE);

    const nonMonotonicMetricSum = {
      dataPoints: [],
      aggregationTemporality: '' as any,
      isMonotonic: false,
      dataPointType: DataPointType.SUM,
      descriptor: {} as any,
    } as SumMetricData;

    expect(
      _transformMetricKind(nonMonotonicMetricSum)).toBe(MetricKind.GAUGE,
    );

    expect(_transformMetricKind(metricGauge)).toBe(MetricKind.GAUGE);

    expect(
      _transformMetricKind(metricHistogram)).toBe(MetricKind.CUMULATIVE,
    );

    expect(
      _transformMetricKind(metricExponentialHistogram)).toBe(MetricKind.CUMULATIVE,
    );

    expect(
      _transformMetricKind(metricUnknown)).toBe(MetricKind.UNSPECIFIED,
    );
  });

  it('should extract metric and resource labels', () => {
    const dataLabels = _extractLabels(sumDataPoint, 'project_id');
    const resourceLabels = _extractLabels(resource, 'project_id');

    // Metric Labels
    expect(dataLabels.metricLabels['client_uid']).toBe('test_uid');
    expect(dataLabels.metricLabels['client_name']).toBe('test_name');
    expect(dataLabels.metricLabels['database']).toBe('database_id');
    expect(dataLabels.metricLabels['method']).toBe('test_method');
    expect(dataLabels.metricLabels['status']).toBe('test_status');

    // Resource Labels
    expect(
      resourceLabels.monitoredResourceLabels['project_id']).toBe('project_id',
    );
    expect(
      resourceLabels.monitoredResourceLabels['instance_id']).toBe('instance_id',
    );
    expect(
      resourceLabels.monitoredResourceLabels['instance_config']).toBe('test_config',
    );
    expect(
      resourceLabels.monitoredResourceLabels['location']).toBe('test_location',
    );
    expect(
      resourceLabels.monitoredResourceLabels['client_hash']).toBe('test_hash',
    );

    // Other Labels
    expect('other' in dataLabels.metricLabels).toBeFalsy();
    expect('other' in resourceLabels.metricLabels).toBeFalsy();
    expect('other' in dataLabels.monitoredResourceLabels).toBeFalsy();
    expect('other' in resourceLabels.monitoredResourceLabels).toBeFalsy();
  });

  it('should transform otel value types to GCM value types', () => {
    expect(_transformValueType(metricSum)).toBe(ValueType.INT64);

    expect(_transformValueType(metricGauge)).toBe(ValueType.DOUBLE);

    expect(
      _transformValueType(metricHistogram)).toBe(ValueType.DISTRIBUTION,
    );

    expect(
      _transformValueType(metricExponentialHistogram)).toBe(ValueType.DISTRIBUTION,
    );

    expect(
      _transformValueType(metricUnknown)).toBe(ValueType.VALUE_TYPE_UNSPECIFIED,
    );
  });

  it('should tranform the datapoint to a GCM point type', () => {
    const sumExpectation = {
      value: {
        int64Value: '0',
      },
      interval: {
        startTime: _formatHrTimeToGcmTime(sumDataPoint.startTime),
        endTime: _formatHrTimeToGcmTime(sumDataPoint.endTime),
      },
    };
    expect(_transformPoint(metricSum, sumDataPoint)).toEqual(sumExpectation);

    const gaugeExpectation = {
      value: {
        doubleValue: '0.0',
      },
      interval: {
        endTime: _formatHrTimeToGcmTime(gaugeDataPoint.endTime),
      },
    };

    expect(_transformPoint(metricGauge, gaugeDataPoint)).toEqual(gaugeExpectation);

    const histogramExpectation = {
      value: {
        distributionValue: {
          count: '1',
          mean: 0,
          bucketOptions: {
            explicitBuckets: {
              bounds: [
                0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000,
                7500, 10000,
              ],
            },
          },
          bucketCounts: ['0', '0', '0', '0', '1', '0'],
        },
      },
      interval: {
        startTime: _formatHrTimeToGcmTime(histogramDataPoint.startTime),
        endTime: _formatHrTimeToGcmTime(histogramDataPoint.endTime),
      },
    };

    expect(_transformPoint(metricHistogram, histogramDataPoint)).toEqual(histogramExpectation);

    const exponentialHistogramExpectation = {
      interval: {
        startTime: _formatHrTimeToGcmTime(
          exponentialHistogramDataPoint.startTime,
        ),
        endTime: _formatHrTimeToGcmTime(exponentialHistogramDataPoint.endTime),
      },
      value: {
        distributionValue: {
          bucketCounts: ['2', '1', '3', '1', '0'],
          bucketOptions: {
            exponentialBuckets: {
              growthFactor: 4,
              numFiniteBuckets: 3,
              scale: 0.25,
            },
          },
          count: '7',
          mean: 1.7857142857142858,
        },
      },
    };

    expect(_transformPoint(metricExponentialHistogram, exponentialHistogramDataPoint)).toEqual(exponentialHistogramExpectation);
  });

  it('should create a MonitoredResource with spanner type', () => {
    const labels = {};
    const resource = _transformResource(labels);
    expect(resource).toBeTruthy();
    expect(resource.type).toBe(SPANNER_RESOURCE_TYPE);
  });

  it('should convert otel metrics to GCM TimeSeries', async () => {
    const meter: Meter = meterProvider.getMeter(SPANNER_METER_NAME);

    const attemptCounter: Counter = meter.createCounter(
      METRIC_NAME_ATTEMPT_COUNT,
      {
        description: 'Count of attempts',
        unit: 'count',
      },
    );

    attemptCounter.add(1, {});
    attemptCounter.add(2, {});

    const {errors, resourceMetrics} = await reader.collect();
    if (errors.length !== 0) {
      throw errors;
    }
    const timeseries = transformResourceMetricToTimeSeriesArray(
      resourceMetrics,
      'project_id',
    );
    expect(timeseries.length).toBe(1);

    // Verify the contents of the TimeSeries
    const ts = timeseries[0];

    expect(ts.valueType).toBe('INT64');

    expect(ts.points?.length).toBe(1);

    expect(
      (ts.points[0].value as {int64Value: string})?.int64Value).toBe('3',
    );
  });

  it('should filter out metrics without spanner-nodejs scope', async () => {
    reader = new InMemoryMetricReader();
    meterProvider = new MeterProvider({
      readers: [reader],
    });

    const meter: Meter = meterProvider.getMeter('wrong_scope');

    const attemptCounter: Counter = meter.createCounter(
      METRIC_NAME_ATTEMPT_COUNT,
      {
        description: 'Count of attempts',
        unit: 'count',
      },
    );

    attemptCounter.add(1, {});
    attemptCounter.add(2, {});

    const {errors, resourceMetrics} = await reader.collect();

    if (errors.length !== 0) {
      throw errors;
    }
    const timeseries = transformResourceMetricToTimeSeriesArray(
      resourceMetrics,
      'project_id',
    );

    expect(timeseries.length).toBe(0);
  });
});
