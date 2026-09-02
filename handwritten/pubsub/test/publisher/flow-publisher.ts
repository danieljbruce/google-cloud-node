/*!
 * Copyright 2021 Google LLC
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

import * as defer from 'p-defer';

import {
  Publisher,
  flowControlDefaults,
  PublishOptions,
  PubsubMessage,
} from '../../src/publisher';
import {FlowControl} from '../../src/publisher/flow-control';
import * as fp from '../../src/publisher/flow-publisher';
import * as tracing from '../../src/telemetry-tracing';

class FakePublisher {
  flowControl!: FlowControl;
  async publishMessage() {}
  setOptions(options: PublishOptions) {
    this.flowControl.setOptions(options.flowControlOptions!);
  }
}

describe('Flow control publisher', () => {
  let publisher: Publisher;

  beforeEach(() => {
    publisher = new FakePublisher() as unknown as Publisher;
    publisher.flowControl = new FlowControl(flowControlDefaults);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    tracing.setGloballyEnabled(false);
  });

  it('should create a flow span if a parent exists', async () => {
    tracing.setGloballyEnabled(true);

    const fcp = new fp.FlowControlledPublisher(publisher);
    const message = {
      data: Buffer.from('foo'),
      parentSpan: tracing.PubsubSpans.createPublisherSpan(
        {},
        'projects/foo/topics/topic',
        'tests',
      ),
    };
    await fcp.publish(message as unknown as PubsubMessage);
    expect(!!message.parentSpan).toBe(true);
  });

  it('should not create a flow span if no parent exists', async () => {
    const fcp = new fp.FlowControlledPublisher(publisher);
    const message = {data: Buffer.from('foo'), parentSpan: undefined};
    await fcp.publish(message as unknown as PubsubMessage);
    expect(!message.parentSpan).toBe(true);
  });

  it('should get no promise if there is flow control space left', async () => {
    publisher.setOptions({
      flowControlOptions: {
        maxOutstandingMessages: 1,
      },
    });

    const addStub = jest.spyOn(publisher as any, 'publishMessage').mockImplementation(async () => '' as any);

    const fcp = new fp.FlowControlledPublisher(publisher);
    const publishResult = fcp.publish({data: Buffer.from('foo')});

    expect(addStub).toHaveBeenCalled();
    expect(publishResult).toBeNull();
  });

  it('should get a promise when there is no flow control space left', async () => {
    publisher.setOptions({
      flowControlOptions: {
        maxOutstandingMessages: 1,
      },
    });

    const deferred = defer<string>();
    const addStub = jest
      .spyOn(publisher as any, 'publishMessage')
      .mockReturnValue(deferred.promise as unknown as any);

    const fcp = new fp.FlowControlledPublisher(publisher);
    const firstResult = fcp.publish({data: Buffer.from('foo')});
    expect(addStub).toHaveBeenCalledTimes(1);
    expect(firstResult).toBeNull();

    const secondResult = fcp.publish({data: Buffer.from('bar')});
    expect(secondResult).toBeDefined();
    expect(addStub).toHaveBeenCalledTimes(1);
    publisher.flowControl.sent(3, 1);
    await secondResult;
    expect(addStub).toHaveBeenCalledTimes(2);
  });

  it('should still call sent() on send errors', async () => {
    const pubStub = jest.spyOn(publisher as any, 'publishMessage').mockImplementation(async () => {
      throw new Error();
    });
    const sentStub = jest.spyOn(publisher.flowControl, 'sent');

    const fcp = new fp.FlowControlledPublisher(publisher);
    fcp.publish({data: Buffer.from('foo')});
    await fcp.all().catch(() => {});

    expect(pubStub).toHaveBeenCalled();
    expect(sentStub).toHaveBeenCalled();
  });

  it('should send messages immediately when publishNow is called', () => {
    const pubStub = jest.spyOn(publisher as any, 'publishMessage').mockImplementation(async () => '' as any);
    const addStub = jest.spyOn(publisher.flowControl, 'addToCount');

    const fcp = new fp.FlowControlledPublisher(publisher);
    fcp.publishNow({data: Buffer.from('foo')});

    expect(pubStub).toHaveBeenCalledTimes(1);
    expect(addStub).toHaveBeenNthCalledWith(1, 3, 1);
  });

  it('should calculate the message size if needed, in wait mode', async () => {
    jest.spyOn(publisher as any, 'publishMessage').mockImplementation(async () => '' as any);
    const fcp = new fp.FlowControlledPublisher(publisher);
    const message: PubsubMessage = {data: Buffer.from('test!')};
    await fcp.publish(message);

    expect(message.calculatedSize).toBe(5);
  });

  it('should calculate the message size if needed, in now mode', () => {
    jest.spyOn(publisher as any, 'publishMessage').mockImplementation(async () => '' as any);
    const fcp = new fp.FlowControlledPublisher(publisher);
    const message: PubsubMessage = {data: Buffer.from('test!')};
    fcp.publishNow(message);

    expect(message.calculatedSize).toBe(5);
  });
});
