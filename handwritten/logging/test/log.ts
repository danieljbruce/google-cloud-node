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
    callbackifyAll(c: Function, options: any) {
      if (
        c.name === 'Log' &&
        options?.exclude?.includes('entry') &&
        options?.exclude?.includes('getEntriesStream')
      ) {
        callbackified = true;
      }
      return actual.callbackifyAll(c, options);
    },
  };
});

import {Entry, Logging} from '../src';
import {Log, LogOptions, WriteOptions} from '../src/log';
import {Data, EntryJson, LogEntry} from '../src/entry';

import * as logCommon from '../src/utils/log-common';
import * as instrumentation from '../src/utils/instrumentation';

describe('Log', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let log: any;

  const PROJECT_ID = 'project-id';
  const FAKE_RESOURCE = 'fake-resource';
  const LOG_NAME = 'escaping/required/for/this/log-name';
  const TRUNCATE_FIELD =
    'jsonPayload.fields.metadata.structValue.fields.custom.stringValue';
  const INVALID_TRUNCATE_FIELD = 'insertId';
  const LOG_NAME_ENCODED = encodeURIComponent(LOG_NAME);
  const LOG_NAME_FORMATTED = [
    'projects',
    PROJECT_ID,
    'logs',
    LOG_NAME_ENCODED,
  ].join('/');

  let LOGGING: Logging;

  beforeAll(() => {
    log = createLogger();
  });

  beforeEach(() => {
    log.logging.entry.mockReset();
    log.logging.getEntries.mockReset();
    log.logging.getEntriesStream.mockReset();
    log.logging.tailEntries.mockReset();
    log.logging.request.mockReset();
    log.logging.loggingService.deleteLog.mockReset();
    log.logging.loggingService.writeLogEntries.mockReset();
    log.logging.auth.getEnv.mockReset();
    log.logging.auth.getProjectId.mockReset();
    log.logging.auth.getProjectId.mockResolvedValue(PROJECT_ID);
    // Required setup for Write():
    log.logging.setProjectId = () => {
      log.logging.projectId = PROJECT_ID;
    };
    log.logging.setDetectedResource = () => {
      log.logging.detectedResource = FAKE_RESOURCE;
    };
    instrumentation.setInstrumentationStatus(true);
  });

  // Create a mock Logging instance
  function createLogger(maxEntrySize?: number, maxRetries?: number) {
    LOGGING = {
      options: maxRetries !== undefined ? {maxRetries: maxRetries} : undefined,
      projectId: '{{project-id}}',
      entry: jest.fn(),
      setProjectId: jest.fn(),
      setDetectedResource: jest.fn(),
      getEntries: jest.fn(),
      getEntriesStream: jest.fn(),
      tailEntries: jest.fn(),
      request: jest.fn(),
      loggingService: {
        deleteLog: jest.fn(),
        writeLogEntries: jest.fn(),
      },
      auth: {
        getEnv: jest.fn(),
        getProjectId: jest.fn(),
      },
    } as {} as Logging;

    // Add some custom defined field to truncate which can be tested later - the idea is to
    // see that constructor works properly and provides correct order of fields to be truncated.
    // Also append same value twice to make sure that duplicates should be discarded.
    // Adding illegal field to be truncated should be discared as well
    const options: LogOptions = {
      jsonFieldsToTruncate: [
        INVALID_TRUNCATE_FIELD,
        TRUNCATE_FIELD,
        TRUNCATE_FIELD,
      ],
    };
    if (maxEntrySize) {
      options.maxEntrySize = maxEntrySize;
    }
    return new Log(LOGGING, LOG_NAME, options);
  }

  describe('instantiation', () => {
    it('should callbackify all the things', () => {
      expect(callbackified).toBe(true);
    });

    it('should localize the escaped name', () => {
      expect(log.name).toBe(LOG_NAME_ENCODED);
    });

    it('should localize removeCircular_ to default value', () => {
      expect(log.removeCircular_).toBe(false);
    });

    it('should localize the formatted name', () => {
      const log = new Log(LOGGING, LOG_NAME);
      expect(log.formattedName_).toBe(
        logCommon.formatLogName('{{project-id}}', LOG_NAME),
      );
    });

    it('should accept and localize options.removeCircular', () => {
      const options = {removeCircular: true};
      const log = new Log(LOGGING, LOG_NAME, options);
      expect(log.removeCircular_).toBe(true);
    });

    it('should localize the Logging instance', () => {
      expect(log.logging).toBe(LOGGING);
    });

    it('should localize the name', () => {
      expect(log.name).toBe(LOG_NAME_FORMATTED.split('/').pop());
    });

    it('should default to no max entry size', () => {
      expect(log.maxEntrySize).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should execute gax method', async () => {
      await log.delete();
      expect(log.logging.loggingService.deleteLog).toHaveBeenCalledWith(
        {
          logName: log.formattedName_,
        },
        undefined,
        undefined,
      );
    });

    it('should execute global callback for delete', async () => {
      log.defaultWriteDeleteCallback = () => {};
      await log.delete();
      expect(log.logging.loggingService.deleteLog).toHaveBeenCalledWith(
        {
          logName: log.formattedName_,
        },
        undefined,
        log.defaultWriteDeleteCallback,
      );
      log.defaultWriteDeleteCallback = undefined;
    });

    it('should accept gaxOptions', async () => {
      await log.delete({});
      expect(log.logging.loggingService.deleteLog).toHaveBeenCalledWith(
        expect.anything(),
        {},
        undefined,
      );
    });
  });

  describe('entry', () => {
    it('should return an entry from Logging', () => {
      const metadata = {
        val: true,
      } as LogEntry;
      const data = {};
      const entryObject = {};
      log.logging.entry.mockReturnValue(entryObject);

      const entry = log.entry(metadata, data);
      expect(entry).toBe(entryObject);
      expect(log.logging.entry).toHaveBeenCalledWith(metadata, data);
    });

    it('should assume one regular argument means data', () => {
      const data = {};
      log.entry(data);
      expect(log.logging.entry).toHaveBeenCalledWith(expect.anything(), data);
    });

    it('should assume one httpRequest argument means metadata', () => {
      const metadata = {
        httpRequest: {},
      };
      log.entry(metadata);
      expect(log.logging.entry).toHaveBeenCalledWith(metadata, {});
    });
  });

  describe('getEntries', () => {
    it('should call Logging getEntries with defaults', async () => {
      await log.getEntries();
      expect(log.logging.getEntries).toHaveBeenCalledWith({
        filter: `logName="${LOG_NAME_FORMATTED}"`,
      });
    });

    it('should add logName filter to user provided filter', async () => {
      const options = {
        custom: true,
        filter: 'custom filter',
      };
      const expectedOptions = extend({}, options);
      expectedOptions.filter = `(${options.filter}) AND logName="${LOG_NAME_FORMATTED}"`;

      await log.getEntries(options);
      expect(log.logging.getEntries).toHaveBeenCalledWith(expectedOptions);
    });

    it('should not add logName filter if already present', async () => {
      const filter = `logName="${LOG_NAME_FORMATTED}" AND custom filter`;
      const options = {filter};

      await log.getEntries(options);
      expect(log.logging.getEntries).toHaveBeenCalledWith({filter});
    });
  });

  describe('getEntriesStream', () => {
    const FAKE_STREAM = {};

    beforeEach(() => {
      log.logging.getEntriesStream.mockReturnValue(FAKE_STREAM);
    });

    it('should call Logging getEntriesStream with defaults', () => {
      const stream = log.getEntriesStream();
      expect(stream).toBe(FAKE_STREAM);
      expect(log.logging.getEntriesStream).toHaveBeenCalledWith({
        log: LOG_NAME_ENCODED,
      });
    });

    it('should allow overriding the options', () => {
      const options = {
        custom: true,
        filter: 'custom filter',
      };

      const stream = log.getEntriesStream(options);
      expect(stream).toBe(FAKE_STREAM);
      expect(log.logging.getEntriesStream).toHaveBeenCalledWith(
        extend(
          {},
          {
            log: LOG_NAME_ENCODED,
          },
          options,
        ),
      );
    });
  });

  describe('tailEntries', () => {
    const FAKE_STREAM = {};

    beforeEach(() => {
      log.logging.tailEntries.mockReturnValue(FAKE_STREAM);
    });

    it('should call Logging tailEntries with defaults', () => {
      const stream = log.tailEntries();
      expect(stream).toBe(FAKE_STREAM);
      expect(log.logging.tailEntries).toHaveBeenCalledWith({
        log: LOG_NAME_ENCODED,
      });
    });

    it('should allow overriding the options', () => {
      const options = {
        custom: true,
        filter: 'custom filter',
      };

      const stream = log.tailEntries(options);
      expect(stream).toBe(FAKE_STREAM);
      expect(log.logging.tailEntries).toHaveBeenCalledWith(
        extend(
          {},
          {
            log: LOG_NAME_ENCODED,
          },
          options,
        ),
      );
    });
  });

  describe('write', () => {
    let ENTRY: Entry;
    let ENTRIES: Entry[];
    let OPTIONS: WriteOptions;
    let truncateEntriesSpy: jest.SpyInstance;
    let decorateEntriesSpy: jest.SpyInstance;
    let origDetectedResource: string;

    beforeAll(() => {
      origDetectedResource = log.logging.detectedResource;
    });
    beforeEach(() => {
      ENTRY = {} as Entry;
      ENTRIES = [ENTRY] as Entry[];
      OPTIONS = {} as WriteOptions;
      decorateEntriesSpy = jest.spyOn(log, 'decorateEntries').mockImplementation(x => x as any);
      truncateEntriesSpy = jest.spyOn(log, 'truncateEntries').mockImplementation(x => x as any);
    });
    afterEach(() => {
      decorateEntriesSpy.mockRestore();
      truncateEntriesSpy.mockRestore();
      log.logging.detectedResource = origDetectedResource;
    });

    it('should forward options.resource to request', async () => {
      const CUSTOM_RESOURCE = {
        labels: {
          projectId: 'fake-project',
          regionZone: 'us-west-1',
        },
      };
      const optionsWithResource = extend({}, OPTIONS, {
        resource: CUSTOM_RESOURCE,
      }) as WriteOptions;

      await log.write(ENTRIES, optionsWithResource);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        {
          logName: log.formattedName_,
          entries: ENTRIES,
          partialSuccess: true,
          resource: {
            labels: {
              project_id: 'fake-project',
              region_zone: 'us-west-1',
            },
          },
        },
        undefined,
        undefined,
      );
    });

    it('should cache a projectId in Logging', async () => {
      const fakeProject = 'test-level-fake-projectId';
      log.logging.setProjectId = () => {
        log.logging.projectId = fakeProject;
      };
      await log.write(ENTRIES);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledTimes(1);
      expect(log.logging.projectId).toBe(fakeProject);
    });

    it('should cache a detected resource in Logging', async () => {
      const fakeResource = 'test-level-fake-resource';
      log.logging.setDetectedResource = () => {
        log.logging.detectedResource = fakeResource;
      };
      await log.write(ENTRIES);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledTimes(1);
      expect(log.logging.detectedResource).toBe(fakeResource);
    });

    it('should re-use detected resource', async () => {
      const reusableDetectedResource = 'environment-default-resource';
      log.logging.detectedResource = reusableDetectedResource;
      log.logging.setDetectedResource = () => Promise.resolve();
      await log.write(ENTRIES);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: reusableDetectedResource,
        }),
        undefined,
        undefined,
      );
    });

    it('should transform camelcase label keys to snake case', async () => {
      const CUSTOM_RESOURCE = {
        labels: {
          camelCaseKey: 'camel-case-key-val',
        },
      };
      const EXPECTED_RESOURCE = {
        labels: {
          camel_case_key: 'camel-case-key-val',
        },
      };
      const optionsWithResource = extend({}, OPTIONS, {
        resource: CUSTOM_RESOURCE,
      });

      await log.write(ENTRIES, optionsWithResource);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        {
          logName: log.formattedName_,
          entries: ENTRIES,
          partialSuccess: true,
          resource: EXPECTED_RESOURCE,
        },
        undefined,
        undefined,
      );
    });

    it('should call gax method', async () => {
      await log.write(ENTRIES, OPTIONS);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        {
          logName: log.formattedName_,
          entries: ENTRIES,
          partialSuccess: true,
          resource: FAKE_RESOURCE,
        },
        undefined,
        undefined,
      );
    });

    it('should call gax write method with global callback', async () => {
      log.defaultWriteDeleteCallback = () => {};
      await log.write(ENTRIES, OPTIONS);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        {
          logName: log.formattedName_,
          entries: ENTRIES,
          partialSuccess: true,
          resource: FAKE_RESOURCE,
        },
        undefined,
        log.defaultWriteDeleteCallback,
      );
      log.defaultWriteDeleteCallback = undefined;
    });

    it('should decorate the entries', async () => {
      decorateEntriesSpy.mockImplementation(() => 'decorated entries' as any);

      await log.write(ENTRIES, OPTIONS);
      expect(decorateEntriesSpy).toHaveBeenCalledWith(ENTRIES);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: 'decorated entries',
        }),
        undefined,
        undefined,
      );
    });

    it('should arrify the entries', async () => {
      const arrifiedEntries: Entry[] = [ENTRY];

      await log.write(ENTRY, OPTIONS);
      expect(decorateEntriesSpy).toHaveBeenCalledWith(arrifiedEntries);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: arrifiedEntries,
        }),
        undefined,
        undefined,
      );
    });

    it('should truncate the entries after decorating', async () => {
      const order: string[] = [];
      decorateEntriesSpy.mockImplementation((x) => {
        order.push('decorate');
        return x;
      });
      truncateEntriesSpy.mockImplementation((x) => {
        order.push('truncate');
        return x;
      });

      await log.write(ENTRIES, OPTIONS);
      expect(order).toEqual(['decorate', 'truncate']);
      expect(truncateEntriesSpy).toHaveBeenCalledWith(ENTRIES);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: ENTRIES,
        }),
        undefined,
        undefined,
      );
    });

    it('should not require options', async () => {
      await log.write(ENTRY);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          partialSuccess: true,
        }),
        undefined,
        undefined,
      );
    });

    it('should pass through additional options', async () => {
      await log.write(ENTRY, {dryRun: true, partialSuccess: false});
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: true,
          partialSuccess: false,
        }),
        undefined,
        undefined,
      );
    });

    it('should set the partialSuccess properly for instrumentation record', async () => {
      instrumentation.setInstrumentationStatus(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).shouldSkipInstrumentationCheck = false;
      await log.write(ENTRIES, OPTIONS);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          partialSuccess: true,
        }),
        undefined,
        undefined,
      );
      instrumentation.setInstrumentationStatus(true);
    });

    it('should set the partialSuccess properly for existing instrumentation record', async () => {
      ENTRIES.push(instrumentation.createDiagnosticEntry(undefined, undefined));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).shouldSkipInstrumentationCheck = false;
      await log.write(ENTRIES, OPTIONS);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          partialSuccess: true,
        }),
        undefined,
        undefined,
      );
    });

    it('should pass through global options', async () => {
      log = createLogger(undefined, 1);
      decorateEntriesSpy = jest.spyOn(log, 'decorateEntries').mockImplementation(x => x as any);
      await log.write(ENTRIES, OPTIONS);
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.anything(),
        {
          maxRetries: 1,
        },
        undefined,
      );
      log.logging.loggingService.writeLogEntries.mockReset();
      await log.write(ENTRIES, {gaxOptions: {maxRetries: 10}});
      expect(log.logging.loggingService.writeLogEntries).toHaveBeenCalledWith(
        expect.anything(),
        {
          maxRetries: 10,
        },
        undefined,
      );
    });
  });

  describe('decorateEntries', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toJSONResponse: any;
    let logEntrySpy: jest.SpyInstance;
    let toJSONSpy: jest.Mock;

    beforeEach(() => {
      toJSONResponse = {};
      toJSONSpy = jest.fn().mockReturnValue(toJSONResponse);
      logEntrySpy = jest.spyOn(log, 'entry').mockReturnValue({
        toJSON: toJSONSpy,
      });
    });

    afterEach(() => {
      logEntrySpy.mockRestore();
    });

    it('should create an Entry object if one is not provided', () => {
      const entry = {};
      const decoratedEntries = log.decorateEntries([entry]);
      expect(decoratedEntries[0]).toBe(toJSONResponse);
      expect(log.entry).toHaveBeenCalledWith(entry);
    });

    it('should get JSON format from Entry object', () => {
      const entry = new Entry();
      entry.toJSON = () => toJSONResponse as {} as EntryJson;
      const decoratedEntries = log.decorateEntries([entry]);
      expect(decoratedEntries[0]).toBe(toJSONResponse);
      expect(log.entry).not.toHaveBeenCalled();
    });

    it('should pass log.removeCircular to toJSON', () => {
      log.removeCircular_ = true;
      log.logging.projectId = PROJECT_ID;
      const entry = new Entry();
      const localJSONSpy = jest.spyOn(entry, 'toJSON').mockReturnValue({} as EntryJson);
      log.decorateEntries([entry]);
      expect(localJSONSpy).toHaveBeenCalledWith({removeCircular: true}, PROJECT_ID);
    });

    it('should throw error from serialization', () => {
      const entry = new Entry();
      jest.spyOn(entry, 'toJSON').mockImplementation(() => {
        throw new Error('Error.');
      });
      expect(() => {
        log.decorateEntries([entry]);
      }).toThrow('Error.');
    });
  });

  describe('truncateEntries', () => {
    const entryMetaMaxLength = 100;

    function entriesFactory(message: Data): EntryJson[] {
      return [new Entry({}, message).toJSON()];
    }

    it('should not truncate entries by default', () => {
      const longEntry = 'hello world'.padEnd(3e5, '.');
      const entries = entriesFactory(longEntry);

      log.truncateEntries(entries);
      const text = entries[0].textPayload;
      expect(text).toBe(longEntry);
    });

    it('should truncate string entry if maxEntrySize hit', () => {
      const maxSize = 2e2;
      const longEntry = 'hello world'.padEnd(maxSize * 10, '.');
      const entries = entriesFactory(longEntry);

      log.maxEntrySize = maxSize;
      log.truncateEntries(entries);

      const text: string = entries[0].textPayload!;
      expect(text.startsWith('hello world')).toBe(true);
      expect(text.length).toBeLessThan(maxSize + entryMetaMaxLength);
    });

    it('should not truncate string entry if less than maxEntrySize', () => {
      const maxSize = 2e3; // something greater than message length and entry overhead
      const shortEntry = 'hello world';
      const entries = entriesFactory(shortEntry);

      log.maxEntrySize = maxSize;
      log.truncateEntries(entries);

      const text: string = entries[0].textPayload!;
      expect(text).toBe(shortEntry);
    });

    it('should truncate message field, on object entry, if maxEntrySize hit', () => {
      const maxSize = 2e2;
      const longEntry = 'hello world'.padEnd(maxSize * 10, '.');
      const entries = entriesFactory({message: longEntry});

      log.maxEntrySize = maxSize;
      log.truncateEntries(entries);

      const text: string = entries[0].jsonPayload!.fields!.message.stringValue!;
      expect(text.startsWith('hello world')).toBe(true);
      expect(text.length).toBeLessThan(maxSize + entryMetaMaxLength);
    });

    it('should truncate stack trace', async () => {
      const maxSize = 300;
      const entries = entriesFactory({
        message: 'hello world'.padEnd(2000, '.'),
        metadata: {
          stack: 'hello world'.padEnd(2000, '.'),
        },
      });

      log.maxEntrySize = maxSize;
      log.truncateEntries(entries);

      const message: string =
        entries[0].jsonPayload!.fields!.message.stringValue!;
      const stack: string =
        entries[0].jsonPayload!.fields!.metadata.structValue!.fields!.stack
          .stringValue!;
      expect(stack).toBe('');
      expect(message.startsWith('hello world')).toBe(true);
      expect(message.length).toBeLessThan(maxSize + entryMetaMaxLength);
    });

    it('should not contin duplicate or illegal fields to be truncated and defaults should present', async () => {
      expect(log.jsonFieldsToTruncate.length).toBeGreaterThan(1);
      expect(log.jsonFieldsToTruncate[0]).toBe(TRUNCATE_FIELD);
      const notExists = log.jsonFieldsToTruncate.filter(
        (str: string) => str === INVALID_TRUNCATE_FIELD,
      );
      expect(notExists.length).toBe(0);
      const existOnce = log.jsonFieldsToTruncate.filter(
        (str: string) => str === TRUNCATE_FIELD,
      );
      expect(existOnce.length).toBe(1);
    });

    it('should truncate custom defined field', async () => {
      const maxSize = 300;
      const entries = entriesFactory({
        message: 'hello world'.padEnd(2000, '.'),
        metadata: {
          custom: 'custom world'.padEnd(2000, '.'),
        },
      });

      log.maxEntrySize = maxSize;
      log.truncateEntries(entries);

      const message: string =
        entries[0].jsonPayload!.fields!.message.stringValue!;
      const custom: string =
        entries[0].jsonPayload!.fields!.metadata.structValue!.fields!.custom
          .stringValue!;
      expect(message.startsWith('hello world')).toBe(true);
      expect(custom).toBe('');
      expect(message.length).toBeLessThan(maxSize + entryMetaMaxLength);
    });
  });

  describe('severity shortcuts', () => {
    let ENTRY: Entry;
    let LABELS: WriteOptions;
    let assignSeveritySpy: jest.SpyInstance;
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
      ENTRY = {} as Entry;
      LABELS = [] as WriteOptions;
      assignSeveritySpy = jest.spyOn(logCommon, 'assignSeverityToEntries');
      writeSpy = jest.spyOn(log, 'write').mockResolvedValue([] as any);
    });

    afterEach(() => {
      assignSeveritySpy.mockRestore();
      writeSpy.mockRestore();
    });

    [
      'alert',
      'critical',
      'debug',
      'emergency',
      'error',
      'info',
      'notice',
      'warning',
    ].forEach(severityMethodName => {
      describe(severityMethodName, () => {
        let severityMethod: Function;

        beforeEach(() => {
          severityMethod = log[severityMethodName].bind(log);
        });

        it('should format the entries', async () => {
          const severity = severityMethodName.toUpperCase();
          await severityMethod(ENTRY, LABELS);
          expect(assignSeveritySpy).toHaveBeenCalledWith(ENTRY, severity);
        });

        it('should pass correct arguments to write', async () => {
          const assignedEntries = [] as Entry[];
          assignSeveritySpy.mockReturnValue(assignedEntries);
          await severityMethod(ENTRY, LABELS);
          expect(writeSpy).toHaveBeenCalledWith(assignedEntries, LABELS);
        });
      });
    });
  });
});
