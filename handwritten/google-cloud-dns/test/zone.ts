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

import {ServiceObject, ServiceObjectConfig} from '@google-cloud/common';
import * as promisify from '@google-cloud/promisify';
import {CoreOptions, OptionsWithUri, Response} from 'request';
import * as crypto from 'crypto';

import {Change, CreateChangeRequest} from '../src/change';
import {Record, RecordObject, RecordMetadata} from '../src/record';

let promisified = false;
let extended = false;

let parseOverride: Function | null = null;
jest.mock('dns-zonefile', () => {
  return {
    parse(...args: unknown[]) {
      return (parseOverride || (() => {})).apply(null, args);
    },
  };
});

let readFileOverride: Function | null = null;
let writeFileOverride: Function | null = null;
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFile(...args: unknown[]) {
      return (readFileOverride || (() => {})).apply(null, args);
    },
    writeFile(...args: unknown[]) {
      return (writeFileOverride || (() => {})).apply(null, args);
    },
  };
});

class FakeChange {
  calledWith_: unknown[];
  constructor(...args: unknown[]) {
    this.calledWith_ = args;
  }
}
jest.mock('../src/change', () => {
  return {
    Change: FakeChange,
  };
});

class FakeRecord {
  calledWith_: unknown[];
  constructor(...args: unknown[]) {
    this.calledWith_ = args;
  }
  static fromZoneRecord_(...args: unknown[]) {
    const record = new FakeRecord();
    record.calledWith_ = args;
    return record;
  }
}
jest.mock('../src/record', () => {
  return {
    Record: FakeRecord,
  };
});

jest.mock('@google-cloud/common', () => {
  const common = jest.requireActual('@google-cloud/common');
  return {
    ...common,
    ServiceObject: class FakeServiceObject extends common.ServiceObject {
      calledWith_: unknown[];
      constructor(config: ServiceObjectConfig, ...args: unknown[]) {
        super(config);
        this.calledWith_ = [config, ...args];
      }
    },
  };
});

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll(esClass: Function, options?: promisify.PromisifyAllOptions) {
      if (esClass.name === 'Zone') {
        promisified = true;
        expect(options?.exclude).toEqual(['change', 'record']);
      }
      return actual.promisifyAll(esClass, options);
    },
  };
});

jest.mock('@google-cloud/paginator', () => {
  return {
    paginator: {
      extend(esClass: Function, methods: string[]) {
        if (esClass.name !== 'Zone') {
          return;
        }
        extended = true;
        const arr = Array.isArray(methods) ? methods : [methods];
        expect(esClass.name).toBe('Zone');
        expect(arr).toEqual(['getChanges', 'getRecords']);
      },
      streamify(methodName: string) {
        return methodName;
      },
    },
  };
});

import {Zone} from '../src/zone';

