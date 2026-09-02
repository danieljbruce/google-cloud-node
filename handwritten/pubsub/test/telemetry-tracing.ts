/*!
 * Copyright 2020-2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as trace from '@opentelemetry/sdk-trace-base';
import * as otel from '../src/telemetry-tracing';
import {exporter} from './tracing';
import {SpanKind} from '@opentelemetry/api';
import * as opentelemetry from '@opentelemetry/api';
import {PubsubMessage} from '../src/publisher';
import {Duration} from '../src/temporal';

describe('OpenTelemetryTracer', () => {
  beforeEach(() => {
    exporter.reset();
    otel.setGloballyEnabled(true);
  });
  afterEach(() => {
    exporter.reset();
    otel.setGloballyEnabled(false);
    jest.restoreAllMocks();
  });

  describe('project parser', () => {
    it('parses subscription info', () => {
      const name = 'projects/project-name/subscriptions/sub-name';
      const info = otel.getSubscriptionInfo(name);
      expect(info.subName).toBe(name);
      expect(info.projectId).toBe('project-name');
      expect(info.subId).toBe('sub-name');
      expect(info.topicId).toBe(undefined);
      expect(info.topicName).toBe(undefined);
    });

    it('parses topic info', () => {
      const name = 'projects/project-name/topics/topic-name';
      const info = otel.getTopicInfo(name);
      expect(info.topicName).toBe(name);
      expect(info.projectId).toBe('project-name');
      expect(info.topicId).toBe('topic-name');
      expect(info.subId).toBe(undefined);
      expect(info.subName).toBe(undefined);
    });

    it('parses broken subscription info', () => {
      const name = 'projec/foo_foo/subs/sub_sub';
      const info = otel.getSubscriptionInfo(name);
      expect(info.subName).toBe(name);
      expect(info.projectId).toBe(undefined);
      expect(info.subId).toBe(undefined);
      expect(info.topicId).toBe(undefined);
      expect(info.topicName).toBe(undefined);
    });

    it('parses broken topic info', () => {
      const name = 'projec/foo_foo/tops/top_top';
      const info = otel.getTopicInfo(name);
      expect(info.subName).toBe(undefined);
      expect(info.projectId).toBe(undefined);
      expect(info.subId).toBe(undefined);
      expect(info.topicId).toBe(undefined);
      expect(info.topicName).toBe(name);
    });
  });

  describe('basic span creation', () => {
    it('creates a span', () => {
      const message: PubsubMessage = {};
      const span = otel.PubsubSpans.createPublisherSpan(
        message,
        'projects/test/topics/topicfoo',
        'tests',
      ) as trace.Span;
      span!.end();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).not.toBe(0);
      const exportedSpan = spans.concat().pop()!;

      expect(exportedSpan.name).toBe('topicfoo create');
      expect(exportedSpan.kind).toBe(SpanKind.PRODUCER);
    });

    it('injects a trace context', () => {
      const message: PubsubMessage = {
        attributes: {},
      };
      const span = otel.PubsubSpans.createPublisherSpan(
        message,
        'projects/test/topics/topicfoo',
        'tests',
      ) as trace.Span;

      otel.injectSpan(span!, message);

      expect(
        Object.getOwnPropertyNames(message.attributes).includes(
          otel.modernAttributeName,
        ),
      ).toBe(true);
    });
  });

  describe('context propagation', () => {
    it('injects a trace context', () => {
      const message: PubsubMessage = {
        attributes: {},
      };
      const span = otel.PubsubSpans.createPublisherSpan(
        message,
        'projects/test/topics/topicfoo',
        'tests',
      );
      expect(span).toBeTruthy();

      otel.injectSpan(span!, message);

      expect(
        Object.getOwnPropertyNames(message.attributes).includes(
          otel.modernAttributeName,
        ),
      ).toBe(true);
    });

    it('should issue a warning if OpenTelemetry span context key is set', () => {
      const message: PubsubMessage = {
        attributes: {
          [otel.modernAttributeName]: 'bazbar',
        },
      };
      const span = otel.PubsubSpans.createPublisherSpan(
        message,
        'projects/test/topics/topicfoo',
        'tests',
      );
      expect(span).toBeTruthy();

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        otel.injectSpan(span!, message);
        expect((warnSpy as any).mock.calls.length).toBe(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should be able to determine if attributes are present', () => {
      let message: otel.MessageWithAttributes;

      message = {
        attributes: {
          [otel.modernAttributeName]: 'foobar',
        },
      };
      expect(otel.containsSpanContext(message)).toBe(true);

      message = {};
      expect(otel.containsSpanContext(message)).toBe(false);
    });

    it('extracts a trace context', () => {
      const message = {
        attributes: {
          [otel.modernAttributeName]:
            '00-d4cda95b652f4a1592b449d5929fda1b-553964cd9101a314-01',
        },
      };

      const childSpan = otel.extractSpan(
        message,
        'projects/test/subscriptions/subfoo',
      );
      expect(
        childSpan!.spanContext().traceId,
      ).toBe('d4cda95b652f4a1592b449d5929fda1b');
    });
  });

  describe('attribute creation', () => {
    it('creates attributes for publish', () => {
      const topicInfo: otel.AttributeParams = {
        topicName: 'projects/foo/topics/top',
        topicId: 'top',
        projectId: 'foo',
      };
      const message: PubsubMessage = {
        data: Buffer.from('test'),
        attributes: {},
        calculatedSize: 1234,
        orderingKey: 'key',
        isExactlyOnceDelivery: true,
        ackId: 'ackack',
      };

      const topicAttrs = otel.PubsubSpans.createAttributes(
        topicInfo,
        message,
        'tests',
        'create',
      );
      expect(topicAttrs).toEqual({
        'messaging.system': 'gcp_pubsub',
        'messaging.destination.name': topicInfo.topicId,
        'gcp.project_id': topicInfo.projectId,
        'messaging.message.envelope.size': message.calculatedSize,
        'messaging.gcp_pubsub.message.ordering_key': message.orderingKey,
        'messaging.gcp_pubsub.message.exactly_once_delivery':
          message.isExactlyOnceDelivery,
        'messaging.gcp_pubsub.message.ack_id': message.ackId,
        'messaging.operation': 'create',
        'code.function': 'tests',
      });

      // Check again with no calculated size and other parameters missing.
      delete message.calculatedSize;
      delete message.orderingKey;
      delete message.isExactlyOnceDelivery;
      delete message.ackId;

      const topicAttrs2 = otel.PubsubSpans.createAttributes(
        topicInfo,
        message,
        'tests',
        'create',
      );
      expect(topicAttrs2).toEqual({
        'messaging.system': 'gcp_pubsub',
        'messaging.destination.name': topicInfo.topicId,
        'messaging.operation': 'create',
        'gcp.project_id': topicInfo.projectId,
        'messaging.message.envelope.size': message.data?.length,
        'code.function': 'tests',
      });
    });
  });

  describe('specialized span creation', () => {
    const tests = {
      topicInfo: {
        topicName: 'projects/foo/topics/top',
        topicId: 'top',
        projectId: 'foo',
      } as otel.AttributeParams,
      subInfo: {
        subName: 'projects/foo/subscriptions/sub',
        subId: 'sub',
        projectId: 'foo',
      } as otel.AttributeParams,
      message: {
        data: Buffer.from('test'),
        attributes: {},
        calculatedSize: 1234,
        orderingKey: 'key',
        isExactlyOnceDelivery: true,
        ackId: 'ackack',
      } as PubsubMessage,
    };

    it('creates publisher spans', () => {
      const span = otel.PubsubSpans.createPublisherSpan(
        tests.message,
        tests.topicInfo.topicName!,
        'tests',
      );
      expect(span).toBeTruthy();
      span!.end();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);

      const firstSpan = spans.pop();
      expect(firstSpan).toBeTruthy();
      expect(firstSpan!.name).toBe(`${tests.topicInfo.topicId} create`);
      expect(firstSpan!.attributes['messaging.operation']).toBe('create');
      expect(
        firstSpan!.attributes['messaging.destination.name'],
      ).toBe(tests.topicInfo.topicId);
      expect(
        firstSpan!.attributes['messaging.system'],
      ).toBe('gcp_pubsub');
    });

    it('updates publisher topic names', () => {
      const span = otel.PubsubSpans.createPublisherSpan(
        tests.message,
        tests.topicInfo.topicName!,
        'tests',
      );
      expect(span).toBeTruthy();
      otel.PubsubSpans.updatePublisherTopicName(
        span!,
        'projects/foo/topics/other',
      );
      span!.end();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);

      const firstSpan = spans.pop();
      expect(firstSpan).toBeTruthy();
      expect(firstSpan!.name).toBe('other create');
      expect(
        firstSpan!.attributes['messaging.destination.name'],
      ).toBe('other');
    });

    it('creates receive spans', () => {
      const parentSpan = otel.PubsubSpans.createPublisherSpan(
        tests.message,
        tests.topicInfo.topicName!,
        'tests',
      );
      expect(parentSpan).toBeTruthy();
      const span = otel.PubsubSpans.createReceiveSpan(
        tests.message,
        tests.subInfo.subName!,
        otel.spanContextToContext(parentSpan!.spanContext()),
        'tests',
      );
      expect(span).toBeTruthy();
      span!.end();
      parentSpan!.end();

      const spans = exporter.getFinishedSpans();
      const parentReadSpan = spans.pop();
      const childReadSpan = spans.pop();
      expect(parentReadSpan && childReadSpan).toBeTruthy();

      expect(childReadSpan!.name).toBe('sub subscribe');
      expect(
        childReadSpan!.attributes['messaging.operation'],
      ).toBe('receive');
      expect(
        childReadSpan!.attributes['messaging.destination.name'],
      ).toBe('sub');
      expect(childReadSpan!.kind).toBe(SpanKind.CONSUMER);
      expect(childReadSpan!.parentSpanContext?.spanId).toBeTruthy();
    });

    it('creates publish RPC spans', () => {
      const message: PubsubMessage = {};
      const topicName = 'projects/test/topics/topicfoo';
      const span = otel.PubsubSpans.createPublisherSpan(
        message,
        topicName,
        'test',
      ) as trace.Span;
      message.parentSpan = span;

      const publishSpan = otel.PubsubSpans.createPublishRpcSpan(
        [message],
        topicName,
        'test',
      );

      span!.end();
      publishSpan?.end();
      const spans = exporter.getFinishedSpans();
      const publishReadSpan = spans.pop();
      const childReadSpan = spans.pop();
      expect(publishReadSpan && childReadSpan).toBeTruthy();

      expect(
        publishReadSpan!.attributes['messaging.batch.message_count'],
      ).toBe(1);
      expect(publishReadSpan!.links.length).toBe(1);
      expect(childReadSpan!.links.length).toBe(1);
    });

    it('creates ack rpc span', () => {
      const message: PubsubMessage = {};
      const topicName = 'projects/test/topics/topicfoo';
      const subName = 'subTest';
      const producerSpan = otel.PubsubSpans.createPublisherSpan(
        message,
        topicName,
        'test',
      ) as trace.Span;
      const span = otel.PubsubSpans.createAckRpcSpan(
        [producerSpan],
        subName,
        'tests',
      );
      expect(span).toBeTruthy();
      producerSpan.end();
      span!.end();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(2);

      const firstSpan = spans.pop();
      expect(firstSpan).toBeTruthy();
      expect(firstSpan!.kind).toBe(SpanKind.CLIENT);
      expect(firstSpan!.name).toBe(`${subName} ack`);
      expect(
        firstSpan!.attributes['messaging.destination.name'],
      ).toBe(subName);
      expect(
        firstSpan!.attributes['messaging.batch.message_count'],
      ).toBe(1);
      expect(
        firstSpan!.attributes['messaging.system'],
      ).toBe('gcp_pubsub');
    });

    it('creates modack rpc span', () => {
      const message: PubsubMessage = {};
      const topicName = 'projects/test/topics/topicfoo';
      const subName = 'subTest';
      const producerSpan = otel.PubsubSpans.createPublisherSpan(
        message,
        topicName,
        'test',
      ) as trace.Span;
      const span = otel.PubsubSpans.createModackRpcSpan(
        [producerSpan],
        subName,
        'modack',
        'test',
        Duration.from({seconds: 1}),
        true,
      );
      expect(span).toBeTruthy();
      producerSpan.end();
      span!.end();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(2);

      const firstSpan = spans.pop();
      expect(firstSpan).toBeTruthy();
      expect(firstSpan!.kind).toBe(SpanKind.CLIENT);
      expect(firstSpan!.name).toBe(`${subName} modack`);
      expect(
        firstSpan!.attributes['messaging.destination.name'],
      ).toBe(subName);
      expect(
        firstSpan!.attributes[
          'messaging.gcp_pubsub.message.ack_deadline_seconds'
        ],
      ).toBe(1);
      expect(
        firstSpan!.attributes['messaging.gcp_pubsub.is_receipt_modack'],
      ).toBe(true);
      expect(
        firstSpan!.attributes['messaging.system'],
      ).toBe('gcp_pubsub');
    });
  });
});
