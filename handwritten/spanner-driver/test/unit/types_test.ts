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

import {
  BuiltinOids,
  TypeOverrides,
  parseBool,
  parseBytea,
  parseFloatVal,
  parsePgArray,
  parseString,
  parseTimestamp,
  types,
} from '../../src/lib/pg/types.js';
import {FieldDef, getDefaultTypeOverrides} from '../../src/lib/types.js';
import {Codec} from '../../src/lib/codec.js';

describe('Type System & Parsers', () => {
  describe('Scalar Type Parsers', () => {
    it('should parse boolean values and string variants', () => {
      expect(parseBool('true')).toBe(true);
      expect(parseBool('t')).toBe(true);
      expect(parseBool('1')).toBe(true);
      expect(parseBool('yes')).toBe(true);
      expect(parseBool('false')).toBe(false);
      expect(parseBool('f')).toBe(false);
      expect(parseBool('0')).toBe(false);
      expect(parseBool('no')).toBe(false);
      expect(parseBool('')).toBe(false);

      expect(types.getTypeParser(BuiltinOids.BOOL)('t')).toBe(true);
      expect(types.getTypeParser(BuiltinOids.BOOL)('f')).toBe(false);
    });

    it('should parse integers (INT8)', () => {
      // INT8 returns string by default to prevent 64-bit precision loss
      const largeInt = '9223372036854775807';
      expect(types.getTypeParser(BuiltinOids.INT8)(largeInt)).toBe(largeInt);
    });

    it('should parse floating point and decimal numbers (FLOAT4, FLOAT8, NUMERIC)', () => {
      expect(types.getTypeParser(BuiltinOids.FLOAT8)('3.14159')).toBe(3.14159);
      expect(types.getTypeParser(BuiltinOids.FLOAT4)('2.5')).toBe(2.5);
      // NUMERIC returns exact string by default
      const numStr = '12345678901234567890.123456789';
      expect(types.getTypeParser(BuiltinOids.NUMERIC)(numStr)).toBe(numStr);
    });

    it('should parse text and string types (TEXT, VARCHAR, UUID)', () => {
      expect(types.getTypeParser(BuiltinOids.TEXT)('hello world')).toBe(
        'hello world',
      );
      expect(types.getTypeParser(BuiltinOids.VARCHAR)('varchar text')).toBe(
        'varchar text',
      );
      expect(
        types.getTypeParser(BuiltinOids.UUID)(
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        ),
      ).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    });

    it('should parse date and timestamp types (DATE, TIMESTAMP, TIMESTAMPTZ)', () => {
      expect(types.getTypeParser(BuiltinOids.DATE)('2026-08-07')).toBe(
        '2026-08-07',
      );
      const parsed = types.getTypeParser(BuiltinOids.TIMESTAMPTZ)(
        '2026-08-07 14:30:00.000000+00',
      ) as Date;
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.toISOString()).toBe('2026-08-07T14:30:00.000Z');
    });

    it('should parse JSON and JSONB types into objects', () => {
      const parsed = types.getTypeParser(BuiltinOids.JSONB)(
        '{"key":"value","count":10}',
      );
      expect(parsed).toEqual({key: 'value', count: 10});

      const parsedArr = types.getTypeParser(BuiltinOids.JSON)(
        '[1, 2, "three"]',
      );
      expect(parsedArr).toEqual([1, 2, 'three']);
    });

    it('should parse BYTEA into Node.js Buffer', () => {
      const base64Str = Buffer.from('hello spanner').toString('base64');
      const buf1 = types.getTypeParser(BuiltinOids.BYTEA)(base64Str) as Buffer;
      expect(Buffer.isBuffer(buf1)).toBe(true);
      expect(buf1.toString('utf8')).toBe('hello spanner');

      const hexStr = '\\x6465616462656566'; // 'deadbeef'
      const buf2 = types.getTypeParser(BuiltinOids.BYTEA)(hexStr) as Buffer;
      expect(Buffer.isBuffer(buf2)).toBe(true);
      expect(buf2.toString('hex')).toBe('6465616462656566');
    });
  });

  describe('PostgreSQL Array Parser', () => {
    it('should parse 1D and nested pre-parsed array elements', () => {
      expect(types.getTypeParser(1022)([1.5, 2.5, 3.5])).toEqual([
        1.5, 2.5, 3.5,
      ]);
      expect(types.getTypeParser(1016)(['10', '20'])).toEqual(['10', '20']);
      expect(types.getTypeParser(1000)([true, false, true, false])).toEqual([
        true,
        false,
        true,
        false,
      ]);
      expect(
        types.getTypeParser(1009)([
          ['a', 'b'],
          ['c', 'd'],
        ]),
      ).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('should parse arrays with NULL elements', () => {
      expect(
        parsePgArray([1, null, 3, null], val => (val ? Number(val) : null)),
      ).toEqual([1, null, 3, null]);
      expect(
        parsePgArray(['hello, world', 'foo, bar'], val => String(val)),
      ).toEqual(['hello, world', 'foo, bar']);
      expect(parsePgArray([])).toEqual([]);
      expect(parsePgArray(null)).toEqual([]);
    });
  });

  describe('TypeOverrides Scoping & Hierarchy', () => {
    it('should allow custom parser registration and support format parameter overload', () => {
      const overrides = new TypeOverrides();
      overrides.setTypeParser(BuiltinOids.INT8, 'text', val => BigInt(val));
      expect(overrides.getTypeParser(BuiltinOids.INT8)('100')).toBe(
        BigInt(100),
      );

      expect(() => {
        overrides.setTypeParser(
          BuiltinOids.INT8,
          'not-a-function' as unknown as (val: unknown) => unknown,
        );
      }).toThrow(/Type parser must be a function/);
    });

    it('should allow registering custom array parsers on array OIDs', () => {
      const overrides = new TypeOverrides();
      overrides.setTypeParser(1016, val =>
        overrides.arrayParser(val, x => Number(x) * 10),
      );
      expect(overrides.getTypeParser(1016)([1, 2])).toEqual([10, 20]);
    });

    it('should support hierarchical parent fallback in TypeOverrides', () => {
      const parent = new TypeOverrides();
      parent.setTypeParser(BuiltinOids.INT8, val => BigInt(val));

      const child = new TypeOverrides(parent);
      // Child inherits parent's INT8 parser
      expect(child.getTypeParser(BuiltinOids.INT8)('42')).toBe(BigInt(42));

      // Child override takes precedence
      child.setTypeParser(BuiltinOids.INT8, val => Number(val));
      expect(child.getTypeParser(BuiltinOids.INT8)('42')).toBe(42);
      // Parent remains unchanged
      expect(parent.getTypeParser(BuiltinOids.INT8)('42')).toBe(BigInt(42));
    });

    it('should provide arrayParser helper and throw on non-numeric OID', () => {
      const overrides = new TypeOverrides();
      expect(overrides.arrayParser([10, 20], val => Number(val) + 1)).toEqual([
        11, 21,
      ]);

      expect(() => {
        overrides.getTypeParser('INVALID_OID');
      }).toThrow(/Invalid PostgreSQL OID/);

      expect(() => {
        overrides.getTypeParser(BuiltinOids.INT8, 'binary');
      }).toThrow(/Binary wire format is not supported/);

      expect(() => {
        overrides.setTypeParser(BuiltinOids.INT8, 'binary', val => val);
      }).toThrow(/Binary wire format is not supported/);
    });
  });

  describe('Row Decoding (Codec.decodeRow)', () => {
    const fields: FieldDef[] = [
      {name: 'id', dataTypeID: BuiltinOids.FLOAT8},
      {name: 'name', dataTypeID: BuiltinOids.TEXT},
      {name: 'active', dataTypeID: BuiltinOids.BOOL},
      {name: 'tags', dataTypeID: 1009},
    ];
    const rawRow = ['101', 'Spanner', 't', ['cloud', 'db']];

    it('should decode row in object mode', () => {
      const parsers = fields.map(f => types.getTypeParser(f.dataTypeID));
      const decoded = Codec.decodeRow<Record<string, unknown>>(
        rawRow,
        fields,
        parsers,
        'object',
      );
      expect(decoded).toEqual({
        id: 101,
        name: 'Spanner',
        active: true,
        tags: ['cloud', 'db'],
      });
    });

    it('should decode row in array mode', () => {
      const parsers = fields.map(f => types.getTypeParser(f.dataTypeID));
      const decoded = Codec.decodeRow<unknown[]>(
        rawRow,
        fields,
        parsers,
        'array',
      );
      expect(decoded).toEqual([101, 'Spanner', true, ['cloud', 'db']]);
    });

    it('should decode rows with custom TypeOverrides and fallback', () => {
      const customOverrides = new TypeOverrides();
      customOverrides.setTypeParser(BuiltinOids.FLOAT8, val => `id_${val}`);

      const parsers = Codec.getTypeParsers(fields, customOverrides);
      const decoded = Codec.decodeRow<Record<string, unknown>>(
        rawRow,
        fields,
        parsers,
      );
      expect(decoded.id).toBe('id_101');
      expect(decoded.name).toBe('Spanner');
    });

    it('should return default PG type overrides via getDefaultTypeOverrides', () => {
      const defaultTypes = getDefaultTypeOverrides('pg');
      expect(defaultTypes.getTypeParser(BuiltinOids.BOOL)('t')).toBe(true);
      expect(defaultTypes.getTypeParser(BuiltinOids.FLOAT8)('42')).toBe(42);
    });

    it('should decode rows containing structValue and array of structValues', () => {
      const structFields: FieldDef[] = [
        {name: 'user', dataTypeID: BuiltinOids.JSON},
        {name: 'items', dataTypeID: 3807},
      ];
      const listValue = {
        values: [
          {
            structValue: {
              fields: {
                id: {stringValue: '100'},
                score: {numberValue: 98.5},
              },
            },
          },
          {
            listValue: {
              values: [
                {
                  structValue: {
                    fields: {
                      itemId: {stringValue: 'item_1'},
                      qty: {numberValue: 5},
                    },
                  },
                },
              ],
            },
          },
        ],
      };
      const raw = Codec.extractRawRow(
        listValue as Parameters<typeof Codec.extractRawRow>[0],
      );
      const parsers = structFields.map(f => types.getTypeParser(f.dataTypeID));
      const decoded = Codec.decodeRow<Record<string, unknown>>(
        raw,
        structFields,
        parsers,
      );
      expect(decoded).toEqual({
        user: {id: '100', score: 98.5},
        items: [{itemId: 'item_1', qty: 5}],
      });
    });

    it('should handle pre-parsed values gracefully in parsers', () => {
      const date = new Date('2026-08-11T10:00:00.000Z');
      expect(parseTimestamp(date)).toBe(date);
      expect(parseBool(true)).toBe(true);
      expect(parseFloatVal(3.14)).toBe(3.14);
      expect(parseString(100)).toBe('100');
      expect(parseBytea(Buffer.from('hi')).toString()).toBe('hi');
    });
  });
});
