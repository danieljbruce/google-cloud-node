// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {EncodedKeyMap, SqlValue} from '../src/execute-query/values.js';

describe('Bigtable/EncodedKeyMap', () => {
  describe('map tests', () => {
    it('test constructor', () => {
      const bufferKey = Buffer.from('exampleKey');
      const entries: [string | Buffer, string][] = [
        [bufferKey, 'valueForBufferKey'],
        ['stringKey', 'valueForStringKey'],
      ];

      const map = new EncodedKeyMap(entries);
      // get works with the same object
      expect(map.get(bufferKey)).toEqual('valueForBufferKey');
      // get works with a new object
      expect(map.get(Buffer.from('exampleKey'))).toEqual('valueForBufferKey');
      // get works with a regular string
      expect(map.get('stringKey')).toEqual('valueForStringKey');
    });
    it('test duplicate keys', () => {
      const bufferKey1 = Buffer.from('exampleKey');
      const bufferKey2 = Buffer.from('exampleKey');
      const bufferKey3 = Buffer.from('exampleKey');
      const entries: [string | Buffer, string][] = [
        [bufferKey1, 'valueForBufferKey1'],
        ['stringKey', 'valueForStringKey1'],
        [bufferKey2, 'valueForBufferKey2'],
        ['stringKey', 'valueForStringKey2'],
      ];

      const map = new EncodedKeyMap(entries);
      // get works with the same object
      expect(map.get(bufferKey1)).toEqual('valueForBufferKey2');
      expect(map.get(bufferKey2)).toEqual('valueForBufferKey2');
      // get works with a new object
      expect(map.get(Buffer.from('exampleKey'))).toEqual('valueForBufferKey2');
      // get works with a regular string
      expect(map.get('stringKey')).toEqual('valueForStringKey2');

      // check that old value is replaced
      map.set(bufferKey3, 'valueForBufferKey3');
      expect(map.get(Buffer.from('exampleKey'))).toEqual('valueForBufferKey3');
      map.set('stringKey', 'valueForStringKey3');
      expect(map.get('stringKey')).toEqual('valueForStringKey3');
    });
    it('test get/set', () => {
      const bufferKey = Buffer.from('exampleKey');
      const map = new EncodedKeyMap();
      map.set(bufferKey, 'valueForBufferKey');
      map.set('stringKey', 'valueForStringKey');
      // get works with the same object
      expect(map.get(bufferKey)).toEqual('valueForBufferKey');
      // get works with a new object
      expect(map.get(Buffer.from('exampleKey'))).toEqual('valueForBufferKey');
      // get works with a regular string
      expect(map.get('stringKey')).toEqual('valueForStringKey');
    });
    it('test null vs empty bytes', () => {
      const entries: [string | Buffer | null, string][] = [
        [null, 'valueForNull'],
        ['', 'valueForEmptyString'],
      ];

      // TS normally would not permit a null key, thus we pass entries as any
      const map = new EncodedKeyMap(entries as any);
      // get works with the same object
      expect(map.get('')).toEqual('valueForEmptyString');
      // get works with a regular string
      expect(map.get(null as any)).toEqual('valueForNull');
    });
    it('test null vs empty bytes', () => {
      const entries: [string | Buffer | null, string][] = [
        [null, 'valueForNull'],
        [Buffer.from(''), 'valueForEmptyBuffer'],
      ];

      // TS normally would not permit a null key, thus we pass entries as any
      const map = new EncodedKeyMap(entries as any);
      // get works with the same object
      expect(map.get(Buffer.from(''))).toEqual('valueForEmptyBuffer');
      // get works with a regular string
      expect(map.get(null as any)).toEqual('valueForNull');
    });
    it('map builtin functions', () => {
      const entries: [string | Buffer | null, string][] = [
        [Buffer.from('Buffer1'), 'valueForBuffer1'],
        ['stringKey1', 'valueForString1'],
      ];

      // TS normally would not permit a null key, thus we pass entries as any
      const map = new EncodedKeyMap(entries as any);

      // get works with a buffer
      expect(map.get(Buffer.from('Buffer1'))).toEqual('valueForBuffer1');
      // get works with a regular string
      expect(map.get('stringKey1')).toEqual('valueForString1');

      // delete, set, has, size

      map.set(Buffer.from('Buffer2'), 'valueForBuffer2');
      map.set('stringKey2', 'valueForString2');

      expect(map.size).toEqual(4);

      expect(map.get(Buffer.from('Buffer2'))).toEqual('valueForBuffer2');
      expect(map.get('stringKey2')).toEqual('valueForString2');

      expect(map.has('stringKey2')).toBe(true);
      expect(map.has(Buffer.from('Buffer2'))).toBe(true);

      map.delete('stringKey2');
      map.delete(Buffer.from('Buffer2'));

      expect(map.has('stringKey2')).toBe(false);
      expect(map.has(Buffer.from('Buffer2'))).toBe(false);

      expect(map.size).toEqual(2);

      // iterators

      const keys = [...map.keys()];
      expect(keys[0]?.toString()).toEqual('Buffer1');
      expect(keys[0] instanceof Buffer).toBe(true);
      expect(keys[1]).toEqual('stringKey1');

      const values = [...map.values()];
      expect(values[0]).toEqual('valueForBuffer1');
      expect(values[1]).toEqual('valueForString1');

      const resultForEach: [string | bigint | Uint8Array | null, SqlValue][] =
        [];
      map.forEach((value, key) => {
        resultForEach.push([key, value]);
      });

      expect(resultForEach[0][0]?.toString()).toEqual('Buffer1');
      expect(resultForEach[0][0] instanceof Buffer).toBe(true);
      expect(resultForEach[0][1]).toEqual('valueForBuffer1');
      expect(resultForEach[1][0]).toEqual('stringKey1');
      expect(resultForEach[1][1]).toEqual('valueForString1');
    });
  });
});
