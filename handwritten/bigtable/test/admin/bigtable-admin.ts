// Copyright 2026 Google LLC
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

import * as bigtabletableadminModule from '../../src';

import {protobuf, operationsProtos} from 'google-gax';
import {TableAdminClient} from '../../src/admin';

// Copied from v2/gapic_bigtable_table_admin_v2.ts
function generateSampleMessage<T extends object>(instance: T) {
  const filledObject = (
    instance.constructor as typeof protobuf.Message
  ).toObject(instance as protobuf.Message<T>, {defaults: true});
  return (instance.constructor as typeof protobuf.Message).fromObject(
    filledObject,
  ) as T;
}

// Copied from v2/gapic_bigtable_table_admin_v2.ts
function stubSimpleCall<ResponseType>(response?: ResponseType, error?: Error) {
  return error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue([response]);
}

// The GAPIC generated tests don't cover our supplemental methods, so this
// basically just copies the code for checkRestoreTableProgress.
describe('restoreTable', () => {
  it('invokes checkOptimizeRestoredTableProgress without error', async () => {
    const client = new bigtabletableadminModule.admin.TableAdminClient({
      credentials: {client_email: 'bogus', private_key: 'bogus'},
      projectId: 'bogus',
    });
    await client.initialize();
    const expectedResponse = generateSampleMessage(
      new operationsProtos.google.longrunning.Operation(),
    );
    expectedResponse.name = 'test';
    expectedResponse.response = {type_url: 'url', value: Buffer.from('')};
    expectedResponse.metadata = {type_url: 'url', value: Buffer.from('')};

    client.operationsClient.getOperation = stubSimpleCall(expectedResponse);
    const decodedOperation = await client.checkOptimizeRestoredTableProgress(
      expectedResponse.name,
    );
    expect(decodedOperation.name).toEqual(expectedResponse.name);
    expect(decodedOperation.metadata).toBeTruthy();
    expect(
      (client.operationsClient.getOperation as jest.Mock).mock.calls[0],
    ).toBeTruthy();
  });

  it('invokes checkOptimizeRestoredTableProgress with error', async () => {
    const client = new bigtabletableadminModule.admin.TableAdminClient({
      credentials: {client_email: 'bogus', private_key: 'bogus'},
      projectId: 'bogus',
    });
    await client.initialize();
    const expectedError = new Error('expected');

    client.operationsClient.getOperation = stubSimpleCall(
      undefined,
      expectedError,
    );
    await expect(
      client.checkOptimizeRestoredTableProgress(''),
    ).rejects.toThrow(expectedError);
    expect(
      (client.operationsClient.getOperation as jest.Mock).mock.calls[0],
    ).toBeTruthy();
  });
});

describe('waitForConsistency', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('accepts a token object', async () => {
    const token = 'test';
    const client = new TableAdminClient();
    jest.spyOn(client, 'generateConsistencyToken').mockImplementation(() => {
      throw new Error('should not have been called');
    });

    jest.spyOn(client, 'checkConsistency').mockImplementation((req: any) => {
      expect(req.consistencyToken).toBe(token);
      return Promise.resolve([
        {
          consistent: true,
        },
      ]) as any;
    });

    await client.waitForConsistency('tableName', token);
  });

  it('calls without error', async () => {
    jest.useFakeTimers();

    const tableName = 'test';
    const consistencyToken = 'token';

    const client = new TableAdminClient();
    jest.spyOn(client, 'generateConsistencyToken').mockImplementation((tn: any) => {
      expect(tn.name).toBe(tableName);
      return Promise.resolve([
        {
          consistencyToken,
        },
      ]) as any;
    });

    let consistent = false;
    const checkStub = jest
      .spyOn(client, 'checkConsistency')
      .mockImplementation((req: any) => {
        expect(req.consistencyToken).toBe(consistencyToken);
        const rv = {
          consistent,
        };
        consistent = true;
        return Promise.resolve([rv]) as any;
      });

    const promise = client.waitForConsistency(tableName);
    while (!consistent) {
      // This is gross, but we basically have to wait a few ticks
      // to make sure the function has called setTimeout, before
      // advancing the fake timer.
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
      jest.advanceTimersByTime(5500);
    }

    await promise;

    expect(checkStub).toHaveBeenCalledTimes(2);
  });

  it('errors on generateConsistencyToken', async () => {
    const client = new TableAdminClient();
    jest.spyOn(client, 'generateConsistencyToken').mockImplementation(() => {
      throw new Error('it failed!');
    });
    jest.spyOn(client, 'checkConsistency').mockImplementation(() => {
      throw new Error('should not be called');
    });

    await expect(client.waitForConsistency('foo')).rejects.toThrow();
  });

  it('errors on checkConsistency', async () => {
    const client = new TableAdminClient();
    jest.spyOn(client, 'generateConsistencyToken').mockImplementation(() =>
      Promise.resolve([
        {
          consistencyToken: 'foo',
        },
      ]) as any,
    );
    jest.spyOn(client, 'checkConsistency').mockImplementation(() => {
      throw new Error('it failed!');
    });

    await expect(client.waitForConsistency('foo')).rejects.toThrow();
  });
});
