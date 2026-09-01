// Copyright 2014 Google LLC
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

import * as extend from 'extend';
import {Datastore} from '../src';
import {Entity, entity} from '../src/entity';
import {IntegerTypeCastOptions} from '../src/query';
import {PropertyFilter, EntityFilter, and} from '../src/filter';
import {
  entityObject,
  expectedEntityProto,
} from './fixtures/entityObjectAndProto';

export function outOfBoundsError(opts: {
  propertyName?: string;
  integerValue: string | number;
}) {
  return new Error(
    'We attempted to return all of the numeric values, but ' +
      (opts.propertyName ? opts.propertyName + ' ' : '') +
      'value ' +
      opts.integerValue +
      " is out of bounds of 'Number.MAX_SAFE_INTEGER'.\n" +
      "To prevent this error, please consider passing 'options.wrapNumbers=true' or\n" +
      "'options.wrapNumbers' as\n" +
      '{\n' +
      '  integerTypeCastFunction: provide <your_custom_function>\n' +
      '  properties: optionally specify property name(s) to be custom casted\n' +
      '}\n',
  );
}

describe('entity', () => {
  let testEntity: Entity;
  const originalInt = entity.Int;
  const originalDouble = entity.Double;
  const originalGeoPoint = entity.GeoPoint;
  const originalKey = entity.Key;
  const originalDecodeValueProto = entity.decodeValueProto;
  const originalEncodeValue = entity.encodeValue;
  const originalKeyToKeyProto = entity.keyToKeyProto;
  const originalKeyFromKeyProto = entity.keyFromKeyProto;
  const originalEntityFromEntityProto = entity.entityFromEntityProto;
  const originalEntityToEntityProto = entity.entityToEntityProto;
  const originalFormatArray = entity.formatArray;

  beforeEach(() => {
    testEntity = entity;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    entity.Int = originalInt;
    entity.Double = originalDouble;
    entity.GeoPoint = originalGeoPoint;
    entity.Key = originalKey;
    entity.decodeValueProto = originalDecodeValueProto;
    entity.encodeValue = originalEncodeValue;
    entity.keyToKeyProto = originalKeyToKeyProto;
    entity.keyFromKeyProto = originalKeyFromKeyProto;
    entity.entityFromEntityProto = originalEntityFromEntityProto;
    entity.entityToEntityProto = originalEntityToEntityProto;
    entity.formatArray = originalFormatArray;
  });

  describe('KEY_SYMBOL', () => {
    it('should export the symbol', () => {
      expect(testEntity.KEY_SYMBOL.toString()).toBe('Symbol(KEY)');
    });
  });

  describe('Double', () => {
    it('should store the value', () => {
      const value = 8.3;

      const double = new testEntity.Double(value);
      expect(double.value).toBe(value);
    });
  });

  describe('isDsDouble', () => {
    it('should correctly identify a Double', () => {
      const double = new testEntity.Double(0.42);
      expect(testEntity.isDsDouble(double)).toBe(true);
    });

    it('should correctly identify a homomorphic non-Double', () => {
      const nonDouble = Object.assign({}, new testEntity.Double(42));
      expect(testEntity.isDsDouble(nonDouble)).toBe(false);
    });

    it('should correctly identify a primitive', () => {
      const primitiveDouble = 0.42;
      expect(testEntity.isDsDouble(primitiveDouble)).toBe(false);
    });
  });

  describe('isDsDoubleLike', () => {
    it('should correctly identify a Double', () => {
      const double = new testEntity.Double(0.42);
      expect(testEntity.isDsDoubleLike(double)).toBe(true);
    });

    it('should correctly identify a POJO Double', () => {
      const double = new testEntity.Double(0.42);
      const pojoDouble = JSON.parse(JSON.stringify(double));
      expect(testEntity.isDsDoubleLike(pojoDouble)).toBe(true);
    });
  });

  describe('Int', () => {
    it('should store the stringified value', () => {
      const value = 8;

      const int = new testEntity.Int(value);
      expect(int.value).toBe(value.toString());
    });

    it('should store the stringified value from valueProto object', () => {
      const valueProto = {
        valueType: 'integerValue',
        integerValue: 8,
      };
      const int = new testEntity.Int(valueProto);
      expect(int.value).toBe(valueProto.integerValue.toString());
    });

    describe('valueOf', () => {
      let valueProto: {};
      beforeEach(() => {
        valueProto = {
          valueType: 'integerValue',
          integerValue: 8,
        };
      });

      describe('integerTypeCastFunction is not provided', () => {
        it('should throw if integerTypeCastOptions is provided but integerTypeCastFunction is not', () => {
          expect(() => new testEntity.Int(valueProto, {}).valueOf()).toThrow(/integerTypeCastFunction is not a function or was not provided\./);
        });

        it('should throw if integer value is outside of bounds passing objects', () => {
          const largeIntegerValue = Number.MAX_SAFE_INTEGER + 1;
          const smallIntegerValue = Number.MIN_SAFE_INTEGER - 1;

          const valueProto = {
            integerValue: largeIntegerValue,
            propertyName: 'phoneNumber',
          };

          const valueProto2 = {
            integerValue: smallIntegerValue,
            propertyName: 'phoneNumber',
          };

          expect(() => {
            new testEntity.Int(valueProto).valueOf();
          }).toThrow(outOfBoundsError(valueProto));

          expect(() => {
            new testEntity.Int(valueProto2).valueOf();
          }).toThrow(outOfBoundsError(valueProto2));
        });

        it('should throw if integer value is outside of bounds passing strings or Numbers', () => {
          const largeIntegerValue = Number.MAX_SAFE_INTEGER + 1;
          const smallIntegerValue = Number.MIN_SAFE_INTEGER - 1;

          // should throw when Number is passed
          expect(() => {
              new testEntity.Int(largeIntegerValue).valueOf();
            }).toThrow(outOfBoundsError({integerValue: largeIntegerValue}));

          // should throw when string is passed
          expect(() => {
              new testEntity.Int(smallIntegerValue.toString()).valueOf();
            }).toThrow(outOfBoundsError({integerValue: smallIntegerValue}));
        });

        it('should not auto throw on initialization', () => {
          const largeIntegerValue = Number.MAX_SAFE_INTEGER + 1;

          const valueProto = {
            valueType: 'integerValue',
            integerValue: largeIntegerValue,
          };

          expect(() => {
              new testEntity.Int(valueProto);
            }).not.toThrow();
        });
      });

      describe('integerTypeCastFunction is provided', () => {
        it('should throw if integerTypeCastFunction is not a function', () => {
          expect(() =>
              new testEntity.Int(valueProto, {
                integerTypeCastFunction: {},
              }).valueOf()).toThrow(/integerTypeCastFunction is not a function or was not provided\./);
        });

        it('should custom-cast integerValue when integerTypeCastFunction is provided', () => {
          const stub = jest.fn();

          new testEntity.Int(valueProto, {
            integerTypeCastFunction: stub,
          }).valueOf();
          expect(stub).toHaveBeenCalledTimes(1);
        });

        it('should custom-cast integerValue if `properties` specified by user', () => {
          const stub = jest.fn();
          Object.assign(valueProto, {
            propertyName: 'thisValue',
          });

          new testEntity.Int(valueProto, {
            integerTypeCastFunction: stub,
            properties: 'thisValue',
          }).valueOf();
          expect(stub).toHaveBeenCalledTimes(1);
        });

        it('should not custom-cast integerValue if `properties` not specified by user', () => {
          const stub = jest.fn();

          Object.assign(valueProto, {
            propertyName: 'thisValue',
          });

          new testEntity.Int(valueProto, {
            integerTypeCastFunction: stub,
            properties: 'thatValue',
          }).valueOf();
          expect(stub).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe('isDsInt', () => {
    it('should correctly identify an Int', () => {
      const int = new testEntity.Int(42);
      expect(testEntity.isDsInt(int)).toBe(true);
    });

    it('should correctly identify homomorphic non-Int', () => {
      const nonInt = Object.assign({}, new testEntity.Int(42));
      expect(testEntity.isDsInt(nonInt)).toBe(false);
    });

    it('should correctly identify a primitive', () => {
      const primitiveInt = 42;
      expect(testEntity.isDsInt(primitiveInt)).toBe(false);
    });
  });

  describe('isDsIntLike', () => {
    it('should correctly identify an Int', () => {
      const int = new testEntity.Int(42);
      expect(testEntity.isDsIntLike(int)).toBe(true);
    });

    it('should correctly identify a POJO Int', () => {
      const int = new testEntity.Int(42);
      const pojoInt = JSON.parse(JSON.stringify(int));
      expect(testEntity.isDsIntLike(pojoInt)).toBe(true);
    });
  });

  describe('GeoPoint', () => {
    it('should store the value', () => {
      const value = {
        latitude: 24,
        longitude: 88,
      };

      const geoPoint = new testEntity.GeoPoint(value);
      expect(geoPoint.value).toBe(value);
    });
  });

  describe('isDsGeoPoint', () => {
    it('should correctly identify a GeoPoint', () => {
      const geoPoint = new testEntity.GeoPoint({latitude: 24, longitude: 88});
      expect(testEntity.isDsGeoPoint(geoPoint)).toBe(true);
    });

    it('should correctly identify a homomorphic non-GeoPoint', () => {
      const geoPoint = new testEntity.GeoPoint({latitude: 24, longitude: 88});
      const nonGeoPoint = Object.assign({}, geoPoint);
      expect(testEntity.isDsGeoPoint(nonGeoPoint)).toBe(false);
    });
  });

  describe('Key', () => {
    it('should assign the namespace', () => {
      const namespace = 'NS';
      const key = new testEntity.Key({namespace, path: []});
      expect(key.namespace).toBe(namespace);
    });

    it('should assign the kind', () => {
      const kind = 'kind';
      const key = new testEntity.Key({path: [kind]});
      expect(key.kind).toBe(kind);
    });

    it('should assign the ID', () => {
      const id = 11;
      const key = new testEntity.Key({path: ['Kind', id]});
      expect(key.id).toBe(id);
    });

    it('should assign the ID from an Int', () => {
      const id = new testEntity.Int(11);
      const key = new testEntity.Key({path: ['Kind', id]});
      expect(key.id).toBe(id.value);
    });

    it('should assign the name', () => {
      const name = 'name';
      const key = new testEntity.Key({path: ['Kind', name]});
      expect(key.name).toBe(name);
    });

    it('should assign a parent', () => {
      const key = new testEntity.Key({path: ['ParentKind', 1, 'Kind', 1]});
      expect(key.parent instanceof testEntity.Key).toBeTruthy();
    });

    it('should not modify input path', () => {
      const inputPath = ['ParentKind', 1, 'Kind', 1];
      new testEntity.Key({path: inputPath});
      expect(inputPath).toEqual(['ParentKind', 1, 'Kind', 1]);
    });

    it('should always compute the correct path', () => {
      const key = new testEntity.Key({path: ['ParentKind', 1, 'Kind', 1]});
      expect(key.path).toEqual(['ParentKind', 1, 'Kind', 1]);

      key.parent.kind = 'GrandParentKind';
      key.kind = 'ParentKind';

      expect(key.path).toEqual(['GrandParentKind', 1, 'ParentKind', 1]);
    });

    it('should always compute the correct serialized path', () => {
      const key = new testEntity.Key({
        namespace: 'namespace',
        path: [
          'ParentKind',
          'name',
          'Kind',
          1,
          'SubKind',
          new testEntity.Int('1'),
        ],
      });
      expect(key.serialized).toEqual({
        namespace: 'namespace',
        path: [
          'ParentKind',
          'name',
          'Kind',
          new testEntity.Int(1),
          'SubKind',
          new testEntity.Int('1'),
        ],
      });
    });

    it('should allow re-creating a Key from the serialized path', () => {
      const key = new testEntity.Key({
        path: [
          'ParentKind',
          'name',
          'Kind',
          1,
          'SubKind',
          new testEntity.Int('1'),
        ],
      });
      const key2 = new testEntity.Key(key.serialized);
      expect(key.serialized).toEqual(key2.serialized);
    });

    it('should allow re-creating a Key from the JSON serialized path', () => {
      const key = new testEntity.Key({
        path: [
          'ParentKind',
          'name',
          'Kind',
          1,
          'SubKind',
          new testEntity.Int('1'),
        ],
      });
      const toPOJO = (v: object) => JSON.parse(JSON.stringify(v));
      const key2 = new testEntity.Key(toPOJO(key.serialized));
      expect(key.serialized).toEqual(key2.serialized);
    });
  });

  describe('isDsKey', () => {
    it('should correctly identify a Key', () => {
      const key = new testEntity.Key({path: ['Kind', 1]});
      expect(testEntity.isDsKey(key)).toBe(true);
    });

    it('should correctly identify a homomorphic non-Key', () => {
      const notKey = Object.assign({}, new testEntity.Key({path: ['Kind', 1]}));
      expect(testEntity.isDsKey(notKey)).toBe(false);
    });
  });

  describe('decodeValueProto', () => {
    describe('arrays', () => {
      const intValue = 8;
      const expectedValue = [
        {
          valueType: 'integerValue',
          integerValue: intValue,
        },
      ];
      const valueProto = {
        valueType: 'arrayValue',
        arrayValue: {
          values: expectedValue,
        },
      };

      it('should decode arrays', () => {
        const expectedValue = [{}];

        const valueProto = {
          valueType: 'arrayValue',
          arrayValue: {
            values: expectedValue,
          },
        };

        let run = false;

        const decodeValueProto = testEntity.decodeValueProto;
        testEntity.decodeValueProto = (valueProto: {}) => {
          if (!run) {
            run = true;
            return decodeValueProto(valueProto);
          }

          expect(valueProto).toBe(expectedValue[0]);
          return valueProto;
        };

        expect(testEntity.decodeValueProto(valueProto)).toEqual(expectedValue);
      });

      it('should not wrap numbers by default', () => {
        const decodeValueProto = testEntity.decodeValueProto;
        testEntity.decodeValueProto = (
          valueProto: {},
          wrapNumbers?: boolean | {},
        ) => {
          expect(wrapNumbers).toBe(undefined);

          return decodeValueProto(valueProto, wrapNumbers);
        };

        expect(testEntity.decodeValueProto(valueProto)).toEqual([
          intValue,
        ]);
      });

      it('should wrap numbers with an option', () => {
        const wrapNumbersBoolean = true;
        const wrapNumbersObject = {};
        const decodeValueProto = testEntity.decodeValueProto;
        let run = false;
        testEntity.decodeValueProto = (
          valueProto: {},
          wrapNumbers?: boolean | {},
        ) => {
          if (!run) {
            run = true;
            return decodeValueProto(valueProto, wrapNumbers);
          }

          // verify that `wrapNumbers`param is passed (boolean or object)
          expect(wrapNumbers).toBeTruthy();
          return valueProto;
        };

        expect(testEntity.decodeValueProto(valueProto, wrapNumbersBoolean)).toEqual(expectedValue);

        // reset the run flag.
        run = false;
        expect(testEntity.decodeValueProto(valueProto, wrapNumbersObject)).toEqual(expectedValue);
      });
    });

    describe('entities', () => {
      it('should decode entities', () => {
        const expectedValue = {};

        const valueProto = {
          valueType: 'entityValue',
          entityValue: expectedValue,
        };

        testEntity.entityFromEntityProto = (entityProto: {}) => {
          expect(entityProto).toBe(expectedValue);
          return expectedValue;
        };

        expect(testEntity.decodeValueProto(valueProto)).toBe(expectedValue);
      });

      it('should not wrap numbers by default', () => {
        const expectedValue = {};

        const valueProto = {
          valueType: 'entityValue',
          entityValue: expectedValue,
        };

        testEntity.entityFromEntityProto = (
          entityProto: {},
          wrapNumbers?: boolean | {},
        ) => {
          expect(wrapNumbers).toBe(undefined);
          expect(entityProto).toBe(expectedValue);
          return expectedValue;
        };

        expect(testEntity.decodeValueProto(valueProto)).toBe(expectedValue);
      });

      it('should wrap numbers with an option', () => {
        const expectedValue = {};
        const wrapNumbersBoolean = true;
        const wrapNumbersObject = {};

        const valueProto = {
          valueType: 'entityValue',
          entityValue: expectedValue,
        };

        testEntity.entityFromEntityProto = (
          entityProto: {},
          wrapNumbers?: boolean | {},
        ) => {
          // verify that `wrapNumbers`param is passed (boolean or object)
          expect(wrapNumbers).toBeTruthy();
          expect(entityProto).toBe(expectedValue);
          return expectedValue;
        };

        expect(testEntity.decodeValueProto(valueProto, wrapNumbersBoolean)).toBe(expectedValue);

        expect(testEntity.decodeValueProto(valueProto, wrapNumbersObject)).toBe(expectedValue);
      });
    });

    describe('integerValues', () => {
      const valueProto = {
        valueType: 'integerValue',
        integerValue: 8,
      };

      describe('default `wrapNumbers: undefined`', () => {
        it('should not wrap ints by default', () => {
          expect(typeof testEntity.decodeValueProto(valueProto)).toBe('number');
        });

        it('should throw if integer value is outside of bounds', () => {
          const largeIntegerValue = Number.MAX_SAFE_INTEGER + 1;
          const smallIntegerValue = Number.MIN_SAFE_INTEGER - 1;

          const valueProto = {
            valueType: 'integerValue',
            integerValue: largeIntegerValue,
            propertyName: 'phoneNumber',
          };

          const valueProto2 = {
            valueType: 'integerValue',
            integerValue: smallIntegerValue,
            propertyName: 'phoneNumber',
          };

          expect(() => {
            testEntity.decodeValueProto(valueProto);
          }).toThrow(outOfBoundsError(valueProto));

          expect(() => {
            testEntity.decodeValueProto(valueProto2);
          }).toThrow(outOfBoundsError(valueProto2));
        });
      });

      describe('should wrap ints with option', () => {
        it('should wrap ints with wrapNumbers as boolean', () => {
          const wrapNumbers = true;
          const stub = jest
            .spyOn(testEntity, 'Int')
            .mockImplementation((...args) => {
              return new originalInt(...(args as [any, any]));
            });

          testEntity.decodeValueProto(valueProto, wrapNumbers);
          expect(stub).toHaveBeenCalled();
        });

        it('should wrap ints with wrapNumbers as object', () => {
          const wrapNumbers = {integerTypeCastFunction: () => {}};
          const stub = jest
            .spyOn(testEntity, 'Int')
            .mockImplementation((...args) => {
              return new originalInt(...(args as [any, any]));
            });

          testEntity.decodeValueProto(valueProto, wrapNumbers);
          expect(stub).toHaveBeenCalled();
        });

        it('should call #valueOf if integerTypeCastFunction is provided', () => {
          Object.assign(valueProto, {integerValue: Number.MAX_SAFE_INTEGER});
          const takeFirstTen = jest.fn((value: string | number) =>
            value.toString().substr(0, 10),
          );
          const wrapNumbers = {integerTypeCastFunction: takeFirstTen};

          expect(testEntity.decodeValueProto(valueProto, wrapNumbers)).toBe(
            takeFirstTen(Number.MAX_SAFE_INTEGER),
          );
          expect(takeFirstTen).toHaveBeenCalled();
        });

        it('should propagate error from typeCastfunction', () => {
          const errorMessage = 'some error from type casting function';
          const error = new Error(errorMessage);
          const stub = jest.fn().mockImplementation(() => {
            throw error;
          });
          expect(() =>
            testEntity
              .decodeValueProto(valueProto, {
                integerTypeCastFunction: stub,
              })
              .valueOf(),
          ).toThrow(
            new RegExp(
              `integerTypeCastFunction threw an error:\n\n  - ${errorMessage}`,
            ),
          );
        });
      });
    });

    it('should decode blobs', () => {
      const expectedValue = Buffer.from('Hi');

      const valueProto = {
        valueType: 'blobValue',
        blobValue: expectedValue.toString('base64'),
      };

      expect(testEntity.decodeValueProto(valueProto)).toEqual(expectedValue);
    });

    it('should decode null', () => {
      const expectedValue = null;

      const valueProto = {
        valueType: 'nullValue',
        nullValue: 0,
      };

      const decodedValue = testEntity.decodeValueProto(valueProto);
      expect(decodedValue).toEqual(expectedValue);
    });

    it('should decode doubles', () => {
      const expectedValue = 8.3;

      const valueProto = {
        valueType: 'doubleValue',
        doubleValue: expectedValue,
      };

      expect(testEntity.decodeValueProto(valueProto)).toBe(expectedValue);
    });

    it('should decode keys', () => {
      const expectedValue = {};

      const valueProto = {
        valueType: 'keyValue',
        keyValue: expectedValue,
      };

      testEntity.keyFromKeyProto = (keyProto: {}) => {
        expect(keyProto).toBe(expectedValue);
        return expectedValue;
      };

      expect(testEntity.decodeValueProto(valueProto)).toBe(expectedValue);
    });

    it('should decode timestamps', () => {
      const date = new Date();

      const seconds = Math.floor(date.getTime() / 1000);
      const ms = date.getMilliseconds();

      const expectedValue = new Date(seconds * 1000 + ms);

      const valueProto = {
        valueType: 'timestampValue',
        timestampValue: {
          seconds,
          nanos: ms * 1e6,
        },
      };

      expect(testEntity.decodeValueProto(valueProto)).toEqual(expectedValue);
    });

    it('should return the value if no conversions are necessary', () => {
      const expectedValue = false;

      const valueProto = {
        valueType: 'booleanValue',
        booleanValue: expectedValue,
      };

      expect(testEntity.decodeValueProto(valueProto)).toBe(expectedValue);
    });
  });

  describe('encodeValue', () => {
    it('should encode a boolean', () => {
      const value = true;

      const expectedValueProto = {
        booleanValue: value,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode null', () => {
      const value = null;

      const expectedValueProto = {
        nullValue: 0,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode an int', () => {
      const value = 8;

      const expectedValueProto = {
        integerValue: value,
      };

      testEntity.Int = function (value_: {}) {
        expect(value_).toBe(value);
        this.value = value_;
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should emit warning on out of bounce int', () => {
      // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
      const largeIntValue = 9223372036854775807;
      const property = 'largeInt';
      const expectedWarning =
        'IntegerOutOfBoundsWarning: ' +
        "the value for '" +
        property +
        "' property is outside of bounds of a JavaScript Number.\n" +
        "Use 'Datastore.int(<integer_value_as_string>)' to preserve accuracy during the upload.";

      const spy = jest.spyOn(process, 'emitWarning').mockImplementation();
      testEntity.encodeValue(largeIntValue, property);
      expect(spy).toHaveBeenCalledWith(expectedWarning);
    });

    it('should encode an Int object', () => {
      const value = new testEntity.Int(3);

      const expectedValueProto = {
        integerValue: value.value,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a double', () => {
      const value = 8.3;

      const expectedValueProto = {
        doubleValue: value,
      };

      testEntity.Double = function (value_: {}) {
        expect(value_).toBe(value);
        this.value = value_;
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a Double object', () => {
      const value = new testEntity.Double(3);

      const expectedValueProto = {
        doubleValue: value.value,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a GeoPoint object', () => {
      const value = new testEntity.GeoPoint();

      const expectedValueProto = {
        geoPointValue: value.value,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a date', () => {
      const value = new Date();
      const seconds = value.getTime() / 1000;

      const expectedValueProto = {
        timestampValue: {
          seconds: Math.floor(seconds),
          nanos: value.getMilliseconds() * 1e6,
        },
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a string', () => {
      const value = 'Hi';

      const expectedValueProto = {
        stringValue: value,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a buffer', () => {
      const value = Buffer.from('Hi');

      const expectedValueProto = {
        blobValue: value,
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode an array', () => {
      const value = [{}];

      const expectedValueProto = {
        arrayValue: {
          values: value,
        },
      };

      let run = false;

      const encodeValue = testEntity.encodeValue;
      testEntity.encodeValue = (value_: {}) => {
        if (!run) {
          run = true;
          return encodeValue(value_);
        }

        expect(value_).toBe(value[0]);
        return value_;
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode a Key', () => {
      const value = new testEntity.Key({
        namespace: 'ns',
        path: ['Kind', 1],
      });

      const expectedValueProto = {
        keyValue: value,
      };

      testEntity.keyToKeyProto = (key: {}) => {
        expect(key).toBe(value);
        return value;
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should encode an object', () => {
      const value = {
        key: 'value',
      };

      const expectedValueProto = {
        entityValue: {
          properties: {
            key: value.key,
          },
        },
      };

      let run = false;

      const encodeValue = testEntity.encodeValue;
      testEntity.encodeValue = (value_: {}) => {
        if (!run) {
          run = true;
          return encodeValue(value_);
        }

        expect(value_).toBe(value.key);
        return value_;
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should clone an object', () => {
      const value = {
        a: {
          b: {
            obj: true,
          },
        },
      };

      const originalValue = extend(true, {}, value);

      const encodedValue = testEntity.encodeValue(value);

      expect(value).toEqual(originalValue);
      expect(value).not.toBe(encodedValue);
    });

    it('should encode an empty object', () => {
      const value = {};

      const expectedValueProto = {
        entityValue: {
          properties: {},
        },
      };

      expect(testEntity.encodeValue(value)).toEqual(expectedValueProto);
    });

    it('should throw if an invalid value was provided', () => {
      expect(() => {
        testEntity.encodeValue();
      }).toThrow(/Unsupported field value/);
    });
  });

  describe('entityFromEntityProto', () => {
    it('should convert entity proto to entity', () => {
      const expectedEntity = {
        name: 'Stephen',
      };

      const entityProto = {
        properties: {
          name: {
            valueType: 'stringValue',
            stringValue: expectedEntity.name,
          },
        },
      };

      expect(testEntity.entityFromEntityProto(entityProto)).toEqual(expectedEntity);
    });

    describe('should pass `wrapNumbers` to decodeValueProto', () => {
      const entityProto = {properties: {number: {}}};
      let decodeValueProtoStub: jest.SpyInstance;
      let wrapNumbers: boolean | IntegerTypeCastOptions | undefined;

      beforeEach(() => {
        decodeValueProtoStub = jest.spyOn(testEntity, 'decodeValueProto');
      });

      afterEach(() => {
        decodeValueProtoStub.mockRestore();
      });

      it('should identify entity propertyName', () => {
        testEntity.entityFromEntityProto(entityProto);
        const valueProto = decodeValueProtoStub.mock.calls[0][0];
        expect(valueProto.propertyName).toBe('number');
      });

      it('should pass `wrapNumbers` to decodeValueProto as undefined by default', () => {
        testEntity.entityFromEntityProto(entityProto);
        wrapNumbers = decodeValueProtoStub.mock.calls[0][1];
        expect(wrapNumbers).toBe(undefined);
      });

      it('should pass `wrapNumbers` to decodeValueProto as boolean', () => {
        testEntity.entityFromEntityProto(entityProto, true);
        wrapNumbers = decodeValueProtoStub.mock.calls[0][1];
        expect(typeof wrapNumbers).toBe('boolean');
      });

      it('should pass `wrapNumbers` to decodeValueProto as IntegerTypeCastOptions', () => {
        const integerTypeCastOptions = {
          integerTypeCastFunction: () => {},
          properties: 'that',
        };

        testEntity.entityFromEntityProto(entityProto, integerTypeCastOptions);
        wrapNumbers = decodeValueProtoStub.mock.calls[0][1];
        expect(wrapNumbers).toBe(integerTypeCastOptions);
        expect(wrapNumbers).toEqual(integerTypeCastOptions);
      });
    });
  });

  describe('entityToEntityProto', () => {
    it('should format an entity', () => {
      const value = 'Stephen';

      const entityObject = {
        data: {
          name: value,
        },
      };

      const expectedEntityProto = {
        key: null,
        properties: entityObject.data,
      };

      testEntity.encodeValue = (value_: {}) => {
        expect(value_).toBe(value);
        return value;
      };

      expect(testEntity.entityToEntityProto(entityObject)).toEqual(expectedEntityProto);
    });

    it('should respect excludeFromIndexes', () => {
      expect(testEntity.entityToEntityProto(entityObject)).toEqual(expectedEntityProto);
    });

    it('should not throw when `null` value is supplied for a field with an entity/array index exclusion', () => {
      const entityObject = {
        excludeFromIndexes: [
          'entityCompletelyExcluded.*',
          'entityPropertyExcluded.name',
          'entityArrayCompletelyExcluded[].*',
          'entityArrayPropertyExcluded[].name',
        ],

        data: {
          entityCompletelyExcluded: null,
          entityPropertyExcluded: null,
          entityArrayCompletelyExcluded: null,
          entityArrayPropertyExcluded: null,
        },
      };

      const expectedEntityProto = {
        key: null,
        properties: {
          entityCompletelyExcluded: {
            nullValue: 0,
            excludeFromIndexes: true,
          },
          entityPropertyExcluded: {
            nullValue: 0,
          },
          entityArrayCompletelyExcluded: {
            nullValue: 0,
          },
          entityArrayPropertyExcluded: {
            nullValue: 0,
          },
        },
      };

      expect(testEntity.entityToEntityProto(entityObject)).toEqual(expectedEntityProto);
    });
  });

  describe('formatArray', () => {
    it('should convert protos to key/data entity array', () => {
      const key = {};

      const entityProto = {
        key,
      };

      const results = [
        {
          entity: entityProto,
        },
      ];

      const expectedResults = entityProto;

      testEntity.keyFromKeyProto = (key_: {}) => {
        expect(key_).toBe(key);
        return key;
      };

      testEntity.entityFromEntityProto = (entityProto_: {}) => {
        expect(entityProto_).toBe(entityProto);
        return entityProto;
      };

      const ent = testEntity.formatArray(results)[0];

      expect(ent).toEqual(expectedResults);
    });

    describe('should pass `wrapNumbers` to entityFromEntityProto', () => {
      const results = [{entity: {}}];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let entityFromEntityProtoStub: any;
      let wrapNumbers: boolean | IntegerTypeCastOptions | undefined;

      beforeEach(() => {
        entityFromEntityProtoStub = jest
          .spyOn(testEntity, 'entityFromEntityProto')
          .mockImplementation(() => ({}));
        jest.spyOn(testEntity, 'keyFromKeyProto').mockReturnValue({} as any);
      });

      afterEach(() => {
        entityFromEntityProtoStub.mockRestore();
      });

      it('should pass `wrapNumbers` to entityFromEntityProto as undefined by default', () => {
        testEntity.formatArray(results);
        wrapNumbers = entityFromEntityProtoStub.mock.calls[0][1];
        expect(wrapNumbers).toBe(undefined);
      });

      it('should pass `wrapNumbers` to entityFromEntityProto as boolean', () => {
        testEntity.formatArray(results, true);
        wrapNumbers = entityFromEntityProtoStub.mock.calls[0][1];
        expect(typeof wrapNumbers).toBe('boolean');
      });

      it('should pass `wrapNumbers` to entityFromEntityProto as IntegerTypeCastOptions', () => {
        const integerTypeCastOptions = {
          integerTypeCastFunction: () => {},
          properties: 'that',
        };

        testEntity.formatArray(results, integerTypeCastOptions);
        wrapNumbers = entityFromEntityProtoStub.mock.calls[0][1];
        expect(wrapNumbers).toBe(integerTypeCastOptions);
        expect(wrapNumbers).toEqual(integerTypeCastOptions);
      });
    });
  });

  describe('isKeyComplete', () => {
    it('should convert key to key proto', done => {
      const key = new testEntity.Key({
        path: ['Kind', 123],
      });

      testEntity.keyToKeyProto = (key_: {}) => {
        expect(key_).toBe(key);
        setImmediate(done);
        return key;
      };

      testEntity.isKeyComplete(key);
    });

    it('should return true if key has id', () => {
      const key = new testEntity.Key({
        path: ['Kind', 123],
      });

      expect(testEntity.isKeyComplete(key)).toBe(true);
    });

    it('should return true if key has name', () => {
      const key = new testEntity.Key({
        path: ['Kind', 'name'],
      });

      expect(testEntity.isKeyComplete(key)).toBe(true);
    });

    it('should return false if key does not have name or ID', () => {
      const key = new testEntity.Key({
        path: ['Kind'],
      });

      expect(testEntity.isKeyComplete(key)).toBe(false);
    });
  });

  describe('keyFromKeyProto', () => {
    const NAMESPACE = 'Namespace';

    const keyProto = {
      partitionId: {
        namespaceId: NAMESPACE,
        projectId: 'project-id',
      },
      path: [
        {
          idType: 'id',
          kind: 'Kind',
          id: '111',
        },
        {
          idType: 'name',
          kind: 'Kind2',
          name: 'name',
        },
      ],
    };

    it('should set the namespace', done => {
      testEntity.Key = class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(keyOptions: any) {
          expect(keyOptions.namespace).toBe(NAMESPACE);
          done();
        }
      };
      testEntity.keyFromKeyProto(keyProto);
    });

    it('should create a proper Key', done => {
      testEntity.Key = class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(keyOptions: any) {
          expect(keyOptions).toEqual({
            namespace: NAMESPACE,
            path: ['Kind', new testEntity.Int(111), 'Kind2', 'name'],
          });
          done();
        }
      };
      testEntity.keyFromKeyProto(keyProto);
    });

    it('should return the created Key', () => {
      const expectedValue = {};

      testEntity.Key = class {
        constructor() {
          return expectedValue;
        }
      };

      expect(testEntity.keyFromKeyProto(keyProto)).toBe(expectedValue);
    });

    it('should throw if path is invalid', done => {
      const keyProtoInvalid = {
        partitionId: {
          namespaceId: 'Namespace',
          projectId: 'project-id',
        },
        path: [
          {
            kind: 'Kind',
          },
          {
            kind: 'Kind2',
          },
        ],
      };

      try {
        testEntity.keyFromKeyProto(keyProtoInvalid);
      } catch (e) {
        expect((e as Error).name).toBe('InvalidKey');
        expect((e as Error).message).toBe('Ancestor keys require an id or name.');
        done();
      }
    });
  });

  describe('keyToKeyProto', () => {
    it('should handle hierarchical key definitions', () => {
      const key = new testEntity.Key({
        path: ['Kind1', 1, 'Kind2', 'name', 'Kind3', new testEntity.Int(3)],
      });

      const keyProto = testEntity.keyToKeyProto(key);

      expect(keyProto.partitionId).toBe(undefined);

      expect(keyProto.path[0].kind).toBe('Kind1');
      expect(keyProto.path[0].id).toBe(1);
      expect(keyProto.path[0].name).toBe(undefined);

      expect(keyProto.path[1].kind).toBe('Kind2');
      expect(keyProto.path[1].id).toBe(undefined);
      expect(keyProto.path[1].name).toBe('name');

      expect(keyProto.path[2].kind).toBe('Kind3');
      expect(keyProto.path[2].id).toBe(new testEntity.Int(3).value);
      expect(keyProto.path[2].name).toBe(undefined);
    });

    it('should detect the namespace of the hierarchical keys', () => {
      const key = new testEntity.Key({
        namespace: 'Namespace',
        path: ['Kind1', 1, 'Kind2', 'name'],
      });

      const keyProto = testEntity.keyToKeyProto(key);

      expect(keyProto.partitionId.namespaceId).toBe('Namespace');

      expect(keyProto.path[0].kind).toBe('Kind1');
      expect(keyProto.path[0].id).toBe(1);
      expect(keyProto.path[0].name).toBe(undefined);

      expect(keyProto.path[1].kind).toBe('Kind2');
      expect(keyProto.path[1].id).toBe(undefined);
      expect(keyProto.path[1].name).toBe('name');
    });

    it('should handle incomplete keys with & without namespaces', () => {
      const incompleteKey = new testEntity.Key({
        path: ['Kind'],
      });

      const incompleteKeyWithNs = new testEntity.Key({
        namespace: 'Namespace',
        path: ['Kind'],
      });

      const keyProto = testEntity.keyToKeyProto(incompleteKey);
      const keyProtoWithNs = testEntity.keyToKeyProto(incompleteKeyWithNs);

      expect(keyProto.partitionId).toBe(undefined);
      expect(keyProto.path[0].kind).toBe('Kind');
      expect(keyProto.path[0].id).toBe(undefined);
      expect(keyProto.path[0].name).toBe(undefined);

      expect(keyProtoWithNs.partitionId.namespaceId).toBe('Namespace');
      expect(keyProtoWithNs.path[0].kind).toBe('Kind');
      expect(keyProtoWithNs.path[0].id).toBe(undefined);
      expect(keyProtoWithNs.path[0].name).toBe(undefined);
    });

    it('should throw if key contains 0 items', done => {
      const key = new testEntity.Key({
        path: [],
      });

      try {
        testEntity.keyToKeyProto(key);
      } catch (e) {
        expect((e as Error).name).toBe('InvalidKey');
        expect((e as Error).message).toBe('A key should contain at least a kind.');
        done();
      }
    });

    it('should throw if key path contains null ids', done => {
      const key = new testEntity.Key({
        namespace: 'Namespace',
        path: ['Kind1', null, 'Company'],
      });

      try {
        testEntity.keyToKeyProto(key);
      } catch (e) {
        expect((e as Error).name).toBe('InvalidKey');
        expect((e as Error).message).toBe('Ancestor keys require an id or name.');
        done();
      }
    });

    it('should not throw if key is incomplete', () => {
      const key = new testEntity.Key({
        namespace: 'Namespace',
        path: ['Kind1', 123, 'Company', null],
      });

      expect(() => {
        testEntity.keyToKeyProto(key);
      }).not.toThrow();
    });
  });

  describe('queryToQueryProto', () => {
    const queryProto = {
      distinctOn: [
        {
          name: 'name',
        },
      ],
      kind: [
        {
          name: 'Kind1',
        },
      ],
      order: [
        {
          property: {
            name: 'name',
          },
          direction: 'ASCENDING',
        },
      ],
      projection: [
        {
          property: {
            name: 'name',
          },
        },
      ],
      endCursor: 'end',
      limit: {
        value: 1,
      },
      offset: 1,
      startCursor: 'start',
      filter: {
        compositeFilter: {
          filters: [
            {
              propertyFilter: {
                property: {
                  name: 'name',
                },
                op: 'EQUAL',
                value: {
                  stringValue: 'John',
                },
              },
            },
            {
              propertyFilter: {
                property: {
                  name: '__key__',
                },
                op: 'HAS_ANCESTOR',
                value: {
                  keyValue: {
                    path: [
                      {
                        kind: 'Kind2',
                        name: 'somename',
                      },
                    ],
                  },
                },
              },
            },
          ],
          op: 'AND',
        },
      },
    };

    it('should support all configurations of a query', () => {
      const ancestorKey = new entity.Key({
        path: ['Kind2', 'somename'],
      });

      const ds = new Datastore({projectId: 'project-id'});

      const query = ds
        .createQuery('Kind1')
        .filter(new PropertyFilter('name', '=', 'John'))
        .start('start')
        .end('end')
        .groupBy(['name'])
        .order('name')
        .select('name')
        .limit(1)
        .offset(1)
        .hasAncestor(ancestorKey);

      expect(testEntity.queryToQueryProto(query)).toEqual(queryProto);
    });

    it('should support using __key__ with array as value', () => {
      const keyWithInQuery = {
        distinctOn: [],
        filter: {
          compositeFilter: {
            filters: [
              {
                propertyFilter: {
                  op: 'IN',
                  property: {
                    name: '__key__',
                  },
                  value: {
                    arrayValue: {
                      values: [
                        {
                          keyValue: {
                            path: [
                              {
                                kind: 'Kind1',
                                name: 'key1',
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
            op: 'AND',
          },
        },
        kind: [
          {
            name: 'Kind1',
          },
        ],
        order: [],
        projection: [],
      };

      const ds = new Datastore({projectId: 'project-id'});

      const query = ds
        .createQuery('Kind1')
        .filter(
          new PropertyFilter('__key__', 'IN', [
            new entity.Key({path: ['Kind1', 'key1']}),
          ]),
        );

      expect(testEntity.queryToQueryProto(query)).toEqual(keyWithInQuery);
    });

    it('should support the filter method with Filter objects', () => {
      const ancestorKey = new entity.Key({
        path: ['Kind2', 'somename'],
      });

      const ds = new Datastore({projectId: 'project-id'});

      const query = ds
        .createQuery('Kind1')
        .filter(new PropertyFilter('name', '=', 'John'))
        .start('start')
        .end('end')
        .groupBy(['name'])
        .order('name')
        .select('name')
        .limit(1)
        .offset(1)
        .hasAncestor(ancestorKey);
      expect(testEntity.queryToQueryProto(query)).toEqual(queryProto);
    });

    it('should support the filter method with AND', () => {
      const ancestorKey = new entity.Key({
        path: ['Kind2', 'somename'],
      });

      const ds = new Datastore({projectId: 'project-id'});

      const query = ds
        .createQuery('Kind1')
        .filter(
          and([
            new PropertyFilter('name', '=', 'John'),
            new PropertyFilter('__key__', 'HAS_ANCESTOR', ancestorKey),
          ]),
        )
        .start('start')
        .end('end')
        .groupBy(['name'])
        .order('name')
        .select('name')
        .limit(1)
        .offset(1);
      const testFilters = queryProto.filter;
      const computedFilters =
        testEntity.queryToQueryProto(query).filter.compositeFilter.filters[0];
      expect(computedFilters).toEqual(testFilters);
    });

    it('should handle buffer start and end values', () => {
      const ds = new Datastore({projectId: 'project-id'});
      const startVal = Buffer.from('start');
      const endVal = Buffer.from('end');

      const query = ds.createQuery('Kind1').start(startVal).end(endVal);

      const queryProto = testEntity.queryToQueryProto(query);
      expect(queryProto.endCursor).toBe(endVal);
      expect(queryProto.startCursor).toBe(startVal);
    });
  });

  describe('UrlSafeKey', () => {
    const PROJECT_ID = 'grass-clump-479';
    const LOCATION_PREFIX = 's~';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let urlSafeKey: any;

    beforeEach(() => {
      urlSafeKey = new testEntity.URLSafeKey();
    });

    describe('convertToBase64_', () => {
      it('should convert buffer to base64 and cleanup', () => {
        const buffer = Buffer.from('Hello World');

        expect(urlSafeKey.convertToBase64_(buffer)).toBe('SGVsbG8gV29ybGQ');
      });
    });

    describe('convertToBuffer_', () => {
      it('should convert encoded url safe key to buffer', () => {
        expect(urlSafeKey.convertToBuffer_('aGVsbG8gd29ybGQgZnJvbSBkYXRhc3RvcmU')).toEqual(Buffer.from('hello world from datastore'));
      });
    });

    describe('legacyEncode', () => {
      it('should encode with namespace', () => {
        const kind = 'Task';
        const name = 'sampletask1';
        const key = new testEntity.Key({
          namespace: 'NS',
          path: [kind, name],
        });

        const encodedKey =
          'ahFzfmdyYXNzLWNsdW1wLTQ3OXIVCxIEVGFzayILc2FtcGxldGFzazEMogECTlM';
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key, LOCATION_PREFIX)).toBe(encodedKey);
      });

      it('should encode key with single path element string string type', () => {
        const kind = 'Task';
        const name = 'sampletask1';
        const key = new testEntity.Key({
          path: [kind, name],
        });

        const encodedKey =
          'ag9ncmFzcy1jbHVtcC00NzlyFQsSBFRhc2siC3NhbXBsZXRhc2sxDA';
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key)).toBe(encodedKey);
      });

      it('should encode key with single path element long int type', () => {
        const kind = 'Task';
        const id = 5754248394440704;
        const key = new testEntity.Key({
          path: [kind, id],
        });

        const encodedKey = 'ag9ncmFzcy1jbHVtcC00NzlyEQsSBFRhc2sYgICA3NWunAoM';
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key)).toBe(encodedKey);
      });

      it('should encode key with single path element entity int type', () => {
        const kind = 'Task';
        const id = new testEntity.Int('5754248394440704');
        const key = new testEntity.Key({
          path: [kind, id],
        });

        const encodedKey = 'ag9ncmFzcy1jbHVtcC00NzlyEQsSBFRhc2sYgICA3NWunAoM';
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key)).toBe(encodedKey);
      });

      it('should encode key with parent', () => {
        const key = new testEntity.Key({
          path: ['Task', 'sampletask1', 'Task', 'sampletask2'],
        });

        const encodedKey =
          'ahFzfmdyYXNzLWNsdW1wLTQ3OXIqCxIEVGFzayILc2FtcGxldGFzazEMCxIEVGFzayILc2FtcGxldGFzazIM';
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key, LOCATION_PREFIX)).toBe(encodedKey);
      });
    });

    describe('legacyDecode', () => {
      it('should decode key with namespace', () => {
        const encodedKey =
          'ahFzfmdyYXNzLWNsdW1wLTQ3OXIVCxIEVGFzayILc2FtcGxldGFzazEMogECTlM';
        const key = urlSafeKey.legacyDecode(encodedKey);
        expect(key.namespace).toBe('NS');
        expect(key.path).toEqual(['Task', 'sampletask1']);
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key, LOCATION_PREFIX)).toBe(encodedKey);
      });

      it('should decode key with single path element string type', () => {
        const encodedKey =
          'ag9ncmFzcy1jbHVtcC00NzlyFQsSBFRhc2siC3NhbXBsZXRhc2sxDA';
        const key = urlSafeKey.legacyDecode(encodedKey);
        expect(key.namespace).toBe(undefined);
        expect(key.path).toEqual(['Task', 'sampletask1']);
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key)).toBe(encodedKey);
      });

      it('should decode key with single path element long int type', () => {
        const encodedKey =
          'ahFzfmdyYXNzLWNsdW1wLTQ3OXIRCxIEVGFzaxiAgIDc1a6cCgw';
        const key = urlSafeKey.legacyDecode(encodedKey);
        expect(key.namespace).toBe(undefined);
        expect(key.path).toEqual(['Task', '5754248394440704']);
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key, LOCATION_PREFIX)).toBe(encodedKey);
      });

      it('should decode key with parent path', () => {
        const encodedKey =
          'ahFzfmdyYXNzLWNsdW1wLTQ3OXIqCxIEVGFzayILc2FtcGxldGFzazEMCxIEVGFzayILc2FtcGxldGFzazIM';
        const key = urlSafeKey.legacyDecode(encodedKey);
        expect(key.namespace).toBe(undefined);
        expect(key.path).toEqual([
          'Task',
          'sampletask1',
          'Task',
          'sampletask2',
        ]);
        expect(key.parent!.name).toBe('sampletask1');
        expect(key.parent!.path).toEqual(['Task', 'sampletask1']);
        expect(urlSafeKey.legacyEncode(PROJECT_ID, key, LOCATION_PREFIX)).toBe(encodedKey);
      });

      describe('should ensure that decode inverses encode and decoding is correct', () => {
        const TEST_PROJECT = 'test-project';
        const testCases = [
          {name: 'numeric ID', path: ['Kind', '123']},
          {name: 'string name with spaces', path: ['Kind', 'name with spaces']},
          {name: 'special characters', path: ['Kind', 'special!@#$%^&*()']},
          {
            name: '3-level parent',
            path: ['Grandparent', '1', 'Parent', 'p1', 'Child', '2'],
          },
          {
            name: 'namespace and numeric ID',
            path: ['Kind', '456'],
            namespace: 'MyNS',
          },
          {
            name: 'namespace and parent',
            path: ['Parent', '1', 'Child', 'c1'],
            namespace: 'MyNS',
          },
          {
            name: 'long integer ID as string',
            path: ['Kind', '9223372036854775807'],
          },
          {name: 'kind with hyphens', path: ['My-Kind', '1']},
          {
            name: 'different kinds in path',
            path: ['User', 'user1', 'Post', '100', 'Comment', 'c1'],
          },
          {
            name: 'same kinds in path',
            path: ['Node', '1', 'Node', '2', 'Node', '3'],
          },
        ];

        testCases.forEach(tc => {
          it(`should decode and re-encode ${tc.name} correctly`, () => {
            const key = new testEntity.Key({
              path: tc.path,
              namespace: tc.namespace,
            });
            const encoded = urlSafeKey.legacyEncode(
              TEST_PROJECT,
              key,
              LOCATION_PREFIX,
            );
            const decoded = urlSafeKey.legacyDecode(encoded);
            expect(decoded.namespace).toBe(tc.namespace);
            expect(decoded.path).toEqual(tc.path);
            const reEncoded = urlSafeKey.legacyEncode(
              TEST_PROJECT,
              decoded,
              LOCATION_PREFIX,
            );
            expect(reEncoded).toBe(encoded);
          });
        });
      });
    });
  });
});
