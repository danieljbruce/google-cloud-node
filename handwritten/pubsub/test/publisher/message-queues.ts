/*!
 * Copyright 2019 Google Inc. All Rights Reserved.
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

import {loggingUtils, ServiceError} from 'google-gax';
import {EventEmitter} from 'events';

import {RequestConfig, RequestCallback} from '../../src/pubsub';
import * as p from '../../src/publisher';
import * as b from '../../src/publisher/message-batch';
import * as q from '../../src/publisher/message-queues';
import {PublishError} from '../../src/publisher/publish-error';
import {FakeLog, TestUtils} from '../test-utils';

class FakeTopic {
  name = 'projects/foo/topics/fake-topic';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  request<T>(config: RequestConfig, callback: RequestCallback<T>): void {}
}

class FakeFlowControl {}

class FakePublisher {
  topic: FakeTopic;
  settings: p.PublishOptions;
  flowControl: FakeFlowControl;
  constructor(topic: FakeTopic) {
    this.topic = topic;
    this.settings = {
      batching: {},
    };
    this.flowControl = new FakeFlowControl();
  }
}

jest.mock('../../src/publisher/message-batch', () => {
  return {
    MessageBatch: class FakeMessageBatch {
      callbacks: any[];
      created: number;
      messages: any[];
      options: any;
      bytes: number;
      topicName: string;
      constructor(options = {}, topicName = 'topicName') {
        this.callbacks = [];
        this.created = Date.now();
        this.messages = [];
        this.options = options;
        this.topicName = topicName;
        this.bytes = 0;
      }
      add(message: any, callback: any): void {}
      canFit(message: any): boolean {
        return true;
      }
      canFitCount(): boolean {
        return true;
      }
      canFitSize(): boolean {
        return true;
      }
      isAtMax(): boolean {
        return false;
      }
      isFull(): boolean {
        return false;
      }
      isFullMessages(): boolean {
        return false;
      }
      isFullSize(): boolean {
        return false;
      }
      setOptions(options: any) {
        this.options = options;
      }
      end() {
        return {
          messages: this.messages,
          callbacks: this.callbacks,
          bytes: 0,
        };
      }
    },
  };
});

jest.mock('../../src/publisher/publish-error', () => {
  return {
    PublishError: class FakePublishError {
      orderingKey: string;
      error: any;
      constructor(key: string, error: any) {
        this.orderingKey = key;
        this.error = error;
      }
    },
  };
});


describe('Message Queues', () => {
  const MessageQueue = (q as any).MessageQueue;
  const Queue = q.Queue;
  const OrderedQueue = q.OrderedQueue;

  let topic: FakeTopic;
  let publisher: p.Publisher;

  beforeEach(() => {
    topic = new FakeTopic();
    publisher = new FakePublisher(topic) as unknown as p.Publisher;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('MessageQueue', () => {
    let queue: q.Queue;

    beforeEach(() => {
      queue = new MessageQueue(publisher as p.Publisher);
    });

    describe('initialization', () => {
      it('should extend EventEmitter', () => {
        expect(queue instanceof EventEmitter).toBeTruthy();
      });

      it('should localize the publisher', () => {
        expect(queue.publisher).toBe(publisher);
      });

      it('should localize the batch options', () => {
        const batching = {maxMessages: 1001};
        publisher.settings = {batching};

        queue = new MessageQueue(publisher as p.Publisher);
        expect(queue.batchOptions).toBe(batching);
      });
    });

    describe('_publish', () => {
      const messages = [{}, {}, {}];
      const callbacks = messages.map(() => jest.fn());

      it('should make the correct request', () => {
        const stub = jest.spyOn(topic, 'request');

        void queue._publish(messages, callbacks, 0, 'test');

        const [{client, method, reqOpts}] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(client).toBe('PublisherClient');
        expect(method).toBe('publish');
        expect(reqOpts).toEqual({topic: topic.name, messages});
      });

      it('should make a log message about the publish', () => {
        jest.spyOn(topic, 'request');
        const fakeLog = new FakeLog(q.logs.publishBatch);
        void queue._publish(messages, callbacks, 0, 'test');
        fakeLog.remove();

        expect(fakeLog.called).toBe(true);
        expect(fakeLog.fields!.severity).toBe('INFO');
        expect(fakeLog.args![1] as string).toBe('test');
      });

      it('should pass along any gax options', () => {
        const stub = jest.spyOn(topic, 'request');
        const callOptions = {};

        publisher.settings.gaxOpts = callOptions;
        void queue._publish(messages, callbacks, 0, 'test');

        const [{gaxOpts}] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(gaxOpts).toBe(callOptions);
      });

      it('should pass back any request errors', async () => {
        const error = new Error('err') as ServiceError;

        jest.spyOn(topic, 'request').mockImplementation(((config: any, callback: any) => {
          callback(error);
        }) as any);

        try {
          await queue._publish(messages, callbacks, 0, 'test');
          expect(null).toBe(error);
        } catch (e) {
          const err = e as ServiceError;

          expect(err).toBe(error);

          callbacks.forEach(callback => {
            const [err] = (callback as any).mock.calls[(callback as any).mock.calls.length - 1];
            expect(err).toBe(error);
          });
        }
      });

      it('should pass back message ids', async () => {
        const messageIds = messages.map((_, i) => `message${i}`);

        jest.spyOn(topic, 'request').mockImplementation(((config: any, callback: any) => {
          callback(null, {messageIds});
        }) as any);

        await queue._publish(messages, callbacks, 0, 'test');

        callbacks.forEach((callback, i) => {
          const [, messageId] = (callback as any).mock.calls[(callback as any).mock.calls.length - 1];
          const expectedId = `message${i}`;
          expect(messageId).toBe(expectedId);
        });
      });
    });
  });

  describe('Queue', () => {
    let queue: q.Queue;

    beforeEach(() => {
      queue = new Queue(publisher as p.Publisher);
    });

    describe('initialization', () => {
      it('should create a message batch', () => {
        expect(queue.batch instanceof b.MessageBatch).toBeTruthy();
        expect(queue.batch.options).toBe(queue.batchOptions);
      });

      it('should propagate batch options to the message batch when updated', () => {
        const newConfig = {
          batching: {},
        };
        publisher.settings = newConfig;
        queue.updateOptions();
        expect(queue.batch.options).toBe(newConfig.batching);
      });
    });

    describe('add', () => {
      const spy = jest.fn();
      const fakeMessage: p.PubsubMessage = {};

      it('should publish immediately if unable to fit message', done => {
        const addStub = jest.spyOn(queue.batch, 'add');
        jest.spyOn(queue.batch, 'canFit').mockReturnValue(false);

        const publishStub = jest.spyOn(queue, 'publish');
        publishStub.mockImplementationOnce(async () => {
          expect((addStub as any).mock.calls.length).toBe(0);
          done();
        });
        publishStub.mockResolvedValue();

        queue.add(fakeMessage, spy);
      });

      it('should add the message to the batch', () => {
        const stub = jest.spyOn(queue.batch, 'add');
        jest.spyOn(queue, 'publish').mockResolvedValue();

        queue.add(fakeMessage, spy);

        const [message, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(message).toBe(fakeMessage);
        expect(callback).toBe(spy);
      });

      it('should publish immediately if the batch became full', () => {
        const stub = jest.spyOn(queue, 'publish').mockResolvedValue();
        jest.spyOn(queue.batch, 'isFull').mockReturnValue(true);

        queue.add(fakeMessage, spy);

        expect((stub as any).mock.calls.length).toBe(1);
      });

      it('should set a timeout to publish if need be', () => {
        const clock = TestUtils.useFakeTimers();
        const stub = jest.spyOn(queue, 'publish').mockResolvedValue();
        const maxMilliseconds = 1234;

        queue.batchOptions = {maxMilliseconds};
        queue.add(fakeMessage, spy);

        expect((stub as any).mock.calls.length).toBe(0);
        clock.tick(maxMilliseconds);
        expect((stub as any).mock.calls.length).toBe(1);
        clock.restore();
      });

      it('should noop if a timeout is already set', () => {
        const clock = TestUtils.useFakeTimers();
        const stub = jest.spyOn(queue, 'publish').mockResolvedValue();
        const maxMilliseconds = 1234;

        queue.batchOptions = {maxMilliseconds};
        queue.pending = 1234 as unknown as NodeJS.Timeout;
        queue.add(fakeMessage, spy);

        clock.tick(maxMilliseconds);
        expect((stub as any).mock.calls.length).toBe(0);
        clock.restore();
      });
    });

    describe('publish', () => {
      it('should create a new batch', async () => {
        const oldBatch = queue.batch;

        await queue.publish('test');

        expect(oldBatch).not.toBe(queue.batch);
        expect(queue.batch instanceof b.MessageBatch).toBeTruthy();
        expect(queue.batch.options).toBe(queue.batchOptions);
      });

      it('should cancel any pending publish calls', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fakeHandle = 1234 as unknown as any;
        const stub = jest.spyOn(global, 'clearTimeout');

        queue.pending = fakeHandle;
        await queue.publish('test');

        expect((stub as any).mock.calls.length).toBe(1);
        expect(queue.pending).toBe(undefined);
      });

      it('should publish the messages', async () => {
        const batch = queue.batch;
        const stub = jest.spyOn(queue, '_publish').mockImplementation(async () => {});

        await queue.publish('test');

        const [messages, callbacks] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(messages).toBe(batch.messages);
        expect(callbacks).toBe(batch.callbacks);
      });

      describe('publish chaining', () => {
        let fakeMessages: p.PubsubMessage[];
        let spies: p.PublishCallback[];
        beforeEach(() => {
          fakeMessages = [{}, {}] as p.PubsubMessage[];
          spies = [jest.fn(), jest.fn()] as p.PublishCallback[];
        });

        it('should begin another publish(drain) if there are pending batches', done => {
          const stub = jest.spyOn(queue, '_publish').mockImplementation(async () => {});
          let once = false;
          stub.mockImplementation(async () => {
            if (!once) {
              // Drop in a second batch before calling the callback.
              const secondBatch = new b.MessageBatch({} as any, 'topicName');
              secondBatch.messages = fakeMessages;
              secondBatch.callbacks = spies;
              queue.batch = secondBatch;
            }
            once = true;
          });

          queue.batch = new b.MessageBatch({} as any, 'topicName');
          queue.batch.messages = fakeMessages;
          queue.batch.callbacks = spies;
          void queue.publishDrain().then(() => {
            process.nextTick(() => {
              expect((stub as any).mock.calls.length).toBe(2);
              done();
            });
          });
        });

        it('should not begin another publish(non-drain) if there are pending batches', async () => {
          const stub = jest.spyOn(queue, '_publish').mockImplementation(async () => {});
          let once = false;
          stub.mockImplementation(async () => {
            if (!once) {
              // Drop in a second batch before calling the callback.
              const secondBatch = new b.MessageBatch({} as any, 'topicName');
              secondBatch.messages = fakeMessages;
              secondBatch.callbacks = spies;
              queue.batch = secondBatch;
            }
            once = true;
          });

          queue.batch = new b.MessageBatch({} as any, 'topicName');
          queue.batch.messages = fakeMessages;
          queue.batch.callbacks = spies;
          await queue.publish('test');

          expect((stub as any).mock.calls.length).toBe(1);
        });

        it('should emit "drain" if there is nothing left to publish', done => {
          const spy = jest.fn();
          jest.spyOn(queue, '_publish').mockImplementation(async () => {});

          queue.on('drain', spy);
          void queue.publish('test').then(() => {
            process.nextTick(() => {
              expect((spy as any).mock.calls.length).toBe(1);
              done();
            });
          });
        });
      });
    });
  });

  describe('OrderedQueue', () => {
    const key = 'abcd';
    let queue: q.OrderedQueue;

    beforeEach(() => {
      queue = new OrderedQueue(publisher as p.Publisher, key);
    });

    describe('initialization', () => {
      it('should create an array of batches', () => {
        expect(queue.batches).toEqual([]);
      });

      it('should default inFlight ot false', () => {
        expect(queue.inFlight).toBe(false);
      });

      it('should localize the ordering key', () => {
        expect(queue.key).toBe(key);
      });

      it('should propagate batch options to all message batches when updated', () => {
        const firstBatch = queue.createBatch();
        const secondBatch = queue.createBatch();
        queue.batches.push(firstBatch, secondBatch);

        const newConfig = {
          batching: {},
        };
        publisher.settings = newConfig;
        queue.updateOptions();

        expect(firstBatch.options).toBe(newConfig.batching);
        expect(secondBatch.options).toBe(newConfig.batching);
      });
    });

    describe('currentBatch', () => {
      it('should return the oldest known batch', () => {
        const batches = [
          new b.MessageBatch({} as any, 'topicName'),
          new b.MessageBatch({} as any, 'topicName'),
        ] as b.MessageBatch[];
        queue.batches.push(...batches);
        expect(queue.currentBatch).toBe(batches[0]);
      });

      it('should create a new batch if one does not exist', () => {
        expect(queue.batches.length).toBe(0);
        expect(queue.currentBatch instanceof b.MessageBatch).toBeTruthy();
        expect(queue.batches.length).toBe(1);
      });
    });

    describe('add', () => {
      const fakeMessage: p.PubsubMessage = {};
      const spy = jest.fn();

      let batch: b.MessageBatch;

      beforeEach(() => {
        batch = queue.currentBatch as b.MessageBatch;
      });

      describe('with batch in flight', () => {
        beforeEach(() => {
          queue.inFlight = true;
        });

        it('should add the message to current batch', () => {
          const stub = jest.spyOn(batch, 'add');

          queue.add(fakeMessage, spy);

          const [message, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
          expect(message).toBe(fakeMessage);
          expect(callback).toBe(spy);
        });

        it('should create a new batch if current one is at max', () => {
          const fakeBatch = new b.MessageBatch({} as any, 'topicName') as b.MessageBatch;
          const stub = jest.spyOn(fakeBatch, 'add');

          jest.spyOn(batch, 'isAtMax').mockReturnValue(true);
          jest.spyOn(queue, 'createBatch').mockReturnValue(fakeBatch);

          queue.add(fakeMessage, spy);

          expect(queue.batches).toEqual([fakeBatch, batch]);
          const [message, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
          expect(message).toBe(fakeMessage);
          expect(callback).toBe(spy);
        });
      });

      describe('without a batch in flight', () => {
        it('should publish immediately if it cannot fit the message', done => {
          const addStub = jest.spyOn(batch, 'add');

          jest.spyOn(batch, 'canFit').mockReturnValue(false);
          const publishStub = jest.spyOn(queue, 'publish');
          publishStub.mockImplementationOnce(async () => {
            expect((addStub as any).mock.calls.length).toBe(0);
            done();
          });
          publishStub.mockResolvedValue();

          queue.add(fakeMessage, spy);
        });

        it('should add the message to the current batch', () => {
          const stub = jest.spyOn(batch, 'add');

          queue.add(fakeMessage, spy);

          const [message, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
          expect(message).toBe(fakeMessage);
          expect(callback).toBe(spy);
        });

        it('should noop after adding if a publish was triggered', () => {
          const publishStub = jest.spyOn(queue, 'publish').mockResolvedValue();
          const beginPublishStub = jest.spyOn(queue, 'beginNextPublish');

          jest.spyOn(batch, 'canFit').mockReturnValue(false);

          publishStub.mockImplementationOnce(async () => {
            queue.inFlight = true;
          });

          queue.add(fakeMessage, spy);

          expect((publishStub as any).mock.calls.length).toBe(1);
          expect((beginPublishStub as any).mock.calls.length).toBe(0);
        });

        it('should publish immediately if the batch is full', () => {
          const stub = jest.spyOn(queue, 'publish').mockResolvedValue();

          jest.spyOn(batch, 'isFull').mockReturnValue(true);
          queue.add(fakeMessage, spy);

          expect((stub as any).mock.calls.length).toBe(1);
        });

        it('should schedule a publish if one is not pending', () => {
          const stub = jest.spyOn(queue, 'beginNextPublish');

          queue.add(fakeMessage, spy);

          expect((stub as any).mock.calls.length).toBe(1);
        });

        it('should noop after adding if a publish is already pending', () => {
          const stub = jest.spyOn(queue, 'beginNextPublish');

          queue.pending = 1234 as unknown as NodeJS.Timeout;
          queue.add(fakeMessage, spy);

          expect((stub as any).mock.calls.length).toBe(0);
        });
      });
    });

    describe('beginNextPublish', () => {
      const maxMilliseconds = 10000;
      let clock: any;

      beforeEach(() => {
        queue.batchOptions = {maxMilliseconds};
        clock = TestUtils.useFakeTimers();
      });

      afterEach(() => {
        clock.restore();
      });

      it('should set a timeout that will call publish', done => {
        jest.spyOn(queue, 'publish').mockImplementation(async () => done());
        queue.beginNextPublish();
        clock.tick(maxMilliseconds);
      });

      it('should factor in the time the batch has been sitting', done => {
        const halfway = maxMilliseconds / 2;
        jest.spyOn(queue, 'publish').mockImplementation(async () => done());
        queue.currentBatch.created = Date.now() - halfway;
        queue.beginNextPublish();
        clock.tick(halfway);
      });

      it('should not set a timeout with a negative number', () => {
        const stub = jest.spyOn(global, 'setTimeout');

        queue.currentBatch.created = Date.now() - maxMilliseconds * 2;
        queue.beginNextPublish();

        const [, delay] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(delay).toBe(0);
      });
    });

    describe('createBatch', () => {
      it('should create a batch with the correct options', () => {
        const batchOptions = {};
        queue.batchOptions = batchOptions;
        const batch = queue.createBatch();

        expect(batch instanceof b.MessageBatch).toBeTruthy();
        expect(batch.options).toBe(batchOptions);
      });
    });

    describe('handlePublishFailure', () => {
      const error = new Error('err') as ServiceError;

      it('should localize the publish error', () => {
        queue.handlePublishFailure(error);

        expect(queue.error instanceof PublishError).toBeTruthy();
        expect(queue.error!.orderingKey).toBe(key);
        expect(queue.error!.error).toBe(error);
      });

      it('should pass the error to call pending callbacks', () => {
        const spies = [jest.fn(), jest.fn()];

        queue.currentBatch.callbacks = spies;
        queue.handlePublishFailure(error);

        expect(queue.batches.length).toBe(0);

        spies.forEach(spy => {
          expect(spy).toHaveBeenCalledWith(error);
        });
      });
    });

    describe('publish', () => {
      const fakeMessages = [{}, {}] as p.PubsubMessage[];
      const spies = [jest.fn(), jest.fn()] as p.PublishCallback[];

      beforeEach(() => {
        queue.currentBatch.messages = fakeMessages;
        queue.currentBatch.callbacks = spies;
      });

      it('should set inFlight to true', () => {
        void queue.publish('test');
        expect(queue.inFlight).toBe(true);
      });

      it('should cancel any pending publishes', () => {
        const fakeHandle = 1234 as unknown as NodeJS.Timeout;
        const stub = jest.spyOn(global, 'clearTimeout');

        queue.pending = fakeHandle;
        void queue.publish('test');

        const [handle] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(handle).toBe(fakeHandle);
        expect(queue.pending).toBe(undefined);
      });

      it('should remove the oldest batch from the batch list', () => {
        const oldestBatch = queue.currentBatch;

        void queue.publish('test');

        expect(queue.currentBatch).not.toBe(oldestBatch);
      });

      it('should publish the batch', async () => {
        const stub = jest.spyOn(queue, '_publish').mockImplementation(async () => {});

        await queue.publish('test');

        const [messages, callbacks] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(messages).toBe(fakeMessages);
        expect(callbacks).toBe(spies);
      });

      it('should set inFlight to false after publishing', async () => {
        jest.spyOn(queue, '_publish').mockResolvedValue();

        await queue.publish('test');

        expect(queue.inFlight).toBe(false);
      });

      it('should handle any publish failures', async () => {
        const error = new Error('err') as ServiceError;
        const stub = jest.spyOn(queue, 'handlePublishFailure');

        jest.spyOn(queue, '_publish').mockRejectedValue(error);

        await queue.publish('test');

        const [err] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
        expect(err).toBe(error);
      });

      it('should begin another publish if there are pending batches', async () => {
        const stub = jest.spyOn(queue, 'beginNextPublish');
        jest.spyOn(queue, '_publish').mockResolvedValue();

        const secondBatch = new b.MessageBatch({} as any, 'topicName');
        secondBatch.messages = fakeMessages;
        secondBatch.callbacks = spies;

        queue.batches.push(secondBatch as b.MessageBatch);
        await queue.publish('test');

        expect((stub as any).mock.calls.length).toBe(1);
      });

      it('should emit "drain" if there is nothing left to publish', async () => {
        const spy = jest.fn();
        jest.spyOn(queue, '_publish').mockResolvedValue();

        queue.on('drain', spy);
        await queue.publish('test');

        expect((spy as any).mock.calls.length).toBe(1);
      });

      it('should emit "drain" if already empty on publish', async () => {
        const spy = jest.fn();
        jest.spyOn(queue, '_publish').mockResolvedValue();

        queue.on('drain', spy);
        await queue.publish('test');
        await queue.publish('test');

        expect((spy as any).mock.calls.length).toBe(2);
      });
    });

    describe('resumePublishing', () => {
      const error = new Error('err') as PublishError;

      beforeEach(() => {
        queue.error = error;
      });

      it('should delete the cached publish error', () => {
        queue.resumePublishing();
        expect(queue.error).toBe(undefined);
      });

      it('should emit the drain event if there are no more batches', done => {
        queue.on('drain', done);
        queue.resumePublishing();
      });

      it('should not emit the drain event if publishing continues', done => {
        queue.on('drain', () => done(new Error('Should not be called.')));
        queue.resumePublishing();

        expect(queue.currentBatch).toBeTruthy();
        process.nextTick(() => done());
      });
    });
  });
});
