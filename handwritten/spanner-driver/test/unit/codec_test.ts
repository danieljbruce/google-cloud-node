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

import {Codec} from '../../src/lib/codec.js';
import {BuiltinOids} from '../../src/lib/pg/types.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pkg from '@google-cloud/spanner-api/build/protos/protos.js';
import type {google as GoogleProto} from '@google-cloud/spanner-api/build/protos/protos.js';

const google =
  (pkg as unknown as {google: typeof GoogleProto}).google ||
  (pkg as unknown as {default: {google: typeof GoogleProto}}).default?.google ||
  (pkg as unknown as {default: typeof GoogleProto}).default;

describe('Codec Utilities', () => {
  describe('mapMetadataToFieldDefs', () => {
    it('should return empty array for null/undefined metadata', () => {
      expect(Codec.mapMetadataToFieldDefs(null)).toEqual([]);
      expect(Codec.mapMetadataToFieldDefs(undefined)).toEqual([]);
      expect(Codec.mapMetadataToFieldDefs({})).toEqual([]);
    });

    it('should map Spanner scalar and array TypeCodes to PostgreSQL OIDs', () => {
      const metadata: GoogleProto.spanner.v1.IResultSetMetadata = {
        rowType: {
          fields: [
            {name: 'b', type: {code: google.spanner.v1.TypeCode.BOOL}},
            {name: 'i', type: {code: google.spanner.v1.TypeCode.INT64}},
            {name: 'f', type: {code: google.spanner.v1.TypeCode.FLOAT64}},
            {name: 'ts', type: {code: google.spanner.v1.TypeCode.TIMESTAMP}},
            {name: 'd', type: {code: google.spanner.v1.TypeCode.DATE}},
            {name: 's', type: {code: google.spanner.v1.TypeCode.STRING}},
            {name: 'by', type: {code: google.spanner.v1.TypeCode.BYTES}},
            {name: 'n', type: {code: google.spanner.v1.TypeCode.NUMERIC}},
            {name: 'j', type: {code: google.spanner.v1.TypeCode.JSON}},
            {
              name: 'arr_i',
              type: {
                code: google.spanner.v1.TypeCode.ARRAY,
                arrayElementType: {code: google.spanner.v1.TypeCode.INT64},
              },
            },
            {
              name: 'arr_s',
              type: {
                code: google.spanner.v1.TypeCode.ARRAY,
                arrayElementType: {code: google.spanner.v1.TypeCode.STRING},
              },
            },
          ],
        },
      };

      const fields = Codec.mapMetadataToFieldDefs(metadata, 'pg');
      expect(fields.length).toBe(11);
      expect(fields[0].dataTypeID).toBe(BuiltinOids.BOOL);
      expect(fields[1].dataTypeID).toBe(BuiltinOids.INT8);
      expect(fields[2].dataTypeID).toBe(BuiltinOids.FLOAT8);
      expect(fields[3].dataTypeID).toBe(BuiltinOids.TIMESTAMPTZ);
      expect(fields[4].dataTypeID).toBe(BuiltinOids.DATE);
      expect(fields[5].dataTypeID).toBe(BuiltinOids.TEXT);
      expect(fields[6].dataTypeID).toBe(BuiltinOids.BYTEA);
      expect(fields[7].dataTypeID).toBe(BuiltinOids.NUMERIC);
      expect(fields[9].dataTypeID).toBe(1016); // int8[]
      expect(fields[10].dataTypeID).toBe(1009); // text[]
    });

    it('should map GoogleSQL dialect types directly as strings', () => {
      const metadata: GoogleProto.spanner.v1.IResultSetMetadata = {
        rowType: {
          fields: [{name: 'i', type: {code: google.spanner.v1.TypeCode.INT64}}],
        },
      };
      const fields = Codec.mapMetadataToFieldDefs(metadata, 'googlesql');
      expect(fields.length).toBe(1);
      expect(fields[0].dataTypeID).toBe(
        String(google.spanner.v1.TypeCode.INT64),
      );
    });
  });

  describe('extractRawRow', () => {
    it('should return empty array for null/undefined ListValue', () => {
      expect(Codec.extractRawRow(null)).toEqual([]);
      expect(Codec.extractRawRow(undefined)).toEqual([]);
      expect(Codec.extractRawRow({})).toEqual([]);
    });

    it('should extract values directly without unnecessary string conversions', () => {
      const listValue: GoogleProto.protobuf.IListValue = {
        values: [
          {stringValue: 'hello'},
          {stringValue: '123'},
          {boolValue: true},
          {boolValue: false},
          {numberValue: 45.6},
          {nullValue: google.protobuf.NullValue.NULL_VALUE},
          {structValue: {fields: {k: {stringValue: 'v'}}}},
        ],
      };

      const raw = Codec.extractRawRow(listValue);
      expect(raw[0]).toBe('hello');
      expect(raw[1]).toBe('123');
      expect(raw[2]).toBe(true);
      expect(raw[3]).toBe(false);
      expect(raw[4]).toBe(45.6);
      expect(raw[5]).toBeNull();
      expect(raw[6]).toEqual({k: 'v'});
    });
  });

  describe('encodeValue & encodeParams', () => {
    it('should encode JavaScript primitives and complex objects into Spanner protobuf format', () => {
      // Booleans
      expect(Codec.encodeValue(true)).toEqual({
        valueProto: {boolValue: true},
        typeProto: {code: google.spanner.v1.TypeCode.BOOL},
      });

      // Integers
      expect(Codec.encodeValue(42)).toEqual({
        valueProto: {stringValue: '42'},
        typeProto: {code: google.spanner.v1.TypeCode.INT64},
      });

      // Floats
      expect(Codec.encodeValue(3.14)).toEqual({
        valueProto: {numberValue: 3.14},
        typeProto: {code: google.spanner.v1.TypeCode.FLOAT64},
      });

      // BigInt
      expect(Codec.encodeValue(BigInt(9007199254740991))).toEqual({
        valueProto: {stringValue: '9007199254740991'},
        typeProto: {code: google.spanner.v1.TypeCode.INT64},
      });

      // Buffer
      const buf = Buffer.from('hello');
      expect(Codec.encodeValue(buf)).toEqual({
        valueProto: {stringValue: buf.toString('base64')},
        typeProto: {code: google.spanner.v1.TypeCode.BYTES},
      });

      // Dates
      const d = new Date('2023-01-01T00:00:00.000Z');
      expect(Codec.encodeValue(d)).toEqual({
        valueProto: {stringValue: d.toISOString()},
        typeProto: {code: google.spanner.v1.TypeCode.TIMESTAMP},
      });

      // Invalid Date object -> nullValue
      const invalidDate = new Date('invalid');
      expect(Codec.encodeValue(invalidDate)).toEqual({
        valueProto: {nullValue: google.protobuf.NullValue.NULL_VALUE},
        typeProto: {code: google.spanner.v1.TypeCode.TIMESTAMP},
      });

      // Objects / JSON
      const obj = {genre: 'rock'};
      expect(Codec.encodeValue(obj)).toEqual({
        valueProto: {stringValue: JSON.stringify(obj)},
        typeProto: {code: google.spanner.v1.TypeCode.STRING},
      });

      // Null / Undefined
      expect(Codec.encodeValue(null)).toEqual({
        valueProto: {nullValue: google.protobuf.NullValue.NULL_VALUE},
        typeProto: {code: google.spanner.v1.TypeCode.TYPE_CODE_UNSPECIFIED},
      });
    });

    it('should encode arrays correctly', () => {
      // Empty array
      const emptyArr = Codec.encodeValue([]);
      expect(emptyArr.valueProto).toEqual({listValue: {values: []}});
      expect(emptyArr.typeProto).toEqual({
        code: google.spanner.v1.TypeCode.ARRAY,
        arrayElementType: {
          code: google.spanner.v1.TypeCode.TYPE_CODE_UNSPECIFIED,
        },
      });

      // Integer array
      const intArr = Codec.encodeValue([1, 2, 3]);
      expect(intArr.valueProto).toEqual({
        listValue: {
          values: [{stringValue: '1'}, {stringValue: '2'}, {stringValue: '3'}],
        },
      });
      expect(intArr.typeProto).toEqual({
        code: google.spanner.v1.TypeCode.ARRAY,
        arrayElementType: {code: google.spanner.v1.TypeCode.INT64},
      });
    });

    it('should encode parameters via Codec.encodeParams supporting toPostgres custom objects', () => {
      const customParam = {toPostgres: () => 'custom_val'};
      const {fields} = Codec.encodeParams(['test', 123, true, customParam]);
      expect(fields.p1).toEqual({stringValue: 'test'});
      expect(fields.p2).toEqual({stringValue: '123'});
      expect(fields.p3).toEqual({boolValue: true});
      expect(fields.p4).toEqual({stringValue: 'custom_val'});
    });

    it('should unwrap custom objects with .toPostgres() inside array parameters', () => {
      // Custom ORM / domain model wrappers
      const customId1 = {toPostgres: () => 101};
      const customId2 = {toPostgres: () => 102};
      // Pass array of custom objects to parameter $1
      const {fields} = Codec.encodeParams([[customId1, customId2]], 'pg');
      expect(fields.p1).toEqual({
        listValue: {
          values: [{stringValue: '101'}, {stringValue: '102'}],
        },
      });
    });
  });
});
