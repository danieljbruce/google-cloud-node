// Copyright 2022 Google LLC
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

import {Bigtable} from '../src';
import {GoogleError, grpc, ServiceError} from 'google-gax';
import {MockServer} from '../src/util/mock-servers/mock-server';
import {
  BigtableAdminClientMockService,
  BigtableClientMockService,
} from '../src/util/mock-servers/service-implementations/bigtable-client-mock-service';
import {MockService} from '../src/util/mock-servers/mock-service';

function isServiceError(error: any): error is ServiceError {
  return (
    error.code !== undefined &&
    error.details !== undefined &&
    error.metadata !== undefined
  );
}

describe('Bigtable/Errors', () => {
  let server: MockServer;
  let bigtable: Bigtable;
  let table: any;
  let service: MockService;

  beforeAll(async () => {
    // make sure we have everything initialized before starting tests
    const port = await new Promise<string>(resolve => {
      server = new MockServer(resolve);
    });
    bigtable = new Bigtable({
      apiEndpoint: `localhost:${port}`,
    });
    service = new BigtableClientMockService(server);
    table = bigtable.instance('fake-instance').table('fake-table');
  });

  describe('with the bigtable data client', () => {
    describe('sends errors through a streaming request', () => {
      const errorDetails =
        'Table not found: projects/my-project/instances/my-instance/tables/my-table';
      const emitTableNotExistsError = (stream: any) => {
        // TODO: Replace stream with type
        const metadata = new grpc.Metadata();
        metadata.set(
          'grpc-server-stats-bin',
          Buffer.from([0, 0, 116, 73, 159, 3, 0, 0, 0, 0]),
        );
        stream.emit('error', {
          code: 5,
          details: errorDetails,
          metadata,
        });
      };
      function checkTableNotExistError(err: any) {
        if (isServiceError(err)) {
          const {code, message, details} = err;
          expect(details).toBe(errorDetails);
          expect(code).toBe(5);
          expect(message).toBe(`5 NOT_FOUND: ${errorDetails}`);
        } else {
          throw new Error(
            'Errors checked using this function should all be GoogleErrors',
          );
        }
      }
      describe('with ReadRows service', () => {
        beforeAll(async () => {
          service.setService({
            ReadRows: emitTableNotExistsError,
          });
        });
        it('should produce human readable error when passing through gax', done => {
          const readStream = table.createReadStream({});
          readStream.on('error', (err: GoogleError) => {
            try {
              checkTableNotExistError(err);
              done();
            } catch (e) {
              done(e);
            }
          });
        });
      });
      describe('with mutateRows service through insert', () => {
        beforeAll(async () => {
          service.setService({
            mutateRows: emitTableNotExistsError,
          });
        });
        it('should produce human readable error when passing through gax', async () => {
          const timestamp = new Date();
          const rowsToInsert = [
            {
              key: 'r2',
              data: {
                cf1: {
                  c1: {
                    value: 'test-value2',
                    labels: [],
                    timestamp,
                  },
                },
              },
            },
          ];
          try {
            await table.insert(rowsToInsert);
          } catch (err) {
            checkTableNotExistError(err);
            return;
          }
          throw new Error('An error should have been thrown by the stream');
        });
      });
      describe('with sampleRowKeys', () => {
        beforeAll(async () => {
          service.setService({
            sampleRowKeys: emitTableNotExistsError,
          });
        });
        it('should produce human readable error when passing through gax', async () => {
          try {
            await table.sampleRowKeys({});
          } catch (err) {
            checkTableNotExistError(err);
            return;
          }
          throw new Error('An error should have been thrown by the stream');
        });
      });
    });
  });
  afterAll(async () => {
    server.shutdown(() => {});
  });
});

describe('BigtableAdminClient/Errors', () => {
  let server: MockServer;
  let bigtable: Bigtable;
  let service: MockService;

  beforeAll(async () => {
    // make sure we have everything initialized before starting tests
    const port = await new Promise<string>(resolve => {
      server = new MockServer(resolve);
    });
    bigtable = new Bigtable({
      apiEndpoint: `localhost:${port}`,
    });
    service = new BigtableAdminClientMockService(server);
  });

  describe('with getInstances', () => {
    const emitGetInstancesError = (stream: any) => {
      const metadata = new grpc.Metadata();
      stream.emit('error', {
        code: 5,
        details: 'getInstances error details',
        metadata,
      });
    };
    beforeAll(async () => {
      service.setService({
        listInstances: emitGetInstancesError,
      });
    });
    it('should produce human readable error when passing through gax', async () => {
      try {
        await bigtable.getInstances();
        throw new Error(
          'An error should have been thrown by the getInstances call',
        );
      } catch (err) {
        expect((err as ServiceError).message).toBe(
          '5 NOT_FOUND: getInstances error details',
        );
      }
    });
  });
  afterAll(async () => {
    server.shutdown(() => {});
  });
});
