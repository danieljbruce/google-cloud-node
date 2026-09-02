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

import {randomBytes} from 'crypto';

import {MessageBatch} from '../../src/publisher/message-batch';
import {PubsubMessage} from '../../src/publisher';

describe('MessageBatch', () => {
  let batch: MessageBatch;

  const options = {
    maxBytes: 1000,
    maxMessages: 100,
  };

  beforeEach(() => {
    batch = new MessageBatch(Object.assign({}, options), 'topicName');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should localize options', () => {
      expect(batch.options).toEqual(options);
    });

    it('should create a message array', () => {
      expect(batch.messages).toEqual([]);
    });

    it('should create a callback array', () => {
      expect(batch.callbacks).toEqual([]);
    });

    it('should capture the creation time', () => {
      const now = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(now);
      batch = new MessageBatch(options, 'topicName');

      expect(batch.created).toBe(now);
    });

    it('should initialize bytes to 0', () => {
      expect(batch.bytes).toBe(0);
    });
  });

  describe('add', () => {
    const callback = jest.fn();
    let message: PubsubMessage;
    let messageSize: number;
    beforeEach(() => {
      message = {
        data: Buffer.from('Hello, world!'),
      };
      messageSize = message.data!.length;
    });

    it('should add the message to the message array', () => {
      batch.add(message, callback);
      expect(batch.messages).toEqual([message]);
    });

    it('should add the callback to the callback array', () => {
      batch.add(message, callback);
      expect(batch.callbacks).toEqual([callback]);
    });

    it('should adjust the byte count', () => {
      batch.add(message, callback);
      expect(batch.bytes).toBe(messageSize);
    });
  });

  describe('canFit', () => {
    let message: PubsubMessage;
    let messageSize: number;
    beforeEach(() => {
      message = {
        data: Buffer.from('Hello, world!'),
      };
      messageSize = message.data!.length;
    });

    it('should return false if too many messages', () => {
      batch.options.maxMessages = 0;
      const canFit = batch.canFit(message);
      expect(canFit).toBe(false);
      expect(batch.canFitCount()).toBe(false);
      expect(batch.canFitSize(message)).toBe(true);
    });

    it('should return false if too many bytes', () => {
      batch.options.maxBytes = messageSize - 1;
      const canFit = batch.canFit(message);
      expect(canFit).toBe(false);
      expect(batch.canFitCount()).toBe(true);
      expect(batch.canFitSize(message)).toBe(false);
    });

    it('should return true if it can fit', () => {
      const canFit = batch.canFit(message);
      expect(canFit).toBe(true);
      expect(batch.canFitCount()).toBe(true);
      expect(batch.canFitSize(message)).toBe(true);
    });
  });

  describe('isAtMax', () => {
    it('should return true if at max message limit', () => {
      // tslint:disable-next-line ban
      Array(1000)
        .fill({
          data: Buffer.from('Hello!'),
        })
        .forEach(message => {
          batch.add(message, jest.fn());
        });

      const isAtMax = batch.isAtMax();
      expect(isAtMax).toBe(true);
    });

    it('should return true if at max byte limit', () => {
      const message = {
        data: randomBytes(Math.pow(1024, 2) * 9),
      };

      batch.add(message, jest.fn());

      const isAtMax = batch.isAtMax();
      expect(isAtMax).toBe(true);
    });

    it('should return false if it is not full', () => {
      const message = {
        data: randomBytes(500),
      };

      batch.add(message, jest.fn());

      const isAtMax = batch.isAtMax();
      expect(isAtMax).toBe(false);
    });
  });

  describe('isFull', () => {
    let message: PubsubMessage;
    let messageSize: number;
    beforeEach(() => {
      message = {
        data: Buffer.from('Hello, world!'),
      };
      messageSize = message.data!.length;
    });

    it('should return true if at max message limit', () => {
      batch.options.maxMessages = 1;
      batch.add(message, jest.fn());
      const isFull = batch.isFull();
      expect(isFull).toBe(true);
      expect(batch.isFullMessages()).toBe(true);
      expect(batch.isFullSize()).toBe(false);
    });

    it('should return true if at max byte limit', () => {
      batch.options.maxBytes = messageSize;
      batch.add(message, jest.fn());
      const isFull = batch.isFull();
      expect(isFull).toBe(true);
      expect(batch.isFullMessages()).toBe(false);
      expect(batch.isFullSize()).toBe(true);
    });

    it('should return false if it is not full', () => {
      batch.add(message, jest.fn());
      const isFull = batch.isFull();
      expect(isFull).toBe(false);
      expect(batch.isFullMessages()).toBe(false);
      expect(batch.isFullSize()).toBe(false);
    });
  });

  describe('setOptions', () => {
    it('updates the options', () => {
      const newOptions = {};
      batch.setOptions(newOptions);
      expect(newOptions).toBe(batch.options);
    });
  });

  it('returns data from end()', () => {
    const output = batch.end();
    expect(output.messages).toBe(batch.messages);
    expect(output.callbacks).toBe(batch.callbacks);
  });
});
