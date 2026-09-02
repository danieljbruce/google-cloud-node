// Copyright 2015 Google LLC
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

let callbackified = false;
jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    callbackifyAll(c: Function) {
      if (c.name === 'Sink') {
        callbackified = true;
      }
    },
  };
});

import {Sink} from '../src/sink';
import {Logging, CreateSinkRequest, LogSink} from '../src/index';

describe('Sink', () => {
  let sink: Sink;

  const PROJECT_ID = 'project-id';

  const LOGGING = {
    createSink: () => {},
    projectId: '{{projectId}}',
    auth: () => {},
    configService: () => {},
  } as {} as Logging;
  const SINK_NAME = 'sink-name';

  beforeEach(() => {
    sink = new Sink(LOGGING, SINK_NAME);
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(callbackified).toBe(true);
    });

    it('should localize Logging instance', () => {
      expect(sink.logging).toBe(LOGGING);
    });

    it('should localize the name', () => {
      expect(sink.name).toBe(SINK_NAME);
    });

    it('should localize the formatted name', () => {
      expect(sink.formattedName_).toBe(
        'projects/' + LOGGING.projectId + '/sinks/' + SINK_NAME,
      );
    });
  });

  describe('create', () => {
    it('should call parent createSink', async () => {
      const config = {} as CreateSinkRequest;
      jest
        .spyOn(sink.logging, 'createSink')
        .mockImplementation(async (name: any, config_: any) => {
          expect(name).toBe(sink.name);
          expect(config_).toBe(config);
          return [] as any;
        });
      await sink.create(config);
    });
  });

  describe('delete', () => {
    it('should execute gax method', async () => {
      sink.logging.auth.getProjectId = async () => PROJECT_ID;
      sink.logging.configService.deleteSink = async (
        reqOpts: {},
        gaxOpts: {},
      ) => {
        expect(reqOpts).toEqual({
          sinkName: sink.formattedName_,
        });
        expect(gaxOpts).toBeUndefined();
      };

      await sink.delete();
    });

    it('should accept gaxOptions', async () => {
      const gaxOptions = {};
      sink.logging.configService.deleteSink = async (
        reqOpts: {},
        gaxOpts: {},
      ) => {
        expect(gaxOpts).toEqual(gaxOptions);
      };

      await sink.delete(gaxOptions);
    });
  });

  describe('getMetadata', () => {
    beforeEach(() => {
      sink.logging.auth.getProjectId = async () => PROJECT_ID;
    });
    it('should execute gax method', async () => {
      sink.logging.configService.getSink = async (reqOpts: {}, gaxOpts: {}) => {
        expect(reqOpts).toEqual({
          sinkName: sink.formattedName_,
        });
        expect(gaxOpts).toBeUndefined();
        return [];
      };

      await sink.getMetadata();
    });

    it('should accept gaxOptions', async () => {
      const gaxOptions = {};
      sink.logging.configService.getSink = async (reqOpts: {}, gaxOpts: {}) => {
        expect(gaxOpts).toEqual(gaxOptions);
        return [];
      };
      await sink.getMetadata(gaxOptions);
    });

    it('should update metadata', async () => {
      const metadata = {};
      jest.spyOn(sink.logging.configService, 'getSink').mockResolvedValue([metadata] as any);
      await sink.getMetadata();
      expect(sink.metadata).toBe(metadata);
    });

    it('should return original arguments', async () => {
      const ARGS = [{}, {}, {}];
      sink.logging.configService.getSink = async () => {
        return [ARGS];
      };
      const [args] = await sink.getMetadata();
      expect(args).toEqual(ARGS);
    });
  });

  describe('setFilter', () => {
    const FILTER = 'filter';

    it('should call set metadata', async () => {
      jest.spyOn(sink, 'setMetadata').mockImplementation(async (metadata: any) => {
        expect(metadata.filter).toBe(FILTER);
        return [] as any;
      });
      await sink.setFilter(FILTER);
    });
  });

  describe('setMetadata', () => {
    const METADATA = {a: 'b', c: 'd'} as LogSink;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sink.getMetadata = async () => [METADATA] as any;
      sink.logging.auth.getProjectId = async () => PROJECT_ID;
    });

    it('should refresh the metadata', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sink.getMetadata = () => [] as any;
      sink.logging.configService.updateSink = async () => {
        return [METADATA];
      };
      expect(sink.metadata).toBeUndefined();
      await sink.setMetadata(METADATA);
      expect(sink.metadata).toEqual(METADATA);
    });

    it('should throw the error from refresh', async () => {
      const error = new Error('Error.');
      sink.getMetadata = async () => {
        throw error;
      };
      await expect(sink.setMetadata(METADATA)).rejects.toBe(error);
    });

    it('should execute gax method', async () => {
      const currentMetadata = {a: 'a', e: 'e'} as LogSink;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sink.getMetadata = async () => [currentMetadata] as any;
      sink.logging.configService.updateSink = async (
        reqOpts: {},
        gaxOpts: {},
      ) => {
        expect(reqOpts).toEqual({
          sinkName: sink.formattedName_,
          sink: extend({}, currentMetadata, METADATA),
        });
        expect(gaxOpts).toBeUndefined();
        return [];
      };

      await sink.setMetadata(METADATA);
    });

    it('should accept gaxOptions', async () => {
      const metadata = extend({}, METADATA, {
        gaxOptions: {},
      });

      jest
        .spyOn(sink.logging.configService, 'updateSink')
        .mockImplementation(async (reqOpts: any, gaxOpts: any) => {
          expect(reqOpts.sink.gaxOptions).toBeUndefined();
          expect(gaxOpts).toBe(metadata.gaxOptions);
          return [];
        });
      await sink.setMetadata(metadata);
    });

    it('should update metadata', async () => {
      const metadata = {};
      sink.logging.configService.updateSink = async () => {
        return [metadata];
      };
      await sink.setMetadata(metadata);
      expect(sink.metadata).toBe(metadata);
    });

    it('should return callback with original arguments', async () => {
      const ARGS = [{}, {}, {}];
      sink.logging.configService.updateSink = async () => {
        return [ARGS];
      };
      const [args] = await sink.setMetadata(METADATA);
      expect(args).toEqual(ARGS);
    });
  });
});
