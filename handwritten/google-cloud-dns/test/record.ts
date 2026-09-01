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

import * as promisify from '@google-cloud/promisify';

let promisified = false;

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll(esClass: Function, options?: promisify.PromisifyAllOptions) {
      if (esClass.name === 'Record') {
        promisified = true;
        expect(options?.exclude).toEqual(['toJSON', 'toString']);
      }
      return actual.promisifyAll(esClass, options);
    },
  };
});

import {Record} from '../src/record';

interface Metadata {
  name: string;
  data?: string[];
  ttl: number;
}

describe('Record', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let record: any;

  const ZONE = {
    deleteRecords() {},
  };
  const TYPE = 'A';
  const METADATA = {
    name: 'name',
    data: [],
    ttl: 86400,
  };

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record = new Record(ZONE as any, TYPE, METADATA);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should localize the zone instance', () => {
      expect(record.zone_).toBe(ZONE);
    });

    it('should localize the type', () => {
      expect(record.type).toBe(TYPE);
    });

    it('should localize the metadata', () => {
      expect(record.metadata).toBe(METADATA);
    });

    it('should assign the parsed metadata', () => {
      const parsedMetadata = record.toJSON();
      delete parsedMetadata.rrdatas;
      for (const prop in parsedMetadata) {
        expect(record[prop]).toEqual(parsedMetadata[prop]);
      }
    });

    it('should re-assign rrdatas to data', () => {
      const originalRrdatas = new Array<string>();

      const recordThatHadRrdatas = new Record(ZONE as any, TYPE, {
        rrdatas: originalRrdatas,
        name: 'name',
        ttl: 86400,
      });

      expect(recordThatHadRrdatas.rrdatas).toBeUndefined();
      expect(recordThatHadRrdatas.data).toBe(originalRrdatas);
    });
  });

  describe('fromZoneRecord_', () => {
    describe('a', () => {
      const aRecord = {
        ip: '0.0.0.0',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = aRecord.ip;

      it('should parse an A record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'a', aRecord);

        expect(record.type).toBe('A');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(aRecord.name);
        expect(record.metadata.ttl).toBe(aRecord.ttl);
      });
    });

    describe('aaaa', () => {
      const aaaaRecord = {
        ip: '2607:f8b0:400a:801::1005',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = aaaaRecord.ip;

      it('should parse an AAAA record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'aaaa', aaaaRecord);

        expect(record.type).toBe('AAAA');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(aaaaRecord.name);
        expect(record.metadata.ttl).toBe(aaaaRecord.ttl);
      });
    });

    describe('cname', () => {
      const cnameRecord = {
        alias: 'example.com.',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = cnameRecord.alias;

      it('should parse a CNAME record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'cname', cnameRecord);

        expect(record.type).toBe('CNAME');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(cnameRecord.name);
        expect(record.metadata.ttl).toBe(cnameRecord.ttl);
      });
    });

    describe('mx', () => {
      const mxRecord = {
        preference: 0,
        host: 'mail',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = mxRecord.preference + ' ' + mxRecord.host;

      it('should parse an MX record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'mx', mxRecord);

        expect(record.type).toBe('MX');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(mxRecord.name);
        expect(record.metadata.ttl).toBe(mxRecord.ttl);
      });
    });

    describe('ns', () => {
      const nsRecord = {
        host: 'example.com',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = nsRecord.host;

      it('should parse an NS record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'ns', nsRecord);

        expect(record.type).toBe('NS');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(nsRecord.name);
        expect(record.metadata.ttl).toBe(nsRecord.ttl);
      });
    });

    describe('soa', () => {
      const soaRecord = {
        mname: 'ns1.nameserver.net.',
        rname: 'hostmaster.mydomain.com.',
        serial: 86400,
        retry: 600,
        refresh: 3600,
        expire: 604800,
        minimum: 86400,
        name: 'name',
        ttl: 86400,
      };

      const expectedData = [
        soaRecord.mname,
        soaRecord.rname,
        soaRecord.serial,
        soaRecord.retry,
        soaRecord.refresh,
        soaRecord.expire,
        soaRecord.minimum,
      ].join(' ');

      it('should parse an SOA record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'soa', soaRecord);

        expect(record.type).toBe('SOA');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(soaRecord.name);
        expect(record.metadata.ttl).toBe(soaRecord.ttl);
      });
    });

    describe('spf', () => {
      const spfRecord = {
        data: '"v=spf1" "mx:example.com"',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = spfRecord.data;

      it('should parse an SPF record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'spf', spfRecord);

        expect(record.type).toBe('SPF');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(spfRecord.name);
        expect(record.metadata.ttl).toBe(spfRecord.ttl);
      });
    });

    describe('srv', () => {
      const srvRecord = {
        priority: 10,
        weight: 0,
        port: 5222,
        target: 'jabber',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = [
        srvRecord.priority,
        srvRecord.weight,
        srvRecord.port,
        srvRecord.target,
      ].join(' ');

      it('should parse an SRV record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'srv', srvRecord);

        expect(record.type).toBe('SRV');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(srvRecord.name);
        expect(record.metadata.ttl).toBe(srvRecord.ttl);
      });
    });

    describe('txt', () => {
      const txtRecord = {
        txt: 'txt-record-txt',
        name: 'name',
        ttl: 86400,
      };

      const expectedData = txtRecord.txt;

      it('should parse a TXT record', () => {
        const record = Record.fromZoneRecord_(ZONE as any, 'txt', txtRecord);

        expect(record.type).toBe('TXT');
        expect(record.metadata.data).toBe(expectedData);
        expect(record.metadata.name).toBe(txtRecord.name);
        expect(record.metadata.ttl).toBe(txtRecord.ttl);
      });
    });
  });

  describe('delete', () => {
    it('should call zone.deleteRecords', done => {
      record.zone_.deleteRecords = (records: Record[], callback: Function) => {
        try {
          expect(records).toBe(record);
          callback();
        } catch (e) {
          done(e);
        }
      };
      record.delete(done);
    });
  });

  describe('toJSON', () => {
    it('should format the data for the API', () => {
      const expectedRecord: Metadata = Object.assign({}, METADATA, {
        type: 'A',
        rrdatas: METADATA.data,
      });
      delete expectedRecord.data;

      expect(record.toJSON()).toEqual(expectedRecord);
    });
  });

  describe('toString', () => {
    it('should format the data for a zonefile', () => {
      const jsonRecord = Object.assign({}, METADATA, {
        type: TYPE,
        rrdatas: ['example.com.', 'example2.com.'],
      });

      record.toJSON = () => {
        return jsonRecord;
      };

      const expectedRecordString = [
        [
          jsonRecord.name,
          jsonRecord.ttl,
          'IN',
          TYPE,
          jsonRecord.rrdatas[0],
        ].join(' '),

        [
          jsonRecord.name,
          jsonRecord.ttl,
          'IN',
          TYPE,
          jsonRecord.rrdatas[1],
        ].join(' '),
      ].join('\n');

      expect(record.toString()).toBe(expectedRecordString);
    });
  });
});
