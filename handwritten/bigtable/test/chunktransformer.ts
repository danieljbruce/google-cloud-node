// Copyright 2018 Google LLC
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
import {ChunkTransformer as RealChunkTransformer, RowStateEnum} from '../src/chunktransformer';
import {Mutation} from '../src/mutation';
import {Row} from '../src/row';

const ROW_ID = 'my-row';
const CONVERTED_ROW_ID = 'my-converted-row';

jest.mock('../src/mutation', () => {
  const actual = jest.requireActual('../src/mutation');
  return {
    ...actual,
    Mutation: {
      ...actual.Mutation,
      convertToBytes: jest.fn((value: any) => {
        if (value === 'my-row') {
          return 'my-converted-row';
        }
        return value;
      }),
      convertFromBytes: jest.fn((value: any) => value),
    },
  };
});

const ChunkTransformer: any = RealChunkTransformer;

describe('Bigtable/ChunkTransformer', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chunkTransformer: any;
  let rows: Row[];
    beforeEach(() => {
    chunkTransformer = new ChunkTransformer();
    rows = [];
    chunkTransformer.push = (row: Row) => {
      rows.push(row);
    };
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe('instantiation', () => {
    it('should have initial state', () => {
      expect(chunkTransformer instanceof ChunkTransformer).toBeTruthy();
      //chunkTransformer.lastRowKey = '';
      //chunkTransformer.family = {};
      //chunkTransformer.qualifiers = [];
      //chunkTransformer.qualifier = {};
      //chunkTransformer.row = {};
      //chunkTransformer.state = RowStateEnum.NEW_ROW;
      expect(chunkTransformer.row).toEqual({});
      expect(chunkTransformer.lastRowKey).toEqual(undefined);
      expect(chunkTransformer.family).toEqual({});
      expect(chunkTransformer.qualifiers).toEqual([]);
      expect(chunkTransformer.qualifier).toEqual({});
      expect(chunkTransformer.state).toEqual(RowStateEnum.NEW_ROW);
    });
  });
  describe('processNewRow', () => {
    let processNewRowSpy: any;
    let resetSpy: any;
    let commitSpy: any;
    let destroySpy: any;
    beforeEach(() => {
      processNewRowSpy = jest.spyOn(chunkTransformer, 'processNewRow');
      resetSpy = jest.spyOn(chunkTransformer, 'reset');
      commitSpy = jest.spyOn(chunkTransformer, 'commit');
      destroySpy = jest.spyOn(chunkTransformer, 'destroy');
    });
    it('should destroy when row key is defined ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      chunkTransformer.row = {key: 'abc'};
      processNewRowSpy.call(chunkTransformer, {});
    });
    it('should destroy when chunk key is undefined ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processNewRowSpy.call(chunkTransformer, {});
    });
    it('should destroy when resetRow is true ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processNewRowSpy.call(chunkTransformer, {
        rowKey: 'key',
        resetRow: true,
      });
    });
    it('should destroy when resetRow ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processNewRowSpy.call(chunkTransformer, {resetRow: true});
    });
    it('should destroy when row key is equal to previous row key ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      chunkTransformer.lastRowKey = 'key';

      processNewRowSpy.call(chunkTransformer, {
        rowKey: 'key',
        resetRow: false,
      });
    });
    it('should destroy when family name is undefined ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processNewRowSpy.call(chunkTransformer, {rowKey: 'key'});
    });
    it('should destroy when qualifier is undefined ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processNewRowSpy.call(chunkTransformer, {
        rowKey: 'key',
        familyName: 'family',
      });
    });
    it('should destroy when valueSize>0 and commitRow=true ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processNewRowSpy.call(chunkTransformer, {
        rowKey: 'key',
        familyName: 'family',
        qualifier: 'qualifier',
        valueSize: 10,
        commitRow: true,
      });
    });
    it('should commit 1 row ', () => {
      const chunk = {
        rowKey: 'key',
        familyName: {value: 'family'},
        qualifier: {value: 'qualifier'},
        valueSize: 0,
        timestampMicros: 0,
        labels: [],
        commitRow: true,
        value: 'value',
      };
      chunkTransformer.processNewRow(chunk);
      expect(resetSpy).toHaveBeenCalled();
      expect(commitSpy).toHaveBeenCalled();
      expect(chunkTransformer.lastRowKey).toBe(chunk.rowKey);
      const expectedRow = {
        key: chunk.rowKey,
        data: {
          family: {
            qualifier: [
              {
                value: chunk.value,
                timestamp: chunk.timestampMicros,
                labels: chunk.labels,
              },
            ],
          },
        },
      };
      expect(rows[0]).toEqual(expectedRow);
    });
    it('partial row  ', () => {
      const chunk = {
        rowKey: 'key',
        familyName: {value: 'family'},
        qualifier: {value: 'qualifier'},
        valueSize: 0,
        timestampMicros: 0,
        labels: [],
        commitRow: false,
        value: 'value',
      };
      chunkTransformer.processNewRow(chunk);
      expect(resetSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      const partialRow = {
        key: chunk.rowKey,
        data: {
          family: {
            qualifier: [
              {
                value: chunk.value,
                timestamp: chunk.timestampMicros,
                labels: chunk.labels,
              },
            ],
          },
        },
      };
      expect(chunkTransformer.row).toEqual(partialRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.ROW_IN_PROGRESS);
    });
    it('partial cell  ', () => {
      const chunk = {
        rowKey: 'key',
        familyName: {value: 'family'},
        qualifier: {value: 'qualifier'},
        valueSize: 10,
        timestampMicros: 0,
        labels: [],
        commitRow: false,
        value: 'value',
      };
      chunkTransformer.processNewRow(chunk);
      expect(resetSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      const partialRow = {
        key: chunk.rowKey,
        data: {
          family: {
            qualifier: [
              {
                value: chunk.value,
                timestamp: chunk.timestampMicros,
                labels: chunk.labels,
              },
            ],
          },
        },
      };
      expect(chunkTransformer.row).toEqual(partialRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.CELL_IN_PROGRESS);
    });
  });
  describe('processRowInProgress', () => {
    let processRowInProgressSpy: any;
    let resetSpy: any;
    let commitSpy: any;
    let destroySpy: any;
    beforeEach(() => {
      processRowInProgressSpy = jest.spyOn(chunkTransformer, 'processRowInProgress');
      resetSpy = jest.spyOn(chunkTransformer, 'reset');
      commitSpy = jest.spyOn(chunkTransformer, 'commit');
      destroySpy = jest.spyOn(chunkTransformer, 'destroy');
    });
    it('should destroy when resetRow and rowkey', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processRowInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        rowKey: 'key',
      });
    });
    it('should destroy when resetRow and familyName', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processRowInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        familyName: 'family',
      });
    });
    it('should destroy when resetRow and qualifier', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processRowInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        qualifier: 'qualifier',
      });
    });
    it('should destroy when resetRow and value', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processRowInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        value: 'value',
      });
    });
    it('should destroy when resetRow and timestampMicros', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processRowInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        timestampMicros: 10,
      });
    });
    it('should destroy when rowKey not equal to lastRowKey', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      chunkTransformer.row = {key: 'key1'};
      processRowInProgressSpy.call(chunkTransformer, {rowKey: 'key'});
    });
    it('should destroy when valueSize>0 and commitRow=true ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processRowInProgressSpy.call(chunkTransformer, {
        valueSize: 10,
        commitRow: true,
      });
    });
    it('should destroy when familyName without qualifier ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      chunkTransformer.row = { data: {} };
      processRowInProgressSpy.call(chunkTransformer, {
        familyName: { value: 'family' },
      });
    });
    it('should reset on resetRow ', () => {
      const chunk = {resetRow: true};
      chunkTransformer.processRowInProgress(chunk);
      expect(resetSpy).toHaveBeenCalled();
      expect(rows.length).toBe(0);
      expect(commitSpy).not.toHaveBeenCalled();
    });
    it('bare commitRow should produce qualifer ', () => {
      chunkTransformer.qualifiers = [];
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: {
            qualifier: chunkTransformer.qualifiers,
          },
        },
      };
      const chunk = {commitRow: true};
      chunkTransformer.processRowInProgress(chunk);
      expect(commitSpy).toHaveBeenCalled();
      expect(resetSpy).toHaveBeenCalled();
      expect(rows.length).toBe(1);
      const expectedRow = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: undefined,
                timestamp: undefined,
                labels: undefined,
              },
            ],
          },
        },
      };
      const row = rows[0];
      expect(row).toEqual(expectedRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.NEW_ROW);
    });
    it('chunk with qualifier and commit should produce row ', () => {
      chunkTransformer.qualifiers = [];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: true,
        qualifier: {value: 'qualifier2'},
        value: 'value',
        timestampMicros: 0,
        labels: [],
        valueSize: 0,
      };
      chunkTransformer.processRowInProgress(chunk);
      expect(commitSpy).toHaveBeenCalled();
      expect(resetSpy).toHaveBeenCalled();
      expect(rows.length).toBe(1);
      const expectedRow = {
        key: 'key',
        data: {
          family: {
            qualifier: [],
            qualifier2: [
              {
                value: 'value',
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      const row = rows[0];
      expect(row).toEqual(expectedRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.NEW_ROW);
    });
    it('chunk with familyName and empty qualifier should produce row', () => {
      chunkTransformer.qualifiers = [];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: true,
        familyName: {value: 'family2'},
        qualifier: '',
        value: 'value',
        timestampMicros: 0,
        labels: [],
        valueSize: 0,
      };
      chunkTransformer.processRowInProgress(chunk);
      expect(commitSpy).toHaveBeenCalled();
      expect(resetSpy).toHaveBeenCalled();
      expect(rows.length).toBe(1);
      const expectedRow = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: 'value',
                timestamp: 0,
                labels: [],
              },
            ],
          },
          family2: {},
        },
      };
      const row = rows[0];
      expect(row).toEqual(expectedRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.NEW_ROW);
    });
    it('chunk with new family and commitRow should produce row', () => {
      chunkTransformer.qualifiers = [];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: true,
        familyName: {value: 'family2'},
        qualifier: {value: 'qualifier2'},
        value: 'value',
        timestampMicros: 0,
        labels: [],
        valueSize: 0,
      };
      chunkTransformer.processRowInProgress(chunk);
      expect(commitSpy).toHaveBeenCalled();
      expect(resetSpy).toHaveBeenCalled();
      expect(rows.length).toBe(1);
      const expectedRow = {
        key: 'key',
        data: {
          family: {
            qualifier: [],
          },
          family2: {
            qualifier2: [
              {
                value: 'value',
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      const row = rows[0];
      expect(row).toEqual(expectedRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.NEW_ROW);
    });
    it('partial cell ', () => {
      chunkTransformer.qualifiers = [];
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: {
            qualifier: chunkTransformer.qualifiers,
          },
        },
      };
      const chunk = {
        commitRow: false,
        value: 'value2',
        valueSize: 10,
        timestampMicros: 0,
        labels: [],
      };
      chunkTransformer.processRowInProgress(chunk);
      expect(commitSpy).not.toHaveBeenCalled();
      expect(resetSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      const expectedState = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: 'value2',
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      expect(chunkTransformer.row).toEqual(expectedState);
      expect(chunkTransformer.state).toBe(RowStateEnum.CELL_IN_PROGRESS);
    });
    it('should decode numbers', () => {
      const RealChunkTransformer =
        require('../src/chunktransformer.js').ChunkTransformer;
      chunkTransformer = new RealChunkTransformer({decode: true});
      resetSpy = jest.spyOn(chunkTransformer, 'reset');
      commitSpy = jest.spyOn(chunkTransformer, 'commit');
      destroySpy = jest.spyOn(chunkTransformer, 'destroy');

      chunkTransformer.qualifiers = [];
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: {
            qualifier: chunkTransformer.qualifiers,
          },
        },
      };
      const chunk = {
        commitRow: false,
        value: Buffer.from(Long.fromNumber(10).toBytesBE()).toString('base64'),
        valueSize: 0,
        timestampMicros: 0,
        labels: [],
      };
      chunkTransformer.processRowInProgress(chunk);
      expect(resetSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      const expectedState = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: Buffer.from(Long.fromNumber(10).toBytesBE()).toString(
                  'base64',
                ),
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      expect(chunkTransformer.row).toEqual(expectedState);
      expect(chunkTransformer.state).toBe(RowStateEnum.ROW_IN_PROGRESS);
    });
  });
  describe('processCellInProgress', () => {
    let processCellInProgressSpy: any;
    let resetSpy: any;
    let commitSpy: any;
    let destroySpy: any;
    beforeEach(() => {
      processCellInProgressSpy = jest.spyOn(chunkTransformer, 'processCellInProgress');
      resetSpy = jest.spyOn(chunkTransformer, 'reset');
      commitSpy = jest.spyOn(chunkTransformer, 'commit');
      destroySpy = jest.spyOn(chunkTransformer, 'destroy');
    });
    it('should destroy when resetRow and rowkey', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processCellInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        rowKey: 'key',
      });
    });
    it('should destroy when resetRow and familyName', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processCellInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        familyName: 'family',
      });
    });
    it('should destroy when resetRow and qualifier', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processCellInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        qualifier: 'qualifier',
      });
    });
    it('should destroy when resetRow and value', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processCellInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        value: 'value',
      });
    });
    it('should destroy when resetRow and timestampMicros', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processCellInProgressSpy.call(chunkTransformer, {
        resetRow: true,
        timestampMicros: 10,
      });
    });
    it('should destroy when valueSize>0 and commitRow=true ', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      processCellInProgressSpy.call(chunkTransformer, {
        valueSize: 10,
        commitRow: true,
      });
    });
    it('should reset on resetRow ', () => {
      const chunk = {resetRow: true};
      chunkTransformer.processCellInProgress(chunk);
      expect(resetSpy).toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
    });
    it('should produce row on commitRow', () => {
      chunkTransformer.qualifier = {
        value: 'value',
        size: 0,
        timestamp: 0,
        labels: [],
      };
      chunkTransformer.qualifiers = [chunkTransformer.qualifier];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: true,
        value: '2',
        valueSize: 0,
      };
      chunkTransformer.processCellInProgress(chunk);
      expect(commitSpy).toHaveBeenCalled();
      expect(resetSpy).toHaveBeenCalled();
      expect(rows.length).toBe(1);
      const expectedRow = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: 'value2',
                size: 0,
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      const row = rows[0];
      expect(row).toEqual(expectedRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.NEW_ROW);
    });
    it('without commitRow should change state to processRowInProgress', () => {
      chunkTransformer.qualifier = {
        value: 'value',
        size: 0,
        timestamp: 0,
        labels: [],
      };
      chunkTransformer.qualifiers = [chunkTransformer.qualifier];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: false,
        value: '2',
        valueSize: 0,
      };
      chunkTransformer.processCellInProgress(chunk);
      expect(resetSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      const expectedState = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: 'value2',
                size: 0,
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      expect(chunkTransformer.row).toEqual(expectedState);
      expect(chunkTransformer.state).toBe(RowStateEnum.ROW_IN_PROGRESS);
    });
    it('should concat buffer when decode option is false', () => {
      chunkTransformer = new ChunkTransformer({decode: false});
      processCellInProgressSpy = jest.spyOn(chunkTransformer, 'processCellInProgress');
      resetSpy = jest.spyOn(chunkTransformer, 'reset');
      commitSpy = jest.spyOn(chunkTransformer, 'commit');
      destroySpy = jest.spyOn(chunkTransformer, 'destroy');
      chunkTransformer.qualifier = {
        value: Buffer.from('value', 'base64'),
        size: 0,
        timestamp: 0,
        labels: [],
      };
      chunkTransformer.qualifiers = [chunkTransformer.qualifier];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: false,
        value: Buffer.from('value', 'base64'),
        valueSize: 0,
      };
      chunkTransformer.processCellInProgress(chunk);
      expect(resetSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      const expectedState = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: Buffer.concat([
                  Buffer.from('value', 'base64'),
                  Buffer.from('value', 'base64'),
                ]),
                size: 0,
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      expect(chunkTransformer.row).toEqual(expectedState);
      expect(chunkTransformer.state).toBe(RowStateEnum.ROW_IN_PROGRESS);
    });
  });
  describe('_flush', () => {
    let _flushSpy: any;
    let callback: any;
    let destroySpy: any;
    beforeEach(() => {
      _flushSpy = jest.spyOn(chunkTransformer, '_flush');
      callback = jest.fn();
      destroySpy = jest.spyOn(chunkTransformer, 'destroy');
    });
    it('completed row should complete successfully', () => {
      chunkTransformer.row = {};
      _flushSpy.call(chunkTransformer, callback);
      expect(callback).toHaveBeenCalled();
      const err = (callback as jest.Mock).mock.calls[0][0];
      expect(err).toBeFalsy();
    });
    it('should call destroy when there is uncommitted row', done => {
      chunkTransformer.on('error', () => {
        expect(destroySpy).toHaveBeenCalled();
        done();
      });
      chunkTransformer.row = {key: 'abc'};
      _flushSpy.call(chunkTransformer, callback);
    });
  });
  describe('_transform', () => {
    let callback: any;
    let processNewRowSpy: any;
    let processRowInProgressSpy: any;
    let processCellInProgressSpy: any;
    beforeEach(() => {
      callback = jest.fn();
      processNewRowSpy = jest.spyOn(chunkTransformer, 'processNewRow');
      processRowInProgressSpy = jest.spyOn(chunkTransformer, 'processRowInProgress');
      processCellInProgressSpy = jest.spyOn(chunkTransformer, 'processCellInProgress');
    });
    it('when current state is NEW_ROW should call processNewRow', () => {
      const chunk = {
        rowKey: 'key',
        familyName: {value: 'family'},
        qualifier: {value: 'qualifier'},
        valueSize: 0,
        timestampMicros: 0,
        labels: [],
        commitRow: true,
        value: 'value',
      };
      chunkTransformer.state = RowStateEnum.NEW_ROW;
      const chunks = [chunk];
      chunkTransformer._transform({chunks}, {}, callback);
      expect(processNewRowSpy).toHaveBeenCalled();
      const err = (callback as jest.Mock).mock.calls[0][0];
      expect(err).toBeFalsy();
    });
    it('when current state is ROW_IN_PROGRESS should call processRowInProgress', () => {
      chunkTransformer.row = {key: 'key'};
      chunkTransformer.state = RowStateEnum.ROW_IN_PROGRESS;
      const chunks = [{key: 'key'}];
      chunkTransformer._transform({chunks}, {}, callback);
      expect(processRowInProgressSpy).toHaveBeenCalled();
      const err = (callback as jest.Mock).mock.calls[0][0];
      expect(err).toBeFalsy();
    });
    it('when current state is CELL_IN_PROGRESS should call processCellInProgress', () => {
      chunkTransformer.row = {key: 'key'};
      chunkTransformer.state = RowStateEnum.CELL_IN_PROGRESS;
      const chunks = [{key: 'key'}];
      chunkTransformer._transform({chunks}, {}, callback);
      expect(processCellInProgressSpy).toHaveBeenCalled();
      const err = (callback as jest.Mock).mock.calls[0][0];
      expect(err).toBeFalsy();
    });
    it('should change the `lastRowKey` value for `data.lastScannedRowKey`', () => {
      chunkTransformer._transform(
        {chunks: [], lastScannedRowKey: 'foo'},
        {},
        callback,
      );
      expect(chunkTransformer.lastRowKey).toEqual('foo');
    });
  });
  describe('reset', () => {
    it('should reset initial state', () => {
      chunkTransformer.lastRowKey = 'prevkey';
      chunkTransformer.qualifier = {
        value: 'value',
        size: 0,
        timestamp: 0,
        labels: [],
      };
      chunkTransformer.qualifiers = [chunkTransformer.qualifier];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      chunkTransformer.state = RowStateEnum.CELL_IN_PROGRESS;
      chunkTransformer.reset();
      expect(chunkTransformer.row).toEqual({});
      expect(chunkTransformer.lastRowKey).toEqual('prevkey');
      expect(chunkTransformer.family).toEqual({});
      expect(chunkTransformer.qualifiers).toEqual([]);
      expect(chunkTransformer.qualifier).toEqual({});
      expect(chunkTransformer.state).toEqual(RowStateEnum.NEW_ROW);
    });
  });
  describe('commit', () => {
    let resetSpy: any;
    beforeEach(() => {
      resetSpy = jest.spyOn(chunkTransformer, 'reset');
    });
    it('should reset to initial state and set lastRowKey', () => {
      chunkTransformer.lastRowKey = '';
      chunkTransformer.qualifier = {
        value: 'value',
        size: 0,
        timestamp: 0,
        labels: [],
      };
      chunkTransformer.qualifiers = [chunkTransformer.qualifier];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      chunkTransformer.state = RowStateEnum.CELL_IN_PROGRESS;
      chunkTransformer.commit();
      expect(resetSpy).toHaveBeenCalled();
      expect(chunkTransformer.row).toEqual({});
      expect(chunkTransformer.lastRowKey).toEqual('key');
      expect(chunkTransformer.family).toEqual({});
      expect(chunkTransformer.qualifiers).toEqual([]);
      expect(chunkTransformer.qualifier).toEqual({});
      expect(chunkTransformer.state).toEqual(RowStateEnum.NEW_ROW);
    });
  });
  describe('moveToNextState', () => {
    let commitSpy: any;
    beforeEach(() => {
      commitSpy = jest.spyOn(chunkTransformer, 'commit');
    });
    it('chunk with commit row should call callback with row and call commit state', () => {
      chunkTransformer.qualifier = {
        value: 'value',
        size: 0,
        timestamp: 0,
        labels: [],
      };
      chunkTransformer.qualifiers = [chunkTransformer.qualifier];
      chunkTransformer.family = {
        qualifier: chunkTransformer.qualifiers,
      };
      chunkTransformer.row = {
        key: 'key',
        data: {
          family: chunkTransformer.family,
        },
      };
      const chunk = {
        commitRow: true,
      };
      chunkTransformer.moveToNextState(chunk);
      expect(commitSpy).toHaveBeenCalled();
      expect(rows.length).toBe(1);
      const expectedRow = {
        key: 'key',
        data: {
          family: {
            qualifier: [
              {
                value: 'value',
                size: 0,
                timestamp: 0,
                labels: [],
              },
            ],
          },
        },
      };
      const row = rows[0];
      expect(row).toEqual(expectedRow);
      expect(chunkTransformer.state).toBe(RowStateEnum.NEW_ROW);
    });
    it('chunk without commitRow and value size>0 should move to CELL_IN_PROGRESS', () => {
      const chunk = {
        commitRow: false,
        valueSize: 10,
      };
      chunkTransformer.state = RowStateEnum.NEW_ROW;
      chunkTransformer.moveToNextState(chunk);
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      expect(chunkTransformer.state).toBe(RowStateEnum.CELL_IN_PROGRESS);
    });
    it('chunk without commitRow and value size==0 should move to ROW_IN_PROGRESS', () => {
      const chunk = {
        commitRow: false,
        valueSize: 0,
      };
      chunkTransformer.state = RowStateEnum.CELL_IN_PROGRESS;
      chunkTransformer.moveToNextState(chunk);
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rows.length).toBe(0);
      expect(chunkTransformer.state).toBe(RowStateEnum.ROW_IN_PROGRESS);
    });
  });
  describe('destroy', () => {
    it('should emit error when destroy is called with error', done => {
      const error = new Error('destroy error');
      chunkTransformer.on('error', (err: Error) => {
        expect(err).toBe(error);
        done();
      });
      chunkTransformer.destroy(error);
    });
    it('should not emit if transform is already destroyed', done => {
      chunkTransformer.on('close', () => {
        done();
      });
      chunkTransformer.destroy();
      chunkTransformer.destroy();
    });
  });
});
