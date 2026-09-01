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

import * as Long from 'long';

import {IMutateRowRequest, Mutation, IMutation} from '../src/mutation.js';


describe('Bigtable/Mutation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    const fakeData = {
      key: 'a',
      method: 'b',
      data: 'c',
    };

    it('should localize all the mutation properties', () => {
      const mutation = new Mutation(fakeData);

      expect(mutation.key).toBe(fakeData.key);
      expect(mutation.method).toBe(fakeData.method);
      expect(mutation.data).toBe(fakeData.data);
    });
  });

  describe('convertFromBytes', () => {
    describe('isPossibleNumber', () => {
      it('should convert a base64 encoded number when true', () => {
        const num = 10;
        const encoded = Buffer.from(Long.fromNumber(num).toBytesBE()).toString(
          'base64',
        );
        const decoded = Mutation.convertFromBytes(encoded, {
          isPossibleNumber: true,
        });

        expect(num).toBe(decoded);
      });

      it('should convert a base64 encoded MIN_SAFE_INTEGER number when true', () => {
        const num = Number.MIN_SAFE_INTEGER;
        const encoded = Buffer.from(Long.fromNumber(num).toBytesBE()).toString(
          'base64',
        );
        const decoded = Mutation.convertFromBytes(encoded, {
          isPossibleNumber: true,
        });

        expect(num).toBe(decoded);
      });

      it('should convert a base64 encoded MAX_SAFE_INTEGER number when true', () => {
        const num = Number.MAX_SAFE_INTEGER;
        const encoded = Buffer.from(Long.fromNumber(num).toBytesBE()).toString(
          'base64',
        );
        const decoded = Mutation.convertFromBytes(encoded, {
          isPossibleNumber: true,
        });

        expect(num).toBe(decoded);
      });

      it('should not convert a base64 encoded smaller than MIN_SAFE_INTEGER number when true', () => {
        const num = Number.MIN_SAFE_INTEGER - 100;
        const encoded = Buffer.from(Long.fromNumber(num).toBytesBE()).toString(
          'base64',
        );
        const decoded = Mutation.convertFromBytes(encoded, {
          isPossibleNumber: true,
        });

        expect(num).not.toBe(decoded);
      });

      it('should not convert a base64 encoded larger than MAX_SAFE_INTEGER number when true', () => {
        const num = Number.MAX_SAFE_INTEGER + 100;
        const encoded = Buffer.from(Long.fromNumber(num).toBytesBE()).toString(
          'base64',
        );
        const decoded = Mutation.convertFromBytes(encoded, {
          isPossibleNumber: true,
        });

        expect(num).not.toBe(decoded);
      });

      it('should not convert a base64 encoded number when false', () => {
        const num = 10;
        const encoded = Buffer.from(Long.fromNumber(num).toBytesBE()).toString(
          'base64',
        );
        const decoded = Mutation.convertFromBytes(encoded);

        expect(num).not.toBe(decoded);
      });
    });

    it('should convert a base64 encoded string', () => {
      const message = 'Hello!';
      const encoded = Buffer.from(message).toString('base64');
      const decoded = Mutation.convertFromBytes(encoded);

      expect(message).toBe(decoded);
    });

    it('should allow using a custom encoding scheme', () => {
      const message = 'æ';
      const encoded = Buffer.from(message, 'binary').toString('base64');
      const decoded = Mutation.convertFromBytes(encoded, {
        userOptions: {encoding: 'binary'},
      });

      expect(message).toBe(decoded);
    });

    it('should return a buffer if decode is set to false', () => {
      const message = 'Hello!';
      const encoded = Buffer.from(message).toString('base64');
      const userOptions = {decode: false};
      const decoded = Mutation.convertFromBytes(encoded, {
        userOptions,
      });

      expect(decoded instanceof Buffer).toBeTruthy();
      expect(decoded.toString()).toBe(message);
    });

    it('should not create a new Buffer needlessly', () => {
      const message = 'Hello!';
      const encoded = Buffer.from(message);
      const stub = jest.spyOn(Buffer, 'from');
      const decoded = Mutation.convertFromBytes(encoded);
      expect(stub).not.toHaveBeenCalled();
      expect(decoded.toString()).toBe(message);
    });
  });

  describe('convertToBytes', () => {
    it('should not re-wrap buffers', () => {
      const buf = Buffer.from('hello');
      const encoded = Mutation.convertToBytes(buf);

      expect(buf).toBe(encoded);
    });

    it('should pack numbers into int64 values', () => {
      const num = 10;
      const encoded = Mutation.convertToBytes(num);
      const decoded = Long.fromBytes(encoded as number[]).toNumber();

      expect(num).toBe(decoded);
    });

    it('should wrap the value in a buffer', () => {
      const message = 'Hello!';
      const encoded = Mutation.convertToBytes(message);

      expect(encoded instanceof Buffer).toBeTruthy();
      expect(encoded.toString()).toBe(message);
    });

    it('should simply return the value if it cannot wrap it', () => {
      const message = true;
      const notEncoded = Mutation.convertToBytes(message);

      expect(!(notEncoded instanceof Buffer)).toBe(true);
      expect(message).toBe(notEncoded);
    });
  });

  describe('createTimeRange', () => {
    it('should create a time range', () => {
      const timestamp = Date.now();
      const dateObj = new Date(timestamp);
      const range = Mutation.createTimeRange(dateObj, dateObj);
      expect(range.startTimestampMicros).toBe(timestamp * 1000);
      expect(range.endTimestampMicros).toBe(timestamp * 1000);
    });
  });

  describe('encodeSetCell', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let convertCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeTime = new Date('2018-1-1') as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const realTimestamp = new Date() as any;

    beforeEach(() => {
      jest.spyOn(global, 'Date').mockImplementation(() => fakeTime);
      convertCalls = [];
      jest.spyOn(Mutation, 'convertToBytes').mockImplementation(value => {
        convertCalls.push(value);
        return value;
      });
    });

    it('should encode a setCell mutation', () => {
      const fakeMutation = {
        follows: {
          gwashington: 1,
          alincoln: 1,
        },
      };

      const cells = Mutation.encodeSetCell(fakeMutation);

      expect(cells.length).toBe(2);

      expect(cells).toEqual([
        {
          setCell: {
            familyName: 'follows',
            columnQualifier: 'gwashington',
            timestampMicros: fakeTime * 1000, // Convert ms to μs
            value: 1,
          },
        },
        {
          setCell: {
            familyName: 'follows',
            columnQualifier: 'alincoln',
            timestampMicros: fakeTime * 1000, // Convert ms to μs
            value: 1,
          },
        },
      ]);

      expect(convertCalls.length).toBe(4);
      expect(convertCalls).toEqual(['gwashington', 1, 'alincoln', 1]);
    });

    it('should optionally accept a timestamp', () => {
      const fakeMutation = {
        follows: {
          gwashington: {
            value: 1,
            timestamp: realTimestamp,
          },
        },
      };

      const cells = Mutation.encodeSetCell(fakeMutation);

      expect(cells).toEqual([
        {
          setCell: {
            familyName: 'follows',
            columnQualifier: 'gwashington',
            timestampMicros: realTimestamp * 1000, // Convert ms to μs
            value: 1,
          },
        },
      ]);

      expect(convertCalls.length).toBe(2);
      expect(convertCalls).toEqual(['gwashington', 1]);
    });

    it('should accept buffers', () => {
      const val = Buffer.from('hello');
      const fakeMutation = {
        follows: {
          gwashington: val,
        },
      };

      const cells = Mutation.encodeSetCell(fakeMutation);

      expect(cells).toEqual([
        {
          setCell: {
            familyName: 'follows',
            columnQualifier: 'gwashington',
            timestampMicros: fakeTime * 1000, // Convert ms to μs
            value: val,
          },
        },
      ]);

      expect(convertCalls.length).toBe(2);
      expect(convertCalls).toEqual(['gwashington', val]);
    });
  });

  describe('encodeDelete', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let convertCalls: any[] = [];

    beforeEach(() => {
      convertCalls = [];
      jest.spyOn(Mutation, 'convertToBytes').mockImplementation(value => {
        convertCalls.push(value);
        return value;
      });
    });

    it('should create a delete row mutation', () => {
      const mutation = Mutation.encodeDelete();
      expect(mutation).toEqual([
        {
          deleteFromRow: {},
        },
      ]);
    });

    it('should array-ify the input', () => {
      const fakeKey = 'follows';
      const mutation = Mutation.encodeDelete(fakeKey);

      expect(mutation).toEqual([
        {
          deleteFromFamily: {
            familyName: fakeKey,
          },
        },
      ]);
    });

    it('should create a delete family mutation', () => {
      const fakeColumnName = {
        family: 'followed',
        qualifier: null,
      };
      jest.spyOn(Mutation, 'parseColumnName').mockReturnValue(fakeColumnName);
      const mutation = Mutation.encodeDelete(['follows']);
      expect(mutation).toEqual([
        {
          deleteFromFamily: {
            familyName: fakeColumnName.family,
          },
        },
      ]);
    });

    it('should create a delete column mutation', () => {
      const mutation = Mutation.encodeDelete(['follows:gwashington']);
      expect(mutation).toEqual([
        {
          deleteFromColumn: {
            familyName: 'follows',
            columnQualifier: 'gwashington',
            timeRange: undefined,
          },
        },
      ]);

      expect(convertCalls.length).toBe(1);
      expect(convertCalls[0]).toBe('gwashington');
    });

    it('should optionally accept a timerange for column requests', () => {
      const createTimeRange = Mutation.createTimeRange;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timeCalls: any[] = [];
      const fakeTimeRange = {a: 'a'};

      const fakeMutationData = {
        column: 'follows:gwashington',
        time: {
          start: 1,
          end: 2,
        },
      };

      Mutation.createTimeRange = (start, end) => {
        timeCalls.push({
          start,
          end,
        });
        return fakeTimeRange;
      };

      const mutation = Mutation.encodeDelete(fakeMutationData);

      expect(mutation).toEqual([
        {
          deleteFromColumn: {
            familyName: 'follows',
            columnQualifier: 'gwashington',
            timeRange: fakeTimeRange,
          },
        },
      ]);

      expect(timeCalls.length).toBe(1);
      expect(timeCalls[0]).toEqual(fakeMutationData.time);

      Mutation.createTimeRange = createTimeRange;
    });
  });

  describe('parse', () => {
    let toProtoCalled = false;
    const fakeData = {a: 'a'} as IMutateRowRequest;

    beforeEach(() => {
      jest.spyOn(Mutation.prototype, 'toProto').mockImplementation(() => {
        toProtoCalled = true;
        return fakeData;
      });
    });

    it('should create a new mutation object and parse it', () => {
      const fakeMutationData = {
        key: 'a',
        method: 'b',
        data: 'c',
      } as Mutation;
      const mutation = Mutation.parse(fakeMutationData);
      expect(toProtoCalled).toBe(true);
      expect(mutation).toBe(fakeData);
    });

    it('should parse a pre-existing mutation object', () => {
      const data = new Mutation({
        key: 'a',
        method: 'b',
        data: [],
      });

      const mutation = Mutation.parse(data);

      expect(toProtoCalled).toBe(true);
      expect(mutation).toBe(fakeData);
    });
  });

  describe('parseColumnName', () => {
    it('should parse a column name', () => {
      const parsed = Mutation.parseColumnName('a:b');

      expect(parsed.family).toBe('a');
      expect(parsed.qualifier).toBe('b');
    });

    it('should parse a family name', () => {
      const parsed = Mutation.parseColumnName('a');

      expect(parsed.family).toBe('a');
      expect(parsed.qualifier).toBe(undefined);
    });

    it('should parse a qualifier name with colons', () => {
      const parsed = Mutation.parseColumnName('a:b:c');

      expect(parsed.family).toBe('a');
      expect(parsed.qualifier).toBe('b:c');
    });
  });

  describe('toProto', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let convertCalls: any[] = [];

    beforeEach(() => {
      jest.spyOn(Mutation, 'convertToBytes').mockImplementation(value => {
        convertCalls.push(value);
        return value;
      });
      convertCalls = [];
    });

    it('should encode set cell mutations when method is insert', () => {
      const fakeEncoded = [{a: 'a'}];
      const data = {
        key: 'a',
        method: 'insert',
        data: [],
      };
      const mutation = new Mutation(data);
      jest.spyOn(Mutation, 'encodeSetCell').mockImplementation(_data => {
        expect(_data).toBe(data.data);
        return fakeEncoded;
      });
      const mutationProto = mutation.toProto();
      expect(mutationProto.mutations).toBe(fakeEncoded);
      expect(mutationProto.rowKey).toBe(data.key);
      expect(convertCalls[0]).toBe(data.key);
    });

    it('should encode delete mutations when method is delete', () => {
      const fakeEncoded = [{b: 'b'}] as {} as IMutation[];
      const data = {
        key: 'b',
        method: 'delete',
        data: [],
      };
      jest.spyOn(Mutation, 'encodeDelete').mockImplementation(_data => {
        expect(_data).toBe(data.data);
        return fakeEncoded;
      });
      const mutation = new Mutation(data).toProto();
      expect(mutation.mutations).toBe(fakeEncoded);
      expect(mutation.rowKey).toBe(data.key);
      expect(convertCalls[0]).toBe(data.key);
    });
  });
});
