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

import {protos} from '@google-cloud/bigtable-api';
import google = protos.google;
import * as fm from '../src/family';
import {Family, FamilyError} from '../src/family';
import {Table} from '../src/table';

(global as any).mockPromisified = (global as any).mockPromisified || false;
jest.mock('@google-cloud/promisify', () => ({
  ...jest.requireActual('@google-cloud/promisify'),
  promisifyAll: (klass: Function) => {
    if (klass.name === 'Family') {
      (global as any).mockPromisified = true;
    }
  },
}));

describe('Bigtable/Family', () => {
  const FAMILY_ID = 'family-test';
  const TABLE = {
    bigtable: {
      request: () => {},
    },
    id: 'my-table',
    name: 'projects/my-project/instances/my-inststance/tables/my-table',
    getFamilies: () => {},
    createFamily: () => {},
  } as {} as Table;

  const FAMILY_NAME = `${TABLE.name}/columnFamilies/${FAMILY_ID}`;
    let family: fm.Family;
  
  
  beforeEach(() => {
    family = new Family(TABLE, FAMILY_NAME);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect((global as any).mockPromisified).toBeTruthy();
    });

    it('should localize the Bigtable instance', () => {
      expect(family.bigtable).toBe(TABLE.bigtable);
    });

    it('should localize the Table instance', () => {
      expect(family.table).toBe(TABLE);
    });

    it('should localize the full resource path', () => {
      expect(family.id).toBe(FAMILY_ID);
    });

    it('should extract the family name', () => {
      const family = new Family(TABLE, FAMILY_ID);
      expect(family.name).toBe(FAMILY_NAME);
    });

    it('should leave full family names unaltered and localize the id from the name', () => {
      const family = new Family(TABLE, FAMILY_NAME);
      expect(family.name).toBe(FAMILY_NAME);
      expect(family.id).toBe(FAMILY_ID);
    });

    it('should throw if family id in wrong format', () => {
      const id = `/project/bad-project/instances/bad-instance/columnFamiles/${FAMILY_ID}`;
      expect(() => { new Family(TABLE, id); }).toThrow(Error);
    });
  });

  describe('formatRule_', () => {
    it('should capture the max age option', () => {
      const originalRule = {
        age: 10,
      };
      const rule = Family.formatRule_(originalRule);
      expect(rule).toEqual({
        maxAge: originalRule.age,
      });
    });

    it('should capture the max number of versions option', () => {
      const originalRule = {
        versions: 10,
      };
      const rule = Family.formatRule_(originalRule);
      expect(rule).toEqual({
        maxNumVersions: originalRule.versions,
      });
    });

    it('should create a union rule', () => {
      const originalRule = {
        age: 10,
        versions: 2,
        union: true,
      };
      const rule = Family.formatRule_(originalRule);
      expect(rule).toEqual({
        union: {
          rules: [
            {
              maxAge: originalRule.age,
            },
            {
              maxNumVersions: originalRule.versions,
            },
          ],
        },
      });
    });

    it('should create an intersecting rule', () => {
      const originalRule = {
        age: 10,
        versions: 2,
      };
      const rule = Family.formatRule_(originalRule);
      expect(rule).toEqual({
        intersection: {
          rules: [
            {
              maxAge: originalRule.age,
            },
            {
              maxNumVersions: originalRule.versions,
            },
          ],
        },
      });
    });

    it('should allow nested rules', () => {
      const originalRule = {
        age: 10,
        rule: {age: 30, versions: 2},
        union: true,
      };
      const rule = Family.formatRule_(originalRule);
      expect(rule).toEqual({
        union: {
          rules: [
            {maxAge: originalRule.age},
            {
              intersection: {
                rules: [
                  {maxAge: originalRule.rule.age},
                  {maxNumVersions: originalRule.rule.versions},
                ],
              },
            },
          ],
        },
      });
    });

    it('should throw if union only has one rule', () => {
      expect(() => { Family.formatRule_({age: 10, union: true}); }).toThrow(/A union must have more than one garbage collection rule\./);
    });

    it('should throw if no rules are provided', () => {
expect(() => { Family.formatRule_({}); }).toThrow(/No garbage collection rules were specified\./);
    });
  });

  describe('create', () => {
    it('should call createFamily from table', done => {
      const options = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (family as any).table.createFamily = (
        id: string,
        options_: {},
        callback: Function,
      ) => {
        expect(id).toBe(family.id);
        expect(options_).toBe(options);
        callback(); // done()
      };
      family.create(options, done);
    });

    it('should not require options', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (family as any).table.createFamily = (
        name: string,
        options: {},
        callback: Function,
      ) => {
        expect(options).toEqual({});
        callback(); // done()
      };
      family.create(done);
    });
  });

  describe('delete', () => {
    it('should make the correct request', done => {
      jest.spyOn(family.bigtable, 'request').mockImplementation((config, callback) => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('modifyColumnFamilies');
        expect(config.reqOpts).toEqual({
          name: family.table.name,
          modifications: [
            {
              id: family.id,
              drop: true,
            },
          ],
        });
        expect(config.gaxOpts).toEqual({});
        callback!(null); // done()
      });
      family.delete(done);
    });

    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      jest.spyOn(family.bigtable, 'request').mockImplementation(config => {
        expect(config.gaxOpts).toBe(gaxOptions);
        done();
      });
      family.delete(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });
  });

  describe('exists', () => {
    it('should not require gaxOptions', done => {
      jest.spyOn(family, 'getMetadata').mockImplementation(gaxOptions => {
        expect(gaxOptions).toEqual({});
        done();
      });
      family.exists(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should pass gaxOptions to getMetadata', done => {
      const gaxOptions = {};
      jest.spyOn(family, 'getMetadata').mockImplementation(gaxOptions_ => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      });
      family.exists(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return false if FamilyError', done => {
      const error = new FamilyError('Error.');
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      family.exists((err, exists) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(false);
        done();
      });
    });

    it('should return error if not FamilyError', done => {
      const error = new Error('Error.');
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      family.exists(err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return true if no error', done => {
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(null, {}); }) as any);
      family.exists((err, exists) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(exists).toBe(true);
        done();
      });
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const options = {
        gaxOptions: {},
      };
      jest.spyOn(family, 'getMetadata').mockImplementation(gaxOptions => {
        expect(gaxOptions).toBe(options.gaxOptions);
        done();
      });
      family.get(options, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should not require an options object', done => {
      jest.spyOn(family, 'getMetadata').mockImplementation(gaxOptions => {
        expect(gaxOptions).toEqual(undefined);
        done();
      });
      family.get(((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should auto create with a FamilyError error', done => {
      const error = new FamilyError(TABLE.id);
      const options = {
        autoCreate: true,
        gaxOptions: {},
      };
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (family as any).create = (options_: any, callback: Function) => {
        expect(options_.gaxOptions).toBe(options.gaxOptions);
        callback();
      };
      family.get(options, done);
    });

    it('should pass the rules when auto creating', done => {
      const error = new FamilyError(TABLE.id);
      const options = {
        autoCreate: true,
        rule: {
          versions: 1,
        },
      };
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (family as any).create = (options_: {}, callback: Function) => {
        expect(options.rule).toEqual({versions: 1});
        callback();
      };
      family.get(options, done);
    });

    it('should not auto create without a FamilyError error', done => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error('Error.');
      error.code = 'NOT-5';
      const options = {
        autoCreate: true,
      };
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      family.create = () => {
        throw new Error('Should not create.');
      };
      family.get(options, err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should not auto create unless requested', done => {
      const error = new FamilyError(TABLE.id);
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      family.create = () => {
        throw new Error('Should not create.');
      };
      family.get(err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.');
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      family.get(err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should return self and API response', done => {
      const apiResponse = {};
      jest.spyOn(family, 'getMetadata').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(null, apiResponse); }) as any);
      family.get((err, family_, apiResponse_) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(family_).toBe(family);
        expect(apiResponse_).toBe(apiResponse);
        done();
      });
    });
  });

  describe('getMetadata', () => {
    it('should accept gaxOptions', done => {
      const gaxOptions = {};
      jest.spyOn(family.table, 'getFamilies').mockImplementation(gaxOptions_ => {
        expect(gaxOptions_).toBe(gaxOptions);
        done();
      });
      family.getMetadata(gaxOptions, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error to the callback', done => {
      const err = new Error('err');
      const response = {};
      jest.spyOn(family.table, 'getFamilies').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(err, null, response); }) as any);
      family.getMetadata(err_ => {
        expect(err).toBe(err_);
        done();
      });
    });

    it('should update the metadata', done => {
      const family = new Family(TABLE, FAMILY_NAME);
      family.metadata = {
        a: 'a',
        b: 'b',
      } as google.bigtable.admin.v2.IColumnFamily;
      jest.spyOn(family.table, 'getFamilies').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(null, [family]); }) as any);
      family.getMetadata((err, metadata) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(metadata).toBe(family.metadata);
        done();
      });
    });

    it('should return a custom error if no results', done => {
      jest.spyOn(family.table, 'getFamilies').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(null, []); }) as any);
      family.getMetadata(err => {
        expect(err instanceof FamilyError).toBeTruthy();
        done();
      });
    });
  });

  describe('setMetadata', () => {
    it('should provide the proper request options', done => {
      jest.spyOn(family.bigtable, 'request').mockImplementation(config => {
        expect(config.client).toBe('BigtableTableAdminClient');
        expect(config.method).toBe('modifyColumnFamilies');
        expect(config.reqOpts.name).toBe(TABLE.name);
        expect(config.reqOpts.modifications).toEqual([
          {
            id: FAMILY_ID,
            update: {},
          },
        ]);
        done();
      });
      family.setMetadata({}, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should respect the gc rule option', done => {
      const formatRule = Family.formatRule_;

      const formattedRule = {
        a: 'a',
        b: 'b',
      } as fm.IGcRule;

      const metadata = {
        rule: {
          c: 'c',
          d: 'd',
        },
      } as fm.SetFamilyMetadataOptions;
      jest.spyOn(Family, 'formatRule_').mockImplementation(rule => {
        expect(rule).toBe(metadata.rule);
        return formattedRule;
      });
      jest.spyOn(family.bigtable, 'request').mockImplementation(config => {
        expect(config.reqOpts).toEqual({
          name: TABLE.name,
          modifications: [
            {
              id: family.id,
              update: {
                gcRule: formattedRule,
              },
            },
          ],
        });
        Family.formatRule_ = formatRule;
        done();
      });
      family.setMetadata(metadata, ((err: any) => { expect(err).toBeFalsy(); }));
    });

    it('should return an error to the callback', done => {
      const error = new Error('err');
      jest.spyOn(family.bigtable, 'request').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(error); }) as any);
      family.setMetadata({}, err => {
        expect(err).toBe(error);
        done();
      });
    });

    it('should update the metadata property', done => {
      const fakeMetadata = {};
      const response = {
        columnFamilies: {
          'family-test': fakeMetadata,
        },
      };
      jest.spyOn(family.bigtable, 'request').mockImplementation(((...args: any[]) => { const cb = args.find(a => typeof a === 'function'); if (cb) cb(null, response); }) as any);
      family.setMetadata({}, (err, metadata, apiResponse) => {
        ((err: any) => { expect(err).toBeFalsy(); })(err);
        expect(metadata).toBe(fakeMetadata);
        expect(family.metadata).toBe(fakeMetadata);
        expect(apiResponse).toBe(response);
        done();
      });
    });
  });

  describe('FamilyError', () => {
    it('should set the code and message', () => {
      const err = new FamilyError(FAMILY_NAME);

      expect(err.code).toBe(404);
      expect(
        err.message).toBe('Column family not found: ' + FAMILY_NAME + '.',
      );
    });
  });
});
