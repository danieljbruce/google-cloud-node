// Copyright 2019 Google LLC
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
  ObjectToStructConverter,
  ObjectToStructConverterConfig,
  zuluToDateObj,
} from '../../src/utils/common';

const OPTIONS = {
  maxRetries: 3,
} as ObjectToStructConverterConfig;

describe('ObjectToStructConverter', () => {
  let objectToStructConverter: ObjectToStructConverter;

  beforeEach(() => {
    objectToStructConverter = new ObjectToStructConverter(OPTIONS);
  });

  describe('instantiation', () => {
    it('should not require an options object', () => {
      expect(() => {
        new ObjectToStructConverter();
      }).not.toThrow();
    });

    it('should localize an empty Set for seenObjects', () => {
      expect(objectToStructConverter.seenObjects).toBeInstanceOf(Set);
      expect(objectToStructConverter.seenObjects.size).toBe(0);
    });

    it('should localize options', () => {
      const objectToStructConverter = new ObjectToStructConverter({
        removeCircular: true,
        stringify: true,
      });

      expect(objectToStructConverter.removeCircular).toBe(true);
      expect(objectToStructConverter.stringify).toBe(true);
    });

    it('should set correct defaults', () => {
      expect(objectToStructConverter.removeCircular).toBe(false);
      expect(objectToStructConverter.stringify).toBe(false);
    });
  });

  describe('convert', () => {
    it('should encode values in an Object', () => {
      const inputValue = {};
      const convertedValue = {};

      objectToStructConverter.encodeValue_ = value => {
        expect(value).toBe(inputValue);
        return convertedValue as any;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const struct: any = objectToStructConverter.convert({
        a: inputValue,
      });

      expect(struct.fields.a).toBe(convertedValue);
    });

    it('should support host objects', () => {
      const hostObject = {hasOwnProperty: null};

      objectToStructConverter.encodeValue_ = () => {
        return {} as any;
      };

      expect(() => {
        objectToStructConverter.convert(hostObject);
      }).not.toThrow();
    });

    it('should not include undefined values', done => {
      objectToStructConverter.encodeValue_ = () => {
        done(new Error('Should not be called'));
        return {} as any;
      };

      try {
        const struct = objectToStructConverter.convert({
          a: undefined,
        });

        expect(struct.fields).toEqual({});
        done();
      } catch (e) {
        done(e);
      }
    });

    it('should add seen objects to set then empty set', done => {
      const obj = {};
      let objectAdded: {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (objectToStructConverter as any).seenObjects = {
        add(obj: {}) {
          objectAdded = obj;
        },
        delete(obj_: {}) {
          try {
            expect(obj_).toBe(obj);
            expect(objectAdded).toBe(obj);
            done();
          } catch (e) {
            done(e);
          }
        },
      };

      objectToStructConverter.convert(obj);
    });
  });

  describe('encodeValue_', () => {
    it('should convert primitive values correctly', () => {
      const buffer = Buffer.from('Value');

      expect(objectToStructConverter.encodeValue_(null)).toEqual({
        nullValue: 0,
      });

      expect(objectToStructConverter.encodeValue_(1)).toEqual({
        numberValue: 1,
      });

      expect(objectToStructConverter.encodeValue_('Hi')).toEqual({
        stringValue: 'Hi',
      });

      expect(objectToStructConverter.encodeValue_(true)).toEqual({
        boolValue: true,
      });

      expect(
        (objectToStructConverter.encodeValue_(buffer) as any).blobValue.toString(),
      ).toBe('Value');
    });

    it('should convert arrays', () => {
      const convertedValue = objectToStructConverter.encodeValue_([1, 2, 3]);

      expect((convertedValue as any).listValue).toEqual({
        values: [
          objectToStructConverter.encodeValue_(1),
          objectToStructConverter.encodeValue_(2),
          objectToStructConverter.encodeValue_(3),
        ],
      });
    });

    it('should throw if a type is not recognized', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (objectToStructConverter as any).encodeValue_();
      }).toThrow(/Value of type undefined not recognized./);
    });

    describe('objects', () => {
      const VALUE: {circularReference?: {}} = {};
      VALUE.circularReference = VALUE;

      it('should convert objects', () => {
        const convertedValue = {};
        objectToStructConverter.convert = value => {
          expect(value).toBe(VALUE);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return convertedValue as any;
        };

        expect(objectToStructConverter.encodeValue_(VALUE)).toEqual({
          structValue: convertedValue,
        });
      });

      describe('circular references', () => {
        it('should throw if circular', () => {
          const errorMessage = [
            'This object contains a circular reference. To automatically',
            'remove it, set the `removeCircular` option to true.',
          ].join(' ');

          objectToStructConverter.seenObjects.add(VALUE);

          expect(() => {
            objectToStructConverter.encodeValue_(VALUE);
          }).toThrow(new RegExp(errorMessage));
        });

        describe('options.removeCircular', () => {
          let objectToStructConverter: ObjectToStructConverter;

          beforeEach(() => {
            objectToStructConverter = new ObjectToStructConverter({
              removeCircular: true,
            });

            objectToStructConverter.seenObjects.add(VALUE);
          });

          it('should replace circular reference with [Circular]', () => {
            expect(objectToStructConverter.encodeValue_(VALUE)).toEqual({
              stringValue: '[Circular]',
            });
          });
        });
      });
    });

    describe('options.stringify', () => {
      let objectToStructConverter: ObjectToStructConverter;

      beforeEach(() => {
        objectToStructConverter = new ObjectToStructConverter({
          stringify: true,
        });
      });

      it('should return a string if the value is not recognized', () => {
        const date = new Date();
        expect(objectToStructConverter.encodeValue_(date)).toEqual({
          stringValue: String(date),
        });
      });
    });
  });
});

describe('zuluToDateObj', () => {
  it('should convert a string timestamp', () => {
    const tests = [
      {
        inputTime: '2020-01-01T00:00:00.11Z',
        expectedSeconds: 1577836800,
        expectedNanos: 110000000,
      },
      {
        inputTime: '2020-01-01T00:00:00Z',
        expectedSeconds: 1577836800,
        expectedNanos: 0,
      },
      {
        inputTime: '2020-01-01T00:00:00.999999999Z',
        expectedSeconds: 1577836800,
        expectedNanos: 999999999,
      },
      {
        inputTime: 'invalid timestamp string',
        expectedSeconds: 0,
        expectedNanos: 0,
      },
    ];

    for (const test of tests) {
      const dateString = test.inputTime;
      const dateObj = zuluToDateObj(dateString);
      expect(dateObj).toEqual({
        seconds: test.expectedSeconds,
        nanos: test.expectedNanos,
      });
    }
  });
});
