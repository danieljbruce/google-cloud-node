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

import {Client, Pool, Query, QueryResult} from '../../src/index.js';
import {Pool as NativePool} from '../../src/lib/native.js';
import {createMockPool} from './mock_native.js';

describe('Pool Class', () => {
  describe('Unit Tests (Config & Validation)', () => {
    it('should instantiate Pool with config object or connection string and resolve dsn', () => {
      const pool1 = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      expect(pool1.config.project).toBe('p');
      expect(pool1.dsn).toBe('projects/p/instances/i/databases/d');

      const pool2 = new Pool('projects/p/instances/i/databases/d');
      expect(pool2.config.connectionString).toBe(
        'projects/p/instances/i/databases/d',
      );
      expect(pool2.dsn).toBe('projects/p/instances/i/databases/d');
    });
  });

  describe('Mock Native Bridge Execution (End-to-End Pooling & Lifecycle)', () => {
    let poolSpy: jest.SpyInstance;

    beforeEach(() => {
      poolSpy = jest
        .spyOn(NativePool, 'create')
        .mockImplementation(async () => createMockPool());
    });

    afterEach(() => {
      poolSpy.mockRestore();
    });

    it('should acquire client via connect() promise and return it to idle pool on release()', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const client = await pool.connect();
      expect(client.isConnected).toBe(true);
      expect(typeof client.release).toBe('function');
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(0);

      await client.release();
      expect(client.isConnected).toBe(true);
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);

      await pool.end();
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(client.isConnected).toBe(false);
    });

    it('should reuse idle clients from the pool on subsequent connect() calls', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const client1 = await pool.connect();
      await client1.release();

      const client2 = await pool.connect();
      expect(client1).toBe(client2);
      await client2.release();
      await pool.end();
    });

    it('should respect max pool limit and queue pending acquisitions', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        max: 2,
      });

      const c1 = await pool.connect();
      const c2 = await pool.connect();
      expect(pool.totalCount).toBe(2);
      expect(pool.idleCount).toBe(0);

      let c3Acquired = false;
      let c3Client: Client | undefined;
      const p3 = pool.connect().then(c => {
        c3Acquired = true;
        c3Client = c;
        return c;
      });

      expect(pool.waitingCount).toBe(1);
      expect(c3Acquired).toBe(false);

      await c1.release();
      await p3;

      expect(c3Acquired).toBe(true);
      expect(c3Client).toBe(c1);
      expect(pool.waitingCount).toBe(0);

      await c2.release();
      await c3Client!.release();
      await pool.end();
    });

    it('should reject connection acquisition on connectionTimeoutMillis timeout', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        max: 1,
        connectionTimeoutMillis: 50,
      });

      const c1 = await pool.connect();
      expect(pool.totalCount).toBe(1);

      try {
        await pool.connect();
        throw new Error('Should have timed out waiting for connection');
      } catch (err: unknown) {
        expect((err as Error).message).toBe(
          'timeout exceeded when trying to connect',
        );
      }

      await c1.release();
      await pool.end();
    });

    it('should timeout when client.connect() takes longer than connectionTimeoutMillis', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        connectionTimeoutMillis: 40,
      });

      const origConnect = Client.prototype.connect;
      Client.prototype.connect = function () {
        return new Promise(r => setTimeout(() => r(this), 100));
      };

      try {
        await pool.connect();
        throw new Error('Should have timed out establishing connection');
      } catch (err: unknown) {
        expect((err as Error).message).toBe(
          'timeout exceeded when trying to connect',
        );
      } finally {
        Client.prototype.connect = origConnect;
      }

      await pool.end();
    });

    it('should apply connectionTimeoutMillis to onConnect initialization hook', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        connectionTimeoutMillis: 40,
        onConnect: async () => {
          // Simulating slow onConnect hook taking 100ms
          await new Promise(r => setTimeout(r, 100));
        },
      });

      try {
        await pool.connect();
        throw new Error('Should have timed out during onConnect');
      } catch (err: unknown) {
        expect((err as Error).message).toBe(
          'timeout exceeded when trying to connect',
        );
      }

      expect(pool.totalCount).toBe(0);
      await pool.end();
    });

    it('should remove idle client after idleTimeoutMillis expires', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        idleTimeoutMillis: 50,
      });

      const c1 = await pool.connect();
      await c1.release();
      expect(pool.idleCount).toBe(1);

      await new Promise(r => setTimeout(r, 80));
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(c1.isConnected).toBe(false);

      await pool.end();
    });

    it('should maintain min idle clients even after idleTimeoutMillis expires', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        min: 1,
        idleTimeoutMillis: 40,
      });

      const c1 = await pool.connect();
      await c1.release();
      expect(pool.idleCount).toBe(1);

      await new Promise(r => setTimeout(r, 70));
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);

      await pool.end();
    });

    it('should emit pool lifecycle events (connect, acquire, release, remove)', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const events: string[] = [];
      pool.on('connect', () => events.push('connect'));
      pool.on('acquire', () => events.push('acquire'));
      pool.on('release', () => events.push('release'));
      pool.on('remove', () => events.push('remove'));

      const c = await pool.connect();
      await c.release();
      await pool.end();

      expect(events).toEqual(['connect', 'acquire', 'release', 'remove']);
    });

    it('should destroy client when released with error parameter', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const c = await pool.connect();
      expect(pool.totalCount).toBe(1);

      await c.release(new Error('Fatal error'));
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(c.isConnected).toBe(false);

      await pool.end();
    });

    it('should create a fresh replacement client for queued waiter when active client is removed with error', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        max: 1,
      });

      const c1 = await pool.connect();
      expect(pool.totalCount).toBe(1);

      let waiterResolved = false;
      let newClient: Client | undefined;
      const p2 = pool.connect().then(c => {
        waiterResolved = true;
        newClient = c;
        return c;
      });

      expect(pool.waitingCount).toBe(1);

      // Release c1 with fatal error -> removeClient destroys c1 and connects fresh replacement for waiter
      await c1.release(new Error('Connection lost'));
      await p2;

      expect(waiterResolved).toBe(true);
      expect(newClient).not.toBe(c1);
      expect(newClient?.isConnected).toBe(true);
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(1);

      await newClient!.release();
      await pool.end();
    });

    it('should emit error event on pool when background client emits error and listener is attached', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      let receivedErr: Error | null = null;
      pool.on('error', err => {
        receivedErr = err;
      });

      const c = await pool.connect();
      c.emit('error', new Error('Background connection dropped'));

      expect(receivedErr).toBeTruthy();
      expect((receivedErr as unknown as Error).message).toBe(
        'Background connection dropped',
      );
      expect(pool.totalCount).toBe(0);

      await pool.end();
    });

    it('should safely handle background client error when no pool error listener is attached without crashing', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const c = await pool.connect();
      // Should not throw or crash uncaught exception and should remove dead client
      c.emit('error', new Error('Background silent drop'));
      expect(pool.totalCount).toBe(0);

      await pool.end();
    });

    it('should ignore duplicate client.release() calls on the same checkout', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const c = await pool.connect();
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(0);

      await c.release();
      expect(pool.idleCount).toBe(1);

      // Second and third release calls should safely no-op
      await c.release();
      await c.release();
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);

      await pool.end();
    });

    it('should support allowExitOnIdle configuration', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        idleTimeoutMillis: 1000,
        allowExitOnIdle: true,
      });

      const c = await pool.connect();
      await c.release();
      expect(pool.idleCount).toBe(1);

      await pool.end();
    });

    it('should destroy client after reaching maxUses limit', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        maxUses: 2,
      });

      const c1 = await pool.connect();
      await c1.release();
      expect(pool.idleCount).toBe(1);

      const c1Again = await pool.connect();
      expect(c1).toBe(c1Again);

      await c1Again.release();
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(c1.isConnected).toBe(false);

      await pool.end();
    });

    it('should destroy client after maxLifetimeSeconds expires', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        maxLifetimeSeconds: 0.05, // 50ms
      });

      const c1 = await pool.connect();
      await new Promise(r => setTimeout(r, 60));
      await c1.release();

      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(c1.isConnected).toBe(false);

      await pool.end();
    });

    it('should evict expired idle client when connect() is called after maxLifetimeSeconds', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        maxLifetimeSeconds: 0.05, // 50ms
        idleTimeoutMillis: 0, // do not evict on idle timeout
      });

      const c1 = await pool.connect();
      // Released immediately while still young
      await c1.release();
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);

      // Wait 60ms so client expires while sitting idle in pool
      await new Promise(r => setTimeout(r, 60));

      // Connect again -> should detect expired lifetime on checkout, evict c1, and create fresh c2
      const c2 = await pool.connect();
      expect(c1).not.toBe(c2);
      expect(c1.isConnected).toBe(false);
      expect(c2.isConnected).toBe(true);
      expect(pool.totalCount).toBe(1);

      await c2.release();
      await pool.end();
    });

    it('should execute onConnect initialization hook when connecting new client', async () => {
      let onConnectRan = false;
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        onConnect: async client => {
          onConnectRan = true;
          expect(client.isConnected).toBe(true);
        },
      });

      const c1 = await pool.connect();
      expect(onConnectRan).toBe(true);
      await c1.release();
      await pool.end();
    });

    it('should destroy client and propagate error when onConnect throws', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        onConnect: () => {
          throw new Error('onConnect initialization failed');
        },
      });

      try {
        await pool.connect();
        throw new Error('Should have thrown onConnect error');
      } catch (err: unknown) {
        expect((err as Error).message).toBe('onConnect initialization failed');
      }

      expect(pool.totalCount).toBe(0);
      await pool.end();
    });

    it('should acquire client via connect() callback syntax with done release', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      pool.connect((err, client, releaseDone) => {
        try {
          expect(err).toBe(null);
          expect(client?.isConnected).toBe(true);
          if (releaseDone) {
            releaseDone();
          }
          void pool
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should destroy client when released with error via connect() done(err) callback', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      pool.connect((err, client, releaseDone) => {
        try {
          expect(err).toBe(null);
          expect(pool.totalCount).toBe(1);
          if (releaseDone) {
            releaseDone(new Error('Fatal connection issue'));
          }
          expect(pool.totalCount).toBe(0);
          expect(pool.idleCount).toBe(0);
          void pool
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should execute query via pool.query() with async/await', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const res = await pool.query('SELECT 1');
      expect(res.command).toBe('SELECT');
      expect(res.rowCount).toBe(1);
      expect(res.rows).toEqual([{'?column?': '1'}]);
      expect(res.fields.length).toBe(1);
      await pool.end();
    });

    it('should execute query via pool.query() with callback syntax', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      void pool.query('SELECT 1', (err, res) => {
        try {
          expect(err).toBe(null);
          expect(res?.command).toBe('SELECT');
          void pool
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should resolve callback when passing Query instance and 3rd argument callback to pool.query()', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const q = new Query<QueryResult>('SELECT $1', [42]);
      void pool.query(q, [42], (err, res) => {
        expect(err).toBe(null);
        expect(res?.command).toBe('SELECT');
        void pool.end().then(() => done());
      });
    });

    it('should invoke callback exactly once when pool.query() fails during connection acquisition', done => {
      const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      const pool = new Pool({});
      let callCount = 0;
      void pool.query('SELECT 1', (err, res) => {
        try {
          if (originalProject !== undefined) {
            process.env.GOOGLE_CLOUD_PROJECT = originalProject;
          } else {
            delete process.env.GOOGLE_CLOUD_PROJECT;
          }
          callCount++;
          expect(res).toBe(undefined);
          expect(callCount).toBe(1);
          expect(err instanceof Error).toBe(true);
          expect(err!.message).toMatch(
            /Invalid Spanner connection configuration/,
          );
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should invoke callback exactly once and NOT emit error event when pool.query() fails', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let callCount = 0;
      let errorEventEmitted = false;

      const q = new Query<QueryResult>('');
      void q.on('error', () => {
        errorEventEmitted = true;
      });

      await new Promise<void>(resolve => {
        void pool.query(q, undefined, (err, res) => {
          callCount++;
          expect(res).toBe(undefined);
          expect(callCount).toBe(1);
          expect(err instanceof Error).toBe(true);
          setTimeout(resolve, 20);
        });
      });

      expect(errorEventEmitted).toBe(false);
      await pool.end();
    });

    it('should retain and return client to idle pool when pool.query() encounters a query execution error', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const origQuery = Client.prototype.query;
      (Client.prototype as unknown as {query: Function}).query = async () => {
        throw new Error('Table not found: users');
      };

      try {
        await pool.query('SELECT * FROM users');
        throw new Error('Should have failed on query execution');
      } catch (err: unknown) {
        expect((err as Error).message).toBe('Table not found: users');
      } finally {
        Client.prototype.query = origQuery;
      }

      // Client should NOT be destroyed; it should be returned to idle pool
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);

      await pool.end();
    });

    it('should prevent new client acquisitions after pool.end()', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      await pool.end();
      try {
        await pool.connect();
        throw new Error('Should have thrown error on ending pool');
      } catch (err: unknown) {
        expect((err as Error).message).toBe(
          'Cannot acquire client from ending pool',
        );
      }
    });

    it('should reject connect() and destroy client if pool.end() is called during connection handshake', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        onConnect: async () => {
          // Wait 40ms during onConnect hook
          await new Promise(r => setTimeout(r, 40));
        },
      });

      const connectPromise = pool.connect();

      // Call pool.end() while connect() / onConnect is in progress
      await new Promise(r => setTimeout(r, 10));
      const endPromise = pool.end();

      try {
        await connectPromise;
        throw new Error('connect() should have been rejected');
      } catch (err: unknown) {
        expect((err as Error).message).toBe(
          'Cannot acquire client from ending pool',
        );
      }

      await endPromise;
      expect(pool.totalCount).toBe(0);
    });

    it('should reject pool.query() calls after pool.end() and invoke callback with error', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      void pool
        .end()
        .then(() => {
          void pool.query('SELECT 1', (err, res) => {
            try {
              expect(res).toBe(undefined);
              expect(err instanceof Error).toBe(true);
              expect(err!.message).toMatch(
                /Cannot acquire client from ending pool/,
              );
              done();
            } catch (e) {
              done(e);
            }
          });
        })
        .catch(done);
    });

    it('should ensure client is released before user callback executes in pool.query()', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let clientReleased = false;

      // Override _doConnect to track client.release call sequence
      const originalDoConnect = (
        pool as unknown as {
          _doConnect: () => Promise<{
            release: () => Promise<void>;
            query: (
              q: unknown,
              v?: unknown[],
            ) => Promise<{command: string; rows: []; fields: []; rowCount: 0}>;
          }>;
        }
      )._doConnect.bind(pool);
      (pool as unknown as {_doConnect: () => Promise<unknown>})._doConnect =
        async () => {
          const client = await originalDoConnect();
          const originalRelease = client.release.bind(client);
          client.release = async () => {
            clientReleased = true;
            await originalRelease();
          };
          return client;
        };

      void pool.query('SELECT 1', (err, res) => {
        try {
          expect(err).toBe(null);
          expect(res?.command).toBe('SELECT');
          expect(clientReleased).toBe(true);
          void pool
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should end pool using pool.end() callback syntax', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      pool.end(() => {
        done();
      });
    });

    it('should emit error event on Query when pool.query() query execution fails without callback', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const q = new Query<QueryResult>('');
      void q.on('error', err => {
        try {
          expect(err instanceof Error).toBe(true);
          void pool
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
      void pool.query(q).catch(() => {});
    });

    it('should emit error event on Query when pool.query() connection acquisition fails without callback', done => {
      const pool = new Pool({});
      const q = new Query<QueryResult>('SELECT 1');
      void q.on('error', err => {
        try {
          expect(err.message).toMatch(
            /Invalid Spanner connection configuration/,
          );
          done();
        } catch (e) {
          done(e);
        }
      });
      void pool.query(q).catch(() => {});
    });

    it('should emit end event on Pool.query() only after client.release() completes', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let releaseCompleted = false;

      const poolAny = pool as unknown as {
        _doConnect: () => Promise<Client>;
      };
      const origConnect = poolAny._doConnect.bind(pool);
      poolAny._doConnect = async () => {
        const c = await origConnect();
        const origRelease = c.release.bind(c);
        c.release = async () => {
          await new Promise(r => setTimeout(r, 40));
          releaseCompleted = true;
          return origRelease();
        };
        return c;
      };

      let releaseStatusWhenEndEmitted = false;
      await new Promise<void>((resolve, reject) => {
        const q = pool.query('SELECT 1');
        void q.on('end', () => {
          releaseStatusWhenEndEmitted = releaseCompleted;
        });
        void q.then(() => setTimeout(resolve, 50)).catch(reject);
      });

      expect(releaseStatusWhenEndEmitted).toBe(true);
    });

    it('should handle concurrent pool.end() calls gracefully and notify all callers', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const c = await pool.connect();
      setTimeout(() => {
        void c.release();
      }, 40);

      // Call pool.end() concurrently 3 times
      await Promise.all([pool.end(), pool.end(), pool.end()]);

      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
    });

    it('should drain active in-flight queries before pool.end() resolves', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const c1 = await pool.connect();
      let queryFinished = false;

      // Simulate active query completing after 50ms
      setTimeout(() => {
        queryFinished = true;
        void c1.release();
      }, 50);

      expect(pool.totalCount).toBe(1);
      await pool.end();

      expect(queryFinished).toBe(true);
      expect(pool.totalCount).toBe(0);
    });

    it('should reject queued waitQueue acquirers when pool.end() is called', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
        max: 1,
      });

      const c1 = await pool.connect();

      let waiterRejected = false;
      let waiterErrorMsg = '';

      const p2 = pool.connect().catch((err: Error) => {
        waiterRejected = true;
        waiterErrorMsg = err.message;
      });

      expect(pool.waitingCount).toBe(1);

      // Release c1 after a short delay so pool.end() rejects waitQueue before c1 release
      setTimeout(() => {
        void c1.release();
      }, 20);

      await pool.end();
      await p2;

      expect(waiterRejected).toBe(true);
      expect(waiterErrorMsg).toBe('Cannot acquire client from ending pool');
      expect(pool.waitingCount).toBe(0);
    });

    it('should remove idle client from pool when background error event occurs', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      pool.on('error', () => {
        // Prevent unhandled error throw in test harness
      });

      const idleClient = await pool.connect();
      await idleClient.release();
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);

      // Emit a background connection error on the idle client handle
      idleClient.emit('error', new Error('Connection reset by peer'));

      // Broken client must be removed from the pool
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(idleClient.isConnected).toBe(false);

      await pool.end();
    });

    it('should reject in-flight connection attempt when pool.end() is called concurrently', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      // Delay client connection to simulate slow handshake
      const originalConnect = Client.prototype.connect;
      Client.prototype.connect = function () {
        return new Promise(resolve => setTimeout(() => resolve(this), 60));
      };

      try {
        const connectPromise = pool.connect();
        // Call pool.end() while connection handshake is in-flight
        const endPromise = pool.end();

        await endPromise;

        try {
          await connectPromise;
          throw new Error(
            'Should not allow client acquisition from an ending pool',
          );
        } catch (err: unknown) {
          expect((err as Error).message).toBe(
            'Cannot acquire client from ending pool',
          );
        }
      } finally {
        Client.prototype.connect = originalConnect;
      }

      expect(pool.totalCount).toBe(0);
    });

    it('should forward streaming row and fields events from pool.query()', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });

      const receivedFields: unknown[] = [];
      const receivedRows: unknown[] = [];
      let receivedResult: unknown = null;

      const query = pool.query('SELECT 1');
      void query.on('fields', fields => receivedFields.push(fields));
      void query.on('row', (row, result) => {
        receivedRows.push(row);
        receivedResult = result;
      });

      await query;

      expect(receivedFields.length).toBe(1);
      expect(receivedRows.length).toBe(1);
      expect(receivedResult).toBeTruthy();

      await pool.end();
    });

    it('should maintain strict FIFO acquisition order and prevent waitQueue displacement on client error', async () => {
      const pool = new Pool({
        project: 'test-project',
        instance: 'test-instance',
        database: 'test-database',
        max: 1,
      });

      // 1. Check out the only available connection slot
      const initialClient = await pool.connect();
      expect(pool.totalCount).toBe(1);

      // 2. Queue Request A (index 0) and Request B (index 1) in FIFO order
      const resolutionOrder: string[] = [];
      const requestA = pool.connect().then(client => {
        resolutionOrder.push('A');
        return client;
      });
      const requestB = pool.connect().then(client => {
        resolutionOrder.push('B');
        return client;
      });
      expect(pool.waitingCount).toBe(2);

      // 3. initialClient encounters a fatal error and is destroyed.
      // Exactly ONE client slot is freed, so only Request A should be dequeued to get the replacement connection.
      const releasePromise = initialClient.release(
        new Error('connection reset'),
      );

      // 4. Concurrently queue Request C while release is in flight
      const requestC = pool.connect().then(client => {
        resolutionOrder.push('C');
        return client;
      });

      await releasePromise;
      // Wait a short tick for asynchronous handlers to settle
      await new Promise(resolve => setTimeout(resolve, 50));

      // 5. Request A completes its work and returns the client to the pool
      const clientA = await requestA;
      await clientA.release();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Request B was queued before Request C, so Request B MUST be resolved before Request C.
      // Without the fix, re-entrant removeClient() prematurely pops Request B from waitQueue,
      // causing Request C to jump ahead of Request B in the queue (resulting in ['A', 'C']).
      expect(resolutionOrder).toEqual(['A', 'B']);

      // 6. Request B completes and frees the connection for Request C
      const clientB = await requestB;
      await clientB.release();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(resolutionOrder).toEqual(['A', 'B', 'C']);

      const clientC = await requestC;
      await clientC.release();
      await pool.end();
    });

    it('should invoke connect callback with error and dummy done function when connection acquisition fails', done => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      void pool.end(); // Closing pool causes _doConnect to reject
      pool.connect((err, client, release) => {
        try {
          expect(err instanceof Error).toBeTruthy();
          expect(client).toBe(undefined);
          expect(typeof release).toBe('function');
          expect(() => release!()).not.toThrow();
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should remove client from pool when client.end() is called directly on checked-out client', async () => {
      const pool = new Pool({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const client = await pool.connect();
      expect(pool.totalCount).toBe(1);

      let removeEmitted = false;
      pool.on('remove', removedClient => {
        if (removedClient === client) {
          removeEmitted = true;
        }
      });

      await client.end();
      expect(removeEmitted).toBe(true);
      expect(pool.totalCount).toBe(0);
      await pool.end();
    });
  });
});