describe('Zone', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let zone: any;

  const DNS = {
    createZone() {},
  };
  const ZONE_NAME = 'zone-name';

  beforeEach(() => {
    parseOverride = null;
    readFileOverride = null;
    writeFileOverride = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zone = new Zone(DNS as any, ZONE_NAME);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should extend the correct methods', () => {
      expect(extended).toBe(true);
    });

    it('should streamify the correct methods', () => {
      expect(zone.getChangesStream).toBe('getChanges');
      expect(zone.getRecordsStream).toBe('getRecords');
    });

    it('should localize the name', () => {
      expect(zone.name).toBe(ZONE_NAME);
    });

    it('should inherit from ServiceObject', done => {
      const dnsInstance = Object.assign({}, DNS, {
        createZone: {
          bind(context: {}) {
            try {
              expect(context).toBe(dnsInstance);
              done();
            } catch (e) {
              done(e);
            }
          },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const zone = new Zone(dnsInstance as any, ZONE_NAME);
      expect(zone).toBeInstanceOf(ServiceObject);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calledWith = (zone as any).calledWith_[0];

      expect(calledWith.parent).toBe(dnsInstance);
      expect(calledWith.baseUrl).toBe('/managedZones');
      expect(calledWith.id).toBe(ZONE_NAME);
      expect(calledWith.methods).toEqual({
        create: true,
        exists: true,
        get: true,
        getMetadata: true,
      });
    });
  });

  describe('addRecords', () => {
    it('should create a change with additions', done => {
      const records = ['a', 'b', 'c'];

      zone.createChange = (
        options: CreateChangeRequest,
        callback: Function
      ) => {
        try {
          expect(options.add).toBe(records);
          callback();
        } catch (e) {
          done(e);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zone.addRecords(records as any, done);
    });
  });

  describe('change', () => {
    it('should return a Change object', () => {
      const changeId = 'change-id';
      const change = zone.change(changeId);
      expect(change).toBeInstanceOf(FakeChange);
      expect(change.calledWith_[0]).toBe(zone);
      expect(change.calledWith_[1]).toBe(changeId);
    });
  });

  describe('createChange', () => {
    function generateRecord(recordJson?: {}) {
      recordJson = Object.assign(
        {
          name: crypto.randomUUID(),
          type: crypto.randomUUID(),
          rrdatas: [crypto.randomUUID(), crypto.randomUUID()],
        },
        recordJson
      );

      return {
        toJSON() {
          return recordJson! as {rrdatas: Array<{}>};
        },
      };
    }

    it('should throw error if add or delete is not provided', () => {
      expect(() => {
        zone.createChange({}, () => {});
      }).toThrow(/Cannot create a change with no additions or deletions/);
    });

    it('should parse and rename add to additions', done => {
      const recordsToAdd = [generateRecord(), generateRecord()];

      const expectedAdditions = recordsToAdd.map(x => x.toJSON());

      zone.request = (reqOpts: CoreOptions) => {
        try {
          expect(reqOpts.json.add).toBeUndefined();
          expect(reqOpts.json.additions).toEqual(expectedAdditions);
          done();
        } catch (e) {
          done(e);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zone.createChange({add: recordsToAdd as any}, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should parse and rename delete to deletions', done => {
      const recordsToDelete = [generateRecord(), generateRecord()];

      const expectedDeletions = recordsToDelete.map(x => x.toJSON());

      zone.request = (reqOpts: CoreOptions) => {
        try {
          expect(reqOpts.json.delete).toBeUndefined();
          expect(reqOpts.json.deletions).toEqual(expectedDeletions);
          done();
        } catch (e) {
          done(e);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zone.createChange({delete: recordsToDelete as any}, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should group changes by name and type', done => {
      const recordsToAdd = [
        generateRecord({name: 'name.com.', type: 'mx'}),
        generateRecord({name: 'name.com.', type: 'mx'}),
      ];

      zone.request = (reqOpts: CoreOptions) => {
        try {
          const expectedRRDatas = recordsToAdd
            .map(x => x.toJSON().rrdatas)
            .reduce((acc, rrdata) => acc.concat(rrdata), []);

          expect(reqOpts.json.additions).toEqual([
            {
              name: 'name.com.',
              type: 'mx',
              rrdatas: expectedRRDatas,
            },
          ]);

          done();
        } catch (e) {
          done(e);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zone.createChange({add: recordsToAdd as any}, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should make correct API request', done => {
      zone.request = (reqOpts: OptionsWithUri) => {
        try {
          expect(reqOpts.method).toBe('POST');
          expect(reqOpts.uri).toBe('/changes');

          done();
        } catch (e) {
          done(e);
        }
      };

      zone.createChange({add: []}, (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {a: 'b', c: 'd'};

      beforeEach(() => {
        zone.request = (reqOpts: {}, callback: Function) => {
          callback(error, apiResponse);
        };
      });

      it('should execute callback with error & API response', done => {
        zone.createChange(
          {add: []},
          (err: Error, change: Change, apiResponse_: Response) => {
            try {
              expect(err).toBe(error);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });

    describe('success', () => {
      const apiResponse = {id: 1, a: 'b', c: 'd'};

      beforeEach(() => {
        zone.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponse);
        };
      });

      it('should execute callback with Change & API response', done => {
        const change = {metadata: null};

        zone.change = (id: string) => {
          expect(id).toBe(apiResponse.id);
          return change;
        };

        zone.createChange(
          {add: []},
          (err: Error, change_: Change, apiResponse_: Response) => {
            try {
              expect(err).toBeNull();
              expect(change_).toBe(change);
              expect(change_.metadata).toBe(apiResponse);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });
  });

  describe('delete', () => {
    describe('force', () => {
      it('should empty the zone', done => {
        zone.empty = () => {
          done();
        };

        zone.delete({force: true}, (err: unknown) => {
          if (err) done(err);
        });
      });

      it('should try to delete again after emptying', done => {
        jest.spyOn(ServiceObject.prototype, 'delete').mockImplementation((() => {
          done();
        }) as any);

        zone.empty = (callback: Function) => {
          callback();
        };

        zone.delete({force: true}, (err: unknown) => {
          if (err) done(err);
        });
      });
    });
  });

  describe('deleteRecords', () => {
    it('should delete records by type if a string is given', done => {
      const recordsToDelete = 'ns';

      zone.deleteRecordsByType_ = (types: string[], callback: Function) => {
        try {
          expect(types).toEqual([recordsToDelete]);
          callback();
        } catch (e) {
          done(e);
        }
      };

      zone.deleteRecords(recordsToDelete, done);
    });

    it('should create a change if record objects given', done => {
      const recordsToDelete = {a: 'b', c: 'd'};

      zone.createChange = (
        options: CreateChangeRequest,
        callback: Function
      ) => {
        try {
          expect(options.delete).toEqual([recordsToDelete]);
          callback();
        } catch (e) {
          done(e);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zone.deleteRecords(recordsToDelete as any, done);
    });
  });

  describe('empty', () => {
    it('should get all records', done => {
      zone.getRecords = () => {
        done();
      };

      zone.empty((err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        zone.getRecords = (callback: Function) => {
          callback(error);
        };
      });

      it('should execute callback with error', done => {
        zone.empty((err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    describe('success', () => {
      const records = [
        {type: 'A'},
        {type: 'AAAA'},
        {type: 'CNAME'},
        {type: 'MX'},
        {type: 'NAPTR'},
        {type: 'NS'},
        {type: 'PTR'},
        {type: 'SOA'},
        {type: 'SPF'},
        {type: 'SRV'},
        {type: 'TXT'},
      ];

      const expectedRecordsToDelete = records.filter(record => {
        return record.type !== 'NS' && record.type !== 'SOA';
      });

      beforeEach(() => {
        zone.getRecords = (callback: Function) => {
          callback(null, records);
        };
      });

      it('should execute callback if no records matched', done => {
        zone.getRecords = (callback: Function) => {
          callback(null, []);
        };

        zone.empty(done);
      });

      it('should delete non-NS and non-SOA records', done => {
        zone.deleteRecords = (
          recordsToDelete: string[],
          callback: Function
        ) => {
          try {
            expect(recordsToDelete).toEqual(expectedRecordsToDelete);
            callback();
          } catch (e) {
            done(e);
          }
        };

        zone.empty(done);
      });
    });
  });

  describe('export', () => {
    const path = './zonefile';

    const records = [
      {
        toString() {
          return 'a';
        },
      },
      {
        toString() {
          return 'a';
        },
      },
      {
        toString() {
          return 'a';
        },
      },
      {
        toString() {
          return 'a';
        },
      },
    ];

    const expectedZonefileContents = 'a\na\na\na';

    beforeEach(() => {
      zone.getRecords = (callback: Function) => {
        callback(null, records);
      };
    });

    describe('get records', () => {
      describe('error', () => {
        const error = new Error('Error.');

        it('should execute callback with error', done => {
          zone.getRecords = (callback: Function) => {
            callback(error);
          };

          zone.export(path, (err: Error) => {
            try {
              expect(err).toBe(error);
              done();
            } catch (e) {
              done(e);
            }
          });
        });
      });

      describe('success', () => {
        it('should get all records', done => {
          zone.getRecords = () => {
            done();
          };

          zone.export(path, (err: unknown) => {
            if (err) done(err);
          });
        });
      });
    });

    describe('write file', () => {
      it('should write correct zone file', done => {
        writeFileOverride = (
          path_: string,
          content: string,
          encoding: string
        ) => {
          try {
            expect(path_).toBe(path);
            expect(content).toBe(expectedZonefileContents);
            expect(encoding).toBe('utf-8');

            done();
          } catch (e) {
            done(e);
          }
        };

        zone.export(path, (err: unknown) => {
          if (err) done(err);
        });
      });

      describe('error', () => {
        const error = new Error('Error.');

        beforeEach(() => {
          writeFileOverride = (
            path: string,
            content: string,
            encoding: string,
            callback: Function
          ) => {
            callback(error);
          };
        });

        it('should execute the callback with an error', done => {
          zone.export(path, (err: Error) => {
            try {
              expect(err).toBe(error);
              done();
            } catch (e) {
              done(e);
            }
          });
        });
      });

      describe('success', () => {
        beforeEach(() => {
          writeFileOverride = (
            path: string,
            content: string,
            encoding: string,
            callback: Function
          ) => {
            callback();
          };
        });

          it('should execute the callback', done => {
            zone.export(path, (err: Error) => {
              try {
                expect(err).toBeFalsy();
                done();
              } catch (e) {
                done(e);
              }
            });
          });
      });
    });
  });

  describe('getChanges', () => {
    it('should accept only a callback', done => {
      zone.request = (reqOpts: CoreOptions) => {
        try {
          expect(reqOpts.qs).toEqual({});
          done();
        } catch (e) {
          done(e);
        }
      };

      zone.getChanges((err: unknown) => {
        if (err) done(err);
      });
    });

    it('should accept a sort', done => {
      const query = {sort: 'desc'};

      zone.request = (reqOpts: CoreOptions) => {
        try {
          expect(reqOpts.qs.sortOrder).toBe('descending');
          expect(reqOpts.qs.sort).toBeUndefined();

          done();
        } catch (e) {
          done(e);
        }
      };

      zone.getChanges(query, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should make the correct API request', done => {
      const query = {a: 'b', c: 'd'};

      zone.request = (reqOpts: OptionsWithUri) => {
        try {
          expect(reqOpts.uri).toBe('/changes');
          expect(reqOpts.qs).toBe(query);

          done();
        } catch (e) {
          done(e);
        }
      };

      zone.getChanges(query, (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {a: 'b', c: 'd'};

      beforeEach(() => {
        zone.request = (reqOpts: {}, callback: Function) => {
          callback(error, apiResponse);
        };
      });

      it('should execute callback with error & API response', done => {
        zone.getChanges(
          {},
          (
            err: Error,
            changes: Change[],
            nextQuery: {},
            apiResponse_: Response
          ) => {
            try {
              expect(err).toBe(error);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });

    describe('success', () => {
      const apiResponse = {
        changes: [{id: 1}],
      };

      beforeEach(() => {
        zone.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponse);
        };
      });

      it('should build a nextQuery if necessary', done => {
        const nextPageToken = 'next-page-token';
        const apiResponseWithNextPageToken = Object.assign({}, apiResponse, {
          nextPageToken,
        });
        const expectedNextQuery = {
          pageToken: nextPageToken,
        };

        zone.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponseWithNextPageToken);
        };

        zone.getChanges({}, (err: Error, changes: Change[], nextQuery: {}) => {
          try {
            expect(err).toBeNull();
            expect(nextQuery).toEqual(expectedNextQuery);
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      it('should execute callback with Changes & API response', done => {
        const change = {metadata: null};

        zone.change = (id: string) => {
          expect(id).toBe(apiResponse.changes[0].id);
          return change;
        };

        zone.getChanges(
          {},
          (
            err: Error,
            changes: Change[],
            nextQuery: {},
            apiResponse_: Response
          ) => {
            try {
              expect(err).toBeNull();
              expect(changes[0]).toBe(change);
              expect(changes[0].metadata).toBe(apiResponse.changes[0]);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });
  });

  describe('getRecords', () => {
    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {a: 'b', c: 'd'};

      beforeEach(() => {
        zone.request = (reqOpts: {}, callback: Function) => {
          callback(error, apiResponse);
        };
      });

      it('should execute callback with error & API response', done => {
        zone.getRecords(
          {},
          (
            err: Error,
            changes: Change[],
            nextQuery: {},
            apiResponse_: Response
          ) => {
            try {
              expect(err).toBe(error);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });

      it('should not require a query', done => {
        zone.getRecords((err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    describe('success', () => {
      const apiResponse = {
        rrsets: [{type: 'NS'}],
      };

      beforeEach(() => {
        zone.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponse);
        };
      });

      it('should execute callback with nextQuery if necessary', done => {
        const nextPageToken = 'next-page-token';
        const apiResponseWithNextPageToken = Object.assign({}, apiResponse, {
          nextPageToken,
        });
        const expectedNextQuery = {pageToken: nextPageToken};

        zone.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponseWithNextPageToken);
        };

        zone.getRecords({}, (err: Error, records: Record[], nextQuery: {}) => {
          try {
            expect(err).toBeNull();
            expect(nextQuery).toEqual(expectedNextQuery);
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      it('should execute callback with Records & API response', done => {
        const record = {};

        zone.record = (type: string, recordObject: RecordObject) => {
          expect(type).toBe(apiResponse.rrsets[0].type);
          expect(recordObject).toBe(apiResponse.rrsets[0]);
          return record;
        };

        zone.getRecords(
          {},
          (
            err: Error,
            records: Record[],
            nextQuery: {},
            apiResponse_: Response
          ) => {
            try {
              expect(err).toBeNull();
              expect(records[0]).toBe(record);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });

      it('should not require a query', done => {
        zone.getRecords((err: unknown) => {
          if (err) done(err);
          else done();
        });
      });

      describe('filtering', () => {
        it('should accept a string type', done => {
          const types = ['MX', 'CNAME'];

          zone.getRecords(types, (err: Error, records: Record[]) => {
            try {
              expect(err).toBeNull();
              expect(records.length).toBe(0);
              done();
            } catch (e) {
              done(e);
            }
          });
        });

        it('should accept an array of types', done => {
          const type = 'MX';

          zone.getRecords(type, (err: Error, records: Record[]) => {
            try {
              expect(err).toBeNull();
              expect(records.length).toBe(0);
              done();
            } catch (e) {
              done(e);
            }
          });
        });

        it('should not send filterByTypes_ in API request', done => {
          zone.request = (reqOpts: CoreOptions) => {
            try {
              expect(reqOpts.qs.filterByTypes_).toBeUndefined();
              done();
            } catch (e) {
              done(e);
            }
          };

          zone.getRecords('NS', (err: unknown) => {
            if (err) done(err);
          });
        });
      });
    });
  });

  describe('import', () => {
    const path = './zonefile';

    it('should read from the file', done => {
      readFileOverride = (path_: string, encoding: string) => {
        try {
          expect(path_).toBe(path);
          expect(encoding).toBe('utf-8');
          done();
        } catch (e) {
          done(e);
        }
      };

      zone.import(path, (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        readFileOverride = (
          path: string,
          encoding: string,
          callback: Function
        ) => {
          callback(error);
        };
      });

      it('should execute the callback', done => {
        zone.import(path, (err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    describe('success', () => {
      const recordType = 'ns';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedZonefile: any = {};

      beforeEach(() => {
        parsedZonefile = {
          [recordType]: {a: 'b', c: 'd'},
        };

        parseOverride = () => {
          return parsedZonefile;
        };

        readFileOverride = (
          path: string,
          encoding: string,
          callback: Function
        ) => {
          callback();
        };
      });

      it('should add records', done => {
        zone.addRecords = (
          recordsToCreate: FakeRecord[],
          callback: Function
        ) => {
          try {
            expect(recordsToCreate.length).toBe(1);
            const recordToCreate = recordsToCreate[0];
            expect(recordToCreate).toBeInstanceOf(FakeRecord);
            const args = recordToCreate.calledWith_;
            expect(args[0]).toBe(zone);
            expect(args[1]).toBe(recordType);
            expect(args[2]).toBe(parsedZonefile[recordType]);
            callback();
          } catch (e) {
            done(e);
          }
        };
        zone.import(path, done);
      });

      it('should use the default ttl', done => {
        const defaultTTL = '90';
        parsedZonefile.$ttl = defaultTTL;
        parsedZonefile[recordType] = {};
        parsedZonefile.mx = {ttl: '180'};
        zone.addRecords = (recordsToCreate: FakeRecord[]) => {
          try {
            const record1 = recordsToCreate[0].calledWith_[2];
            expect((record1 as RecordMetadata).ttl).toBe(defaultTTL);
            const record2 = recordsToCreate[1].calledWith_[2];
            expect((record2 as RecordMetadata).ttl).toBe('180');
            done();
          } catch (e) {
            done(e);
          }
        };
        zone.import(path, done);
      });
    });
  });

  describe('record', () => {
    it('should return a Record object', () => {
      const type = 'a';
      const metadata = {a: 'b', c: 'd'};
      const record = zone.record(type, metadata);
      expect(record).toBeInstanceOf(FakeRecord);
      const args = record.calledWith_;
      expect(args[0]).toBe(zone);
      expect(args[1]).toBe(type);
      expect(args[2]).toBe(metadata);
    });
  });

  describe('replaceRecords', () => {
    it('should get records', done => {
      const recordType = 'ns';
      zone.getRecords = (recordType_: string) => {
        try {
          expect(recordType_).toBe(recordType);
          done();
        } catch (e) {
          done(e);
        }
      };
      zone.replaceRecords(recordType, [], (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      beforeEach(() => {
        zone.getRecords = (recordType: string, callback: Function) => {
          callback(error);
        };
      });

      it('should execute callback with error', done => {
        zone.replaceRecords('a', [], (err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    describe('success', () => {
      const recordsToCreate = [
        {a: 'b', c: 'd'},
        {a: 'b', c: 'd'},
        {a: 'b', c: 'd'},
      ];

      const recordsToDelete = [
        {a: 'b', c: 'd'},
        {a: 'b', c: 'd'},
        {a: 'b', c: 'd'},
      ];

      beforeEach(() => {
        zone.getRecords = (recordType: string, callback: Function) => {
          callback(null, recordsToDelete);
        };
      });

      it('should create a change', done => {
        zone.createChange = (
          options: CreateChangeRequest,
          callback: Function
        ) => {
          try {
            expect(options.add).toBe(recordsToCreate);
            expect(options.delete).toBe(recordsToDelete);
            callback();
          } catch (e) {
            done(e);
          }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zone.replaceRecords('a', recordsToCreate as any, done);
      });
    });
  });

  describe('deleteRecordsByType_', () => {
    it('should get records', done => {
      const recordType = 'ns';
      zone.getRecords = (recordType_: string) => {
        try {
          expect(recordType_).toBe(recordType);
          done();
        } catch (e) {
          done(e);
        }
      };
      zone.deleteRecordsByType_(recordType, (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      beforeEach(() => {
        zone.getRecords = (recordType: string, callback: Function) => {
          callback(error);
        };
      });

      it('should execute callback with error', done => {
        zone.deleteRecordsByType_('a', (err: Error) => {
          try {
            expect(err).toBe(error);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    describe('success', () => {
      const recordsToDelete = [
        {a: 'b', c: 'd'},
        {a: 'b', c: 'd'},
        {a: 'b', c: 'd'},
      ];

      beforeEach(() => {
        zone.getRecords = (recordType: string, callback: Function) => {
          callback(null, recordsToDelete);
        };
      });

      it('should execute callback if no records matched', done => {
        zone.getRecords = (recordType: string, callback: Function) => {
          callback(null, []);
        };
        zone.deleteRecordsByType_('a', done);
      });

      it('should delete records', done => {
        zone.deleteRecords = (records: Record[], callback: Function) => {
          try {
            expect(records).toBe(recordsToDelete);
            callback();
          } catch (e) {
            done(e);
          }
        };
        zone.deleteRecordsByType_('a', done);
      });
    });
  });
});
