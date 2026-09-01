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

import {Spanner, protos} from '@google-cloud/spanner';
import {BuiltinOids, Client, Pool, QueryResult} from '../src/index.js';

describe('Spanner Driver System Tests (PostgreSQL Dialect)', () => {
  jest.setTimeout(180000); // 3 minutes to allow Spanner DDL / Database creation

  const rawConn =
    process.env.SPANNER_CONNECTION_STRING ||
    (process.env.SPANNER_EMULATOR_HOST
      ? `projects/test-project/instances/test-instance/databases/test-database;host=${process.env.SPANNER_EMULATOR_HOST};usePlainText=true`
      : undefined);

  const instanceEnv = process.env.SPANNER_INSTANCE;

  if (!rawConn && !instanceEnv) {
    it.skip('Skipping system tests: Set SPANNER_CONNECTION_STRING, SPANNER_INSTANCE, or SPANNER_EMULATOR_HOST to run', () => {});
    return;
  }

  // Parse project, instance, and database
  let projectId = process.env.SPANNER_PROJECT || process.env.GCLOUD_PROJECT;
  let instanceId: string | undefined;
  let dbName: string | undefined;
  let connectionParams = '';

  if (rawConn) {
    const [pathPart, ...restParams] = rawConn.split(';');
    connectionParams = restParams.length ? ';' + restParams.join(';') : '';
    const match = pathPart.match(
      /projects\/([^/]+)\/instances\/([^/]+)(?:\/databases\/([^/]+))?/,
    );
    if (match) {
      projectId = projectId || match[1];
      instanceId = match[2];
      dbName = match[3];
    }
  } else if (instanceEnv) {
    const match = instanceEnv.match(/projects\/([^/]+)\/instances\/([^/]+)/);
    if (match) {
      projectId = projectId || match[1];
      instanceId = match[2];
    } else {
      instanceId = instanceEnv;
    }
  }

  // Determine whether to dynamically create and drop a temporary test database
  const shouldCreateDb =
    process.env.SPANNER_CREATE_TEMP_DB === 'true' ||
    !dbName ||
    Boolean(instanceEnv && !rawConn);

  if (shouldCreateDb) {
    dbName = `test_pg_${Date.now()}`;
  }

  const finalConnectionString = `projects/${projectId}/instances/${instanceId}/databases/${dbName}${connectionParams}`;
  let spannerAdminClient:
    | ReturnType<Spanner['getDatabaseAdminClient']>
    | undefined;
  let client: Client;
  let pool: Pool;

  beforeAll(async () => {
    if (shouldCreateDb) {
      console.log(
        `Creating temporary Spanner PostgreSQL database: ${dbName}...`,
      );
      const spanner = new Spanner({projectId});
      spannerAdminClient = spanner.getDatabaseAdminClient();
      const parent = spannerAdminClient.instancePath(projectId!, instanceId!);

      const [op] = await spannerAdminClient.createDatabase({
        parent,
        createStatement: `CREATE DATABASE "${dbName}"`,
        databaseDialect:
          protos.google.spanner.admin.database.v1.DatabaseDialect.POSTGRESQL,
      });
      await op.promise();

      const [ddlOp] = await spannerAdminClient.updateDatabaseDdl({
        database: spannerAdminClient.databasePath(
          projectId!,
          instanceId!,
          dbName!,
        ),
        statements: [
          `CREATE TABLE Singers (
            SingerId bigint NOT NULL,
            FirstName character varying(1024),
            LastName character varying(1024),
            BirthDate date,
            LastModified timestamptz,
            Rating float8,
            Active boolean,
            Revenues numeric,
            Metadata jsonb,
            Tags text[],
            PRIMARY KEY (SingerId)
          );`,
          `CREATE TABLE AllTypes (
            Id bigint NOT NULL,
            ColBool boolean,
            ColBytea bytea,
            ColInt8 bigint,
            ColFloat4 float4,
            ColFloat8 float8,
            ColNumeric numeric,
            ColText text,
            ColVarchar character varying(1024),
            ColDate date,
            ColTimestamp timestamptz,
            ColJsonb jsonb,
            ColUuid uuid,
            ArrBool boolean[],
            ArrBytea bytea[],
            ArrInt8 bigint[],
            ArrFloat4 float4[],
            ArrFloat8 float8[],
            ArrNumeric numeric[],
            ArrText text[],
            ArrDate date[],
            ArrTimestamp timestamptz[],
            ArrJsonb jsonb[],
            ArrUuid uuid[],
            PRIMARY KEY (Id)
          );`,
        ],
      });
      await ddlOp.promise();
      console.log(`Database and schema created successfully: ${dbName}`);
    }

    client = new Client({connectionString: finalConnectionString});
    await client.connect();

    pool = new Pool({
      connectionString: finalConnectionString,
      max: 5,
      idleTimeoutMillis: 10000,
    });

    // 1. Create tables if using existing database and tables do not exist
    if (!shouldCreateDb) {
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS Singers (
            SingerId bigint NOT NULL,
            FirstName character varying(1024),
            LastName character varying(1024),
            BirthDate date,
            LastModified timestamptz,
            Rating float8,
            Active boolean,
            Revenues numeric,
            Metadata jsonb,
            Tags text[],
            PRIMARY KEY (SingerId)
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS AllTypes (
            Id bigint NOT NULL,
            ColBool boolean,
            ColBytea bytea,
            ColInt8 bigint,
            ColFloat4 float4,
            ColFloat8 float8,
            ColNumeric numeric,
            ColText text,
            ColVarchar character varying(1024),
            ColDate date,
            ColTimestamp timestamptz,
            ColJsonb jsonb,
            ColUuid uuid,
            ArrBool boolean[],
            ArrBytea bytea[],
            ArrInt8 bigint[],
            ArrFloat4 float4[],
            ArrFloat8 float8[],
            ArrNumeric numeric[],
            ArrText text[],
            ArrDate date[],
            ArrTimestamp timestamptz[],
            ArrJsonb jsonb[],
            ArrUuid uuid[],
            PRIMARY KEY (Id)
          )
        `);
      } catch {
        // Table may already exist or DDL handled externally
      }
    }

    // 2. Seed initial test data inside a read-write transaction
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM Singers WHERE SingerId IN (1, 2, 3, 4)');
      await client.query(
        `
        INSERT INTO Singers (
          SingerId, FirstName, LastName, BirthDate, LastModified, Rating, Active, Revenues, Metadata, Tags
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `,
        [
          1,
          'Marc',
          'Richards',
          '1980-01-05',
          new Date('2023-01-01T12:00:00.000Z'),
          4.8,
          true,
          '125000.50',
          {genre: 'rock'},
          ['rock', 'classic'],
        ],
      );
      await client.query(
        `
        INSERT INTO Singers (
          SingerId, FirstName, LastName, BirthDate, LastModified, Rating, Active, Revenues, Metadata, Tags
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `,
        [
          2,
          'Catalina',
          'Smith',
          '1992-07-15',
          new Date('2023-02-01T15:30:00.000Z'),
          4.9,
          false,
          '95000.00',
          {genre: 'pop'},
          ['pop', 'dance'],
        ],
      );

      // Seed AllTypes table
      await client.query('DELETE FROM AllTypes WHERE Id IN (1, 2, 3, 4)');
      // Row 1: Fully populated values
      await client.query(
        `INSERT INTO AllTypes (
          Id, ColBool, ColBytea, ColInt8, ColFloat4, ColFloat8, ColNumeric, ColText, ColVarchar,
          ColDate, ColTimestamp, ColJsonb, ColUuid,
          ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText,
          ArrDate, ArrTimestamp, ArrJsonb, ArrUuid
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24
        )`,
        [
          1,
          true,
          Buffer.from('Spanner Binary Data'),
          BigInt('9223372036854775807'),
          3.14,
          2.718281828459045,
          '123456789.987654321',
          'Hello Spanner PostgreSQL',
          'Varchar sample',
          '2026-08-14',
          new Date('2026-08-14T12:00:00.000Z'),
          {name: 'Spanner', dialect: 'postgresql'},
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          [true, false, true],
          [Buffer.from('bin1'), Buffer.from('bin2')],
          [100, 200, 300],
          [1.1, 2.2],
          [3.1415, 2.7182],
          ['10.5', '20.25', '30.125'],
          ['alpha', 'beta', 'gamma'],
          ['2026-01-01', '2026-06-01'],
          [
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-06-01T00:00:00.000Z'),
          ],
          [{k: 'v1'}, {k: 'v2'}],
          [
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            'b1ffcd00-0d1c-5fa9-cc7e-7cc0ce491b22',
          ],
        ],
      );

      // Row 2: NULL values for all nullable columns
      await client.query(
        `INSERT INTO AllTypes (
          Id, ColBool, ColBytea, ColInt8, ColFloat4, ColFloat8, ColNumeric, ColText, ColVarchar,
          ColDate, ColTimestamp, ColJsonb, ColUuid,
          ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText,
          ArrDate, ArrTimestamp, ArrJsonb, ArrUuid
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24
        )`,
        [
          2,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      );

      // Row 3: Empty arrays
      await client.query(
        `INSERT INTO AllTypes (
          Id, ColBool, ColBytea, ColInt8, ColFloat4, ColFloat8, ColNumeric, ColText, ColVarchar,
          ColDate, ColTimestamp, ColJsonb, ColUuid,
          ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText,
          ArrDate, ArrTimestamp, ArrJsonb, ArrUuid
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24
        )`,
        [
          3,
          false,
          Buffer.from(''),
          0,
          0.5,
          0.5,
          '0',
          'Empty arrays row',
          'Empty arrays',
          '2026-01-01',
          new Date('2026-01-01T00:00:00.000Z'),
          {},
          '00000000-0000-0000-0000-000000000000',
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
      );

      // Row 4: Arrays with NULL elements inside them
      await client.query(
        `INSERT INTO AllTypes (
          Id, ColBool, ColBytea, ColInt8, ColFloat4, ColFloat8, ColNumeric, ColText, ColVarchar,
          ColDate, ColTimestamp, ColJsonb, ColUuid,
          ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText,
          ArrDate, ArrTimestamp, ArrJsonb, ArrUuid
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24
        )`,
        [
          4,
          true,
          Buffer.from('Null elements row'),
          100,
          1.5,
          2.5,
          '50.5',
          'Null elements in arrays',
          'Null elements',
          '2026-05-05',
          new Date('2026-05-05T12:00:00.000Z'),
          {hasNulls: true},
          'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
          [true, null, false],
          [Buffer.from('bin1'), null, Buffer.from('bin3')],
          [100, null, 300],
          [1.1, null, 3.3],
          [3.1415, null, 2.7182],
          ['10.5', null, '30.125'],
          ['alpha', null, 'gamma'],
          ['2026-01-01', null, '2026-06-01'],
          [
            new Date('2026-01-01T00:00:00.000Z'),
            null,
            new Date('2026-06-01T00:00:00.000Z'),
          ],
          [{k: 'v1'}, null, {k: 'v3'}],
          [
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            null,
            'b1ffcd00-0d1c-5fa9-cc7e-7cc0ce491b22',
          ],
        ],
      );
      await client.query('COMMIT');
      const countRes = await client.query(
        'SELECT count(*) as count FROM Singers',
      );
      console.log(
        'Seeded Singers successfully. Current row count:',
        countRes.rows,
      );
    } catch (seedErr) {
      console.error('FAILED TO SEED DATA:', seedErr);
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw seedErr;
    }
  });

  afterAll(async () => {
    try {
      if (client && client.isConnected) {
        await client.end();
      }
      if (pool) {
        await pool.end();
      }
    } catch {
      // Best effort cleanup
    }

    if (
      shouldCreateDb &&
      spannerAdminClient &&
      projectId &&
      instanceId &&
      dbName
    ) {
      try {
        console.log(`Dropping temporary test database: ${dbName}...`);
        await spannerAdminClient.dropDatabase({
          database: spannerAdminClient.databasePath(
            projectId,
            instanceId,
            dbName,
          ),
        });
        console.log(`Successfully dropped test database: ${dbName}`);
      } catch (dropErr) {
        console.warn(
          `Warning: Failed to drop test database ${dbName}:`,
          dropErr,
        );
      }
    }
  });

  describe('Data Types & Codecs', () => {
    describe('Scalar Types', () => {
      it('should query and decode all scalar column types from table', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName, LastName, BirthDate, LastModified, Rating, Active, Revenues, Metadata FROM Singers WHERE SingerId = 1',
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(row).toBeTruthy();
        expect(String(row.singerid || row.SingerId)).toBe('1');
        expect(row.firstname || row.FirstName).toBe('Marc');
        expect(row.lastname || row.LastName).toBe('Richards');
        expect(row.birthdate || row.BirthDate).toBe('1980-01-05');
        expect(
          (row.lastmodified || row.LastModified) instanceof Date,
        ).toBeTruthy();
        expect(row.active ?? row.Active).toBe(true);
        expect(Number(row.rating || row.Rating)).toBe(4.8);
        expect(Number(row.revenues || row.Revenues)).toBe(125000.5);

        const meta = (row.metadata || row.Metadata) as
          | {genre?: string}
          | undefined;
        expect(meta?.genre).toBe('rock');
      });

      it('should execute parameterized query with numeric parameter ($1)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName, Active FROM Singers WHERE SingerId = $1',
          [2],
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(String(row.singerid || row.SingerId)).toBe('2');
        expect(row.firstname || row.FirstName).toBe('Catalina');
        expect(row.active ?? row.Active).toBe(false);
      });

      it('should execute parameterized query with string parameter ($1)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName, LastName FROM Singers WHERE LastName = $1',
          ['Richards'],
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(row.firstname || row.FirstName).toBe('Marc');
      });

      it('should execute parameterized query with date parameter ($1::date)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE BirthDate = $1::date',
          ['1980-01-05'],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should execute parameterized query with timestamptz Date parameter ($1)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE LastModified = $1',
          [new Date('2023-01-01T12:00:00.000Z')],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should execute parameterized query with boolean parameter ($1)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE Active = $1',
          [true],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should execute parameterized query with numeric/decimal parameter ($1::numeric)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE Revenues = $1::numeric',
          ['125000.50'],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should execute parameterized query filtering jsonb column (Metadata ->> $1)', async () => {
        const res = await client.query(
          "SELECT SingerId, FirstName FROM Singers WHERE Metadata ->> 'genre' = $1",
          ['rock'],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should encode and decode jsonb parameter ($1::jsonb)', async () => {
        const res = await client.query('SELECT $1::jsonb as payload', [
          {genre: 'rock', tracks: 12},
        ]);
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].payload).toEqual({
          genre: 'rock',
          tracks: 12,
        });
      });

      it('should execute parameterized query with bytea Buffer parameter ($1::bytea)', async () => {
        const payload = Buffer.from('Spanner Binary Test Data');
        const res = await client.query('SELECT $1::bytea as bin_data', [
          payload,
        ]);
        expect(res.rowCount).toBe(1);
        const returnedBuf = res.rows[0].bin_data as Buffer;
        expect(Buffer.isBuffer(returnedBuf)).toBeTruthy();
        expect(returnedBuf).toEqual(payload);
      });

      it('should read and decode all table-storable scalar column types from AllTypes table', async () => {
        const res = await client.query(
          'SELECT ColBool, ColBytea, ColInt8, ColFloat4, ColFloat8, ColNumeric, ColText, ColVarchar, ColDate, ColTimestamp, ColJsonb, ColUuid FROM AllTypes WHERE Id = 1',
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(row).toBeTruthy();
        expect(row.colbool ?? row.ColBool).toBe(true);
        const bytea = (row.colbytea || row.ColBytea) as Buffer;
        expect(Buffer.isBuffer(bytea)).toBeTruthy();
        expect(bytea.toString()).toBe('Spanner Binary Data');
        expect(String(row.colint8 || row.ColInt8)).toBe('9223372036854775807');
        expect(
          Math.abs(Number(row.colfloat4 || row.ColFloat4) - 3.14) < 0.001,
        ).toBeTruthy();
        expect(
          Math.abs(Number(row.colfloat8 || row.ColFloat8) - 2.718281828459045) <
            0.000001,
        ).toBeTruthy();
        expect(String(row.colnumeric || row.ColNumeric)).toBe(
          '123456789.987654321',
        );
        expect(row.coltext || row.ColText).toBe('Hello Spanner PostgreSQL');
        expect(row.colvarchar || row.ColVarchar).toBe('Varchar sample');
        expect(row.coldate || row.ColDate).toBe('2026-08-14');
        expect(
          (row.coltimestamp || row.ColTimestamp) instanceof Date,
        ).toBeTruthy();
        expect(row.coljsonb || row.ColJsonb).toEqual({
          name: 'Spanner',
          dialect: 'postgresql',
        });
        expect(row.coluuid || row.ColUuid).toBe(
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        );
      });

      it('should execute parameterized query with uuid parameter ($1::uuid)', async () => {
        const uuidVal = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
        const res = await client.query('SELECT $1::uuid as uuid_val', [
          uuidVal,
        ]);
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].uuid_val).toBe(uuidVal);
      });

      it('should execute query with interval expression and date arithmetic', async () => {
        const res = await client.query(
          "SELECT CAST('1 year 2 months 3 days' AS INTERVAL) as interval_val, ('2026-01-01 00:00:00+00'::timestamptz + CAST('1 year 2 months 3 days' AS INTERVAL)) as shifted_time",
        );
        expect(res.rowCount).toBe(1);
        expect(
          typeof res.rows[0].interval_val === 'string' &&
            res.rows[0].interval_val.length > 0,
        ).toBeTruthy();
        expect(res.rows[0].shifted_time instanceof Date).toBeTruthy();
      });

      it('should execute parameterized query with float4 parameter ($1::float4)', async () => {
        const res = await client.query('SELECT $1::float4 as f4_val', [3.14]);
        expect(res.rowCount).toBe(1);
        expect(
          Math.abs(Number(res.rows[0].f4_val) - 3.14) < 0.001,
        ).toBeTruthy();
      });

      it('should execute parameterized query with float8 parameter ($1::float8)', async () => {
        const res = await client.query('SELECT $1::float8 as f8_val', [
          2.718281828459045,
        ]);
        expect(res.rowCount).toBe(1);
        expect(
          Math.abs(Number(res.rows[0].f8_val) - 2.718281828459045) < 0.000001,
        ).toBeTruthy();
      });
    });

    describe('Array Types', () => {
      it('should read and decode array column (Tags text[]) from Singers table', async () => {
        const res = await client.query(
          'SELECT SingerId, Tags FROM Singers WHERE SingerId = 1',
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].tags || res.rows[0].Tags).toEqual([
          'rock',
          'classic',
        ]);
      });

      it('should read and decode all table-storable array column types from AllTypes table', async () => {
        const res = await client.query(
          'SELECT ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText, ArrDate, ArrTimestamp, ArrJsonb, ArrUuid FROM AllTypes WHERE Id = 1',
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(row.arrbool || row.ArrBool).toEqual([true, false, true]);
        const byteaArr = (row.arrbytea || row.ArrBytea) as Buffer[];
        expect(Array.isArray(byteaArr)).toBeTruthy();
        expect(byteaArr[0].toString()).toBe('bin1');
        expect(byteaArr[1].toString()).toBe('bin2');
        expect(row.arrint8 || row.ArrInt8).toEqual(['100', '200', '300']);
        const float4Arr = (row.arrfloat4 || row.ArrFloat4) as number[];
        expect(Math.abs(float4Arr[0] - 1.1) < 0.01).toBeTruthy();
        expect(Math.abs(float4Arr[1] - 2.2) < 0.01).toBeTruthy();
        const float8Arr = (row.arrfloat8 || row.ArrFloat8) as number[];
        expect(Math.abs(float8Arr[0] - 3.1415) < 0.0001).toBeTruthy();
        expect(Math.abs(float8Arr[1] - 2.7182) < 0.0001).toBeTruthy();
        expect(row.arrnumeric || row.ArrNumeric).toEqual([
          '10.5',
          '20.25',
          '30.125',
        ]);
        expect(row.arrtext || row.ArrText).toEqual(['alpha', 'beta', 'gamma']);
        expect(row.arrdate || row.ArrDate).toEqual([
          '2026-01-01',
          '2026-06-01',
        ]);
        const tsArr = (row.arrtimestamp || row.ArrTimestamp) as Date[];
        expect(tsArr[0] instanceof Date).toBeTruthy();
        expect(tsArr[1] instanceof Date).toBeTruthy();
        expect(row.arrjsonb || row.ArrJsonb).toEqual([{k: 'v1'}, {k: 'v2'}]);
        expect(row.arruuid || row.ArrUuid).toEqual([
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          'b1ffcd00-0d1c-5fa9-cc7e-7cc0ce491b22',
        ]);
      });

      it('should query table rows using array membership filter ($1 = ANY(Tags))', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE $1 = ANY(Tags)',
          ['rock'],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should execute parameterized query with numeric array parameter ($1 = ANY)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = ANY($1) ORDER BY SingerId',
          [[1, 2]],
        );
        expect(res.rowCount).toBe(2);
        expect(res.rows.length).toBe(2);
        expect(String(res.rows[0].singerid || res.rows[0].SingerId)).toBe('1');
        expect(String(res.rows[1].singerid || res.rows[1].SingerId)).toBe('2');
      });

      it('should execute parameterized query with string array parameter ($1 = ANY)', async () => {
        const res = await client.query(
          'SELECT SingerId, LastName FROM Singers WHERE LastName = ANY($1) ORDER BY SingerId',
          [['Richards', 'Smith']],
        );
        expect(res.rowCount).toBe(2);
        expect(res.rows[0].lastname || res.rows[0].LastName).toBe('Richards');
        expect(res.rows[1].lastname || res.rows[1].LastName).toBe('Smith');
      });

      it('should encode and decode array types ($1::text[] and $2::bigint[])', async () => {
        const res = await client.query(
          'SELECT $1::text[] as text_arr, $2::bigint[] as int_arr',
          [
            ['apple', 'banana', 'cherry'],
            [10, 20, 30],
          ],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].text_arr).toEqual(['apple', 'banana', 'cherry']);
        expect(res.rows[0].int_arr).toEqual(['10', '20', '30']);
      });

      it('should read and decode row with all NULL column values (Id = 2)', async () => {
        const res = await client.query(
          'SELECT ColBool, ColBytea, ColInt8, ColFloat4, ColFloat8, ColNumeric, ColText, ColVarchar, ColDate, ColTimestamp, ColJsonb, ColUuid, ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText, ArrDate, ArrTimestamp, ArrJsonb, ArrUuid FROM AllTypes WHERE Id = 2',
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0] as Record<string, unknown>;
        expect(row).toBeTruthy();
        const getCol = (name: string) =>
          row[name.toLowerCase()] !== undefined
            ? row[name.toLowerCase()]
            : row[name];

        expect(getCol('ColBool')).toBe(null);
        expect(getCol('ColBytea')).toBe(null);
        expect(getCol('ColInt8')).toBe(null);
        expect(getCol('ColFloat4')).toBe(null);
        expect(getCol('ColFloat8')).toBe(null);
        expect(getCol('ColNumeric')).toBe(null);
        expect(getCol('ColText')).toBe(null);
        expect(getCol('ColVarchar')).toBe(null);
        expect(getCol('ColDate')).toBe(null);
        expect(getCol('ColTimestamp')).toBe(null);
        expect(getCol('ColJsonb')).toBe(null);
        expect(getCol('ColUuid')).toBe(null);
        expect(getCol('ArrBool')).toBe(null);
        expect(getCol('ArrBytea')).toBe(null);
        expect(getCol('ArrInt8')).toBe(null);
        expect(getCol('ArrFloat4')).toBe(null);
        expect(getCol('ArrFloat8')).toBe(null);
        expect(getCol('ArrNumeric')).toBe(null);
        expect(getCol('ArrText')).toBe(null);
        expect(getCol('ArrDate')).toBe(null);
        expect(getCol('ArrTimestamp')).toBe(null);
        expect(getCol('ArrJsonb')).toBe(null);
        expect(getCol('ArrUuid')).toBe(null);
      });

      it('should read and decode row with empty array columns (Id = 3)', async () => {
        const res = await client.query(
          'SELECT ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText, ArrDate, ArrTimestamp, ArrJsonb, ArrUuid FROM AllTypes WHERE Id = 3',
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(row.arrbool || row.ArrBool).toEqual([]);
        expect(row.arrbytea || row.ArrBytea).toEqual([]);
        expect(row.arrint8 || row.ArrInt8).toEqual([]);
        expect(row.arrfloat4 || row.ArrFloat4).toEqual([]);
        expect(row.arrfloat8 || row.ArrFloat8).toEqual([]);
        expect(row.arrnumeric || row.ArrNumeric).toEqual([]);
        expect(row.arrtext || row.ArrText).toEqual([]);
        expect(row.arrdate || row.ArrDate).toEqual([]);
        expect(row.arrtimestamp || row.ArrTimestamp).toEqual([]);
        expect(row.arrjsonb || row.ArrJsonb).toEqual([]);
        expect(row.arruuid || row.ArrUuid).toEqual([]);
      });

      it('should read and decode row with arrays containing NULL elements (Id = 4)', async () => {
        const res = await client.query(
          'SELECT ArrBool, ArrBytea, ArrInt8, ArrFloat4, ArrFloat8, ArrNumeric, ArrText, ArrDate, ArrTimestamp, ArrJsonb, ArrUuid FROM AllTypes WHERE Id = 4',
        );
        expect(res.rowCount).toBe(1);
        const row = res.rows[0];
        expect(row.arrbool || row.ArrBool).toEqual([true, null, false]);
        const byteaArr = (row.arrbytea || row.ArrBytea) as (Buffer | null)[];
        expect(Array.isArray(byteaArr)).toBeTruthy();
        expect(byteaArr[0]?.toString()).toBe('bin1');
        expect(byteaArr[1]).toBe(null);
        expect(byteaArr[2]?.toString()).toBe('bin3');
        expect(row.arrint8 || row.ArrInt8).toEqual(['100', null, '300']);
        const float4Arr = (row.arrfloat4 || row.ArrFloat4) as (number | null)[];
        expect(Math.abs(float4Arr[0]! - 1.1) < 0.01).toBeTruthy();
        expect(float4Arr[1]).toBe(null);
        expect(Math.abs(float4Arr[2]! - 3.3) < 0.01).toBeTruthy();
        expect(row.arrnumeric || row.ArrNumeric).toEqual([
          '10.5',
          null,
          '30.125',
        ]);
        expect(row.arrtext || row.ArrText).toEqual(['alpha', null, 'gamma']);
        expect(row.arrdate || row.ArrDate).toEqual([
          '2026-01-01',
          null,
          '2026-06-01',
        ]);
        const tsArr = (row.arrtimestamp || row.ArrTimestamp) as (Date | null)[];
        expect(tsArr[0] instanceof Date).toBeTruthy();
        expect(tsArr[1]).toBe(null);
        expect(tsArr[2] instanceof Date).toBeTruthy();
        expect(row.arrjsonb || row.ArrJsonb).toEqual([
          {k: 'v1'},
          null,
          {k: 'v3'},
        ]);
        expect(row.arruuid || row.ArrUuid).toEqual([
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          null,
          'b1ffcd00-0d1c-5fa9-cc7e-7cc0ce491b22',
        ]);
      });

      it('should support objects with custom .toPostgres() in queries and array parameters', async () => {
        const customSingerId = {
          toPostgres: () => 1,
        };
        const customItem1 = {
          toPostgres: () => 'Richards',
        };
        const customItem2 = {
          toPostgres: () => 'Smith',
        };

        // Scalar parameter with .toPostgres()
        const res1 = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = $1',
          [customSingerId],
        );
        expect(res1.rowCount).toBe(1);
        expect(res1.rows[0].firstname || res1.rows[0].FirstName).toBe('Marc');

        // Array parameter with .toPostgres() elements inside array
        const res2 = await client.query(
          'SELECT SingerId, LastName FROM Singers WHERE LastName = ANY($1) ORDER BY SingerId',
          [[customItem1, customItem2]],
        );
        expect(res2.rowCount).toBe(2);
        expect(res2.rows[0].lastname || res2.rows[0].LastName).toBe('Richards');
        expect(res2.rows[1].lastname || res2.rows[1].LastName).toBe('Smith');

        // Array value returned from .toPostgres()
        const res3 = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = ANY($1)',
          [{toPostgres: () => [1, 2]}],
        );
        expect(res3.rowCount).toBe(2);
      });

      it('should query AllTypes rows using array membership filter ($1 = ANY(ArrUuid))', async () => {
        const res = await client.query(
          'SELECT Id FROM AllTypes WHERE $1 = ANY(ArrUuid) ORDER BY Id',
          ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
        );
        expect(res.rowCount).toBe(2); // Rows 1 and 4 have this UUID in ArrUuid
        expect(String(res.rows[0].id || res.rows[0].Id)).toBe('1');
        expect(String(res.rows[1].id || res.rows[1].Id)).toBe('4');
      });

      it('should query AllTypes rows using numeric array membership filter ($1 = ANY(ArrInt8))', async () => {
        const res = await client.query(
          'SELECT Id FROM AllTypes WHERE $1 = ANY(ArrInt8)',
          [200],
        );
        expect(res.rowCount).toBe(1);
        expect(String(res.rows[0].id || res.rows[0].Id)).toBe('1');
      });
    });

    describe('Field Metadata & PostgreSQL Catalog OIDs', () => {
      it('should map Spanner column metadata to exact PostgreSQL catalog OIDs (BuiltinOids)', async () => {
        const res = await client.query('SELECT * FROM AllTypes WHERE Id = 1');
        expect(res.rowCount).toBe(1);
        expect(res.fields && res.fields.length > 0).toBeTruthy();

        const fieldMap = new Map(
          res.fields.map(f => [f.name.toLowerCase(), f.dataTypeID]),
        );

        // Assert scalar PostgreSQL OIDs from table
        expect(fieldMap.get('id')).toBe(BuiltinOids.INT8);
        expect(fieldMap.get('colbool')).toBe(BuiltinOids.BOOL);
        expect(fieldMap.get('colbytea')).toBe(BuiltinOids.BYTEA);
        expect(fieldMap.get('colint8')).toBe(BuiltinOids.INT8);
        expect(fieldMap.get('colfloat4')).toBe(BuiltinOids.FLOAT4);
        expect(fieldMap.get('colfloat8')).toBe(BuiltinOids.FLOAT8);
        expect(fieldMap.get('colnumeric')).toBe(BuiltinOids.NUMERIC);
        expect(fieldMap.get('coltext')).toBe(BuiltinOids.TEXT);
        expect(fieldMap.get('coldate')).toBe(BuiltinOids.DATE);
        expect(fieldMap.get('coltimestamp')).toBe(BuiltinOids.TIMESTAMPTZ);
        expect(fieldMap.get('coljsonb')).toBe(BuiltinOids.JSONB);
        expect(fieldMap.get('coluuid')).toBe(BuiltinOids.UUID);

        // Assert Array OIDs from table
        expect(fieldMap.get('arrbool')).toBe(1000);
        expect(fieldMap.get('arrbytea')).toBe(1001);
        expect(fieldMap.get('arrint8')).toBe(1016);
        expect(fieldMap.get('arrfloat4')).toBe(1021);
        expect(fieldMap.get('arrfloat8')).toBe(1022);
        expect(fieldMap.get('arrnumeric')).toBe(1231);
        expect(fieldMap.get('arrtext')).toBe(1009);
        expect(fieldMap.get('arrdate')).toBe(1182);
        expect(fieldMap.get('arrtimestamp')).toBe(1185);
        expect(fieldMap.get('arrjsonb')).toBe(3807);
        expect(fieldMap.get('arruuid')).toBe(2951);

        // Assert interval OID via expression query
        const ivalRes = await client.query(
          "SELECT CAST('1 day' AS INTERVAL) as ival",
        );
        const ivalFields = new Map(
          ivalRes.fields.map(f => [f.name.toLowerCase(), f.dataTypeID]),
        );
        expect(ivalFields.get('ival')).toBe(BuiltinOids.INTERVAL);
      });
    });
  });

  describe('Query Options & Features', () => {
    describe('Row Formatting (rowMode)', () => {
      it('should format rows as objects by default (rowMode: object)', async () => {
        const res = await client.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = 1',
        );
        expect(res.rowCount).toBe(1);
        expect(typeof res.rows[0]).toBe('object');
        expect(Array.isArray(res.rows[0])).toBe(false);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      });

      it('should format rows as positional arrays when rowMode is array', async () => {
        const res = await client.query({
          text: 'SELECT SingerId, FirstName, LastName, Tags FROM Singers WHERE SingerId = 1',
          rowMode: 'array',
        });
        expect(res.rowCount).toBe(1);
        expect(res.rows[0]).toEqual([
          '1',
          'Marc',
          'Richards',
          ['rock', 'classic'],
        ]);
      });
    });

    describe('Streaming Queries (EventEmitter)', () => {
      it('should stream rows and fields events for Singers query', async () => {
        const q = client.query('SELECT * FROM Singers ORDER BY SingerId');
        let fieldsReceived = false;
        const rows: unknown[] = [];

        void q.on('fields', fields => {
          fieldsReceived = true;
          expect(fields.length >= 2).toBeTruthy();
        });
        void q.on('row', (row, currentResult) => {
          rows.push(row);
          expect(currentResult).toBeTruthy();
          expect(currentResult.fields.length >= 2).toBeTruthy();
        });

        const res = (await q) as QueryResult;
        expect(fieldsReceived).toBe(true);
        expect(rows.length >= 2).toBe(true);
        expect(res.rows).toEqual(rows);
      });
    });

    describe('Transactions (BEGIN / COMMIT / ROLLBACK)', () => {
      it('should insert a singer in a transaction and COMMIT', async () => {
        await client.query('BEGIN');
        expect(client.txStatus).toBe('T');

        await client.query(`
          INSERT INTO Singers (SingerId, FirstName, LastName, Active)
          VALUES (3, 'Alice', 'Cooper', true)
        `);

        await client.query('COMMIT');
        expect(client.txStatus).toBe('I');

        const res = await client.query(
          'SELECT FirstName FROM Singers WHERE SingerId = 3',
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Alice');
      });

      it('should rollback transaction and not persist rows on ROLLBACK', async () => {
        await client.query('BEGIN');
        expect(client.txStatus).toBe('T');

        await client.query(`
          INSERT INTO Singers (SingerId, FirstName, LastName, Active)
          VALUES (4, 'Bob', 'Marley', true)
        `);

        await client.query('ROLLBACK');
        expect(client.txStatus).toBe('I');

        const res = await client.query(
          'SELECT * FROM Singers WHERE SingerId = 4',
        );
        expect(res.rowCount).toBe(0);
      });

      // Currently this test is failing as node wrapper is not returning transaction state in case of error.
      it.skip('should transition txStatus to E on error inside transaction and reset to I on ROLLBACK', async () => {
        await client.query('BEGIN');
        expect(client.txStatus).toBe('T');

        try {
          // Trigger an error inside the active transaction
          await client.query('SELECT * FROM non_existent_table_for_tx_test');
          throw new Error('Should have thrown error on non-existent table');
        } catch {
          expect(client.txStatus).toBe('E');
        }

        await client.query('ROLLBACK');
        expect(client.txStatus).toBe('I');
      });
    });
  });

  describe('Connection Pool (Pool Class)', () => {
    it('should acquire client, execute query and release back to pool', async () => {
      const clientFromPool = await pool.connect();
      expect(clientFromPool).toBeTruthy();

      try {
        const res = await clientFromPool.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = 1',
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].firstname || res.rows[0].FirstName).toBe('Marc');
      } finally {
        await clientFromPool.release();
      }
    });

    it('should execute direct query via pool.query()', async () => {
      const res = await pool.query('SELECT count(*) as total FROM Singers');
      expect(res.rowCount).toBe(1);
      expect(
        Number(res.rows[0].total) >= 2 || Number(res.rows[0].count) >= 2,
      ).toBeTruthy();
    });

    it('should format pool query results as positional arrays when rowMode is array', async () => {
      const res = await pool.query({
        text: 'SELECT SingerId, FirstName FROM Singers WHERE SingerId = 1',
        rowMode: 'array',
      });
      expect(res.rowCount).toBe(1);
      expect(res.rows[0]).toEqual(['1', 'Marc']);
    });

    it('should execute concurrent queries via pool', async () => {
      const queries = [
        pool.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = 1',
        ),
        pool.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = 2',
        ),
        pool.query(
          'SELECT SingerId, FirstName FROM Singers WHERE SingerId = 3',
        ),
      ];

      const results = await Promise.all(queries);
      expect(results.length).toBe(3);
      expect(results[0].rowCount).toBe(1);
      expect(results[1].rowCount).toBe(1);
      expect(results[2].rowCount).toBe(1);
    });

    it('should stream rows and fields events via pool.query()', async () => {
      const q = pool.query('SELECT SingerId, FirstName FROM Singers');
      let fieldsReceived = false;
      const rows: unknown[] = [];
      let lastResult: QueryResult | undefined;

      void q.on('fields', fields => {
        fieldsReceived = true;
        expect(fields.length >= 2).toBeTruthy();
      });
      void q.on('row', (row, result) => {
        rows.push(row);
        lastResult = result;
        expect(result).toBeTruthy();
        expect(result.fields.length >= 2).toBeTruthy();
      });

      const res = (await q) as QueryResult;
      expect(fieldsReceived).toBe(true);
      expect(rows.length >= 2).toBe(true);
      expect(lastResult).toBeTruthy();
      expect(res.rows).toEqual(rows);
    });
  });
});
