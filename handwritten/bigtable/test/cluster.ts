// Copyright 2016 Google LLC
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

import {PassThrough, Readable} from 'stream';
import {CallOptions} from 'google-gax';
import {PreciseDate} from '@google-cloud/precise-date';
import {ClusterUtils} from '../src/utils/cluster';
import {InstanceOptions, RequestOptions} from '../src';
import {createClusterOptionsList} from './constants/cluster';
import {Cluster as RealCluster} from '../src/cluster';

export interface Options {
  nodes?: Number;
  gaxOptions?: {
    timeout: number;
  };
}

(global as any).mockPromisified = (global as any).mockPromisified || false;
jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (klass: Function, options: any) => {
    if (klass.name === 'Cluster') {
      (global as any).mockPromisified = true;
      expect(options.exclude).toEqual(['backup']);
    }
  },
}));

jest.mock('../src/backup', () => ({
  Backup: class FakeBackup {
    calledWith_: Array<{}>;
    constructor(...args: any[]) {
      this.calledWith_ = Array.from(args);
    }
  },
}));

import {Backup} from '../src/backup';
const FakeBackup: any = Backup;
const Cluster: any = RealCluster;

describe('Bigtable/Cluster', () => {
  const CLUSTER_ID = 'my-cluster';
  const PROJECT_ID = 'grape-spaceship-123';

  const INSTANCE = {
    name: `projects/${PROJECT_ID}/instances/i`,
    bigtable: {projectId: PROJECT_ID},
  };

  const CLUSTER_NAME = `${INSTANCE.name}/clusters/${CLUSTER_ID}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cluster: any;

  
  beforeEach(() => {
    cluster = new Cluster(INSTANCE, CLUSTER_ID);
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).mockPromisified).toBeTruthy();
    });

    it('should localize Bigtable instance', () => {
      expect(cluster.bigtable).toBe(INSTANCE.bigtable);
    });

    it('should localize Instance instance', () => {
      expect(cluster.instance).toBe(INSTANCE);
    });

    it('should expand id into full resource path', () => {
      expect(cluster.name).toBe(CLUSTER_NAME);
    });

    it('should leave full cluster names unaltered', () => {
      const cluster = new Cluster(INSTANCE, CLUSTER_ID);
      expect(cluster.name).toBe(CLUSTER_NAME);
    });

    it('should localize the id from the name', () => {
      expect(cluster.id).toBe(CLUSTER_ID);
    });

    it('should leave full cluster names unaltered and localize the id from the name', () => {
      const cluster = new Cluster(INSTANCE, CLUSTER_NAME);
      expect(cluster.name).toBe(CLUSTER_NAME);
      expect(cluster.id).toBe(CLUSTER_ID);
    });

    it('should throw if cluster id in wrong format', () => {
      const id = `clusters/${CLUSTER_ID}`;
      expect(() => { new Cluster(INSTANCE, id); }).toThrow(Error);
    });
  });

  describe('getLocation_', () => {
    const LOCATION = 'us-central2-d';

    it('should format the location name', () => {
      const expected = `projects/${PROJECT_ID}/locations/${LOCATION}`;
      const formatted = Cluster.getLocation_(PROJECT_ID, LOCATION);
      expect(formatted).toBe(expected);
    });

    it('should format the location name for project name with /', () => {
      const PROJECT_NAME = 'projects/grape-spaceship-123';
      const expected = `projects/${PROJECT_NAME.split(
        '/',
      ).pop()}/locations/${LOCATION}`;
      const formatted = Cluster.getLocation_(PROJECT_NAME, LOCATION);
      expect(formatted).toBe(expected);
    });

    it('should not re-format a complete location', () => {
      const complete = `projects/p/locations/${LOCATION}`;
      const formatted = Cluster.getLocation_(PROJECT_ID, complete);
      expect(formatted).toBe(complete);
    });
  });

  describe('getStorageType_', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types: any = {
      unspecified: 0,
      ssd: 1,
      hdd: 2,
    };

    it('should default to unspecified', () => {
      expect(Cluster.getStorageType_()).toBe(types.unspecified);
    });

    it('should lowercase a type', () => {
      expect(Cluster.getStorageType_('SSD')).toBe(types.ssd);
    });

    Object.keys(types).forEach(type => {
      it('should get the storage type for "' + type + '"', () => {
        expect(Cluster.getStorageType_(type)).toBe(types[type]);
      });
    });
  });

  describe('backup', () => {
    it('should return a Backup object', () => {
      const backupId = 'backup-id';
      const backup = cluster.backup(backupId);
      expect(backup instanceof FakeBackup).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (backup as any).calledWith_;
      expect(args[0]).toBe(cluster);
      expect(args[1]).toBe(backupId);
    });
  });

  describe('create', () => {
    it('should call createCluster from instance', done => {
      const options = {};

      cluster.instance.createCluster = (
        id: string,
        options_: {},
        callback: Function,
      ) => {
        expect(id).toBe(cluster.id);
        expect(options_).toBe(options);
        callback(); // done()
      };

      cluster.create(options, done);
    });

    it('should not require options', done => {
      cluster.instance.createCluster = (
        id: string,
        options: {},
        callback: Function,
      ) => {
        expect(options).toEqual({});
        callback(); // done()
      };

      cluster.create(done);
    });
  });

  describe('createBackup', () => {
    it('should throw if backup id not provided', () => {
      expect(() => { cluster.createBackup(); }).toThrow(/An id is required to create a backup\./);
    });

    it('should throw if config is not provided', () => {
      expect(() => { cluster.createBackup('id'); }).toThrow(/A configuration object is required\./);
    });

    it('should throw if a source table is not provided', () => {
      expect(() => { cluster.createBackup('id', {}); }).toThrow(/A source table is required to backup\./);
    });

    it('should accept table as a string', done => {
      const table = 'table-name';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.reqOpts.backup.sourceTable).toBe(table);
        done();
      };

      cluster.createBackup(
        'id',
        {
          table,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should accept table as a Table object', done => {
      const table = {
        name: 'table-name',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.reqOpts.backup.sourceTable).toBe(table.name);
        done();
      };

      cluster.createBackup(
        'id',
        {
          table,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should not include table in request options', done => {
      const table = 'table-name';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(typeof config.reqOpts.backup.table).toBe('undefined');
        done();
      };

      cluster.createBackup(
        'id',
        {
          table,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should convert a Date expireTime to a struct', done => {
      const expireTime = new Date();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(
          config.reqOpts.backup.expireTime,
        ).toEqual(new PreciseDate(expireTime).toStruct());
        done();
      };

      cluster.createBackup(
        'id',
        {
          table: 'table-id',
          expireTime,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should send correct request', done => {
      const backupId = 'backup-id';
      const table = 'table-name';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('createBackup');
        expect(config.reqOpts).toEqual({
          parent: cluster.name,
          backupId,
          backup: {
            sourceTable: table,
            configProperty: true,
          },
        });
        expect(typeof config.gaxOpts).toBe('undefined');
        done();
      };

      cluster.createBackup(
        backupId,
        {
          table,
          configProperty: true,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should accept gaxOptions', done => {
      const table = 'table-name';
      const gaxOptions = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      cluster.createBackup(
        'id',
        {
          table,
          gaxOptions,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should not include gaxOptions in request options', done => {
      const table = 'table-name';
      const gaxOptions = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(typeof config.reqOpts.gaxOptions).toBe('undefined');
        done();
      };

      cluster.createBackup(
        'id',
        {
          table,
          gaxOptions,
        },
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should execute callback with error and original args', done => {
      const error = new Error('Error.');
      const args = [{}, {}, {}];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        callback(error, ...args);
      };

      cluster.createBackup(
        'id',
        {
          table: 'table-name',
        },
        (err: Error, backup: {}, ..._args: Array<{}>) => {
          expect(err).toBe(error);
          expect(backup).toBe(undefined);
          expect(Array.from(_args)).toEqual(args);
          done();
        },
      );
    });

    it('should execute callback with Backup and original args', done => {
      const id = 'backup-id';
      const backupInstance = {};
      const args = [{}, {}, {}];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        callback(null, ...args);
      };

      cluster.backup = (_id: string) => {
        expect(_id).toBe(id);
        return backupInstance;
      };

      cluster.createBackup(
        id,
        {
          table: 'table-name',
        },
        (err: Error, backup: {}, ..._args: Array<{}>) => {
          ((err: any) => { expect(err).toBeFalsy(); })(err);
          expect(backup).toBe(backupInstance);
          expect(Array.from(_args)).toEqual(args);
          done();
        },
      );
    });
  });

  describe('delete', () => {
    it('should make the correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        expect(config.client).toBe('BigtableInstanceAdminClient');
        expect(config.method).toBe('deleteCluster');

        expect(config.reqOpts).toEqual({
          name: cluster.name,
        });

        expect(config.gaxOpts).toEqual({});

        callback(); // done()
      };

      cluster.delete(done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      cluster.delete(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });
  });

  describe('exists', () => {
    it('should not require gaxOptions', done => {
      cluster.getMetadata = (gaxOptions: CallOptions) => {
        expect(gaxOptions).toEqual({});
        done();
      };

      cluster.exists(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should pass gaxOptions to getMetadata', done => {
      const gaxOptions = {};

      cluster.getMetadata = (gaxOptions_: CallOptions) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      };

      cluster.exists(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return false if error code is 5', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error('Error.');
      error.code = 5;

      cluster.getMetadata = (gaxOptions: CallOptions, callback: Function) => {
        callback(error);
      };

      cluster.exists((err: Error, exists: boolean) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(false);
        done();
      });
    });

    it('should return error if code is not 5', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error('Error.');
      error.code = 'NOT-5';
      cluster.getMetadata = (_: CallOptions, callback: Function) => {
        callback(error);
      };
      cluster.exists((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return true if no error', done => {
      cluster.getMetadata = (gaxOptions: CallOptions, callback: Function) => {
        callback(null, {});
      };
      cluster.exists((err: Error, exists: boolean) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(true);
        done();
      });
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const gaxOptions = {};
      cluster.getMetadata = (gaxOptions_: {}) => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      };
      cluster.get(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should not require gaxOptions', done => {
      cluster.getMetadata = (gaxOptions: CallOptions) => {
        expect(gaxOptions).toEqual({});
        done();
      };

      cluster.get(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.');

      cluster.getMetadata = (gaxOptions: CallOptions, callback: Function) => {
        callback(error);
      };

      cluster.get((err: Error) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return self and API response', done => {
      const metadata = {};

      cluster.getMetadata = (gaxOptions: CallOptions, callback: Function) => {
        callback(null, metadata);
      };

      cluster.get((err: Error, cluster_: {}, metadata_: {}) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(cluster_).toBe(cluster);
        expect(metadata_).toBe(metadata);
        done();
      });
    });
  });

  describe('getBackups', () => {
    it('should send the correct request', done => {
      const options = {a: 'b'};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('listBackups');
        expect(config.reqOpts).toEqual({
          parent: cluster.name,
          pageSize: undefined,
          pageToken: undefined,
          ...options,
        });
        expect(config.gaxOpts).toEqual({});

        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should locate pagination settings from gaxOptions', done => {
      const options = {
        gaxOptions: {
          pageSize: 'size',
          pageToken: 'token',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(
          config.reqOpts.pageSize).toBe(options.gaxOptions.pageSize,
        );
        expect(
          config.reqOpts.pageToken).toBe(options.gaxOptions.pageToken,
        );
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should prefer pageSize and pageToken from options over gaxOptions', done => {
      const options = {
        pageSize: 'size-good',
        pageToken: 'token-good',
        gaxOptions: {
          pageSize: 'size-bad',
          pageToken: 'token-bad',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.reqOpts.pageSize).toBe(options.pageSize);
        expect(config.reqOpts.pageToken).toBe(options.pageToken);
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should remove extraneous pagination settings from request', done => {
      const options = {
        gaxOptions: {
          pageSize: 'size',
          pageToken: 'token',
        },
        autoPaginate: true,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(typeof config.gaxOpts.pageSize).toBe('undefined');
        expect(typeof config.gaxOpts.pageToken).toBe('undefined');
        expect(typeof config.reqOpts.autoPaginate).toBe('undefined');
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const options = {
        gaxOptions: {a: 'b'},
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(typeof config.reqOpts.gaxOptions).toBe('undefined');
        expect(config.gaxOpts).toEqual(options.gaxOptions);
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should not send gaxOptions as request options', done => {
      const options = {
        gaxOptions: {a: 'b'},
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(Object.keys(options.gaxOptions).every(k => !config.reqOpts[k])).toBeTruthy();
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should set autoPaginate from options', done => {
      const options = {
        autoPaginate: true,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.gaxOpts.autoPaginate).toBe(options.autoPaginate);
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should prefer autoPaginate from gaxOpts', done => {
      const options = {
        autoPaginate: false,
        gaxOptions: {
          autoPaginate: true,
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.gaxOpts.autoPaginate).toBe(true);
        done();
      };

      cluster.getBackups(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should execute callback with error and correct response arguments', done => {
      const error = new Error('Error.');
      const apiResponse = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        callback(error, [], null, apiResponse);
      };

      cluster.getBackups(
        (err: Error, backups: [], nextQuery: {}, apiResp: {}) => {
          expect(err).toBe(error);
          expect(backups).toEqual([]);
          expect(nextQuery).toBe(null);
          expect(apiResp).toBe(apiResponse);
          done();
        },
      );
    });

    it('should execute callback with Backup instances', done => {
      const rawBackup = {name: 'long/formatted/name', a: 'b'};
      const backupInstance = {};

      cluster.backup = (id: string) => {
        expect(id).toBe(rawBackup.name.split('/').pop());
        return backupInstance;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        callback(null, [rawBackup]);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.getBackups((err: Error, backups: any[]) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(backups).toEqual([backupInstance]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((backups[0] as any)!.metadata).toBe(rawBackup);
        done();
      });
    });

    it('should create Backup from correct cluster when using - as an id', done => {
      cluster.id = '-';

      const clusterId = 'cluster-id';
      const backupId = 'backup-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        callback(null, [
          {
            name: `projects/project-id/clusters/${clusterId}/backups/${backupId}`,
          },
        ]);
      };

      cluster.instance.cluster = (id: string) => {
        expect(id).toBe(clusterId);

        return {
          backup: (id: string) => {
            expect(id).toBe(backupId);
            setImmediate(done);
            return {};
          },
        };
      };

      cluster.getBackups(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should execute callback with prepared nextQuery', done => {
      const options = {pageToken: '1'};
      const nextQuery = {pageToken: '2'};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        callback(null, [], nextQuery);
      };

      cluster.getBackups(options, (err: Error, backups: [], _nextQuery: {}) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(_nextQuery).toEqual(nextQuery);
        done();
      });
    });
  });

  describe('getBackupsStream', () => {
    it('should make correct request', done => {
      const options = {a: 'b'};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('listBackupsStream');
        expect(config.reqOpts).toEqual({
          parent: cluster.name,
          ...options,
        });
        expect(typeof config.gaxOpts).toBe('undefined');
        setImmediate(done);
        return new PassThrough();
      };

      cluster.getBackupsStream(options);
    });

    it('should accept gaxOptions', done => {
      const options = {gaxOptions: {}};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.gaxOpts).toBe(options.gaxOptions);
        setImmediate(done);
        return new PassThrough();
      };

      cluster.getBackupsStream(options);
    });

    it('should not include gaxOptions in reqOpts', done => {
      const options = {gaxOptions: {a: 'b'}};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(Object.keys(options.gaxOptions).every(k => !config.reqOpts[k])).toBeTruthy();
        setImmediate(done);
        return new PassThrough();
      };

      cluster.getBackupsStream(options);
    });

    it('should transform response backups into Backup objects', done => {
      const rawBackup = {name: 'long/formatted/name', a: 'b'};
      const backupInstance = {};
      const requestStream = new Readable({
        objectMode: true,
        read() {
          this.push(rawBackup);
          this.push(null);
        },
      });

      cluster.backup = (id: string) => {
        expect(id).toBe(rawBackup.name.split('/').pop());
        return backupInstance;
      };

      cluster.bigtable.request = () => requestStream;

      cluster
        .getBackupsStream()
        .on('error', done)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .on('data', (backup: any) => {
          expect(backup).toBe(backupInstance);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((backup as any).metadata).toBe(rawBackup);
          done();
        });
    });

    it('should create Backup from correct cluster when using - as an id', done => {
      cluster.id = '-';

      const clusterId = 'cluster-id';
      const backupId = 'backup-id';

      const requestStream = new Readable({
        objectMode: true,
        read() {
          this.push({
            name: `projects/project-id/clusters/${clusterId}/backups/${backupId}`,
          });
          this.push(null);
        },
      });

      cluster.instance.cluster = (id: string) => {
        expect(id).toBe(clusterId);

        return {
          backup: (id: string) => {
            expect(id).toBe(backupId);
            setImmediate(done);
            return {};
          },
        };
      };

      cluster.bigtable.request = () => requestStream;

      cluster.getBackupsStream().on('error', done);
    });
  });

  describe('getMetadata', () => {
    it('should make correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableInstanceAdminClient');
        expect(config.method).toBe('getCluster');
        expect(config.reqOpts).toEqual({
          name: cluster.name,
        });
        expect(config.gaxOpts).toEqual({});
        done();
      };
      cluster.getMetadata(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };
      cluster.getMetadata(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should update metadata', done => {
      const metadata = {};
      cluster.bigtable.request = (config: {}, callback: Function) => {
        callback(null, metadata);
      };
      cluster.getMetadata(() => {
        expect(cluster.metadata).toBe(metadata);
        done();
      });
    });

    it('should execute callback with original arguments', done => {
      const args = [{}, {}];
      cluster.bigtable.request = (config: {}, callback: Function) => {
        callback(...args);
      };
      cluster.getMetadata((...argsies: Array<{}>) => {
        expect([].slice.call(argsies)).toEqual(args);
        done();
      });
    });
  });

  describe('setMetadata', () => {
    beforeEach(() => {
      const metadata = {
        location: 'projects/{{projectId}}/locations/us-east4-b',
      };
      cluster.metadata = metadata;
    });

    it('should provide the proper request options', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any, callback: Function) => {
        expect(config.client).toBe('BigtableInstanceAdminClient');
        expect(config.method).toBe('partialUpdateCluster');
        expect(config.reqOpts.cluster.name).toBe(CLUSTER_NAME);
        callback(); // done()
      };

      cluster.setMetadata({nodes: 2}, done);
    });

    it('should provide the proper request options asynchronously', async () => {
      let currentRequestInput = null;
      (cluster.bigtable.request as Function) = (config: RequestOptions) => {
        currentRequestInput = config;
      };
      for (const options of createClusterOptionsList) {
        await cluster.setMetadata(options);
        expect({
          input: {
            id: cluster.id,
            options: options,
          },
          output: {
            config: currentRequestInput,
          },
        }).toMatchSnapshot();
      }
    });

    it('should respect the nodes option', done => {
      const options = {
        nodes: 3,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.reqOpts.cluster.serveNodes).toBe(options.nodes);
        done();
      };

      cluster.setMetadata(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept and pass user provided input through', done => {
      const options = {
        nodes: 3,
        location: 'us-west2-b',
        defaultStorageType: 'exellent_type',
      };

      const expectedReqOpts = ClusterUtils.getRequestFromMetadata(
        options,
        CLUSTER_NAME,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.reqOpts).toEqual(expectedReqOpts);
        done();
      };

      cluster.setMetadata(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect the gaxOptions', done => {
      const options = {
        nodes: 3,
      };
      const gaxOptions = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cluster.bigtable.request = (config: any) => {
        expect(config.reqOpts.cluster.serveNodes).toBe(options.nodes);
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      cluster.setMetadata(options, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    // eslint-disable-next-line no-restricted-properties
    it('should execute callback with all arguments', done => {
      const args = [{}, {}];
      cluster.bigtable.request = (config: {}, callback: Function) => {
        callback(...args);
      };
      const name =
        'projects/{{projectId}}/instances/fake-instance/clusters/fake-cluster';
      cluster.name = name;
      cluster.setMetadata({nodes: 2}, (...argsies: Array<{}>) => {
        expect([].slice.call(argsies)).toEqual(args);
        done();
      });
    });
  });
});
