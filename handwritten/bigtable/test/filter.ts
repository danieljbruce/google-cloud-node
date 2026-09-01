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

const FakeMutation = {
  convertToBytes: jest.fn(value => value),
  createTimeRange: jest.fn(),
};

jest.mock('../src/mutation', () => ({
  Mutation: FakeMutation,
}));

import * as fr from '../src/filter';
import {Filter, FilterError} from '../src/filter';
import {Row} from '../src/row';

describe('Bigtable/Filter', () => {
      let filter: fr.Filter;

  
  beforeEach(() => {
    filter = new Filter();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should create an empty array of filters', () => {
      expect(filter.filters_).toEqual([]);
    });
  });

  describe('convertToRegExpString', () => {
    it('should convert a RegExp to a string', () => {
      const str = Filter.convertToRegExpString(/\d+/);
      expect(str).toBe('\\d+');
    });

    it('should convert an Array of strings to a single string', () => {
      const things = ['a', 'b', 'c'];
      const str = Filter.convertToRegExpString(things);
      expect(str).toBe('(a|b|c)');
    });

    it('should convert an Array of buffers to a single string', () => {
      const faces = [Buffer.from('.|.'), Buffer.from('=|=')];
      const str = Filter.convertToRegExpString(faces);
      expect(str).toBe('(\\.\\|\\.|=\\|=)');
    });

    it('should not do anything to a string', () => {
      const str1 = 'hello';
      const str2 = Filter.convertToRegExpString(str1);
      expect(str1).toBe(str2);
    });

    it('should convert a number to a string', () => {
      const str = Filter.convertToRegExpString(1);
      expect(str).toBe('1');
    });

    it('should not do anything to a buffer', () => {
      const str1 = 'hello';
      const buffer = Buffer.from(str1);
      const str2 = Filter.convertToRegExpString(buffer);
      expect(buffer).toEqual(str2);
    });

    it('should use a binary encoding on a non utf8 buffer', () => {
      const str1 = 'æ';
      const buffer = Buffer.from('æ', 'binary');
      const str2 = Filter.convertToRegExpString(buffer).toString('binary');
      expect(str1).toBe(str2);
    });

    it('should throw an error for unknown types', () => {
      const errorReg = /Can't convert to RegExp String from unknown type\./;
      expect(() => { Filter.convertToRegExpString(true as {} as string); }).toThrow(errorReg);
    });
  });

  describe('createRange', () => {
    it('should create a range object', () => {
      const start = 'a' as fr.BoundData;
      const end = 'b' as fr.BoundData;
      const key = 'Key';
      const range = Filter.createRange(start, end, key);
      expect(range).toEqual({
        startKeyClosed: start,
        endKeyClosed: end,
      });
    });

    it('should only create start bound', () => {
      const start = 'a' as fr.BoundData;
      const key = 'Key';
      const range = Filter.createRange(start, null, key);
      expect(FakeMutation.convertToBytes).toHaveBeenCalledWith(start);
      expect(range).toEqual({
        startKeyClosed: start,
      });
    });

    it('should only create an end bound', () => {
      const end = 'b' as fr.BoundData;
      const key = 'Key';
      const range = Filter.createRange(null, end, key);
      expect(FakeMutation.convertToBytes).toHaveBeenCalledWith(end);
      expect(range).toEqual({
        endKeyClosed: end,
      });
    });

    it('should optionally accept inclusive flags', () => {
      const start = {
        value: 'a',
        inclusive: false,
      };

      const end = {
        value: 'b',
        inclusive: false,
      };

      const key = 'Key';

      const range = Filter.createRange(start, end, key);

      expect(range).toEqual({
        startKeyOpen: start.value,
        endKeyOpen: end.value,
      });
    });
  });

  describe('parse', () => {
    it('should call each individual filter method', () => {
      jest.spyOn(Filter.prototype, 'row');
      jest.spyOn(Filter.prototype, 'value');
      const fakeFilter = [
        {
          row: 'a',
        },
        {
          value: 'b',
        },
      ];
      Filter.parse(fakeFilter);
      expect(Filter.prototype.row).toHaveBeenCalledTimes(1);
      expect(Filter.prototype.row).toHaveBeenCalledWith('a');
      expect(Filter.prototype.value).toHaveBeenCalledTimes(1);
      expect(Filter.prototype.value).toHaveBeenCalledWith('b');
    });

    it('should throw an error for unknown filters', () => {
      const fakeFilter = [
        {
          wat: 'a',
        },
      ];

      expect(() => { Filter.parse(fakeFilter); }).toThrow(FilterError);
    });

    it('should return the filter in JSON form', () => {
      const fakeProto = {a: 'a'};
      const fakeFilter = [
        {
          column: 'a',
        },
      ];
      const stub = jest.spyOn(Filter.prototype, 'toProto').mockReturnValue(fakeProto as any);
      const parsedFilter = Filter.parse(fakeFilter);
      expect(parsedFilter).toBe(fakeProto);
      expect(Filter.prototype.toProto).toHaveBeenCalledTimes(1);
      stub.mockRestore();
    });
  });

  describe('all', () => {
    it('should create a pass all filter when set to true', done => {
      filter.set = (filterName, value) => {
        expect(filterName).toBe('passAllFilter');
        expect(value).toBe(true);
        done();
      };

      filter.all(true);
    });

    it('should create a block all filter when set to false', done => {
      filter.set = (filterName, value) => {
        expect(filterName).toBe('blockAllFilter');
        expect(value).toBe(true);
        done();
      };

      filter.all(false);
    });
  });

  describe('column', () => {
    it('should set the column qualifier regex filter', done => {
      const column = {
        name: 'fake-column',
      };

      const spy = jest.spyOn(Filter, 'convertToRegExpString').mockImplementation(((x: any) => x) as any);

      filter.set = (filterName, value) => {
        expect(filterName).toBe('columnQualifierRegexFilter');
        expect(value).toBe(column.name);
        expect(spy).toHaveBeenCalledWith(column.name);
        expect(FakeMutation.convertToBytes).toHaveBeenCalledWith(column.name);
        
        done();
      };

      filter.column(column);
    });

    it('should handle a binary encoded buffer regex filter', done => {
      const column = {
        name: Buffer.from('æ', 'binary'),
      };

      filter.set = (filterName, value) => {
        expect(filterName).toBe('columnQualifierRegexFilter');
        expect(value).toEqual(column.name);
        expect(FakeMutation.convertToBytes).toHaveBeenCalledWith(column.name);
        done();
      };

      filter.column(column);
    });

    it('should accept the short-hand version of column', done => {
      const column = 'fake-column';

      filter.set = (filterName, value) => {
        expect(filterName).toBe('columnQualifierRegexFilter');
        expect(value).toBe(column);
        done();
      };

      filter.column(column);
    });

    it('should accept the cells per column limit filter', done => {
      const column = {
        cellLimit: 10,
      };

      filter.set = (filterName, value) => {
        expect(filterName).toBe('cellsPerColumnLimitFilter');
        expect(value).toBe(column.cellLimit);
        done();
      };

      filter.column(column);
    });

    it('should accept the column range filter', done => {
      const fakeRange = {
        a: 'a',
        b: 'b',
      };
      const column = {
        start: 'a' as fr.BoundData,
        end: 'b' as fr.BoundData,
      };
      const spy = jest.spyOn(Filter, 'createRange').mockReturnValue(fakeRange as any);
      filter.set = (filterName, value) => {
        expect(filterName).toBe('columnRangeFilter');
        expect(value).toBe(fakeRange);
        expect(spy).toHaveBeenCalledWith(column.start, column.end, 'Qualifier');
        
        done();
      };
      filter.column(column);
    });
  });

  describe('condition', () => {
    it('should create a condition filter', done => {
      const condition = {
        test: {a: 'a'},
        pass: {b: 'b'},
        fail: {c: 'c'},
      };
      const spy = jest.spyOn(Filter, 'parse').mockImplementation(((x: any) => x) as any);
      filter.set = (filterName, value) => {
        expect(filterName).toBe('condition');
        expect(value).toEqual({
          predicateFilter: condition.test,
          trueFilter: condition.pass,
          falseFilter: condition.fail,
        });
        expect((spy as jest.Mock).mock.calls[0][0]).toBe(condition.test);
        expect((spy as jest.Mock).mock.calls[1][0]).toBe(condition.pass);
        expect((spy as jest.Mock).mock.calls[2][0]).toBe(condition.fail);
        
        done();
      };
      filter.condition(condition);
    });
  });

  describe('family', () => {
    it('should create a family name regex filter', done => {
      const familyName = 'fake-family';
      const spy = jest.spyOn(Filter, 'convertToRegExpString').mockImplementation(((x: any) => x) as any);
      filter.set = (filterName, value) => {
        expect(filterName).toBe('familyNameRegexFilter');
        expect(value).toBe(familyName);
        expect(spy).toHaveBeenCalledWith(familyName);
        
        done();
      };
      filter.family(familyName);
    });
  });

  describe('interleave', () => {
    it('should create an interleave filter', done => {
      const fakeFilters = [{}, {}, {}];

      const spy = jest.spyOn(Filter, 'parse').mockImplementation(((x: any) => x) as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter.set = (filterName, value: any) => {
        expect(filterName).toBe('interleave');
        expect(value.filters[0]).toBe(fakeFilters[0]);
        expect(value.filters[1]).toBe(fakeFilters[1]);
        expect(value.filters[2]).toBe(fakeFilters[2]);
        expect((spy as jest.Mock).mock.calls[0][0]).toBe(fakeFilters[0]);
        expect((spy as jest.Mock).mock.calls[1][0]).toBe(fakeFilters[1]);
        expect((spy as jest.Mock).mock.calls[2][0]).toBe(fakeFilters[2]);
        
        done();
      };

      filter.interleave(fakeFilters);
    });
  });

  describe('label', () => {
    it('should apply the label transformer', done => {
      const label = 'label';

      filter.set = (filterName, value) => {
        expect(filterName).toBe('applyLabelTransformer');
        expect(value).toBe(label);
        done();
      };

      filter.label(label);
    });
  });

  describe('row', () => {
    it('should apply the row key regex filter', done => {
      const row = {
        key: 'gwashinton',
      };
      const convertedKey = 'abcd';

      const spy = jest.spyOn(Filter, 'convertToRegExpString').mockReturnValue(convertedKey as any);

      filter.set = (filterName, value) => {
        expect(filterName).toBe('rowKeyRegexFilter');
        expect(value).toBe(convertedKey);
        expect(spy).toHaveBeenCalledWith(row.key);
        expect(FakeMutation.convertToBytes).toHaveBeenCalledWith(convertedKey);
        
        done();
      };

      filter.row(row);
    });

    it('should accept the short-hand version of row key', done => {
      const rowKey = 'gwashington';
      filter.set = (filterName, value) => {
        expect(filterName).toBe('rowKeyRegexFilter');
        expect(value).toBe(rowKey);
        done();
      };
      filter.row(rowKey);
    });

    it('should set the row sample filter', done => {
      const row = {
        sample: 10,
      };
      filter.set = (filterName, value) => {
        expect(filterName).toBe('rowSampleFilter');
        expect(value).toBe(row.sample);
        done();
      };
      filter.row(row as {} as Row);
    });

    it('should set the cells per row offset filter', done => {
      const row = {
        cellOffset: 10,
      };
      filter.set = (filterName, value) => {
        expect(filterName).toBe('cellsPerRowOffsetFilter');
        expect(value).toBe(row.cellOffset);
        done();
      };
      filter.row(row);
    });

    it('should set the cells per row limit filter', done => {
      const row = {
        cellLimit: 10,
      };
      filter.set = (filterName, value) => {
        expect(filterName).toBe('cellsPerRowLimitFilter');
        expect(value).toBe(row.cellLimit);
        done();
      };
      filter.row(row);
    });
  });

  describe('set', () => {
    it('should create a filter object', () => {
      const key = 'notARealFilter';
      const value = {a: 'b'};
      filter.set(key, value);
      expect(filter.filters_[0][key]).toBe(value);
    });
  });

  describe('sink', () => {
    it('should set the sink filter', done => {
      const sink = true;
      filter.set = (filterName, value) => {
        expect(filterName).toBe('sink');
        expect(value).toBe(sink);
        done();
      };
      filter.sink(sink);
    });
  });

  describe('time', () => {
    it('should set the timestamp range filter', done => {
      const fakeTimeRange = {
        start: 10,
        end: 10,
      };
      const spy = FakeMutation.createTimeRange.mockReturnValue(fakeTimeRange as any);
      filter.set = (filterName, value) => {
        expect(filterName).toBe('timestampRangeFilter');
        expect(value).toBe(fakeTimeRange);
        expect(spy).toHaveBeenCalledWith(fakeTimeRange.start, fakeTimeRange.end);
        done();
      };
      filter.time(fakeTimeRange);
    });
  });

  describe('toProto', () => {
    it('should return null when no filters are present', () => {
      const filter = new Filter();
      const filterProto = filter.toProto();
      expect(filterProto).toBe(null);
    });

    it('should return a plain filter if there is only 1', () => {
      filter.filters_ = [{}];
      const filterProto = filter.toProto();
      expect(filterProto).toBe(filter.filters_[0]);
    });

    it('should create a chain filter if there are multiple', () => {
      filter.filters_ = [{}, {}];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filterProto = filter.toProto() as any;
      expect(filterProto!.chain.filters).toBe(filter.filters_);
    });
  });

  describe('value', () => {
    it('should set the value regex filter', done => {
      const value = {
        value: 'fake-value',
      };
      const fakeRegExValue = 'abcd';
      const fakeConvertedValue = 'dcba';

      const regSpy = jest.spyOn(Filter, 'convertToRegExpString').mockReturnValue(fakeRegExValue as any);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bytesSpy = ((FakeMutation as any).convertToBytes = jest.fn(
        () => {
          return fakeConvertedValue;
        },
      ));

      filter.set = (filterName, val) => {
        expect(filterName).toBe('valueRegexFilter');
        expect(fakeConvertedValue).toBe(val);
        expect(regSpy).toHaveBeenCalledWith(value.value);
        expect(bytesSpy).toHaveBeenCalledWith(fakeRegExValue);
        
        done();
      };

      filter.value(value);
    });

    it('should accept the short-hand version of value', done => {
      const value = 'fake-value';

      const fakeRegExValue = 'abcd';
      const fakeConvertedValue = 'dcba';

      const regSpy = jest.spyOn(Filter, 'convertToRegExpString').mockReturnValue(fakeRegExValue as any);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bytesSpy = ((FakeMutation.convertToBytes as any) = jest.fn(
        () => {
          return fakeConvertedValue;
        },
      ));

      filter.set = (filterName, val) => {
        expect(filterName).toBe('valueRegexFilter');
        expect(fakeConvertedValue).toBe(val);
        expect(regSpy).toHaveBeenCalledWith(value);
        expect(bytesSpy).toHaveBeenCalledWith(fakeRegExValue);
        
        done();
      };

      filter.value(value);
    });

    it('should accept the value range filter', done => {
      const fakeRange = {
        a: 'a',
        b: 'b',
      };
      const value = {
        start: 'a' as fr.BoundData,
        end: 'b' as fr.BoundData,
      };
      const spy = jest.spyOn(Filter, 'createRange').mockReturnValue(fakeRange as any);
      filter.set = (filterName, val) => {
        expect(filterName).toBe('valueRangeFilter');
        expect(val).toBe(fakeRange);
        expect(spy).toHaveBeenCalledWith(value.start, value.end, 'Value');
        
        done();
      };
      filter.value(value);
    });

    it('should apply the strip label transformer', done => {
      const value = {
        strip: true,
      };
      filter.set = (filterName, val) => {
        expect(filterName).toBe('stripValueTransformer');
        expect(val).toBe(value.strip);
        done();
      };
      filter.value(value);
    });
  });

  describe('FilterError', () => {
    it('should set the correct message', () => {
      const err = new FilterError('test');
      expect(err.message).toBe('Unknown filter: test.');
    });

    it('should set the correct name', () => {
      const err = new FilterError('test');

      expect(err.name).toBe('FilterError');
    });
  });
});
