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

import {Client, DatabaseError, Query, QueryResult} from '../../src/index.js';
import {Pool as NativePool} from '../../src/lib/native.js';
import {createMockPool} from './mock_native.js';

describe('Client Class', () => {
  describe('Unit Tests (Config & Validation)', () => {
    it('should instantiate Client with config object or string', () => {
      const client1 = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      expect(client1.dsn).toBe('projects/p/instances/i/databases/d');

      const client2 = new Client('projects/p/instances/i/databases/d');
      expect(client2.dsn).toBe('projects/p/instances/i/databases/d');
    });

    it('should invoke callback with error when client.connect(cb) fails on invalid config', done => {
      const client = new Client({});
      client.connect(err => {
        try {
          expect(err instanceof DatabaseError).toBe(true);
          expect(err!.message).toMatch(
            /Invalid Spanner connection configuration/,
          );
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should reject empty query text with enriched DatabaseError', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      try {
        await client.query('');
        throw new Error('Should have thrown error');
      } catch (err: unknown) {
        expect(err instanceof DatabaseError).toBe(true);
        const dbErr = err as DatabaseError;
        expect(dbErr.code).toBe('XX000');
      } finally {
        await client.end();
      }
    });

    it('should reject non-array query values with enriched DatabaseError', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      try {
        // @ts-expect-error Testing runtime invalid values argument
        await client.query('SELECT $1', 'not-an-array');
        throw new Error('Should have thrown error');
      } catch (err: unknown) {
        expect(err instanceof DatabaseError).toBe(true);
        const dbErr = err as DatabaseError;
        expect(dbErr.code).toBe('XX000');
      } finally {
        await client.end();
      }
    });

    it('should deduplicate concurrent connect() calls and initiate connection exactly once', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let connectInvocations = 0;

      (client as unknown as {_doConnect: () => Promise<void>})['_doConnect'] =
        async () => {
          if (client.isConnected) return;
          connectInvocations++;
          await new Promise(r => setTimeout(r, 20));
          client.isConnected = true;
        };

      await Promise.all([client.connect(), client.connect(), client.connect()]);

      expect(connectInvocations).toBe(1);
    });

    it('should handle multiple client.end() calls safely without error', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      await client.end();
      await expect(client.end()).resolves.not.toThrow();
    });

    it('should clear pending query queue when client.end() is called', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      (client as unknown as {isConnected: boolean}).isConnected = true;

      // Queue query without awaiting
      const p1 = client.query('SELECT 1');
      await client.end();

      // Verify queue was emptied
      expect(
        (client as unknown as {queryQueue: unknown[]}).queryQueue.length,
      ).toBe(0);
      try {
        await p1;
      } catch {
        // Expect rejection on ended client
      }
    });

    it('should reject pending queries in queryQueue with Client was closed error when client.end() is called', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let finishConnect!: () => void;
      const connectGate = new Promise<void>(resolve => {
        finishConnect = resolve;
      });
      (client as unknown as {_doConnect: () => Promise<void>})._doConnect =
        async () => {
          await connectGate;
          (client as unknown as {isConnected: boolean}).isConnected = true;
        };

      const p1 = client.query('SELECT 1');
      const p2 = client.query('SELECT 2');
      const p3 = client.query('SELECT 3');

      p1.catch(() => {});

      await client.end();
      finishConnect();

      expect(
        (client as unknown as {queryQueue: unknown[]}).queryQueue.length,
      ).toBe(0);
      await expect(p2).rejects.toThrow(/Client was closed/);
      await expect(p3).rejects.toThrow(/Client was closed/);
    });

    it('should delegate release() to end()', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      (client as unknown as {isConnected: boolean}).isConnected = true;
      expect(client.isConnected).toBe(true);
      await client.release();
      expect(client.isConnected).toBe(false);
    });

    it('should delegate release(cb) to end(cb) using callback syntax', done => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      (client as unknown as {isConnected: boolean}).isConnected = true;
      client.release(err => {
        try {
          expect(err).toBeNull();
          expect(client.isConnected).toBe(false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should emit error event on Query when client.query() connection fails without callback', done => {
      const client = new Client({});
      const q = client.query('SELECT 1');
      void q.on('error', err => {
        try {
          expect(err instanceof DatabaseError).toBe(true);
          expect(err.message).toMatch(
            /Invalid Spanner connection configuration/,
          );
          done();
        } catch (e) {
          done(e);
        }
      });
      void q.catch(() => {});
    });

    it('should emit error event on validation error even when listener is attached after client.query() returns', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let errorEventEmitted = false;

      await new Promise<void>(resolve => {
        const q = client.query(''); // empty SQL triggers validation error
        void q.on('error', () => {
          errorEventEmitted = true;
          resolve();
        });
        setTimeout(resolve, 50);
      });

      expect(errorEventEmitted).toBe(true);
    });
  });

  describe('Mock Native Bridge Execution (End-to-End Query & State Flow)', () => {
    let poolSpy: jest.SpyInstance;

    beforeEach(() => {
      poolSpy = jest
        .spyOn(NativePool, 'create')
        .mockImplementation(async () => createMockPool());
    });

    afterEach(() => {
      poolSpy.mockRestore();
    });

    it('should connect and close Client', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      await client.connect();
      expect(client.isConnected).toBe(true);
      // Calling connect() on an already connected client should reject matching node-postgres
      await expect(client.connect()).rejects.toThrow(
        /Client has already been connected/,
      );
      expect(client.isConnected).toBe(true);
      await client.end();
      expect(client.isConnected).toBe(false);
    });

    it('should connect using callback syntax', done => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      client.connect(err => {
        try {
          expect(err).toBeNull();
          expect(client.isConnected).toBe(true);
          client.end(() => {
            try {
              expect(client.isConnected).toBe(false);
              done();
            } catch (e) {
              done(e);
            }
          });
        } catch (e) {
          done(e);
        }
      });
    });

    it('should reject connect() calls on an ended client and handle concurrent connect/end', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const connectPromise = client.connect();
      await client.end();
      try {
        await connectPromise;
      } catch {
        // Ignored if race rejected
      }
      expect(client.isConnected).toBe(false);
      await expect(client.connect()).rejects.toThrow(
        /Client was (already )?closed/,
      );
    });

    it('should execute query with async/await and return QueryResult', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const res = await client.query('SELECT 1');
      expect(res.command).toBe('SELECT');
      expect(res.rowCount).toBe(1);
      expect(res.rows).toEqual([{fieldCount: undefined, '?column?': '1'}]);
      expect(res.fields.length).toBe(1);
      await client.end();
    });

    it('should execute query with callback syntax', done => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      void client.query('SELECT 1', (err, res) => {
        try {
          expect(err).toBeNull();
          expect(res?.command).toBe('SELECT');
          void client
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should resolve callback when passing Query instance and 3rd argument callback function', done => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const q = new Query<QueryResult>('SELECT $1', [42]);
      void client.query(q, [42], (err, res) => {
        try {
          expect(err).toBeNull();
          expect(res?.command).toBe('SELECT');
          void client
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should invoke callback and NOT emit error event when callback is provided on query error', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let errorEventEmitted = false;
      let callbackInvoked = false;

      const q = new Query<QueryResult>('FAIL_QUERY');
      void q.on('error', () => {
        errorEventEmitted = true;
      });

      await new Promise<void>(resolve => {
        void client.query(q, undefined, err => {
          expect(err instanceof DatabaseError).toBe(true);
          callbackInvoked = true;
          setTimeout(resolve, 20);
        });
      });

      expect(errorEventEmitted).toBe(false);
      expect(callbackInvoked).toBe(true);
      await client.end();
    });

    it('should reject queries executed after client.end() without reconnecting', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      await client.connect();
      expect(client.isConnected).toBe(true);
      await client.end();
      expect(client.isConnected).toBe(false);

      try {
        await client.query('SELECT 1');
        throw new Error(
          'Should have thrown an error when querying an ended client',
        );
      } catch (err: unknown) {
        expect(client.isConnected).toBe(false);
        expect((err as Error).message).toMatch(
          /Client has already been connected|Connection terminated|Client was closed/,
        );
      }
    });

    it('should throw Connection terminated if nativeConnection is missing during query execution', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      (client as unknown as {isConnected: boolean}).isConnected = true;
      (client as unknown as {nativeConnection: unknown}).nativeConnection =
        undefined;

      await expect(client.query('SELECT 1')).rejects.toThrow(
        /Connection terminated/,
      );
      await client.end();
    });

    it('should emit end event on Query when query execution completes', done => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let endEventEmitted = false;
      const q = client.query('SELECT 1');
      void q.on('end', res => {
        try {
          endEventEmitted = true;
          expect(res.command).toBe('SELECT');
          void client
            .end()
            .then(() => {
              try {
                expect(endEventEmitted).toBe(true);
                done();
              } catch (e) {
                done(e);
              }
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('should emit error event on Query when no callback is provided on query error', done => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const q = new Query<QueryResult>('FAIL_QUERY');
      void q.on('error', err => {
        try {
          expect(err instanceof DatabaseError).toBe(true);
          void client
            .end()
            .then(() => done())
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
      void client.query(q).catch(() => {});
    });

    it('should execute query returning rows and fields metadata via native bridge', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const res = await client.query('SELECT 1');
      expect(res.command).toBe('SELECT');
      expect(res.rowCount).toBe(1);
      expect(res.fields.length).toBe(1);
      expect(res.fields[0].name).toBe('?column?');
      expect(res.rows.length).toBe(1);
      expect(res.rows[0]).toEqual({'?column?': '1'});
      await client.end();
    });

    it('should stream fields and row events during client.query()', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let fieldsEmitted = false;
      const receivedRows: unknown[] = [];

      const q = client.query('SELECT 1');
      void q.on('fields', fields => {
        fieldsEmitted = true;
        expect(fields.length).toBe(1);
      });
      void q.on('row', row => {
        receivedRows.push(row);
      });

      const res = await q;
      expect(fieldsEmitted).toBe(true);
      expect(receivedRows.length).toBe(1);
      expect(res.rows).toEqual(receivedRows);
      await client.end();
    });

    it('should support parameterized queries with values array', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const res = await client.query('SELECT $1 as name', ['hello']);
      expect(res.command).toBe('SELECT');
      await client.end();
    });

    it('should support QueryConfig object with rowMode array', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const res = await client.query({
        text: 'SELECT 1',
        rowMode: 'array',
      });
      expect(res.command).toBe('SELECT');
      expect(res.rowCount).toBe(1);
      expect(res.rows).toEqual([['1']]);
      await client.end();
    });

    it('should support queries with empty values array and undefined values', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const res1 = await client.query('SELECT 1', []);
      expect(res1.rowCount).toBe(1);

      const res2 = await client.query('SELECT 1', undefined);
      expect(res2.rowCount).toBe(1);
      await client.end();
    });

    it('should track transaction status transitions (I -> T -> E -> I)', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      await client.connect();
      expect(client.txStatus).toBe('I');
      expect(client.getTransactionStatus()).toBe('I');

      // 1. BEGIN transaction -> 'T'
      await client.query('BEGIN');
      expect(client.txStatus).toBe('T');
      expect(client.getTransactionStatus()).toBe('T');

      // 2. Query failure inside transaction -> 'E'
      try {
        await client.query('FAIL_QUERY');
        throw new Error('Should have failed');
      } catch {
        expect(client.txStatus).toBe('E');
        expect(client.getTransactionStatus()).toBe('E');
      }

      // 3. ROLLBACK aborted transaction -> 'I'
      await client.query('ROLLBACK');
      expect(client.txStatus).toBe('I');
      expect(client.getTransactionStatus()).toBe('I');

      await client.end();
    });

    it('should support setTypeParser and getTypeParser on Client instance', () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      const customParser = (val: string) => `custom_${val}`;
      client.setTypeParser(16, customParser);
      expect(client.getTypeParser(16)).toBe(customParser);
    });

    it('should emit end event when client.end() is called', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      await client.connect();
      let endEmitted = false;
      client.on('end', () => {
        endEmitted = true;
      });
      await client.end();
      expect(endEmitted).toBe(true);
      expect(client.isEnded).toBe(true);
    });

    it('should treat client.end() on unconnected client as a no-op that emits end without permanently closing', async () => {
      const client = new Client({
        project: 'p',
        instance: 'i',
        database: 'd',
      });
      let endEmitted = false;
      client.on('end', () => {
        endEmitted = true;
      });
      await client.end();
      expect(endEmitted).toBe(true);
      expect(client.isEnded).toBe(false);
      await client.connect();
      await client.end();
      expect(client.isEnded).toBe(true);
    });
  });
});
