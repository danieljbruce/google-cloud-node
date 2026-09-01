/*!
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Big} from 'big.js';
import {PreciseDate} from '@google-cloud/precise-date';
import {GrpcService} from '../src/common-grpc/service';
import {codec as realCodec} from '../src/codec';
import {protos} from '@google-cloud/spanner-api';
import google = protos.google;
import {GoogleError} from 'google-gax';
import {util} from 'protobufjs';
import * as crypto from 'crypto';
import Long = util.Long;
import {isString} from '../src/helper';
const singer = require('./data/singer');
const music = singer.examples.spanner.music;

describe('codec', () => {
  let codec;


  beforeAll(() => {
    codec = realCodec;
  });

  beforeEach(() => {
    jest.spyOn(GrpcService, 'encodeValue_').mockImplementation(value => value as any);
    jest.spyOn(GrpcService, 'decodeValue_').mockImplementation(value => value as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('SpannerDate', () => {
    describe('instantiation', () => {
      it('should accept date strings', () => {
        const date = new codec.SpannerDate('3-22-1986');
        const json = date.toJSON();

        expect(json).toBe('1986-03-22');
      });

      it('should accept dates before 1000AD', () => {
        const date = new codec.SpannerDate('2-25-985');
        const json = date.toJSON();

        expect(json).toBe('0985-02-25');
      });

      it('should default to the current local date', () => {
        const date = new codec.SpannerDate();
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        const day = today.getDate();
        const expected = new codec.SpannerDate(year, month, day);

        expect(date).toEqual(expected);
      });

      it('should interpret ISO date strings as local time', () => {
        const date = new codec.SpannerDate('1986-03-22');
        const json = date.toJSON();

        expect(json).toBe('1986-03-22');
      });

      it('should interpret pre-1970 ISO date strings correctly without 2-digit year mapping', () => {
        const date = new codec.SpannerDate('0050-03-22');
        const json = date.toJSON();

        expect(json).toBe('0050-03-22');
      });

      it('should accept y/m/d number values', () => {
        const date = new codec.SpannerDate(1986, 2, 22);
        const json = date.toJSON();

        expect(json).toBe('1986-03-22');
      });

      it('should accept 2-digit years in y/m/d number values correctly', () => {
        const date = new codec.SpannerDate(50, 2, 22);
        const json = date.toJSON();

        expect(json).toBe('0050-03-22');
      });

      it('should accept year zero in y/m/d number values', () => {
        const d = new codec.SpannerDate(null!);
        const date = new codec.SpannerDate(0, 2, 22);
        const json = date.toJSON();

        expect(d).toBeTruthy();
        expect(json).toBe('1900-03-22');
      });

      it('should truncate additional date fields', () => {
        const truncated = new codec.SpannerDate(1986, 2, 22, 4, 8, 10);
        const expected = new codec.SpannerDate(1986, 2, 22);

        expect(truncated).toEqual(expected);
      });
    });

    describe('toJSON', () => {
      let date: Date;

      beforeEach(() => {
        date = new codec.SpannerDate();
        jest.spyOn(date, 'getFullYear').mockReturnValue(1999);
        jest.spyOn(date, 'getMonth').mockReturnValue(11);
        jest.spyOn(date, 'getDate').mockReturnValue(31);
      });

      it('should return the spanner date string', () => {
        const json = date.toJSON();
        expect(json).toBe('1999-12-31');
      });

      it('should pad single digit months', () => {
        jest.spyOn(date, 'getMonth').mockReturnValue(8);
        const json = date.toJSON();
        expect(json).toBe('1999-09-31');
      });

      it('should pad single digit dates', () => {
        jest.spyOn(date, 'getDate').mockReturnValue(3);
        const json = date.toJSON();
        expect(json).toBe('1999-12-03');
      });

      it('should pad single digit years', () => {
        jest.spyOn(date, 'getFullYear').mockReturnValue(5);
        const json = date.toJSON();
        expect(json).toBe('0005-12-31');
      });

      it('should pad double digit years', () => {
        jest.spyOn(date, 'getFullYear').mockReturnValue(52);
        const json = date.toJSON();
        expect(json).toBe('0052-12-31');
      });

      it('should pad triple digit years', () => {
        jest.spyOn(date, 'getFullYear').mockReturnValue(954);
        const json = date.toJSON();
        expect(json).toBe('0954-12-31');
      });
    });
  });

  describe('Float', () => {
    it('should store the value', () => {
      const value = 8;
      const float = new codec.Float(value);

      expect(float.value).toBe(value);
    });

    it('should return as a float', () => {
      const value = '8.2';
      const float = new codec.Float(value);

      expect(float.valueOf()).toBe(Number(value));
      expect(float + 2).toBe(Number(value) + 2);
    });
  });

  describe('Float32', () => {
    it('should store the value', () => {
      const value = 8;
      const float32 = new codec.Float32(value);

      expect(float32.value).toBe(value);
    });

    it('should return as a float32', () => {
      const value = '8.2';
      const float32 = new codec.Float32(value);

      expect(float32.valueOf()).toBe(Number(value));
      expect(float32 + 2).toBe(Number(value) + 2);
    });
  });

  describe('Int', () => {
    it('should stringify the value', () => {
      const value = 8;
      const int = new codec.Int(value);

      expect(int.value).toBe('8');
    });

    it('should return as a number', () => {
      const value = 8;
      const int = new codec.Int(value);

      expect(int.valueOf()).toBe(8);
      expect(int + 2).toBe(10);
    });

    it('should throw if number is out of bounds', () => {
      const value = '9223372036854775807';
      const int = new codec.Int(value);

      expect(() => {
          int.valueOf();
        }).toThrow(new RegExp('Integer ' + value + ' is out of bounds.'));
    });
  });

  describe('PGOid', () => {
    it('should stringify the value', () => {
      const value = 8;
      const oid = new codec.PGOid(value);

      expect(oid.value).toBe('8');
    });

    it('should return as a number', () => {
      const value = 8;
      const oid = new codec.PGOid(value);

      expect(oid.valueOf()).toBe(8);
      expect(oid + 2).toBe(10);
    });

    it('should throw if number is out of bounds', () => {
      const value = '9223372036854775807';
      const oid = new codec.PGOid(value);

      expect(() => {
          oid.valueOf();
        }).toThrow(new RegExp('PG.OID ' + value + ' is out of bounds.'));
    });
  });

  describe('Numeric', () => {
    it('should store value as a string', () => {
      const value = '8.01911';
      const numeric = new codec.Numeric(value);

      expect(numeric.value).toBe('8.01911');
    });

    it('should return as a Big', () => {
      const value = '8.01911';
      const numeric = new codec.Numeric(value);

      const expected = new Big(value);
      expect(numeric.valueOf().eq(expected)).toBeTruthy();
    });

    it('toJSON', () => {
      const value = '8.01911';
      const numeric = new codec.Numeric(value);

      expect(numeric.toJSON()).toBe(value);
    });
  });

  describe('PGNumeric', () => {
    it('should store value as a string', () => {
      const value = '8.01911';
      const pgNumeric = new codec.PGNumeric(value);

      expect(pgNumeric.value).toBe('8.01911');
    });

    it('should store NaN value as a string', () => {
      const value = 'NaN';
      const pgNumeric = new codec.PGNumeric(value);

      expect(pgNumeric.value).toBe('NaN');
    });

    it('should return as a Big', () => {
      const value = '8.01911';
      const pgNumeric = new codec.PGNumeric(value);

      const expected = new Big(value);
      expect(pgNumeric.valueOf().eq(expected)).toBeTruthy();
    });

    it('should throw an error when trying to return NaN as a Big', () => {
      const value = 'NaN';
      const pgNumeric = new codec.PGNumeric(value);

      expect(() => {
        pgNumeric.valueOf();
      }).toThrow(new RegExp('NaN cannot be converted to a numeric value'));
    });

    it('toJSON', () => {
      const value = '8.01911';
      const pgNumeric = new codec.PGNumeric(value);

      expect(pgNumeric.toJSON()).toBe(value);
    });
  });

  describe('Interval', () => {
    describe('constructor', () => {
      it('should create an Interval instance with correct properties', () => {
        const interval = new codec.Interval(1, 2, BigInt(1000));
        expect(interval.getMonths()).toEqual(1);
        expect(interval.getDays()).toEqual(2);
        expect(interval.getNanoseconds()).toEqual(BigInt(1000));
      });

      it('should throw an error if months is not an integer', () => {
        expect(() => new codec.Interval(1.5, 2, BigInt(1000))).toThrow(new RegExp('Invalid months: 1.5, months should be an integral value'));
      });

      it('should throw an error if days is not an integer', () => {
        expect(() => new codec.Interval(1, 2.5, BigInt(1000))).toThrow(new RegExp('Invalid days: 2.5, days should be an integral value'));
      });

      it('should throw an error if days is not an integer', () => {
        expect(() => new codec.Interval(1, 2, null)).toThrow(new RegExp(
            'Invalid nanoseconds: null, nanoseconds should be a valid bigint value',
          ));
      });
    });

    describe('fromMonths', () => {
      it('should create an Interval from months', () => {
        const interval = codec.Interval.fromMonths(5);
        expect(interval.getMonths()).toEqual(5);
        expect(interval.getDays()).toEqual(0);
        expect(interval.getNanoseconds()).toEqual(BigInt(0));
      });

      it('should throw an error if input is undefined', () => {
        expect(() => codec.Interval.fromMonths(undefined)).toThrow(GoogleError);
      });

      it('should throw an error if input is null', () => {
        expect(() => codec.Interval.fromMonths(null)).toThrow(GoogleError);
      });
    });

    describe('fromDays', () => {
      it('should create an Interval from days', () => {
        const interval = codec.Interval.fromDays(10);
        expect(interval.getMonths()).toEqual(0);
        expect(interval.getDays()).toEqual(10);
        expect(interval.getNanoseconds()).toEqual(BigInt(0));
      });

      it('should throw an error if input is undefined', () => {
        expect(() => codec.Interval.fromDays(undefined)).toThrow(GoogleError);
      });

      it('should throw an error if input is null', () => {
        expect(() => codec.Interval.fromDays(null)).toThrow(GoogleError);
      });
    });

    describe('fromSeconds', () => {
      it('should create an Interval from seconds', () => {
        const interval = codec.Interval.fromSeconds(60);
        expect(interval.getMonths()).toEqual(0);
        expect(interval.getDays()).toEqual(0);
        expect(interval.getNanoseconds()).toEqual(BigInt(60 * 1000000000));
      });

      it('should throw an error if input is undefined', () => {
        expect(() => codec.Interval.fromSeconds(undefined)).toThrow(GoogleError);
      });

      it('should throw an error if input is null', () => {
        expect(() => codec.Interval.fromSeconds(null)).toThrow(GoogleError);
      });
    });

    describe('fromMilliseconds', () => {
      it('should create an Interval from milliseconds', () => {
        const interval = codec.Interval.fromMilliseconds(1000);
        expect(interval.getMonths()).toEqual(0);
        expect(interval.getDays()).toEqual(0);
        expect(interval.getNanoseconds()).toEqual(BigInt(1000 * 1000000));
      });

      it('should throw an error if input is undefined', () => {
        expect(() => codec.Interval.fromMilliseconds(undefined)).toThrow(GoogleError);
      });

      it('should throw an error if input is null', () => {
        expect(() => codec.Interval.fromMilliseconds(null)).toThrow(GoogleError);
      });
    });

    describe('fromMicroseconds', () => {
      it('should create an Interval from microseconds', () => {
        const interval = codec.Interval.fromMicroseconds(1000000);
        expect(interval.getMonths()).toEqual(0);
        expect(interval.getDays()).toEqual(0);
        expect(interval.getNanoseconds()).toEqual(BigInt(1000000 * 1000));
      });

      it('should throw an error if input is undefined', () => {
        expect(() => codec.Interval.fromMicroseconds(undefined)).toThrow(GoogleError);
      });

      it('should throw an error if input is null', () => {
        expect(() => codec.Interval.fromMicroseconds(null)).toThrow(GoogleError);
      });
    });

    describe('fromNanoseconds', () => {
      it('should create an Interval from nanoseconds', () => {
        const interval = codec.Interval.fromNanoseconds(BigInt(1000000000));
        expect(interval.getMonths()).toEqual(0);
        expect(interval.getDays()).toEqual(0);
        expect(interval.getNanoseconds()).toEqual(BigInt(1000000000));
      });

      it('should throw an error if input is undefined', () => {
        expect(() => codec.Interval.fromNanoseconds(undefined)).toThrow(GoogleError);
      });

      it('should throw an error if input is null', () => {
        expect(() => codec.Interval.fromNanoseconds(null)).toThrow(GoogleError);
      });
    });

    describe('fromISO8601', () => {
      it('should parse valid ISO8601 strings correctly', () => {
        const testCases = [
          {
            input: 'P1Y2M3DT12H12M6.789000123S',
            expected: new codec.Interval(14, 3, BigInt('43926789000123')),
          },
          {
            input: 'P1Y2M3DT13H-48M6S',
            expected: new codec.Interval(14, 3, BigInt('43926000000000')),
          },
          {
            input: 'P1Y2M3D',
            expected: new codec.Interval(14, 3, BigInt('0')),
          },
          {
            input: 'P1Y2M',
            expected: new codec.Interval(14, 0, BigInt('0')),
          },
          {
            input: 'P1Y',
            expected: new codec.Interval(12, 0, BigInt('0')),
          },
          {
            input: 'P2M',
            expected: new codec.Interval(2, 0, BigInt('0')),
          },
          {
            input: 'P3D',
            expected: new codec.Interval(0, 3, BigInt('0')),
          },
          {
            input: 'PT4H25M6.7890001S',
            expected: new codec.Interval(0, 0, BigInt('15906789000100')),
          },
          {
            input: 'PT4H25M6S',
            expected: new codec.Interval(0, 0, BigInt('15906000000000')),
          },
          {
            input: 'PT4H30S',
            expected: new codec.Interval(0, 0, BigInt('14430000000000')),
          },
          {
            input: 'PT4H1M',
            expected: new codec.Interval(0, 0, BigInt('14460000000000')),
          },
          {
            input: 'PT5M',
            expected: new codec.Interval(0, 0, BigInt('300000000000')),
          },
          {
            input: 'PT6.789S',
            expected: new codec.Interval(0, 0, BigInt('6789000000')),
          },
          {
            input: 'PT0.123S',
            expected: new codec.Interval(0, 0, BigInt('123000000')),
          },
          {
            input: 'PT.000000123S',
            expected: new codec.Interval(0, 0, BigInt('123')),
          },
          {
            input: 'P0Y',
            expected: new codec.Interval(0, 0, BigInt('0')),
          },
          {
            input: 'P-1Y-2M-3DT-12H-12M-6.789000123S',
            expected: new codec.Interval(-14, -3, BigInt('-43926789000123')),
          },
          {
            input: 'P1Y-2M3DT13H-51M6.789S',
            expected: new codec.Interval(10, 3, BigInt('43746789000000')),
          },
          {
            input: 'P-1Y2M-3DT-13H49M-6.789S',
            expected: new codec.Interval(-10, -3, BigInt('-43866789000000')),
          },
          {
            input: 'P1Y2M3DT-4H25M-6.7890001S',
            expected: new codec.Interval(14, 3, BigInt('-12906789000100')),
          },
          {
            input: 'PT100H100M100.5S',
            expected: new codec.Interval(0, 0, BigInt('366100500000000')),
          },
          {
            input: 'P0Y',
            expected: new codec.Interval(0, 0, BigInt('0')),
          },
          {
            input: 'PT12H30M1S',
            expected: new codec.Interval(0, 0, BigInt('45001000000000')),
          },
          {
            input: 'P1Y2M3D',
            expected: new codec.Interval(14, 3, BigInt('0')),
          },
          {
            input: 'P1Y2M3DT12H30M',
            expected: new codec.Interval(14, 3, BigInt('45000000000000')),
          },
          {
            input: 'PT0.123456789S',
            expected: new codec.Interval(0, 0, BigInt('123456789')),
          },
          {
            input: 'PT1H0.5S',
            expected: new codec.Interval(0, 0, BigInt('3600500000000')),
          },
          {
            input: 'P1Y2M3DT12H30M1.23456789S',
            expected: new codec.Interval(14, 3, BigInt('45001234567890')),
          },
          {
            input: 'P1Y2M3DT12H30M1,23456789S',
            expected: new codec.Interval(14, 3, BigInt('45001234567890')),
          },
          {
            input: 'PT.5S',
            expected: new codec.Interval(0, 0, BigInt('500000000')),
          },
          {
            input: 'P-1Y2M3DT12H-30M1.234S',
            expected: new codec.Interval(-10, 3, BigInt('41401234000000')),
          },
          {
            input: 'P1Y-2M3DT-12H30M-1.234S',
            expected: new codec.Interval(10, 3, BigInt('-41401234000000')),
          },
          {
            input: 'PT1.234000S',
            expected: new codec.Interval(0, 0, BigInt('1234000000')),
          },
          {
            input: 'PT1.000S',
            expected: new codec.Interval(0, 0, BigInt('1000000000')),
          },
          {
            input: 'PT87840000H',
            expected: new codec.Interval(0, 0, BigInt('316224000000000000000')),
          },
          {
            input: 'PT-87840000H',
            expected: new codec.Interval(
              0,
              0,
              BigInt('-316224000000000000000'),
            ),
          },
          {
            input: 'P2Y1M15DT87839999H59M59.999999999S',
            expected: new codec.Interval(
              25,
              15,
              BigInt('316223999999999999999'),
            ),
          },
          {
            input: 'P2Y1M15DT-87839999H-59M-59.999999999S',
            expected: new codec.Interval(
              25,
              15,
              BigInt('-316223999999999999999'),
            ),
          },
        ];

        testCases.forEach(({input, expected}) => {
          expect(codec.Interval.fromISO8601(input)).toEqual(expected);
        });
      });

      it('should throw error for invalid ISO8601 strings', () => {
        const invalidStrings = [
          'invalid',
          'P',
          'PT',
          'P1YM',
          'P1Y2M3D4H5M6S', // Missing T
          'P1Y2M3DT4H5M6.S', // Missing decimal value
          'P1Y2M3DT4H5M6.789SS', // Extra S
          'P1Y2M3DT4H5M6.', // Missing value after decimal point
          'P1Y2M3DT4H5M6.ABC', // Non-digit characters after decimal point
          'P1Y2M3', // Missing unit specifier
          'P1Y2M3DT', // Missing time components
          'P-T1H', // Invalid negative sign position
          'PT1H-', // Invalid negative sign position
          'P1Y2M3DT4H5M6.789123456789S', // Too many digits after decimal
          'P1Y2M3DT4H5M6.123.456S', // Multiple decimal points
          'P1Y2M3DT4H5M6.,789S', // Dot and comma both for decimal
          null,
          undefined,
        ];

        invalidStrings.forEach(str => {
          expect(() => {
              codec.Interval.fromISO8601(str);
            }).toThrow(new RegExp('Invalid ISO8601 duration string'));
        });
      });

      it('should throw error when months is not a safe integer', () => {
        // Assuming Number.MAX_SAFE_INTEGER / 12 is the max safe years
        const maxSafeYears = Math.ceil(Number.MAX_SAFE_INTEGER / 12);
        const invalidISOString = `P${maxSafeYears}Y4M`;
        expect(() => {
          codec.Interval.fromISO8601(invalidISOString);
        }).toThrow(new RegExp('Total months is outside of the range of safe integer'));
      });
    });

    describe('toISO8601', () => {
      it('should convert Interval to valid ISO8601 strings', () => {
        const testCases = [
          {input: new codec.Interval(0, 0, BigInt(0)), expected: 'P0Y'},
          {
            input: new codec.Interval(14, 3, BigInt(43926789000123)),
            expected: 'P1Y2M3DT12H12M6.789000123S',
          },
          {
            input: new codec.Interval(14, 3, BigInt(14706789000000)),
            expected: 'P1Y2M3DT4H5M6.789S',
          },
          {input: new codec.Interval(14, 3, BigInt(0)), expected: 'P1Y2M3D'},
          {input: new codec.Interval(14, 0, BigInt(0)), expected: 'P1Y2M'},
          {input: new codec.Interval(12, 0, BigInt(0)), expected: 'P1Y'},
          {input: new codec.Interval(2, 0, BigInt(0)), expected: 'P2M'},
          {input: new codec.Interval(0, 3, BigInt(0)), expected: 'P3D'},
          {
            input: new codec.Interval(0, 0, BigInt(15906789000000)),
            expected: 'PT4H25M6.789S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(14430000000000)),
            expected: 'PT4H30S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(300000000000)),
            expected: 'PT5M',
          },
          {
            input: new codec.Interval(0, 0, BigInt(6789000000)),
            expected: 'PT6.789S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(123000000)),
            expected: 'PT0.123S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(123)),
            expected: 'PT0.000000123S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(100000000)),
            expected: 'PT0.100S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(100100000)),
            expected: 'PT0.100100S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(100100100)),
            expected: 'PT0.100100100S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(9)),
            expected: 'PT0.000000009S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(9000)),
            expected: 'PT0.000009S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(9000000)),
            expected: 'PT0.009S',
          },
          {input: new codec.Interval(0, 0, BigInt(0)), expected: 'P0Y'},
          {input: new codec.Interval(0, 0, BigInt(0)), expected: 'P0Y'},
          {input: new codec.Interval(1, 0, BigInt(0)), expected: 'P1M'},
          {input: new codec.Interval(0, 1, BigInt(0)), expected: 'P1D'},
          {
            input: new codec.Interval(0, 0, BigInt(10010)),
            expected: 'PT0.000010010S',
          },
          {
            input: new codec.Interval(-14, -3, BigInt(-43926789000123)),
            expected: 'P-1Y-2M-3DT-12H-12M-6.789000123S',
          },
          {
            input: new codec.Interval(10, 3, BigInt(43746789100000)),
            expected: 'P10M3DT12H9M6.789100S',
          },
          {
            input: new codec.Interval(-10, -3, BigInt(-43866789010000)),
            expected: 'P-10M-3DT-12H-11M-6.789010S',
          },
          {
            input: new codec.Interval(14, 3, BigInt(-12906662400000)),
            expected: 'P1Y2M3DT-3H-35M-6.662400S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(500000000)),
            expected: 'PT0.500S',
          },
          {
            input: new codec.Interval(0, 0, BigInt(-500000000)),
            expected: 'PT-0.500S',
          },
          {
            input: new codec.Interval(0, 0, BigInt('316224000000000000000')),
            expected: 'PT87840000H',
          },
          {
            input: new codec.Interval(0, 0, BigInt('-316224000000000000000')),
            expected: 'PT-87840000H',
          },
          {
            input: new codec.Interval(25, 15, BigInt('316223999999999999999')),
            expected: 'P2Y1M15DT87839999H59M59.999999999S',
          },
          {
            input: new codec.Interval(25, 15, BigInt('-316223999999999999999')),
            expected: 'P2Y1M15DT-87839999H-59M-59.999999999S',
          },
          {input: new codec.Interval(13, 0, BigInt(0)), expected: 'P1Y1M'},
          {
            input: new codec.Interval(0, 0, BigInt(86400000000000)),
            expected: 'PT24H',
          },
          {input: new codec.Interval(0, 31, BigInt(0)), expected: 'P31D'},
          {input: new codec.Interval(-12, 0, BigInt(0)), expected: 'P-1Y'},
        ];

        testCases.forEach(({input, expected}) => {
          expect(input.toISO8601()).toEqual(expected);
        });
      });
    });

    it('should check equality correctly', () => {
      const interval1 = new codec.Interval(1, 2, BigInt(3));
      const interval2 = new codec.Interval(1, 2, BigInt(3));
      const interval3 = new codec.Interval(-4, -5, BigInt(-6)); // Negative values

      // Test with identical intervals
      expect(interval1.equals(interval2)).toEqual(true);
      expect(interval2.equals(interval1)).toEqual(true);

      // Test with different intervals
      expect(interval1.equals(interval3)).toEqual(false);
      expect(interval3.equals(interval1)).toEqual(false);

      // Test with different values for each field (including negative)
      expect(interval1.equals(new codec.Interval(1, 2, BigInt(-4)))).toEqual(false);
      expect(interval1.equals(new codec.Interval(1, -3, BigInt(3)))).toEqual(false);
      expect(interval1.equals(new codec.Interval(-2, 2, BigInt(3)))).toEqual(false);
      expect(interval3.equals(new codec.Interval(-4, -5, BigInt(6)))).toEqual(false);
      expect(interval3.equals(new codec.Interval(-4, 5, BigInt(-6)))).toEqual(false);
      expect(interval3.equals(new codec.Interval(4, -5, BigInt(-6)))).toEqual(false);

      // Test with null and undefined
      expect(interval1.equals(null)).toEqual(false);
      expect(interval1.equals(undefined)).toEqual(false);

      // Test with an object that is not an Interval
      expect(interval1.equals({} as BigInt)).toEqual(false);
    });

    it('should return the correct value with valueOf()', () => {
      const interval = new codec.Interval(1, 2, BigInt(3));
      expect(interval.valueOf()).toEqual(interval);
    });

    it('should return the correct JSON representation', () => {
      const interval = new codec.Interval(1, 2, BigInt(3));
      const expectedJson = interval.toISO8601();
      expect(interval.toJSON()).toEqual(expectedJson);
    });

    describe('ISO8601 roundtrip', () => {
      it('should convert Interval to ISO8601 and back without losing data', () => {
        const testCases = [
          new codec.Interval(14, 3, BigInt('43926789000000')),
          new codec.Interval(12, 0, BigInt(0)),
          new codec.Interval(1, 0, BigInt(0)),
          new codec.Interval(0, 1, BigInt(0)),
          new codec.Interval(0, 0, BigInt(3600000000000)),
          new codec.Interval(0, 0, BigInt(60000000000)),
          new codec.Interval(0, 0, BigInt(1000000000)),
          new codec.Interval(0, 0, BigInt(100000000)),
          new codec.Interval(0, 0, BigInt(0)),
          new codec.Interval(-10, 3, BigInt('43926000000000')),
          new codec.Interval(25, 15, BigInt('86399123456789')),
          new codec.Interval(-25, -15, BigInt('-86399123456789')),
          new codec.Interval(13, 0, BigInt('0')),
          new codec.Interval(0, 0, BigInt('86400000000000')),
          new codec.Interval(0, 31, BigInt('0')),
          new codec.Interval(-12, 0, BigInt('0')),
        ];

        testCases.forEach(interval => {
          const isoString = interval.toISO8601();
          const roundtripInterval = codec.Interval.fromISO8601(isoString);
          expect(roundtripInterval).toEqual(interval);
        });
      });
    });
  });

  describe('ProtoMessage', () => {
    const protoMessageParams = {
      value: music.SingerInfo.create({
        singerId: new Long(1),
        genre: music.Genre.POP,
        birthDate: 'January',
        nationality: 'Country1',
      }),
      messageFunction: music.SingerInfo,
      fullName: 'examples.spanner.music.SingerInfo',
    };

    it('should store value as buffer', () => {
      const protoMessage = new codec.ProtoMessage(protoMessageParams);
      expect(Buffer.isBuffer(protoMessage.value)).toBeTruthy();
    });

    it('should throw an error when value is not object and protoMessage is not passed', () => {
      expect(() => {
          new codec.ProtoMessage({
            value: {
              singerId: 1,
              genre: music.Genre.POP,
              birthDate: 'January',
            },
            fullName: 'examples.spanner.music.SingerInfo',
          });
        }).toThrow(new GoogleError(`protoMessageParams cannot be used to construct 
      the ProtoMessage. Pass the serialized buffer of the
       proto message as the value or provide the message object along with the 
       corresponding messageFunction generated by protobufjs-cli.`));
    });

    it('toJSON with messageFunction', () => {
      expect(new codec.ProtoMessage(protoMessageParams).toJSON()).toEqual(music.SingerInfo.toObject(protoMessageParams.value));
    });

    it('toJSON without messageFunction', () => {
      const message = new codec.ProtoMessage({
        value: music.SingerInfo.encode(protoMessageParams.value).finish(),
        fullName: 'examples.spanner.music.SingerInfo',
      });
      expect(message.toJSON()).toEqual(message.value.toString());
    });
  });

  describe('ProtoEnum', () => {
    const enumParams = {
      value: music.Genre.JAZZ,
      enumObject: music.Genre,
      fullName: 'examples.spanner.music.Genre',
    };

    it('should store value as string', () => {
      const protoEnum = new codec.ProtoEnum(enumParams);
      expect(isString(protoEnum.value)).toBeTruthy();
    });

    it('should throw an error when value is non numeric string and enumObject is not passed', () => {
      expect(() => {
          new codec.ProtoEnum({
            value: 'POP',
            fullName: 'examples.spanner.music.Genre',
          });
        }).toThrow(new GoogleError(`protoEnumParams cannot be used for constructing the
       ProtoEnum. Pass the number as the value or provide the enum string 
       constant as the value along with the corresponding enumObject generated 
       by protobufjs-cli.`));
    });

    it('toJSON with enumObject', () => {
      expect(new codec.ProtoEnum(enumParams).toJSON()).toEqual('JAZZ');
    });

    it('toJSON without enumObject', () => {
      expect(new codec.ProtoEnum({
          value: music.Genre.JAZZ,
          fullName: 'examples.spanner.music.Genre',
        }).toJSON()).toEqual('1');
    });
  });

  describe('Struct', () => {
    describe('toJSON', () => {
      it('should covert the struct to JSON', () => {
        const struct = new codec.Struct();
        const options = {};
        const fakeJson = {};

        jest.spyOn(codec, 'convertFieldsToJson').mockReturnValue(fakeJson as any);

        expect(struct.toJSON(options)).toBe(fakeJson);
      });
    });

    describe('fromArray', () => {
      it('should wrap the array in a struct', () => {
        const fields = [{name: 'name', value: 'value'}];
        const struct = codec.Struct.fromArray(fields);

        expect(struct instanceof codec.Struct).toBeTruthy();

        fields.forEach((field, i) => {
          expect(struct[i]).toBe(field);
        });
      });
    });

    describe('fromJSON', () => {
      it('should covert json to a struct', () => {
        const json = {a: 'b', c: 'd'};
        const expected = [
          {name: 'a', value: 'b'},
          {name: 'c', value: 'd'},
        ];
        const struct = codec.Struct.fromJSON(json);

        expect(struct instanceof codec.Struct).toBeTruthy();

        expected.forEach((field, i) => {
          expect(struct[i]).toEqual(field);
        });
      });
    });
  });

  describe('convertFieldsToJson', () => {
    const ROW = [
      {
        name: 'name',
        value: 'value',
      },
    ];

    it('should not require options', () => {
      expect(() => codec.convertFieldsToJson(ROW)).not.toThrow();
    });

    it('should return serialized rows', () => {
      const json = codec.convertFieldsToJson(ROW);

      expect(json).toEqual({name: 'value'});
    });

    it('should not return nameless values by default', () => {
      const row = [
        {
          value: 'value',
        },
      ];

      const json = codec.convertFieldsToJson(row);
      expect(json).toEqual({});
    });

    it('should return nameless values when requested', () => {
      const row = [
        {
          value: 'value',
        },
      ];

      const json = codec.convertFieldsToJson(row, {includeNameless: true});
      expect(json).toEqual({_0: 'value'});
    });

    describe('structs', () => {
      it('should not wrap structs by default', () => {
        const options = {
          wrapNumbers: false,
          wrapStructs: false,
          includeNameless: false,
        };
        const fakeStructJson = {};

        const struct = new codec.Struct();
        const stub = jest.spyOn(struct, 'toJSON').mockReturnValue(fakeStructJson as any);

        const row = [{name: 'Struct', value: struct}];

        const json = codec.convertFieldsToJson(row, options);

        expect(json.Struct).toBe(fakeStructJson);
        expect((stub as any).mock.calls[(stub as any).mock.calls.length - 1][0]).toEqual(options);
      });

      it('should wrap structs with option', () => {
        const value = 3.3;

        const expectedStruct = codec.Struct.fromJSON({Number: value});
        const struct = codec.Struct.fromJSON({Number: new codec.Float(value)});

        const row = [{name: 'Struct', value: struct}];

        const json = codec.convertFieldsToJson(row, {wrapStructs: true});
        expect(json.Struct).toEqual(expectedStruct);
      });
    });

    describe('numbers', () => {
      it('should not wrap numbers by default', () => {
        const row = [
          {
            name: 'Number',
            value: new codec.Int(3),
          },
        ];

        const json = codec.convertFieldsToJson(row);
        expect(typeof json.Number).toBe('number');
        expect(json.Number).toBe(3);
      });

      it('should wrap numbers with option', () => {
        const int = new codec.Int(3);

        const row = [
          {
            name: 'Number',
            value: int,
          },
        ];

        const json = codec.convertFieldsToJson(row, {wrapNumbers: true});

        expect(json.Number instanceof codec.Int).toBeTruthy();
        expect(json.Number).toEqual(int);
      });

      it('should throw an error if number is out of bounds', () => {
        const int = new codec.Int('9223372036854775807');

        const row = [
          {
            name: 'Number',
            value: int,
          },
        ];

        expect(() => {
          codec.convertFieldsToJson(row);
        }).toThrow(new RegExp('Serializing column "Number" encountered an error'));
      });
    });

    describe('arrays', () => {
      it('should not wrap numbers by default', () => {
        const value = 3;

        const row = [
          {
            name: 'List',
            value: [new codec.Int(value)],
          },
        ];

        const json = codec.convertFieldsToJson(row);
        expect(json.List).toEqual([value]);
      });

      it('should wrap numbers with option', () => {
        const value = new codec.Int(3);

        const row = [{name: 'List', value: [value]}];

        const json = codec.convertFieldsToJson(row, {wrapNumbers: true});
        expect(json.List).toEqual([value]);
      });

      it('should not wrap structs by default', () => {
        const struct = new codec.Struct();
        const expectedStruct = {a: 'b', c: 'd'};

        jest.spyOn(struct, 'toJSON').mockReturnValue(expectedStruct as any);

        const row = [{name: 'List', value: [struct]}];

        const json = codec.convertFieldsToJson(row);
        expect(json.List).toEqual([expectedStruct]);
      });

      it('should wrap structs with option', () => {
        const expectedStruct = codec.Struct.fromJSON({a: 'b', c: 'd'});

        const row = [{name: 'List', value: [expectedStruct]}];

        const json = codec.convertFieldsToJson(row, {wrapStructs: true});
        expect(json.List).toEqual([expectedStruct]);
      });
    });
  });

  describe('decode', () => {
    // Does not require any special decoding.
    const BYPASS_FIELD = {
      code: 'not-real-code',
    };

    it('should return the same value if not a special type', () => {
      const value = {};

      const decoded = codec.decode(value, BYPASS_FIELD);
      expect(decoded).toBe(value);
    });

    it('should return null values as null', () => {
      jest.spyOn(GrpcService, 'decodeValue_').mockReturnValue(null as any);
      const decoded = codec.decode(null, BYPASS_FIELD);
      expect(decoded).toBe(null);
    });

    it('should decode BYTES', () => {
      const expected = Buffer.from('bytes value');
      const encoded = expected.toString('base64');

      const decoded = codec.decode(encoded, {
        code: google.spanner.v1.TypeCode.BYTES,
      });

      expect(decoded).toEqual(expected);
    });

    it('should decode ProtoMessage', () => {
      const expected = new codec.ProtoMessage({
        value: music.SingerInfo.create({
          singerId: 1,
          genre: music.Genre.POP,
          birthDate: 'January',
          nationality: 'Country1',
        }),
        messageFunction: music.SingerInfo,
        fullName: 'examples.spanner.music.SingerInfo',
      });
      const encoded = expected.value.toString('base64');

      const decoded = codec.decode(
        encoded,
        {
          code: google.spanner.v1.TypeCode.PROTO,
          protoTypeFqn: 'examples.spanner.music.SingerInfo',
        },
        music.SingerInfo,
      );

      expect(decoded).toEqual(expected);
    });

    it('should decode ProtoEnum (non-JSON mode)', () => {
      const type = {
        code: google.spanner.v1.TypeCode.ENUM,
        protoTypeFqn: 'examples.spanner.music.Genre',
      };

      const decoded = codec.decode(1, type as any, music.Genre);
      expect(decoded instanceof codec.ProtoEnum).toBeTruthy();
      expect(decoded.value).toBe('1');
    });

    it('should decode ProtoEnum (JSON mode)', () => {
      const type = {
        code: google.spanner.v1.TypeCode.ENUM,
        protoTypeFqn: 'examples.spanner.music.Genre',
      };

      const decoder = codec.getDecoder(type as any, music.Genre, {
        wrapStructs: false,
      });

      // 1. Passing a numeric value (1 maps to JAZZ in music.Genre)
      expect(decoder(1)).toBe('JAZZ');

      // 2. Passing an enum name string
      expect(decoder('POP')).toBe('POP');
    });

    it('should safely handle prototype properties like "toString" as enum values and throw/ignore them', () => {
      const type = {
        code: google.spanner.v1.TypeCode.ENUM,
        protoTypeFqn: 'examples.spanner.music.Genre',
      };

      const decoder = codec.getDecoder(type as any, music.Genre, {
        wrapStructs: false,
      });

      // Since "toString" is a prototype property of music.Genre (via Object.prototype.toString),
      // it should NOT be resolved, and attempting to decode it should throw.
      expect(() => {
        decoder('toString');
      }).toThrow(/protoEnumParams cannot be used for constructing the ProtoEnum/);
    });

    it('should decode UUID', () => {
      const value = crypto.randomUUID();

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.UUID,
      });

      expect(decoded).toBe(value);
    });

    it('should decode FLOAT32', () => {
      const value = 'Infinity';

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.FLOAT32,
      });

      expect(decoded instanceof codec.Float32).toBeTruthy();
      expect(decoded.value).toBe(value);
    });

    it('should decode FLOAT64', () => {
      const value = 'Infinity';

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.FLOAT64,
      });

      expect(decoded instanceof codec.Float).toBeTruthy();
      expect(decoded.value).toBe(value);
    });

    it('should decode INT64', () => {
      const value = '64';

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.INT64,
      });

      expect(decoded instanceof codec.Int).toBeTruthy();
      expect(decoded.value).toBe(value);
    });

    it('should decode NUMERIC', () => {
      const value = '8.01911';

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.NUMERIC,
      });

      expect(decoded instanceof codec.Numeric).toBeTruthy();
      expect(decoded.value).toBe(value);
    });

    it('should decode PG NUMERIC', () => {
      const value = '8.01911';

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.NUMERIC,
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_NUMERIC,
      });

      expect(decoded instanceof codec.PGNumeric).toBeTruthy();
      expect(decoded.value).toBe(value);
    });

    it('should decode JSON', () => {
      const value = '{"result":true, "count":42}';
      const expected = JSON.parse(value);

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.JSON,
      });

      expect(decoded).toEqual(expected);
    });

    it('should decode complex JSON string to object', () => {
      const value =
        '{"boolKey":true,"numberKey":3.14,"stringKey":"test","objectKey":{"innerKey":"inner-value"}}';
      const expected = {
        boolKey: true,
        numberKey: 3.14,
        stringKey: 'test',
        objectKey: {innerKey: 'inner-value'},
      };

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.JSON,
      });

      expect(decoded).toEqual(expected);
    });

    it('should decode JSONB', () => {
      const value = '{"result":true, "count":42}';
      const expected = JSON.parse(value);

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.JSON,
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_JSONB,
      });

      expect(decoded.value).toEqual(expected);
    });

    it('should decode JSONB object to string', () => {
      const value =
        '{"boolKey":true,"numberKey":3.14,"stringKey":"test","objectKey":{"innerKey":"inner-value"}}';
      const expected = JSON.stringify({
        boolKey: true,
        numberKey: 3.14,
        stringKey: 'test',
        objectKey: {innerKey: 'inner-value'},
      });

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.JSON,
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_JSONB,
      });

      expect(decoded.toString()).toEqual(expected);
    });

    it('should decode PG OID', () => {
      const value = '64';

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.INT64,
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_OID,
      });

      expect(decoded instanceof codec.PGOid).toBeTruthy();
      expect(decoded.value).toBe(value);
    });

    it('should decode TIMESTAMP', () => {
      const value = new Date();
      const expected = new PreciseDate(value.getTime());
      const decoded = codec.decode(value.toJSON(), {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });

      expect(decoded).toEqual(expected);
    });

    it('should decode pre-1970 TIMESTAMP preserving -0 nanosecond sign correctness', () => {
      const timestampStr = '1933-03-03T00:00:00.000Z';
      const expected = new PreciseDate(timestampStr);
      const decoded = codec.decode(timestampStr, {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });

      expect(decoded).toEqual(expected);
    });

    it('should decode DATE', () => {
      const value = new Date();
      const expected = new codec.SpannerDate(value.toISOString());
      const decoded = codec.decode(value.toJSON(), {
        code: google.spanner.v1.TypeCode.DATE,
      });

      expect(decoded).toEqual(expected);
    });

    it('should decode DATE and gracefully handle malformed strings by falling back', () => {
      // In the legacy code, '2020-0b-15' would not match /^\d{4}-\d{1,2}-\d{1,2}/ and would result in an Invalid Date.
      // But a fast path using loose parseInt could silently parse '0b' as '0' and produce '2019-12-15'.
      // This test ensures we fall back and get an Invalid Date exactly like the native Date constructor.
      const malformedDateStr = '2020-0b-15';
      const decoded = codec.decode(malformedDateStr, {
        code: google.spanner.v1.TypeCode.DATE,
      });

      expect(decoded instanceof codec.SpannerDate).toBeTruthy();
      expect(isNaN(decoded.getTime())).toBeTruthy();
    });

    it('should decode DATE and fallback when month/day out of range causes silent rollover', () => {
      // 1. Month 00 is out of bounds
      const invalidMonthStr = '2020-00-12';
      const decodedMonth = codec.decode(invalidMonthStr, {
        code: google.spanner.v1.TypeCode.DATE,
      });
      expect(decodedMonth instanceof codec.SpannerDate).toBeTruthy();
      expect(isNaN(decodedMonth.getTime())).toBeTruthy();

      // 2. Day 35 is out of bounds
      const invalidDayStr = '2020-12-35';
      const decodedDay = codec.decode(invalidDayStr, {
        code: google.spanner.v1.TypeCode.DATE,
      });
      expect(decodedDay instanceof codec.SpannerDate).toBeTruthy();
      expect(isNaN(decodedDay.getTime())).toBeTruthy();

      // 3. February 30 causes rollover, yielding same output as native SpannerDate
      const rolloverFebStr = '2020-02-30';
      const decodedFeb = codec.decode(rolloverFebStr, {
        code: google.spanner.v1.TypeCode.DATE,
      });
      const expectedFeb = new codec.SpannerDate(rolloverFebStr);
      expect(decodedFeb).toEqual(expectedFeb);
    });

    it('should decode TIMESTAMP and gracefully handle malformed strings by falling back', () => {
      // A string like '2020-0b-15T10:20:30.123456789Z' has correct length and format dividers but contains '0b' as month.
      // Loose parseInt would parse it as 2019-12-15T10:20:30.123456789Z.
      // The robust parser should detect NaN and fall back to native constructor, returning an Invalid Date.
      const malformedTimestampStr = '2020-0b-15T10:20:30.123456789Z';
      const decoded = codec.decode(malformedTimestampStr, {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });

      expect(decoded instanceof PreciseDate).toBeTruthy();
      expect(isNaN(decoded.getTime())).toBeTruthy();
    });

    it('should decode TIMESTAMP and fallback when sub-seconds contain non-digits after 9th decimal', () => {
      const malformedTimestampStr = '2021-05-11T16:46:04.872345678abcZ';
      const decoded = codec.decode(malformedTimestampStr, {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });

      expect(decoded instanceof PreciseDate).toBeTruthy();
      expect(isNaN(decoded.getTime())).toBeTruthy();
    });

    it('should decode TIMESTAMP and fallback when no dot and extra characters exist', () => {
      const malformedTimestampStr = '2021-05-11T16:46:04abcZ';
      const decoded = codec.decode(malformedTimestampStr, {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });

      expect(decoded instanceof PreciseDate).toBeTruthy();
      expect(isNaN(decoded.getTime())).toBeTruthy();
    });

    it('should decode TIMESTAMP and fallback when month/day out of range causes silent rollover', () => {
      const malformedTimestampStr = '2021-13-11T16:46:04Z';
      const decoded = codec.decode(malformedTimestampStr, {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });

      expect(decoded instanceof PreciseDate).toBeTruthy();
      expect(isNaN(decoded.getTime())).toBeTruthy();
    });

    it('should decode TIMESTAMP and fallback when February 30 causes silent rollover, yielding same output as native PreciseDate', () => {
      const rolloverTimestampStr = '2021-02-30T16:46:04.123456789Z';
      const decoded = codec.decode(rolloverTimestampStr, {
        code: google.spanner.v1.TypeCode.TIMESTAMP,
      });
      const expected = new PreciseDate(rolloverTimestampStr);

      expect(decoded).toEqual(expected);
    });

    it('should decode INTERVAL', () => {
      const value = 'P1Y2M-45DT67H12M6.789045638S';
      const expected = codec.Interval.fromISO8601(value);
      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.INTERVAL,
      });

      expect(decoded instanceof codec.Interval).toBeTruthy();
      expect(decoded).toEqual(expected);
    });

    it('should decode ARRAY and inner members', () => {
      const value = ['1'];

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.ARRAY,
        arrayElementType: {
          code: google.spanner.v1.TypeCode.INT64,
        },
      });

      expect(decoded[0] instanceof codec.Int).toBeTruthy();
    });

    it('should decode object STRUCT value and inner members', () => {
      const value = {
        keys: 1,
        fieldName: '2',
      };

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.STRUCT,
        structType: {
          fields: [
            {
              name: 'keys',
              type: {
                code: google.spanner.v1.TypeCode.JSON,
              },
            },
            {
              name: 'fieldName',
              type: {
                code: google.spanner.v1.TypeCode.INT64,
              },
            },
          ],
        },
      });

      const expectedStruct = new codec.Struct(
        {
          name: 'keys',
          value: value.keys,
        },
        {
          name: 'fieldName',
          value: new codec.Int(value.fieldName),
        },
      );

      expect(decoded instanceof codec.Struct).toBeTruthy();
      expect(decoded).toEqual(expectedStruct);
    });

    it('should decode object STRUCT value and inner members with falsy values', () => {
      const value = {
        intField: '0',
        boolField: false,
        stringField: '',
        floatField: 0.0,
        nullField: null,
        nanField: NaN,
      };

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.STRUCT,
        structType: {
          fields: [
            {
              name: 'intField',
              type: {
                code: google.spanner.v1.TypeCode.INT64,
              },
            },
            {
              name: 'boolField',
              type: {
                code: google.spanner.v1.TypeCode.BOOL,
              },
            },
            {
              name: 'stringField',
              type: {
                code: google.spanner.v1.TypeCode.STRING,
              },
            },
            {
              name: 'floatField',
              type: {
                code: google.spanner.v1.TypeCode.FLOAT64,
              },
            },
            {
              name: 'nullField',
              type: {
                code: google.spanner.v1.TypeCode.STRING,
              },
            },
            {
              name: 'nanField',
              type: {
                code: google.spanner.v1.TypeCode.FLOAT64,
              },
            },
          ],
        },
      });

      const expectedStruct = new codec.Struct(
        {
          name: 'intField',
          value: new codec.Int('0'),
        },
        {
          name: 'boolField',
          value: false,
        },
        {
          name: 'stringField',
          value: '',
        },
        {
          name: 'floatField',
          value: new codec.Float(0.0),
        },
        {
          name: 'nullField',
          value: null,
        },
        {
          name: 'nanField',
          value: new codec.Float(NaN),
        },
      );

      expect(decoded instanceof codec.Struct).toBeTruthy();
      expect(decoded).toEqual(expectedStruct);
    });

    it('should decode array STRUCT value and inner members', () => {
      const value = ['1', '2'];

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.STRUCT,
        structType: {
          fields: [
            {
              name: 'keys',
              type: {
                code: google.spanner.v1.TypeCode.JSON,
              },
            },
            {
              name: 'fieldName',
              type: {
                code: google.spanner.v1.TypeCode.INT64,
              },
            },
          ],
        },
      });

      const expectedStruct = new codec.Struct(
        {
          name: 'keys',
          value: JSON.parse(value[0]),
        },
        {
          name: 'fieldName',
          value: new codec.Int(value[1]),
        },
      );

      expect(decoded instanceof codec.Struct).toBeTruthy();
      expect(decoded).toEqual(expectedStruct);
    });

    describe('getDecoder STRUCT options', () => {
      it('should recursively pass field-specific metadata to nested decoders', () => {
        const type = {
          code: google.spanner.v1.TypeCode.STRUCT,
          structType: {
            fields: [
              {
                name: 'singer',
                type: {
                  code: google.spanner.v1.TypeCode.PROTO,
                  protoTypeFqn: 'examples.spanner.music.SingerInfo',
                },
              },
            ],
          },
        };

        const mockMetadata = {
          singer: music.SingerInfo,
        };

        // 1. In standard mode (options = undefined)
        const decoder = codec.getDecoder(type as any, mockMetadata, undefined);

        const testData = {
          singer: music.SingerInfo.encode({
            singerId: 1,
            genre: music.Genre.POP,
            birthDate: 'January',
            nationality: 'Country1',
          })
            .finish()
            .toString('base64'),
        };

        const result = decoder(testData) as any;
        expect(result instanceof codec.Struct).toBeTruthy();
        const singerField = result[0].value;
        expect(singerField instanceof codec.ProtoMessage).toBeTruthy();
        expect(singerField.fullName).toBe('examples.spanner.music.SingerInfo');

        // 2. In JSON mode (options = {wrapStructs: false})
        const jsonDecoder = codec.getDecoder(type as any, mockMetadata, {
          wrapStructs: false,
        });
        const jsonResult = jsonDecoder(testData) as any;
        expect(jsonResult.singer.birthDate).toBe('January');
        expect(jsonResult.singer.nationality).toBe('Country1');
        expect(jsonResult.singer.genre).toBe(0);
        expect(jsonResult.singer.singerId.toString()).toBe('1');
      });

      it('should recursively pass field-specific metadata to empty-string nameless fields', () => {
        const type = {
          code: google.spanner.v1.TypeCode.STRUCT,
          structType: {
            fields: [
              {
                name: '',
                type: {
                  code: google.spanner.v1.TypeCode.PROTO,
                  protoTypeFqn: 'examples.spanner.music.SingerInfo',
                },
              },
            ],
          },
        };

        const mockMetadata = {
          '': music.SingerInfo,
        };

        const decoder = codec.getDecoder(type as any, mockMetadata, undefined);

        const testData = {
          '': music.SingerInfo.encode({
            singerId: 1,
            genre: music.Genre.POP,
            birthDate: 'January',
            nationality: 'Country1',
          })
            .finish()
            .toString('base64'),
        };

        const result = decoder(testData) as any;
        expect(result instanceof codec.Struct).toBeTruthy();
        const singerField = result[0].value;
        expect(singerField instanceof codec.ProtoMessage).toBeTruthy();
        expect(singerField.fullName).toBe('examples.spanner.music.SingerInfo');
      });

      it('should safely handle prototype properties like "toString" as field names and not pollute metadata lookup', () => {
        const type = {
          code: google.spanner.v1.TypeCode.STRUCT,
          structType: {
            fields: [
              {
                name: 'toString',
                type: {
                  code: google.spanner.v1.TypeCode.PROTO,
                  protoTypeFqn: 'examples.spanner.music.SingerInfo',
                },
              },
            ],
          },
        };

        // columnMetadata lacks the own-property "toString" but inherits it from Object.prototype.
        const mockMetadata = Object.create({
          toString: music.SingerInfo,
        });

        // It should NOT resolve the prototype's toString property, but instead pass undefined to the nested decoder
        const decoder = codec.getDecoder(type as any, mockMetadata, undefined);

        const testData = {
          toString: music.SingerInfo.encode({
            singerId: 1,
            genre: music.Genre.POP,
            birthDate: 'January',
            nationality: 'Country1',
          })
            .finish()
            .toString('base64'),
        };

        const result = decoder(testData) as any;
        expect(result instanceof codec.Struct).toBeTruthy();
        const field = result[0].value;

        // Since toString is not an own property of mockMetadata, no metadata was passed down,
        // so the nested decoder's messageFunction is undefined instead of the prototype function.
        expect(field instanceof codec.ProtoMessage).toBeTruthy();
        expect(field.messageFunction).toBe(undefined);
      });

      it('should safely handle prototype properties in row objects and fall back correctly', () => {
        const type = {
          code: google.spanner.v1.TypeCode.STRUCT,
          structType: {
            fields: [
              {
                name: 'toString',
                type: {
                  code: google.spanner.v1.TypeCode.STRING,
                },
              },
            ],
          },
        };

        const decoder = codec.getDecoder(type as any, undefined, undefined);

        // input data lacks the own-property 'toString' (since it is an array), or is an object with a fallback index value
        const inputData = Object.create(null);
        // Fallback value at index 0
        inputData[0] = 'actual_value';

        const result = decoder(inputData) as any;
        expect(result instanceof codec.Struct).toBeTruthy();
        expect(result[0].value).toBe('actual_value');
      });

      it('should correctly decode empty-string field names using name != null', () => {
        const type = {
          code: google.spanner.v1.TypeCode.STRUCT,
          structType: {
            fields: [
              {
                name: '',
                type: {
                  code: google.spanner.v1.TypeCode.STRING,
                },
              },
            ],
          },
        };

        const inputObj = {'': 'hello'};

        // 1. JSON mode (wrapStructs = false) with includeNameless = false (default)
        const jsonDecoderDefault = codec.getDecoder(type as any, undefined, {
          wrapStructs: false,
        });
        const resultDefault = jsonDecoderDefault(inputObj);
        expect(resultDefault).toEqual({});

        // 2. JSON mode (wrapStructs = false) with includeNameless = true
        const jsonDecoderInclude = codec.getDecoder(type as any, undefined, {
          wrapStructs: false,
          includeNameless: true,
        });
        const resultInclude = jsonDecoderInclude(inputObj);
        expect(resultInclude).toEqual({_0: 'hello'});

        // 3. Wrapped mode (wrapStructs = true)
        const wrappedDecoder = codec.getDecoder(type as any, undefined, {
          wrapStructs: true,
        });
        const wrappedResult = wrappedDecoder(inputObj) as any;
        expect(wrappedResult instanceof codec.Struct).toBeTruthy();
        // default toJSON() should omit the nameless field
        expect(wrappedResult.toJSON()).toEqual({});
        // toJSON({includeNameless: true}) should include it as _0
        expect(wrappedResult.toJSON({includeNameless: true})).toEqual({
          _0: 'hello',
        });
      });

      it('should default wrapStructs to false when options is specified as empty object, and true when undefined', () => {
        const type = {
          code: google.spanner.v1.TypeCode.STRUCT,
          structType: {
            fields: [
              {
                name: 'field',
                type: {
                  code: google.spanner.v1.TypeCode.STRING,
                },
              },
            ],
          },
        };

        const input = {field: 'test-value'};

        // 1. When options is undefined (standard mode) -> should wrap struct
        const standardDecoder = codec.getDecoder(
          type as any,
          undefined,
          undefined,
        );
        const standardResult = standardDecoder(input);
        expect(standardResult instanceof codec.Struct).toBeTruthy();

        // 2. When options is {} (JSON mode default) -> should NOT wrap struct (should return plain object)
        const jsonDefaultDecoder = codec.getDecoder(type as any, undefined, {});
        const jsonDefaultResult = jsonDefaultDecoder(input);
        expect(!(jsonDefaultResult instanceof codec.Struct)).toBeTruthy();
        expect(jsonDefaultResult).toEqual({field: 'test-value'});
      });
    });

    describe('getDecoder wrapNumbers options', () => {
      it('should decode FLOAT32 and FLOAT64 based on wrapNumbers', () => {
        const float32Type = {code: google.spanner.v1.TypeCode.FLOAT32};
        const float64Type = {code: google.spanner.v1.TypeCode.FLOAT64};

        // wrapNumbers = true (default/standard mode)
        const decoder32Wrapped = codec.getDecoder(
          float32Type as any,
          undefined,
          undefined,
        );
        const decoder64Wrapped = codec.getDecoder(
          float64Type as any,
          undefined,
          undefined,
        );
        expect(decoder32Wrapped('3.14') instanceof codec.Float32).toBeTruthy();
        expect(decoder64Wrapped('3.14') instanceof codec.Float).toBeTruthy();

        // wrapNumbers = false (JSON mode default)
        const decoder32Raw = codec.getDecoder(float32Type as any, undefined, {
          wrapNumbers: false,
        });
        const decoder64Raw = codec.getDecoder(float64Type as any, undefined, {
          wrapNumbers: false,
        });
        expect(decoder32Raw('3.14')).toBe(3.14);
        expect(decoder64Raw('3.14')).toBe(3.14);
      });

      it('should decode INT64 and PG_OID based on wrapNumbers', () => {
        const int64Type = {code: google.spanner.v1.TypeCode.INT64};
        const pgOidType = {
          code: google.spanner.v1.TypeCode.INT64,
          typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_OID,
        };

        // wrapNumbers = true
        const decoder64Wrapped = codec.getDecoder(
          int64Type as any,
          undefined,
          undefined,
        );
        const decoderOidWrapped = codec.getDecoder(
          pgOidType as any,
          undefined,
          undefined,
        );
        expect(decoder64Wrapped('123') instanceof codec.Int).toBeTruthy();
        expect(decoderOidWrapped('123') instanceof codec.PGOid).toBeTruthy();

        // wrapNumbers = false
        const decoder64Raw = codec.getDecoder(int64Type as any, undefined, {
          wrapNumbers: false,
        });
        const decoderOidRaw = codec.getDecoder(pgOidType as any, undefined, {
          wrapNumbers: false,
        });
        expect(decoder64Raw('123')).toBe(123);
        expect(decoderOidRaw('123')).toBe(123);

        // Should throw error if number is out of bounds
        expect(() => decoder64Raw('9007199254740992')).toThrow(/Integer 9007199254740992 is out of bounds/);
        expect(() => decoderOidRaw('9007199254740992')).toThrow(/PG.OID 9007199254740992 is out of bounds/);
      });
    });
  });

  describe('encode', () => {
    it('should return the value from the common encoder', () => {
      const value = {};
      const defaultEncodedValue = '{}';

      jest.spyOn(GrpcService, 'encodeValue_').mockReturnValue(defaultEncodedValue as any);

      const encoded = codec.encode(value);
      expect(encoded).toBe(defaultEncodedValue);
    });

    it('should encode BYTES', () => {
      const value = Buffer.from('bytes value');

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.toString('base64'));
    });

    it('should encode ProtoMessage', () => {
      const genre = music.Genre.ROCK;
      const singerInfo = music.SingerInfo.create({
        singerId: 1,
        genre: genre,
        birthDate: 'January',
        nationality: 'Country1',
      });

      const protoMessage = new codec.ProtoMessage({
        value: singerInfo,
        messageFunction: music.SingerInfo,
        fullName: 'examples.spanner.music.SingerInfo',
      });

      const encoded = codec.encode(protoMessage);

      expect(encoded).toBe(music.SingerInfo.encode(singerInfo).finish().toString('base64'));
    });

    it('should encode ProtoEnum', () => {
      const genre = music.Genre.ROCK;
      const protoEnum = new codec.ProtoEnum({
        value: genre,
        enumObject: music.Genre,
        fullName: 'examples.spanner.music.Genre',
      });

      const encoded = codec.encode(protoEnum);

      expect(encoded).toBe(genre.toString());
    });

    it('should encode structs', () => {
      const value = codec.Struct.fromJSON({a: 'b', c: 'd'});
      const encoded = codec.encode(value);
      expect(encoded).toEqual(['b', 'd']);
    });

    it('should stringify Infinity', () => {
      const value = Infinity;
      const encoded = codec.encode(value);
      expect(encoded).toBe(value.toString());
    });

    it('should stringify -Infinity', () => {
      const value = -Infinity;

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.toString());
    });

    it('should stringify NaN', () => {
      const value = NaN;

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.toString());
    });

    it('should stringify INT64', () => {
      const value = 5;

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.toString());
    });

    it('should stringify NUMERIC', () => {
      const value = new codec.Numeric('8.01911');

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.value);
    });

    it('should stringify PG NUMERIC', () => {
      const value = new codec.PGNumeric('8.01911');

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.value);
    });

    it('should encode ARRAY and inner members', () => {
      const value = [5];

      const encoded = codec.encode(value);

      expect(encoded).toEqual([
        value.toString(), // (tests that it is stringified)
      ]);
    });

    it('should encode TIMESTAMP', () => {
      const value = new PreciseDate();

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.toJSON());
    });

    it('should encode DATE', () => {
      const value = new codec.SpannerDate();

      const encoded = codec.encode(value);

      expect(encoded).toBe(value.toJSON());
    });

    it('should encode INTERVAL', () => {
      const value = new codec.Interval(17, -20, BigInt(30001));
      const encoded = codec.encode(value);
      expect(encoded).toBe('P1Y5M-20DT0.000030001S');
    });

    it('should encode INT64', () => {
      const value = new codec.Int(10);

      const encoded = codec.encode(value);

      expect(encoded).toBe('10');
    });

    it('should encode PG OID', () => {
      const value = new codec.PGOid(10);

      const encoded = codec.encode(value);

      expect(encoded).toBe('10');
    });

    it('should encode UUID', () => {
      const value = crypto.randomUUID();

      const encoded = codec.encode(value);

      expect(encoded).toBe(value);
    });

    it('should encode FLOAT32', () => {
      const value = new codec.Float32(10);

      const encoded = codec.encode(value);

      expect(encoded).toBe(10);
    });

    it('should encode FLOAT64', () => {
      const value = new codec.Float(10);

      const encoded = codec.encode(value);

      expect(encoded).toBe(10);
    });

    it('should encode JSON', () => {
      const expected = '{"result":true,"count":42}';
      const value = JSON.parse('{"result": true, "count": 42}');

      const encoded = codec.encode(value);

      expect(encoded).toEqual(expected);
    });

    it('should encode complex object as JSON', () => {
      const value = {
        boolKey: true,
        numberKey: 3.14,
        stringKey: 'test',
        objectKey: {innerKey: 'inner-value'},
      };

      const encoded = codec.encode(value);

      expect(encoded).toEqual('{"boolKey":true,"numberKey":3.14,"stringKey":"test","objectKey":{"innerKey":"inner-value"}}');
    });

    it('should encode deeply-nested object as JSON', () => {
      // Cloud Spanner accepts a nesting level in a JSON string of at most 100.
      // This test ensures that the encoder is able to encode such an object to
      // a JSON string.
      const nesting = 100;
      const value = JSON.parse(
        '{"k": '.repeat(nesting).concat('"v"').concat('}'.repeat(nesting)),
      );

      const encoded = codec.encode(value);

      expect(encoded).toEqual('{"k":'.repeat(nesting).concat('"v"').concat('}'.repeat(nesting)));
    });

    it('should decode deeply-nested object as JSON', () => {
      // Cloud Spanner accepts a nesting level in a JSON string of at most 100.
      // This test ensures that the decoder is able to decode such a string.
      const nesting = 100;
      const value = '{"k": '
        .repeat(nesting)
        .concat('"v"')
        .concat('}'.repeat(nesting));

      const decoded = codec.decode(value, {
        code: google.spanner.v1.TypeCode.JSON,
      });

      expect(decoded).toEqual(JSON.parse(
          '{"k":'.repeat(nesting).concat('"v"').concat('}'.repeat(nesting)),
        ));
    });
  });

  describe('getType', () => {
    it('should determine if the value is a boolean', () => {
      expect(codec.getType(true)).toEqual({type: 'bool'});
    });

    it('should determine if the value is a float', () => {
      expect(codec.getType(NaN)).toEqual({type: 'float64'});
      expect(codec.getType(Infinity)).toEqual({type: 'float64'});
      expect(codec.getType(-Infinity)).toEqual({type: 'float64'});
      expect(codec.getType(2.2)).toEqual({type: 'float64'});
      expect(codec.getType(new codec.Float(1.1))).toEqual({
        type: 'float64',
      });
    });

    it('should determine if the uuid value is string', () => {
      expect(codec.getType(crypto.randomUUID())).toEqual({
        type: 'string',
      });
    });

    it('should determine if the uuid value is unspecified when SPANNER_ENABLE_UUID_AS_UNTYPED is true', () => {
      const emitWarningStub = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
      try {
        process.env['SPANNER_ENABLE_UUID_AS_UNTYPED'] = 'true';
        expect(codec.getType(crypto.randomUUID())).toEqual({
          type: 'unspecified',
        });
        expect(emitWarningStub).toHaveBeenCalledTimes(1);
        expect(emitWarningStub).toHaveBeenCalledWith('SPANNER_ENABLE_UUID_AS_UNTYPED environment variable is deprecated and will be removed in a future release.', 'DeprecationWarning');
      } finally {
        delete process.env['SPANNER_ENABLE_UUID_AS_UNTYPED'];
        emitWarningStub.mockRestore();
      }
    });

    it('should determine if the uuid value is string when SPANNER_ENABLE_UUID_AS_UNTYPED is false', () => {
      try {
        process.env['SPANNER_ENABLE_UUID_AS_UNTYPED'] = 'false';
        expect(codec.getType(crypto.randomUUID())).toEqual({
          type: 'string',
        });
      } finally {
        delete process.env['SPANNER_ENABLE_UUID_AS_UNTYPED'];
      }
    });

    it('should determine if the value is a float32', () => {
      expect(codec.getType(new codec.Float32(1.1))).toEqual({
        type: 'float32',
      });
    });

    it('should determine if the value is an int', () => {
      expect(codec.getType(1234)).toEqual({type: 'int64'});
      expect(codec.getType(new codec.Int(1))).toEqual({type: 'int64'});
    });

    it('should determine if the value is numeric', () => {
      expect(codec.getType(new codec.Numeric('8.01911'))).toEqual({
        type: 'numeric',
      });
    });

    it('should determine if the value is a string', () => {
      expect(codec.getType('abc')).toEqual({type: 'string'});
    });

    it('should determine if the value is bytes', () => {
      expect(codec.getType(Buffer.from('abc'))).toEqual({
        type: 'bytes',
      });
    });

    it('should determine if the value is json', () => {
      expect(codec.getType({key: 'value'})).toEqual({
        type: 'json',
      });
    });

    it('should determine if the value is a date', () => {
      expect(codec.getType(new codec.SpannerDate())).toEqual({
        type: 'date',
      });
    });

    it('should determine if the value is a timestamp', () => {
      expect(codec.getType(new PreciseDate())).toEqual({
        type: 'timestamp',
      });
    });

    it('should accept a plain date object as a timestamp', () => {
      expect(codec.getType(new Date())).toEqual({type: 'timestamp'});
    });

    it.skip('should determine if the value is a interval', () => {
      expect(codec.getType(new codec.Interval(1, 2, BigInt(3)))).toEqual({
          type: 'interval',
        });
    });

    it('should determine if the value is a struct', () => {
      const struct = codec.Struct.fromJSON({a: 'b'});
      const type = codec.getType(struct);

      expect(type).toEqual({
        type: 'struct',
        fields: [{name: 'a', type: 'string'}],
      });
    });

    it('should attempt to determine arrays and their values', () => {
      expect(codec.getType([Infinity])).toEqual({
        type: 'array',
        child: {
          type: 'float64',
        },
      });
    });

    it('should return unspecified for unknown values', () => {
      expect(codec.getType(null)).toEqual({type: 'unspecified'});

      expect(codec.getType([null])).toEqual({
        type: 'array',
        child: {
          type: 'unspecified',
        },
      });
    });

    it('should determine if the value is a PGNumeric', () => {
      expect(codec.getType(new codec.PGNumeric('7248'))).toEqual({
        type: 'pgNumeric',
      });
    });

    it('should determine if the value is a PGOid', () => {
      expect(codec.getType(new codec.PGOid(5678))).toEqual({
        type: 'pgOid',
      });
    });
  });

  describe('convertToListValue', () => {
    beforeEach(() => {
      jest.spyOn(codec, 'encode').mockImplementation(value => {
        return {stringValue: value};
      });
    });

    it('should map values to encoded versions', () => {
      const actual = ['hi', 'bye'];
      const expected = {
        values: [{stringValue: 'hi'}, {stringValue: 'bye'}],
      };

      const converted = codec.convertToListValue(actual);
      expect(converted).toEqual(expected);
    });

    it('should convert a single value to a list value', () => {
      const actual = 'hi';
      const expected = {
        values: [{stringValue: 'hi'}],
      };

      const converted = codec.convertToListValue(actual);
      expect(converted).toEqual(expected);
    });
  });

  describe('convertMsToProtoTimestamp', () => {
    it('should convert ms to google.protobuf.Timestamp', () => {
      const ms = 5000.00001;
      const expected = {
        nanos: 10,
        seconds: 5,
      };

      const converted = codec.convertMsToProtoTimestamp(ms);
      expect(converted).toEqual(expected);
    });
  });

  describe('convertProtoTimestampToDate', () => {
    it('should convert google.protobuf.Timestamp to Date', () => {
      const timestamp = {nanos: 10, seconds: 5};

      const expected = new Date(5000.00001);
      const converted = codec.convertProtoTimestampToDate(timestamp);

      expect(converted).toEqual(expected);
    });
  });

  describe('createTypeObject', () => {
    it('should convert strings to the corresponding type', () => {
      const typeMap = {
        unspecified: {
          code: google.spanner.v1.TypeCode[
            google.spanner.v1.TypeCode.TYPE_CODE_UNSPECIFIED
          ],
        },
        bool: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.BOOL],
        },
        int64: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.INT64],
        },
        uuid: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.UUID],
        },
        float32: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.FLOAT32],
        },
        float64: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.FLOAT64],
        },
        timestamp: {
          code: google.spanner.v1.TypeCode[
            google.spanner.v1.TypeCode.TIMESTAMP
          ],
        },
        date: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.DATE],
        },
        string: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.STRING],
        },
        bytes: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.BYTES],
        },
        interval: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.INTERVAL],
        },
        array: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.ARRAY],
          arrayElementType: {
            code: google.spanner.v1.TypeCode[
              google.spanner.v1.TypeCode.TYPE_CODE_UNSPECIFIED
            ],
          },
        },
        struct: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.STRUCT],
          structType: {fields: []},
        },
      };

      Object.keys(typeMap).forEach(key => {
        const type = codec.createTypeObject(key);
        expect(type).toEqual(typeMap[key]);
      });
    });

    it('should default to unspecified for unknown types', () => {
      const type = codec.createTypeObject('unicorn');

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[
          google.spanner.v1.TypeCode.TYPE_CODE_UNSPECIFIED
        ],
      });
    });

    it('should set the arrayElementType', () => {
      const type = codec.createTypeObject({
        type: 'array',
        child: 'bool',
      });

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.ARRAY],
        arrayElementType: {
          code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.BOOL],
        },
      });
    });

    it('should set the struct fields', () => {
      const type = codec.createTypeObject({
        type: 'struct',
        fields: [
          {name: 'boolKey', type: 'bool'},
          {name: 'intKey', type: 'int64'},
        ],
      });

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.STRUCT],
        structType: {
          fields: [
            {
              name: 'boolKey',
              type: {
                code: google.spanner.v1.TypeCode[
                  google.spanner.v1.TypeCode.BOOL
                ],
              },
            },
            {
              name: 'intKey',
              type: {
                code: google.spanner.v1.TypeCode[
                  google.spanner.v1.TypeCode.INT64
                ],
              },
            },
          ],
        },
      });
    });

    it('should handle nested structs', () => {
      const type = codec.createTypeObject({
        type: 'struct',
        fields: [
          {
            name: 'nestedStruct',
            type: 'struct',
            fields: [
              {
                type: 'bool',
                name: 'boolKey',
              },
            ],
          },
        ],
      });

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.STRUCT],
        structType: {
          fields: [
            {
              name: 'nestedStruct',
              type: {
                code: google.spanner.v1.TypeCode[
                  google.spanner.v1.TypeCode.STRUCT
                ],
                structType: {
                  fields: [
                    {
                      name: 'boolKey',
                      type: {
                        code: google.spanner.v1.TypeCode[
                          google.spanner.v1.TypeCode.BOOL
                        ],
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      });
    });
    it('should set code and typeAnnotation for pgNumeric string', () => {
      const type = codec.createTypeObject('pgNumeric');

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.NUMERIC],
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_NUMERIC,
      });
    });

    it('should set code and typeAnnotation for pgNumeric friendlyType object', () => {
      const type = codec.createTypeObject({type: 'pgNumeric'});

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.NUMERIC],
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_NUMERIC,
      });
    });

    it('should set code and typeAnnotation for pgOid string', () => {
      const type = codec.createTypeObject('pgOid');

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.INT64],
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_OID,
      });
    });

    it('should set code and typeAnnotation for pgOid friendlyType object', () => {
      const type = codec.createTypeObject({type: 'pgOid'});

      expect(type).toEqual({
        code: google.spanner.v1.TypeCode[google.spanner.v1.TypeCode.INT64],
        typeAnnotation: google.spanner.v1.TypeAnnotationCode.PG_OID,
      });
    });
  });
});
