
jest.mock('os', () => {
  const original = jest.requireActual('os');
  return {
    ...original,
    freemem: () => 9376387072,
  };
});
/*!
 * Copyright 2018 Google Inc. All Rights Reserved.
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

import {EventEmitter} from 'events';
import * as defer from 'p-defer';

import * as leaseTypes from '../src/lease-manager';
import {LeaseManager} from '../src/lease-manager';
import {
  AckError,
  AckResponse,
  AckResponses,
  Message,
  Subscriber,
} from '../src/subscriber';
import {defaultOptions} from '../src/default-options';
import {FakeLog, TestUtils} from './test-utils';
import {Duration} from '../src';
import {loggingUtils} from 'google-gax';

const FREE_MEM = 9376387072;
const fakeos = {
  freemem: () => FREE_MEM,
};

class FakeSubscriber extends EventEmitter {
  ackDeadline = 10;
  isOpen = true;
  modAckLatency = 2000;
  maxExtensionTime = Duration.from({minutes: 60});
  async modAck(): Promise<void> {}
  async modAckWithResponse(): Promise<AckResponse> {
    return AckResponses.Success;
  }
  isExactlyOnceDelivery = false;
}

class FakeSubscriberTelemetry {
  flowStart() {}
  flowEnd() {}
  schedulerStart() {}
  schedulerEnd() {}
  modAckStart() {}
  modAckStop() {}
  processingStart() {}
  processingEnd() {}
}

class FakeMessage {
  length = 20;
  received: number;
  subSpans: FakeSubscriberTelemetry = new FakeSubscriberTelemetry();
  _dispatched = false;

  constructor() {
    this.received = Date.now();
  }
  modAck(): void {}
  async modAckWithResponse(): Promise<AckResponse> {
    return AckResponses.Success;
  }
  ackFailed() {}
  endParentSpan() {}
  dispatched() {
    this._dispatched = true;
  }
  get isDispatched() {
    return this._dispatched;
  }
  get handledPromise() {
    return Promise.resolve();
  }
}

interface LeaseManagerInternals {
  _extendDeadlines(): void;
  _messages: Set<Message>;
  _isLeasing: boolean;
  _scheduleExtension(): void;
}

function getLMInternals(mgr: leaseTypes.LeaseManager): LeaseManagerInternals {
  return mgr as unknown as LeaseManagerInternals;
}

describe('LeaseManager', () => {
  let subscriber: Subscriber;
  let leaseManager: leaseTypes.LeaseManager;

  let fakeLog: FakeLog | undefined;

  beforeEach(() => {
    subscriber = new FakeSubscriber() as {} as Subscriber;
    leaseManager = new LeaseManager(subscriber);
  });

  afterEach(() => {
    fakeLog?.remove();
    leaseManager.clear();
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should default the bytes value to 0', () => {
      expect(leaseManager.size).toBe(0);
    });

    it('should capture any options passed in', () => {
      const fakeOptions = {};
      const stub = jest.spyOn(LeaseManager.prototype, 'setOptions');
      new LeaseManager(subscriber, fakeOptions);
      const [options] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(options).toBe(fakeOptions);
    });
  });

  describe('pending', () => {
    it('should return the number of pending messages', () => {
      leaseManager.setOptions({allowExcessMessages: false, maxMessages: 1});

      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.add(new FakeMessage() as {} as Message);

      expect(leaseManager.pending).toBe(1);
    });
  });

  describe('size', () => {
    it('should return the number of messages', () => {
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.add(new FakeMessage() as {} as Message);

      expect(leaseManager.size).toBe(2);
    });
  });

  describe('add', () => {
    it('should start a flow span', () => {
      const message = new FakeMessage() as {} as Message;
      const stub = jest.spyOn(message.subSpans, 'flowStart');

      leaseManager.add(message);

      expect(((stub as any).mock.calls.length === 1)).toBe(true);
    });

    it('should update the bytes/size values', () => {
      const message = new FakeMessage() as {} as Message;

      leaseManager.add(message);

      expect(leaseManager.size).toBe(1);
      expect(leaseManager.bytes).toBe(message.length);
    });

    it('should dispatch the message if allowExcessMessages is true', done => {
      const fakeMessage = new FakeMessage() as {} as Message;

      leaseManager.isFull = () => true;
      leaseManager.setOptions({allowExcessMessages: true});

      subscriber.on('message', message => {
        expect(message).toBe(fakeMessage);
        done();
      });

      leaseManager.add(fakeMessage);
    });

    it('should make a log message about the dispatch', done => {
      const fakeMessage = new FakeMessage() as {} as Message;
      fakeMessage.id = 'a';
      fakeMessage.ackId = 'b';

      fakeLog = new FakeLog(leaseTypes.logs.callbackDelivery);

      leaseManager.setOptions({
        allowExcessMessages: true,
      });

      subscriber.on('message', () => {
        expect(fakeLog!.called).toBe(true);
        assert.strictEqual(
          fakeLog!.fields!.severity,
          'INFO',
        );
        expect(fakeLog!.args![1] as string).toBe('a');
        expect(fakeLog!.args![2] as string).toBe('b');
        done();
      });

      leaseManager.add(fakeMessage);
    });

    it('should make a log message about a failed dispatch', async () => {
      const fakeMessage = new FakeMessage() as {} as Message;
      fakeMessage.id = 'a';
      fakeMessage.ackId = 'b';

      fakeLog = new FakeLog(leaseTypes.logs.callbackExceptions);

      leaseManager.setOptions({
        allowExcessMessages: true,
      });

      const deferred = defer<void>();
      subscriber.on('message', () => {
        process.nextTick(() => deferred.resolve());
        throw new Error('fooz');
      });

      leaseManager.add(fakeMessage);
      await deferred.promise;

      expect(fakeLog.called).toBe(true);
      assert.strictEqual(
        fakeLog.fields!.severity,
        'ERROR',
      );
      assert.strictEqual(
        (fakeLog.args![0] as string).includes('exception'),
        true,
      );
      expect(fakeLog.args![1] as string).toBe('a');
      expect(fakeLog.args![2] as string).toBe('b');
    });

    it('should dispatch the message if the inventory is not full', done => {
      const fakeMessage = new FakeMessage() as {} as Message;

      leaseManager.isFull = () => false;
      leaseManager.setOptions({allowExcessMessages: false});

      subscriber.on('message', message => {
        expect(message).toBe(fakeMessage);
        done();
      });

      leaseManager.add(fakeMessage);
    });

    it('should not dispatch the message if the inventory is full', done => {
      const fakeMessage = new FakeMessage() as {} as Message;

      leaseManager.isFull = () => true;
      leaseManager.setOptions({allowExcessMessages: false});

      subscriber.on('message', () => {
        done(new Error('Test should not have dispatched message.'));
      });

      leaseManager.add(fakeMessage);
      setImmediate(done);
    });

    it('should log if blocked by client-side flow control', () => {
      const fakeMessage = new FakeMessage() as {} as Message;

      jest.spyOn(leaseManager, 'isFull').mockReturnValue(true);
      const pendingStub = jest.spyOn(leaseManager, 'pending', 'get').mockReturnValue(0);
      leaseManager.setOptions({allowExcessMessages: false});
      fakeLog = new FakeLog(leaseTypes.logs.subscriberFlowControl);

      leaseManager.add(fakeMessage);
      expect(fakeLog.called).toBe(true);

      fakeLog.called = false;
      pendingStub.mockReturnValue(1);
      leaseManager.add(fakeMessage);
      expect(fakeLog.called).toBe(false);
    });

    it('should not dispatch the message if the sub closes', done => {
      const fakeMessage = new FakeMessage() as {} as Message;

      leaseManager.isFull = () => false;

      subscriber.isOpen = false;
      subscriber.on('message', () => {
        done(new Error('Test should not have dispatched message.'));
      });

      leaseManager.add(fakeMessage);
      setImmediate(done);
    });

    it('should emit the full event if it becomes full', done => {
      leaseManager.setOptions({allowExcessMessages: false, maxMessages: 1});

      leaseManager.on('full', done);
      leaseManager.add(new FakeMessage() as {} as Message);
    });

    describe('extending deadlines', () => {
      let clock: any;
      let random: number;
      let expectedTimeout: number;
      let halfway: number;

      beforeEach(() => {
        // This random number was generated once to keep the test results stable.
        random = 0.5756015072052962;
        jest.spyOn(global.Math, 'random').mockReturnValue(random);
        clock = TestUtils.useFakeTimers();
        expectedTimeout =
          (subscriber.ackDeadline * 1000 * 0.9 - subscriber.modAckLatency) *
          random;
        halfway = expectedTimeout / 2;
      });

      it('should schedule a lease extension', () => {
        const message = new FakeMessage() as {} as Message;
        const stub = jest.spyOn(message, 'modAck')
          ;

        leaseManager.add(message);
        clock.tick(expectedTimeout);

        expect((stub as any).mock.calls.length).toBe(1);
      });

      it('should schedule a lease extension for exactly-once delivery', () => {
        const message = new FakeMessage() as {} as Message;
        const stub = jest.spyOn(message, 'modAck')
          ;

        leaseManager.add(message);
        clock.tick(expectedTimeout);

        expect((stub as any).mock.calls.length).toBe(1);
      });

      it('should not schedule a lease extension if already in progress', () => {
        const messages = [new FakeMessage(), new FakeMessage()];
        const stubs = messages.map(message => jest.spyOn(message, 'modAck'));

        // since only 1 timeout should be set, even if add messages at different
        // times, they should all get extended at the same time
        messages.forEach(message => {
          leaseManager.add(message as {} as Message);
          clock.tick(halfway);
        });

        messages.forEach((fakeMessage, i) => {
          const [deadline] = (stubs[i] as any).mock.calls[(stubs[i] as any).mock.calls.length - 1] as {} as [number];
          expect(deadline).toBe(subscriber.ackDeadline);
        });
      });

      it('should remove any messages that pass the maxExtensionMinutes value', () => {
        const maxExtensionSeconds = (expectedTimeout - 100) / 1000;
        const badMessages = [new FakeMessage(), new FakeMessage()];

        subscriber.maxExtensionTime = Duration.from({
          seconds: maxExtensionSeconds,
        });
        badMessages.forEach(message =>
          leaseManager.add(message as {} as Message),
        );
        clock.tick(halfway);

        // only message that shouldn't be forgotten
        const goodMessage = new FakeMessage();
        const removeStub = jest.spyOn(leaseManager, 'remove');
        const modAckStub = jest.spyOn(goodMessage, 'modAck');

        fakeLog = new FakeLog(leaseTypes.logs.expiry);

        leaseManager.add(goodMessage as {} as Message);
        clock.tick(halfway);

        // make sure the expired messages were forgotten
        expect((removeStub as any).mock.calls.length).toBe(badMessages.length);
        assert.strictEqual(
          fakeLog.fields!.severity,
          'WARNING',
        );
        expect(fakeLog.called).toBe(true);

        badMessages.forEach((fakeMessage, i) => {
          const [message] = (removeStub as any).mock.calls[i];
          expect(message).toBe(fakeMessage);
        });

        const [deadline] = (modAckStub as any).mock.calls[(modAckStub as any).mock.calls.length - 1] as {} as [number];
        expect(deadline).toBe(subscriber.ackDeadline);
      });

      it('should remove and ackFailed any messages that fail to ack', done => {
        (subscriber as unknown as FakeSubscriber).isExactlyOnceDelivery = true;

        subscriber.maxExtensionTime = Duration.from({minutes: 600});

        const goodMessage = new FakeMessage();

        const removeStub = jest.spyOn(leaseManager, 'remove');
        const mawrStub = jest.spyOn(goodMessage, 'modAckWithResponse')
          .mockRejectedValue(new AckError(AckResponses.Invalid));
        const failed = jest.spyOn(goodMessage, 'ackFailed');

        removeStub.mockImplementation(() => {
          expect((mawrStub as any).mock.calls.length).toBe(1);
          expect((removeStub as any).mock.calls.length).toBe(1);
          expect((failed as any).mock.calls.length).toBe(1);
          done();
        });

        leaseManager.add(goodMessage as {} as Message);
        clock.tick(halfway * 2 + 1);
      });

      it('should continuously extend the deadlines', () => {
        const message = new FakeMessage();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stub = (sandbox as any)
          .stub(message, 'modAck')
          ;

        leaseManager.add(message as {} as Message);
        clock.tick(expectedTimeout);

        expect((stub as any).mock.calls.length).toBe(1);
        clock.tick(expectedTimeout);
        expect((stub as any).mock.calls.length).toBe(2);
      });
    });
  });

  describe('clear', () => {
    it('should completely clear out the inventory', () => {
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.clear();

      expect(leaseManager.bytes).toBe(0);
      expect(leaseManager.size).toBe(0);
    });

    it('should emit the free event if it was full', done => {
      leaseManager.setOptions({maxMessages: 1});
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.on('free', done);

      setImmediate(() => leaseManager.clear());
    });

    it('should log if it was full and is now empty', () => {
      fakeLog = new FakeLog(leaseTypes.logs.subscriberFlowControl);
      const pendingStub = jest.spyOn(leaseManager, 'pending', 'get').mockReturnValue(0);
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.clear();
      expect(fakeLog.called).toBe(false);

      pendingStub.mockReturnValue(1);
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.clear();
      expect(fakeLog.called).toBe(true);
    });

    it('should cancel any lease extensions', () => {
      const clock = TestUtils.useFakeTimers();
      const stub = jest.spyOn(subscriber, 'modAck').mockResolvedValue();

      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.clear();

      // this would otherwise trigger a minimum of 2 modAcks
      clock.tick(subscriber.ackDeadline * 1000 * 2);

      expect((stub as any).mock.calls.length).toBe(0);
    });
  });

  describe('isFull', () => {
    it('should return true if the maxMessages threshold is hit', () => {
      const maxMessages = 1;

      leaseManager.setOptions({maxMessages});
      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.add(new FakeMessage() as {} as Message);

      expect(leaseManager.isFull()).toBe(true);
    });

    it('should return true if the maxBytes threshold is hit', () => {
      const message = new FakeMessage();
      const maxBytes = message.length - 1;

      leaseManager.setOptions({maxBytes});
      leaseManager.add(message as {} as Message);

      expect(leaseManager.isFull()).toBe(true);
    });

    it('should return false if no thresholds are hit', () => {
      const message = new FakeMessage();
      const maxMessages = 2;
      const maxBytes = message.length + 1;

      leaseManager.setOptions({maxMessages, maxBytes});
      leaseManager.add(message as {} as Message);

      expect(leaseManager.isFull()).toBe(false);
    });
  });

  describe('remove', () => {
    it('should noop for unknown messages', () => {
      const message = new FakeMessage();

      leaseManager.add(message as {} as Message);
      leaseManager.remove(new FakeMessage() as {} as Message);

      expect(leaseManager.size).toBe(1);
      expect(leaseManager.bytes).toBe(message.length);
    });

    it('should update the bytes/size values', () => {
      const message = new FakeMessage() as {} as Message;

      leaseManager.add(message);
      leaseManager.remove(message);

      expect(leaseManager.size).toBe(0);
      expect(leaseManager.bytes).toBe(0);
    });

    it('should emit the free event if there is free space', done => {
      const message = new FakeMessage() as {} as Message;

      leaseManager.setOptions({maxMessages: 1});
      leaseManager.add(message);
      setImmediate(() => leaseManager.remove(message));

      leaseManager.on('free', () => {
        expect(leaseManager.size).toBe(0);
        done();
      });
    });

    it('should remove a message from the pending state', done => {
      const pending = new FakeMessage() as {} as Message;

      leaseManager.setOptions({allowExcessMessages: false, maxMessages: 1});

      subscriber.on('message', message => {
        if (message === pending) {
          done(new Error('Pending messages should not be emitted.'));
        }
      });

      leaseManager.add(new FakeMessage() as {} as Message);
      leaseManager.add(pending);
      leaseManager.remove(pending);

      expect(leaseManager.pending).toBe(0);
      setImmediate(done);
    });

    it('should dispense a pending message', done => {
      const temp = new FakeMessage() as {} as Message;
      const pending = new FakeMessage() as {} as Message;

      leaseManager.setOptions({allowExcessMessages: false, maxMessages: 1});

      subscriber.on('message', message => {
        if (message === temp) {
          return;
        }

        expect(leaseManager.size).toBe(1);
        expect(message).toBe(pending);
        done();
      });

      leaseManager.add(temp);
      leaseManager.add(pending);
      leaseManager.remove(temp);
    });

    it('log when dispensing a pending message', () => {
      const temp = new FakeMessage() as {} as Message;
      const pending = new FakeMessage() as {} as Message;

      leaseManager.setOptions({allowExcessMessages: false, maxMessages: 1});
      fakeLog = new FakeLog(leaseTypes.logs.subscriberFlowControl);

      leaseManager.add(temp);
      leaseManager.add(pending);
      leaseManager.remove(temp);
      expect(fakeLog.called).toBe(true);
    });

    it('should cancel any extensions if no messages are left', () => {
      const clock = TestUtils.useFakeTimers();
      const message = new FakeMessage() as {} as Message;
      const stub = jest.spyOn(subscriber, 'modAck').mockResolvedValue();

      leaseManager.add(message);
      leaseManager.remove(message);

      clock.tick(subscriber.ackDeadline * 1000 * 2);

      expect((stub as any).mock.calls.length).toBe(0);
    });
  });

  describe('setOptions', () => {
    it('should allow excess messages by default', () => {});

    it('should default maxBytes', () => {
      const littleMessage = new FakeMessage() as {} as Message;
      const bigMessage = new FakeMessage();

      leaseManager.add(littleMessage);
      expect(leaseManager.isFull()).toBe(false);

      leaseManager.remove(littleMessage);
      bigMessage.length = defaultOptions.subscription.maxOutstandingBytes * 2;
      leaseManager.add(bigMessage as {} as Message);
      expect(leaseManager.isFull()).toBe(true);
    });

    it('should cap maxMessages', () => {
      for (
        let i = 0;
        i < defaultOptions.subscription.maxOutstandingMessages;
        i++
      ) {
        expect(leaseManager.isFull()).toBe(false);
        leaseManager.add(new FakeMessage() as {} as Message);
      }

      expect(leaseManager.isFull()).toBe(true);
    });
  });

  describe('deadline extension', () => {
    beforeEach(() => {
      TestUtils.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('calls regular modAck periodically w/o exactly-once', () => {
      const lmi = getLMInternals(leaseManager);
      const msg = new Message(subscriber, {
        ackId: 'ackack',
        message: {data: ''},
        deliveryAttempt: 0,
      });
      jest.advanceTimersByTime(1);

      const maStub = jest.spyOn(msg, 'modAck');

      lmi._messages.add(msg);
      lmi._extendDeadlines();

      assert.ok(((maStub as any).mock.calls.length === 1));
    });

    it('calls modAckWithResponse periodically w/exactly-once, successful', async () => {
      const lmi = getLMInternals(leaseManager);
      const msg = new Message(subscriber, {
        ackId: 'ackack',
        message: {data: ''},
        deliveryAttempt: 0,
      });
      jest.advanceTimersByTime(1);
      (subscriber as unknown as FakeSubscriber).isExactlyOnceDelivery = true;

      const done = defer();
      jest.spyOn(msg, 'modAck').mockImplementation(() => {
        console.error('oops we did it wrong');
      });

      const maStub = jest.spyOn(msg, 'modAckWithResponse');
      maStub.mockImplementation(async () => {
        done.resolve();
        return AckResponses.Success;
      });

      lmi._messages.add(msg);
      lmi._extendDeadlines();

      await done.promise;
      assert.ok(((maStub as any).mock.calls.length === 1));
    });

    it('calls modAckWithResponse periodically w/exactly-once, failure', async () => {
      const lmi = getLMInternals(leaseManager);
      const msg = new Message(subscriber, {
        ackId: 'ackack',
        message: {data: ''},
        deliveryAttempt: 0,
      });
      jest.advanceTimersByTime(1);
      (subscriber as unknown as FakeSubscriber).isExactlyOnceDelivery = true;

      const done = defer();

      const maStub = jest.spyOn(msg, 'modAckWithResponse');
      maStub.mockImplementation(async () => {
        done.resolve();
        throw new AckError(AckResponses.Invalid);
      });
      const rmStub = jest.spyOn(leaseManager, 'remove');

      lmi._messages.add(msg);
      lmi._extendDeadlines();

      await done.promise;

      assert.ok(((maStub as any).mock.calls.length === 1));
      assert.ok(((rmStub as any).mock.calls.length === 1));
    });
  });
});
