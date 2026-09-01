// Copyright 2020 Google LLC
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

import {PreciseDate} from '@google-cloud/precise-date';
import {ServiceError} from 'google-gax';
import * as clusterTypes from '../src/cluster';
import * as backupTypes from '../src/backup';
import * as instanceTypes from '../src/instance';
import {Bigtable, RequestOptions} from '../src';
import {Table} from '../src/table';
import {generateId} from '../system-test/common';
import {Backup} from '../src/backup';

(global as any).mockPromisified = (global as any).mockPromisified || false;
jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (klass: Function, options: any) => {
    if (klass.name === 'Backup') {
      (global as any).mockPromisified = true;
      expect(options.exclude).toEqual([
        'endDate',
        'expireDate',
        'startDate',
      ]);
    }
  },
}));

class FakeTable extends Table {
  calledWith_: Array<{}>;
  constructor(...args: [instanceTypes.Instance, string]) {
    super(args[0], args[1]);
    this.calledWith_ = args;
  }
}

class FakeInstance extends instanceTypes.Instance {
  calledWith_: Array<{}>;
  constructor(...args: [Bigtable, string]) {
    super(...args);
    this.calledWith_ = args;
  }
}

describe('Bigtable/Backup', () => {
  const BACKUP_ID = 'my-backup';
  let CLUSTER: clusterTypes.Cluster;
  let BACKUP_NAME: string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let backup: any;

  
  beforeEach(() => {
    CLUSTER = {
      bigtable: {} as Bigtable,
      name: 'a/b/c/d',
      instance: {
        name: 'instance-name',
      },
    } as clusterTypes.Cluster;
    BACKUP_NAME = CLUSTER.name + '/backups/' + BACKUP_ID;
    backup = new Backup(CLUSTER, BACKUP_ID);
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).mockPromisified).toBeTruthy();
    });

    it('should localize Bigtable instance', () => {
      expect(backup.bigtable).toBe(CLUSTER.bigtable);
    });

    it('should localize the Cluster instance', () => {
      expect(backup.cluster).toBe(CLUSTER);
    });

    it('should localize name and id when provided with name', () => {
      const backup = new Backup(CLUSTER, BACKUP_NAME);
      expect(backup.name).toBe(BACKUP_NAME);
      expect(backup.id).toBe(BACKUP_ID);
    });

    it('should throw if name is in wrong format', () => {
      const badName = '/other/cluster/backup/id';
      expect(() => { new Backup(CLUSTER, badName); }).toThrow(/Backup id '\/other\/cluster\/backup\/id' is not formatted correctly.\nPlease use the format 'my-backup' or 'a\/b\/c\/d\/backups\/my-backup'\./);
    });

    it('should localize name and id when provided with id', () => {
      const backup = new Backup(CLUSTER, BACKUP_ID);
      expect(backup.name).toBe(BACKUP_NAME);
      expect(backup.id).toBe(BACKUP_ID);
    });
  });

  describe('endDate accessor', () => {
    it('should throw if metadata is not set', () => {
      expect(() => { backup.metadata = undefined;
        backup.endDate; }).toThrow(/An endTime is required to convert to Date./);
    });

    it('should throw if endTime is not set on metadata', () => {
      expect(() => { backup.metadata = {};
        backup.endDate; }).toThrow(/An endTime is required to convert to Date./);
    });

    it('should return PreciseDate', () => {
      const seconds = 30;
      const nanos = 1000;
      const expectedEndDate = new PreciseDate({seconds, nanos});
      backup.metadata = {
        endTime: {seconds, nanos},
      };
      const convertedEndDate = backup.endDate;
      expect(convertedEndDate).toEqual(expectedEndDate);
    });
  });

  describe('expireDate accessor', () => {
    it('should throw if metadata is not set', () => {
      expect(() => { backup.metadata = undefined;
        backup.expireDate; }).toThrow(/An expireTime is required to convert to Date./);
    });

    it('should throw if expireTime is not set on metadata', () => {
      expect(() => { backup.metadata = {};
        backup.expireDate; }).toThrow(/An expireTime is required to convert to Date./);
    });

    it('should return PreciseDate', () => {
      const seconds = 30;
      const nanos = 1000;
      const expectedExpireDate = new PreciseDate({seconds, nanos});
      backup.metadata = {
        expireTime: {seconds, nanos},
      };
      const convertedExpireDate = backup.expireDate;
      expect(convertedExpireDate).toEqual(expectedExpireDate);
    });
  });

  describe('startDate accessor', () => {
    it('should throw if metadata is not set', () => {
      expect(() => { backup.metadata = undefined;
        backup.startDate; }).toThrow(/A startTime is required to convert to Date./);
    });

    it('should throw if startTime is not set on metadata', () => {
      expect(() => { backup.metadata = {};
        backup.startDate; }).toThrow(/A startTime is required to convert to Date./);
    });

    it('should return PreciseDate', () => {
      const seconds = 30;
      const nanos = 1000;
      const expectedStartDate = new PreciseDate({seconds, nanos});
      backup.metadata = {
        startTime: {seconds, nanos},
      };
      const convertedStartDate = backup.startDate;
      expect(convertedStartDate).toEqual(expectedStartDate);
    });
  });

  describe('create', () => {
    it('should call createBackup from cluster', done => {
      const config = {};

      backup.cluster.createBackup = (
        id: string,
        _config: {},
        callback: Function,
      ) => {
        expect(id).toBe(backup.id);
        expect(_config).toBe(config);
        callback(); // done()
      };

      backup.create(config, done);
    });
  });

  describe('copy', () => {
    beforeEach(() => {
      backup.bigtable.request = (
        config: RequestOptions,
        callback: (err: ServiceError | null, res: RequestOptions) => void,
      ) => {
        callback(null, config);
      };
    });

    it('should correctly copy backup from the cluster to a custom project', done => {
      const destinationProjectId = generateId('project');
      const bigtable = new Bigtable({projectId: destinationProjectId});
      const backupId = generateId('backup');
      const newBackupId = generateId('backup');
      const backup = new Backup(CLUSTER, backupId);
      const destinationInstanceId = generateId('instance');
      const destinationClusterId = generateId('cluster');
      const instance = new FakeInstance(bigtable, destinationInstanceId);
      // In callback, config is object received in request function so must be
      // of type any so that this test can compile and so that asserts can test
      // its properties.
      backup.copy(
        {
          cluster: new clusterTypes.Cluster(instance, destinationClusterId),
          id: newBackupId,
          expireTime: new PreciseDate(177),
          gaxOptions: {
            timeout: 139,
          },
        },
        (
          err?: ServiceError | Error | null,
          backup?: Backup | null,
          config?: any,
        ) => {
          expect(
            backup?.name).toBe(`projects/${destinationProjectId}/instances/${destinationInstanceId}/clusters/${destinationClusterId}/backups/${newBackupId}`,
          );
          expect(config?.client).toBe('BigtableTableAdminClient');
          expect(config?.method).toBe('copyBackup');
          expect(config?.reqOpts).toEqual({
            parent: `projects/${destinationProjectId}/instances/${destinationInstanceId}/clusters/${destinationClusterId}`,
            backupId: newBackupId,
            sourceBackup: `a/b/c/d/backups/${backupId}`,
            expireTime: {
              seconds: 0,
              nanos: 177000000,
            },
          });
          expect(config?.gaxOpts).toEqual({
            timeout: 139,
          });
          done();
        },
      );
    });
  });

  describe('delete', () => {
    it('should make the correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any, callback: Function) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('deleteBackup');
        expect(config.reqOpts).toEqual({
          name: backup.name,
        });
        expect(config.gaxOpts).toEqual({});
        callback(); // done()
      };

      backup.delete(done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      backup.bigtable.request = (config: {gaxOpts: {}}) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      backup.delete(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });
  });

  describe('exists', () => {
    it('should not require gaxOptions', done => {
      backup.getMetadata = (options: {}) => {
        expect(options).toEqual({});
        done();
      };
      backup.exists(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should pass gaxOptions to getMetadata', done => {
      const gaxOptions = {};
      backup.getMetadata = (options: {}) => {
        expect(options).toBe(gaxOptions);
        done();
      };
      backup.exists(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return false if error code is 5', done => {
      const error = new Error('Error.') as ServiceError;
      error.code = 5;
      backup.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(error);
      };
      backup.exists((err: Error | null, exists: boolean) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(false);
        done();
      });
    });

    it('should return error if code is not 5', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error('Error.');
      error.code = 'NOT-5';
      backup.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(error);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.exists((err: any) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return true if no error', done => {
      backup.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(null, {});
      };
      backup.exists((err: Error | null, exists: boolean) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(true);
        done();
      });
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const gaxOptions = {};
      backup.getMetadata = (options: {}) => {
        expect(options).toBe(gaxOptions);
        done();
      };
      backup.get(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should not require an options object', done => {
      backup.getMetadata = (options: {}) => {
        expect(options).toEqual({});
        done();
      };
      backup.get(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.');
      backup.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(error);
      };
      backup.get((err: Error | null) => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return self and API response', done => {
      const apiResponse = {};
      backup.getMetadata = (gaxOptions: {}, callback: Function) => {
        callback(null, apiResponse);
      };
      backup.get((err: Error | null, _backup: {}, _apiResponse: {}) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(_backup).toBe(backup);
        expect(_apiResponse).toBe(apiResponse);
        done();
      });
    });
  });

  describe('getIamPolicy', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should correctly call Table#getIamPolicy()', done => {
      jest.spyOn(Table.prototype, 'getIamPolicy').mockImplementation((opt, callback) => {
        expect(opt).toEqual({});
        callback(); // done()
      });
      backup.getIamPolicy(done);
    });

    it('should accept options', done => {
      const options = {gaxOptions: {}, requestedPolicyVersion: 1};

      jest.spyOn(Table.prototype, 'getIamPolicy').mockImplementation((opt, callback) => {
        expect(opt).toBe(options);
        callback(); // done()
      });
      backup.getIamPolicy(options, done);
    });
  });

  describe('getMetadata', () => {
    it('should make the correct request', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('getBackup');
        expect(config.reqOpts).toEqual({
          name: backup.name,
        });
        expect(config.gaxOpts).toEqual({});
        done();
      };

      backup.getMetadata(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      backup.bigtable.request = (config: {gaxOpts: {}}) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      backup.getMetadata(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should update the metadata', done => {
      const response = {};
      backup.bigtable.request = (config: {}, callback: Function) => {
        callback(null, response);
      };
      backup.getMetadata((err: Error | null, metadata: {}) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(metadata).toBe(response);
        expect(backup.metadata).toBe(response);
        done();
      });
    });
  });

  describe('restore', () => {
    it('should delegate to Backup#restoreTo()', done => {
      const tableId = 'table-id';
      const callback = ((err: any) => { expect(err).toBeFalsy(); });

      backup.restoreTo = (
        config: backupTypes.RestoreTableConfig,
        cb: backupTypes.RestoreTableCallback,
      ) => {
        expect(config.tableId).toBe(tableId);
        expect(config.instance).toBe(backup.cluster.instance);
        expect(config.gaxOptions).toBe(undefined);
        expect(cb).toBe(callback);
        done();
      };

      backup.restore(tableId, callback);
    });

    it('should accept gaxOptions', done => {
      const tableId = 'table-id';
      const gaxOptions = {};

      backup.restoreTo = (config: backupTypes.RestoreTableConfig) => {
        expect(config.tableId).toBe(tableId);
        expect(config.instance).toBe(backup.cluster.instance);
        expect(config.gaxOptions).toBe(gaxOptions);
        done();
      };

      backup.restore(tableId, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });
  });

  describe('restoreTo', () => {
    it('should send the correct request', done => {
      const tableId = 'table-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('restoreTable');
        expect(config.reqOpts).toEqual({
          parent: backup.cluster.instance.name,
          tableId,
          backup: backup.name,
        });
        expect(config.gaxOpts).toBe(undefined);
        done();
      };

      (backup as backupTypes.Backup).restoreTo({tableId}, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept instance as instanceId', done => {
      const tableId = 'table-id';
      const instance = 'diff-instance';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any) => {
        expect(
          config.reqOpts.parent.match(/instances\/([^/]+)/)![1]).toEqual(instance,
        );
        done();
      };
      backup.bigtable.instance = (id: string) => {
        return new instanceTypes.Instance(backup.bigtable, id);
      };

      (backup as backupTypes.Backup).restoreTo(
        {tableId, instance},
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should accept instance as instanceName', done => {
      const tableId = 'table-id';
      const instance = `${backup.bigtable.projectName}/instances/diff-instance`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any) => {
        expect(config.reqOpts.parent).toEqual(instance);
        done();
      };
      backup.bigtable.instance = (name: string) => {
        return new instanceTypes.Instance(backup.bigtable, name);
      };

      (backup as backupTypes.Backup).restoreTo(
        {tableId, instance},
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should accept instance as Instance object', done => {
      const tableId = 'table-id';
      const instanceName = `${backup.bigtable.projectName}/instances/diff-instance`;
      const instance = new FakeInstance(backup.bigtable, instanceName);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any) => {
        expect(config.reqOpts.parent).toEqual(instance.name);
        done();
      };

      backup.restoreTo({tableId, instance}, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should accept gaxOptions', done => {
      const tableId = 'table-id';
      const gaxOptions = {};

      backup.bigtable.request = (config: {gaxOpts: {}}) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      (backup as backupTypes.Backup).restoreTo(
        {tableId, gaxOptions},
        ((err: any) => { expect(err).toBeFalsy(); }),
      );
    });

    it('should execute callback with error', done => {
      const tableId = 'table-id';
      const error = new Error('Error.');
      const args = [{a: 'b'}, {c: 'd'}, {e: 'f'}];

      backup.bigtable.request = (config: {}, callback: Function) => {
        callback(error, ...args);
      };

      backup.restoreTo(
        {tableId},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: Error | null, table: {}, ..._args: any[]) => {
          expect(err).toBe(error);
          expect(table).toBe(undefined);
          expect(_args).toEqual(args);
          done();
        },
      );
    });

    it('should execute callback with created Table', done => {
      const tableId = 'table-id';
      const args = [{a: 'b'}, {c: 'd'}, {e: 'f'}];
      const tableInstance = {};

      backup.cluster.instance = {
        table: (_tableId: string) => {
          expect(_tableId).toBe(tableId);
          return tableInstance;
        },
      };

      backup.bigtable.request = (config: {}, callback: Function) => {
        callback(null, ...args);
      };

      backup.restoreTo(
        {tableId},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: Error | null, table: {}, ..._args: any[]) => {
          ((err: any) => { expect(err).toBeFalsy(); })(err);
          expect(table).toBe(tableInstance);
          expect(_args).toEqual(args);
          done();
        },
      );
    });
  });

  describe('setMetadata', () => {
    it('should send the correct request', done => {
      const metadata = {
        testProperty: 'value',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any, callback: Function) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('updateBackup');
        expect(config.reqOpts).toEqual({
          backup: {
            name: backup.name,
            ...metadata,
          },
          updateMask: {
            paths: ['test_property'],
          },
        });
        expect(config.gaxOpts).toEqual({});
        callback(); // done()
      };

      backup.setMetadata(metadata, done);
    });

    it('should accept gaxOptions', done => {
      const metadata = {};
      const gaxOptions = {};

      backup.bigtable.request = (config: {gaxOpts: {}}) => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      };

      backup.setMetadata(metadata, gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should convert expireTime Date to struct', done => {
      const metadata = {
        expireTime: new Date(),
      };
      const expectedExpireTime = new PreciseDate(
        metadata.expireTime,
      ).toStruct();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backup.bigtable.request = (config: any) => {
        expect(
          config.reqOpts.backup.expireTime).toEqual(expectedExpireTime,
        );
        done();
      };

      backup.setMetadata(metadata, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should execute the callback and update the metadata', done => {
      const metadata = {};
      const response = {};

      backup.bigtable.request = (config: {}, callback: Function) => {
        callback(null, response);
      };

      backup.setMetadata(
        metadata,
        (err: Error | null, metadata: {}, apiResponse: {}) => {
          ((err: any) => { expect(err).toBeFalsy(); })(err);
          expect(metadata).toBe(response);
          expect(backup.metadata).toBe(response);
          expect(apiResponse).toBe(response);
          done();
        },
      );
    });
  });

  describe('setIamPolicy', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });
    const policy = {};
    it('should correctly call Table#setIamPolicy()', done => {
      jest.spyOn(Table.prototype, 'setIamPolicy').mockImplementation((_policy, gaxOpts, callback) => {
          expect(_policy).toBe(policy);
          expect(gaxOpts).toEqual({});
          callback(); // done()
        });
      backup.setIamPolicy(policy, done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};

      jest.spyOn(Table.prototype, 'setIamPolicy').mockImplementation((_policy, gaxOpts, callback) => {
          expect(_policy).toBe(policy);
          expect(gaxOpts).toBe(gaxOptions);
          callback(); // done()
        });
      backup.setIamPolicy(policy, gaxOptions, done);
    });
  });

  describe('testIamPermissions', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const permissions = 'bigtable.backups.get';
    it('should properly call Table#testIamPermissions', done => {
      jest.spyOn(Table.prototype, 'testIamPermissions').mockImplementation((_permissions, gaxOpts, callback) => {
          expect(_permissions).toBe(permissions);
          expect(gaxOpts).toEqual({});
          callback(); // done()
        });
      backup.testIamPermissions(permissions, done);
    });

    it('should accept permissions as array', done => {
      const permissions = [
        'bigtable.backups.get',
        'bigtable.backups.delete',
        'bigtable.backups.update',
        'bigtable.backups.restore',
      ];
      jest.spyOn(Table.prototype, 'testIamPermissions').mockImplementation((_permissions, gaxOpts, callback) => {
          expect(_permissions).toBe(permissions);
          expect(gaxOpts).toEqual({});
          callback(); // done()
        });
      backup.testIamPermissions(permissions, done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      jest.spyOn(Table.prototype, 'testIamPermissions').mockImplementation((_permissions, gaxOpts, callback) => {
          expect(_permissions).toBe(permissions);
          expect(gaxOpts).toBe(gaxOptions);
          callback(); // done()
        });
      backup.testIamPermissions(permissions, gaxOptions, done);
    });
  });
});
