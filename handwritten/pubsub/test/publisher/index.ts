/*!
 * Copyright 2019 Google LLC
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

import * as opentelemetry from '@opentelemetry/api';
import {SpanKind} from '@opentelemetry/api';
import {Topic} from '../../src';
import * as p from '../../src/publisher';
import {Publisher} from '../../src/publisher';
import * as q from '../../src/publisher/message-queues';
import {PublishError} from '../../src/publisher/publish-error';
import {defaultOptions} from '../../src/default-options';
import * as tracing from '../../src/telemetry-tracing';
import {exporter} from '../tracing';

jest.mock('../../src/publisher/message-queues', () => {
  const {EventEmitter} = require('events');
  class FakeQueue extends EventEmitter {
    publisher: any;
    constructor(publisher: any) {
      super();
      this.publisher = publisher;
    }
    updateOptions() {}
    add(message: any, callback: any): void {}
    async publish() {
      await this._publish([], []);
    }
    async publishDrain() {
      await this.publish();
    }
    async _publish(messages: any[], callbacks: any[]) {}
  }

  class FakeOrderedQueue extends FakeQueue {
    orderingKey: string;
    error?: Error;
    constructor(publisher: any, key: string) {
      super(publisher);
      this.orderingKey = key;
    }
    resumePublishing(): void {}
    async publish() {
      await this._publish([], []);
    }
    async publishDrain() {
      await this.publish();
    }
    async _publish(messages: any[], callbacks: any[]) {}
  }

  return {
    Queue: FakeQueue,
    OrderedQueue: FakeOrderedQueue,
  };
});

const {Queue: FakeQueue, OrderedQueue: FakeOrderedQueue} = require('../../src/publisher/message-queues');

describe('Publisher', () => {
  let spy: jest.Mock;
  const topicId = 'topic-name';
  const projectId = 'PROJECT_ID';
  const topic = {
    name: `projects/${projectId}/topics/${topicId}`,
    pubsub: {projectId},
  } as Topic;

  let publisher: p.Publisher;

  beforeEach(() => {
    spy = jest.fn();
    publisher = new Publisher(topic);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    tracing.setGloballyEnabled(false);
  });

  describe('initialization', () => {
    it('should capture user options', () => {
      const stub = jest.spyOn(Publisher.prototype, 'setOptions');

      const options = {};
      publisher = new Publisher(topic, options);

      expect(stub).toHaveBeenCalledWith(options);
    });

    it('should localize topic instance', () => {
      expect(publisher.topic).toBe(topic);
    });

    it('should create a message queue', () => {
      expect(publisher.queue instanceof FakeQueue).toBeTruthy();
      expect(publisher.queue.publisher).toBe(publisher);
    });

    it('should create a map for ordered queues', () => {
      expect(publisher.orderedQueues instanceof Map).toBeTruthy();
    });
  });

  describe('publish', () => {
    const buffer = Buffer.from('Hello, world!');

    it('should call through to publishMessage', () => {
      const stub = jest.spyOn(publisher as any, 'publishMessage');

      publisher.publish(buffer, spy);

      const [{data}, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(data).toBe(buffer);
      expect(callback).toBe(spy);
    });

    it('should optionally accept attributes', () => {
      const stub = jest.spyOn(publisher as any, 'publishMessage');
      const attrs = {};

      publisher.publish(buffer, attrs, spy);

      const [{attributes}, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(attributes).toBe(attrs);
      expect(callback).toBe(spy);
    });
  });

  describe('OpenTelemetry tracing', () => {
    let tracingPublisher: p.Publisher = {} as p.Publisher;
    const buffer = Buffer.from('Hello, world!');

    beforeEach(() => {
      exporter.reset();
    });

    it('export created spans', () => {
      tracing.setGloballyEnabled(true);

      tracingPublisher = new Publisher(topic);
      const msg = {data: buffer} as p.PubsubMessage;
      void tracingPublisher.publishMessage(msg);

      msg.parentSpan?.end();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).not.toBe(0);
      const createdSpan = spans.concat().pop()!;
      expect(createdSpan.status.code).toBe(opentelemetry.SpanStatusCode.UNSET);
      expect(createdSpan.attributes['messaging.system']).toBe('gcp_pubsub');
      expect(createdSpan.attributes['messaging.destination.name']).toBe(topicId);
      expect(createdSpan.name).toBe(`${topicId} create`);
      expect(createdSpan.kind).toBe(SpanKind.PRODUCER);
      expect(spans).toBeTruthy();
    });
  });

  describe('publishMessage', () => {
    const data = Buffer.from('hello, world!');

    it('should throw an error if data is not a Buffer', () => {
      const badData = {} as Buffer;
      expect(() => {
        publisher.publishMessage({data: badData}, spy);
      }).toThrow(/Data must be in the form of a Buffer or Uint8Array\./);
    });

    it('should throw an error if data and attributes are both empty', () => {
      expect(() => {
        publisher.publishMessage({}, spy);
      }).toThrow(/at least one attribute must be present/);
    });

    it('should allow sending only attributes', () => {
      const attributes = {foo: 'bar'} as {};
      expect(() => publisher.publishMessage({attributes}, spy)).not.toThrow();
    });

    it('should throw an error if attributes are wrong format', () => {
      const attributes = {foo: {bar: 'baz'}} as {};

      expect(() => {
        publisher.publishMessage({data, attributes}, spy);
      }).toThrow(
        /All attributes must be in the form of a string.\n\nInvalid value of type "object" provided for "foo"\./,
      );
    });

    it('should add non-ordered messages to the message queue', done => {
      const stub = jest.spyOn(publisher.queue, 'add');
      const fakeMessage = {data};

      publisher.publishMessage(fakeMessage, done);

      const [message, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(message).toBe(fakeMessage);

      callback(null);
    });

    describe('ordered messages', () => {
      const orderingKey = 'foo';
      const fakeMessage = {data, orderingKey};

      let queue: any;

      beforeEach(() => {
        queue = new FakeOrderedQueue(publisher, orderingKey);
        publisher.orderedQueues.set(
          orderingKey,
          queue as unknown as q.OrderedQueue,
        );
      });

      it('should create a new queue for a message if need be', () => {
        publisher.orderedQueues.clear();
        publisher.publishMessage(fakeMessage, spy);

        queue = publisher.orderedQueues.get(
          orderingKey,
        ) as unknown as any;

        expect(queue instanceof FakeOrderedQueue).toBeTruthy();
        expect(queue.publisher).toBe(publisher);
        expect(queue.orderingKey).toBe(orderingKey);
      });

      it('should add the ordered message to the correct queue', done => {
        const stub = jest.spyOn(queue, 'add');

        publisher.publishMessage(fakeMessage, done);

        const [message, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(message).toBe(fakeMessage);

        callback(null);
      });

      it('should return an error if the queue encountered an error', done => {
        const error = new Error('err') as PublishError;
        jest
          .spyOn(queue, 'add')
          .mockImplementation(((message: any, callback: any) => callback(error)) as any);

        publisher.publishMessage(fakeMessage, (err: any) => {
          expect(err).toBe(error);
          done();
        });
      });

      it('should delete the queue once it is empty', () => {
        publisher.orderedQueues.clear();
        publisher.publishMessage(fakeMessage, spy);

        queue = publisher.orderedQueues.get(
          orderingKey,
        ) as unknown as any;
        queue.emit('drain');

        expect(publisher.orderedQueues.size).toBe(0);
      });

      it('should drain any ordered queues on flush', done => {
        jest.spyOn(FakeQueue.prototype, '_publish').mockImplementation(async () => {
          process.nextTick(() => {
            publisher.queue.emit('drain');
          });
        });

        jest
          .spyOn(FakeOrderedQueue.prototype, '_publish')
          .mockImplementation(async () => {
            const queue = publisher.orderedQueues.get(
              orderingKey,
            ) as unknown as any;
            process.nextTick(() => {
              queue.emit('drain');
            });
          });

        publisher.orderedQueues.clear();
        publisher.publishMessage(fakeMessage, spy);

        publisher.flush(err => {
          expect(err).toBeNull();
          expect(publisher.orderedQueues.size).toBe(0);
          done();
        });
      });
    });
  });

  describe('resumePublishing', () => {
    it('should resume publishing for the provided ordering key', () => {
      const orderingKey = 'foo';
      const queue = new FakeOrderedQueue(publisher, orderingKey);
      const stub = jest.spyOn(queue, 'resumePublishing');

      publisher.orderedQueues.set(
        orderingKey,
        queue as unknown as q.OrderedQueue,
      );
      publisher.resumePublishing(orderingKey);

      expect((stub as any).mock.calls.length).toBe(1);
    });
  });

  describe('setOptions', () => {
    it('should apply default values', () => {
      publisher.setOptions({});

      expect(publisher.settings).toEqual({
        batching: {
          maxBytes: defaultOptions.publish.maxOutstandingBytes,
          maxMessages: defaultOptions.publish.maxOutstandingMessages,
          maxMilliseconds: defaultOptions.publish.maxDelayMillis,
        },
        messageOrdering: false,
        gaxOpts: {
          isBundling: false,
        },
        flowControlOptions: {
          maxOutstandingBytes: undefined,
          maxOutstandingMessages: undefined,
        },
      });
    });

    it('should capture user provided values', () => {
      const options = {
        batching: {
          maxBytes: 10,
          maxMessages: 10,
          maxMilliseconds: 1,
        },
        messageOrdering: true,
        gaxOpts: {
          isBundling: true,
        },
        flowControlOptions: {
          maxOutstandingBytes: 500,
          maxOutstandingMessages: 50,
        },
      };

      publisher.setOptions(options);

      expect(publisher.settings).toEqual(options);
    });

    it('should cap maxBytes at 9MB', () => {
      publisher.setOptions({
        batching: {
          maxBytes: Math.pow(1024, 2) * 10,
        },
      });

      const expected = Math.pow(1024, 2) * 9;
      expect(publisher.settings.batching!.maxBytes).toBe(expected);
    });

    it('should cap maxMessages at 1000', () => {
      publisher.setOptions({
        batching: {
          maxMessages: 1001,
        },
      });
      expect(publisher.settings.batching!.maxMessages).toBe(1000);
    });

    it('should pass new option values into queues after construction', () => {
      publisher.orderedQueues.set('a', new q.OrderedQueue(publisher, 'a'));
      publisher.orderedQueues.set('b', new q.OrderedQueue(publisher, 'b'));

      const stubs = [jest.spyOn(publisher.queue, 'updateOptions')];
      expect(publisher.orderedQueues.size).toBe(2);
      stubs.push(
        ...Array.from(publisher.orderedQueues.values()).map(q =>
          jest.spyOn(q, 'updateOptions'),
        ),
      );

      const newOptions: p.PublishOptions = {
        batching: {},
      };
      publisher.setOptions(newOptions);

      stubs.forEach(s => expect((s as any).mock.calls.length).toBe(1));
    });
  });

  describe('flush', () => {
    it('should drain the main publish queue', done => {
      jest.spyOn(publisher.queue, '_publish').mockImplementation(async () => {
        process.nextTick(() => {
          publisher.queue.emit('drain');
        });
      });

      publisher.flush(err => {
        expect(err).toBeNull();
        expect(!publisher.queue.batch || publisher.queue.batch.messages.length === 0).toBe(true);
        done();
      });
    });
  });
});
