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

import {protos} from '@google-cloud/bigtable-api';
import google = protos.google;
import {createProtoRows} from './utils/proto-bytes';
import {ByteBufferTransformer} from '../src/execute-query/bytebuffertransformer';
import * as SqlValues from '../src/execute-query/values';

type PublicByteBufferTransformer = {
  messageQueue: Buffer[];
  messageBuffer: Uint8Array[];
  push: (data: any) => void;
  processProtoRowsBatch: (
    partialResultSet: google.bigtable.v2.IPartialResultSet,
  ) => void;
};

describe('Bigtable/ExecuteQueryByteBufferTransformer', () => {
  let checksumValidStub: any;
  let checksumIsValid = true;
  let byteBuffer: PublicByteBufferTransformer;

  beforeEach(() => {
    checksumIsValid = true;
    checksumValidStub = jest
      .spyOn(SqlValues, 'checksumValid')
      .mockImplementation(() => checksumIsValid);
    byteBuffer =
      new ByteBufferTransformer() as any as PublicByteBufferTransformer;
  });

  afterEach(() => {
    checksumValidStub.mockRestore();
  });

  describe('processProtoRowsBatch', () => {
    it('empty result', () => {
      expect(() => {
        byteBuffer.processProtoRowsBatch({});
      }).toThrow(/Response did not contain any results!/);
    });

    it('just checksum', () => {
      const response1 = createProtoRows(undefined, undefined, undefined, {
        intValue: 1,
      });
      const responseWithChecksum = createProtoRows(undefined, 111, undefined);

      // fill the buffer
      byteBuffer.processProtoRowsBatch(response1.results!);

      // check that the buffer is filled
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toBe(
        response1.results!.protoRowsBatch!.batchData!,
      );

      // send the checksum
      byteBuffer.processProtoRowsBatch(responseWithChecksum.results!);

      // check that the buffer is flushed and queue contains the new message
      expect(byteBuffer.messageQueue.length).toBe(1);
      expect(byteBuffer.messageQueue[0]).toEqual(
        Buffer.concat([
          response1.results!.protoRowsBatch!.batchData! as Buffer,
        ]),
      );
      expect(byteBuffer.messageBuffer.length).toBe(0);
    });

    it('checksum flushes the buffer', () => {
      const response1 = createProtoRows(undefined, undefined, undefined, {
        intValue: 1,
      });
      const responseWithChecksum = createProtoRows(undefined, 111, undefined, {
        intValue: 2,
      });

      // fill the buffer
      byteBuffer.processProtoRowsBatch(response1.results!);

      // check that the buffer is filled
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toBe(
        response1.results!.protoRowsBatch!.batchData!,
      );

      // send a reset
      byteBuffer.processProtoRowsBatch(responseWithChecksum.results!);

      // check that the buffer is flushed and queue contains the new message
      // containing both values
      expect(byteBuffer.messageQueue.length).toBe(1);
      expect(byteBuffer.messageQueue[0]).toEqual(
        Buffer.concat([
          response1.results!.protoRowsBatch!.batchData! as Buffer,
          responseWithChecksum.results!.protoRowsBatch!.batchData! as Buffer,
        ]),
      );
      expect(byteBuffer.messageBuffer.length).toBe(0);
    });

    it('just reset', () => {
      const responseWithReset = createProtoRows(undefined, undefined, true);

      // send a reset
      byteBuffer.processProtoRowsBatch(responseWithReset.results!);
    });

    it('reset empties the buffer', () => {
      // we first prepare the byteBuffer with a few messages
      // then we send a reset and observe that the queue and
      // buffer have been emptied and only the new message
      // is present
      const response1 = createProtoRows(undefined, undefined, undefined, {
        intValue: 1,
      });
      const responseWithReset = createProtoRows(undefined, undefined, true, {
        intValue: 4,
      });

      byteBuffer.processProtoRowsBatch(response1.results!);

      // check that the buffer is filled
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toBe(
        response1.results!.protoRowsBatch!.batchData!,
      );

      // send a reset
      byteBuffer.processProtoRowsBatch(responseWithReset.results!);

      // check that the buffer has been emptied and populated with
      // the new message after the reset
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toEqual(
        responseWithReset.results!.protoRowsBatch!.batchData!,
      );
    });

    it('reset empties the queue and buffer', () => {
      // we first prepare the byteBuffer with a few messages
      // then we send a reset and observe that the queue and
      // buffer have been emptied and only the new message
      // is present
      const responses = [
        createProtoRows(undefined, undefined, undefined, {intValue: 1}),
        createProtoRows(undefined, 111, undefined, {intValue: 2}),
        createProtoRows(undefined, undefined, undefined, {intValue: 3}),
      ];
      const responseWithReset = createProtoRows(undefined, undefined, true, {
        intValue: 4,
      });

      // fill the buffer with messages
      for (const response of responses) {
        byteBuffer.processProtoRowsBatch(response.results!);
      }

      // check that the buffer and queue are filled
      expect(byteBuffer.messageQueue.length).toBe(1);
      expect(byteBuffer.messageQueue[0]).toEqual(
        Buffer.concat([
          responses[0].results!.protoRowsBatch!.batchData! as Buffer,
          responses[1].results!.protoRowsBatch!.batchData! as Buffer,
        ]),
      );
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toBe(
        responses[2].results!.protoRowsBatch!.batchData!,
      );

      // send a reset
      byteBuffer.processProtoRowsBatch(responseWithReset.results!);

      // check that the buffer and queue have been emptied and populated with
      // the new message after the reset
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toEqual(
        responseWithReset.results!.protoRowsBatch!.batchData!,
      );
    });

    it('token triggers push', () => {
      let pushedData = null;
      byteBuffer.push = (data: any) => {
        pushedData = data;
      };
      const response1 = createProtoRows(undefined, undefined, undefined, {
        intValue: 1,
      });
      const responseWithToken = createProtoRows('token', 111, undefined, {
        intValue: 2,
      });

      // fill the buffer
      byteBuffer.processProtoRowsBatch(response1.results!);

      // check that the buffer is filled
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toBe(
        response1.results!.protoRowsBatch!.batchData!,
      );

      // send a token
      byteBuffer.processProtoRowsBatch(responseWithToken.results!);

      // check that the data was pushed and buffer and queue are empty
      // but pushed data contins the value from the 2nd message
      expect(byteBuffer.messageBuffer.length).toBe(0);
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(pushedData).toEqual([
        [
          Buffer.concat([
            response1.results!.protoRowsBatch!.batchData! as Buffer,
            responseWithToken.results!.protoRowsBatch!.batchData! as Buffer,
          ]),
        ],
        Buffer.from('token'),
      ]);
    });

    it('separate token', () => {
      let pushedData = null;
      byteBuffer.push = (data: any) => {
        pushedData = data;
      };
      const response1 = createProtoRows(undefined, 111, undefined, {
        intValue: 1,
      });
      const responseWithToken = createProtoRows('token', undefined, undefined);

      // fill the buffer
      byteBuffer.processProtoRowsBatch(response1.results!);

      // check that the buffer is filled
      expect(byteBuffer.messageQueue.length).toBe(1);
      expect(byteBuffer.messageBuffer.length).toBe(0);

      // send a token
      byteBuffer.processProtoRowsBatch(responseWithToken.results!);

      // check that the data was pushed and buffer and queue are empty
      expect(byteBuffer.messageBuffer.length).toBe(0);
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(pushedData).toEqual([
        [response1.results!.protoRowsBatch!.batchData! as Buffer],
        Buffer.from('token'),
      ]);
    });

    it('checksum without data throws', () => {
      const responseWithChecksum = createProtoRows(undefined, 111, undefined);

      // send a checksum
      expect(() => {
        byteBuffer.processProtoRowsBatch(responseWithChecksum.results!);
      }).toThrow(/Recieved empty batch with non-zero checksum\./);
    });

    it('token without checksum throws', () => {
      let pushedData = null;
      byteBuffer.push = (data: any) => {
        pushedData = data;
      };
      const response1 = createProtoRows(undefined, undefined, undefined, {
        intValue: 1,
      });
      const responseWithToken = createProtoRows('token', undefined, undefined);

      // fill the buffer
      byteBuffer.processProtoRowsBatch(response1.results!);

      // check that the buffer is filled
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(1);
      expect(byteBuffer.messageBuffer[0]).toBe(
        response1.results!.protoRowsBatch!.batchData!,
      );

      // send a token
      expect(() => {
        byteBuffer.processProtoRowsBatch(responseWithToken.results!);
      }).toThrow(/Recieved incomplete batch of rows\./);
    });

    it('token without data', () => {
      let pushedData = null;
      byteBuffer.push = (data: any) => {
        pushedData = data;
      };
      const responseWithToken = createProtoRows('token', undefined, undefined);

      // check that the buffer and queue are empty
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(byteBuffer.messageBuffer.length).toBe(0);

      // send a token
      byteBuffer.processProtoRowsBatch(responseWithToken.results!);

      // check that the token was pushed even though the buffer and queue are empty
      expect(byteBuffer.messageBuffer.length).toBe(0);
      expect(byteBuffer.messageQueue.length).toBe(0);
      expect(pushedData).toEqual([[], Buffer.from('token')]);
    });

    it('cheksum properly calculated', () => {
      checksumValidStub.mockRestore();
      const response = createProtoRows(
        'token1',
        2412835642,
        undefined,
        {intValue: 1},
        {intValue: 2},
      );
      byteBuffer.processProtoRowsBatch(response.results!);
    });

    it('invalid cheksum throws', () => {
      checksumValidStub.mockRestore();
      const response = createProtoRows(
        'token1',
        111,
        undefined,
        {intValue: 1},
        {intValue: 2},
      );
      expect(() => {
        byteBuffer.processProtoRowsBatch(response.results!);
      }).toThrow(/Failed to validate next batch of results/);
    });
  });
});
