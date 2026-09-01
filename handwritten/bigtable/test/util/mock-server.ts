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

import {MockServer} from '../../src/util/mock-servers/mock-server';

const tcpPortUsed = require('tcp-port-used');

describe('Bigtable/Mock-Server', () => {
  const inputPort = '1234';
  let server: MockServer;
  async function checkPort(port: string, inUse: boolean, callback: () => void) {
    const isInUse: boolean = await tcpPortUsed.check(
      parseInt(port),
      'localhost',
    );
    expect(isInUse).toBe(inUse);
    callback();
  }
  describe('Ensure server shuts down properly when destroyed', () => {
    it('should start a mock server', done => {
      server = new MockServer(port => {
        checkPort(port, true, done).catch(err => {
          done(err);
        });
      }, inputPort);
    });
  });
  afterAll(done => {
    checkPort(server.port, true, () => {
      server.shutdown((err?: Error) => {
        expect(err).toBeUndefined();
        checkPort(server.port, false, done).catch(err => {
          done(err);
        });
      });
    }).catch(err => {
      done(err);
    });
  });
});
