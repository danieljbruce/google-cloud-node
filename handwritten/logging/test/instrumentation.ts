/*!
 * Copyright 2022 Google LLC
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

import {Entry} from '../src';
import * as instrumentation from '../src/utils/instrumentation';
import {protos} from '@google-cloud/logging-api';
import google = protos.google;

const NAME = 'name';
const VERSION = 'version';
const NODEJS_TEST = instrumentation.NODEJS_LIBRARY_NAME_PREFIX + '-test';
const LONG_NODEJS_TEST =
  instrumentation.NODEJS_LIBRARY_NAME_PREFIX + '-test-ooooooooooooooo';
const VERSION_TEST = '1.0.0';
const LONG_VERSION_TEST = VERSION_TEST + '.0.0.0.0.0.0.0.0.11.1.1-ALPHA';

describe('instrumentation_info', () => {
  beforeEach(() => {
    instrumentation.setInstrumentationStatus(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).shouldSkipInstrumentationCheck = false;
  });

  it('should generate library info properly by default', () => {
    const entry = instrumentation.createDiagnosticEntry(
      undefined,
      undefined,
    ) as Entry;
    expect(
      entry.data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
    expect(
      entry.data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[VERSION],
    ).toBe(instrumentation.getNodejsLibraryVersion());
  });

  it('should set library version to NODEJS_DEFAULT_LIBRARY_VERSION', () => {
    const data = {some: 'value'};
    const entry = instrumentation.createDiagnosticEntry(
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data as any,
    ) as Entry;
    expect(
      entry.data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
    expect(
      entry.data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[VERSION],
    ).toBe(instrumentation.NODEJS_DEFAULT_LIBRARY_VERSION);
  });

  it('should add instrumentation log entry to the list', () => {
    const dummyEntry = createEntry(undefined, undefined);
    const entries = instrumentation.populateInstrumentationInfo(dummyEntry);
    expect(entries[0].length).toBe(2);
    expect(entries[0][0]).toEqual(dummyEntry);
    expect(entries[1]).toBe(true);
    expect(
      entries[0][1].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
  });

  it('should add instrumentation info to existing list in right order', () => {
    const dummyEntry = createEntry(NODEJS_TEST, VERSION_TEST);
    const entries = instrumentation.populateInstrumentationInfo(dummyEntry);
    expect(entries[0].length).toBe(1);
    expect(entries[1]).toBe(true);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.length,
    ).toBe(2);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[1]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(NODEJS_TEST);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[VERSION],
    ).toBe(VERSION_TEST);
  });

  it('should replace instrumentation log entry in the list', () => {
    const dummyEntry = createEntry('nodejs-test', undefined);
    const entries = instrumentation.populateInstrumentationInfo(dummyEntry);
    expect(entries[0].length).toBe(1);
    expect(entries[1]).toBe(true);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.length,
    ).toBe(1);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
  });

  it('should truncate instrumentation info in log entry', () => {
    const entries = instrumentation.populateInstrumentationInfo(
      createEntry(LONG_NODEJS_TEST, LONG_VERSION_TEST),
    );
    expect(entries[0].length).toBe(1);
    expect(entries[1]).toBe(true);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(NODEJS_TEST + '-oo*');
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[VERSION],
    ).toBe(VERSION_TEST + '.0.0.0.0.*');
  });

  it('should add instrumentation log entry only once', () => {
    const dummyEntry = createEntry(undefined, undefined);
    let entries = instrumentation.populateInstrumentationInfo(dummyEntry);
    expect(entries[0].length).toBe(2);
    expect(entries[0][0]).toEqual(dummyEntry);
    expect(entries[1]).toBe(true);
    expect(
      entries[0][1].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
    entries = instrumentation.populateInstrumentationInfo(dummyEntry);
    expect(entries[0].length).toBe(1);
    expect(entries[0][0]).toEqual(dummyEntry);
  });

  it('should discard extra instrumentation records', () => {
    // Add 4 library versions and make sure that last 2 are discarded and the "nodejs" base
    // library version is always added as a third one
    const dummy = createEntry(
      instrumentation.NODEJS_LIBRARY_NAME_PREFIX + '-one',
      'v1',
    );
    dummy.data?.[instrumentation.DIAGNOSTIC_INFO_KEY][
      instrumentation.INSTRUMENTATION_SOURCE_KEY
    ].push({
      name: instrumentation.NODEJS_LIBRARY_NAME_PREFIX + '-two',
      version: 'v2',
    });
    dummy.data?.[instrumentation.DIAGNOSTIC_INFO_KEY][
      instrumentation.INSTRUMENTATION_SOURCE_KEY
    ].push({
      name: NODEJS_TEST,
      version: VERSION_TEST,
    });
    dummy.data?.[instrumentation.DIAGNOSTIC_INFO_KEY][
      instrumentation.INSTRUMENTATION_SOURCE_KEY
    ].push({
      name: LONG_NODEJS_TEST,
      version: LONG_VERSION_TEST,
    });
    const entries = instrumentation.populateInstrumentationInfo(dummy);
    expect(entries[0].length).toBe(1);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.length,
    ).toBe(3);
    expect(entries[1]).toBe(true);
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[0]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX + '-one');
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[1]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX + '-two');
    expect(
      entries[0][0].data?.[instrumentation.DIAGNOSTIC_INFO_KEY]?.[
        instrumentation.INSTRUMENTATION_SOURCE_KEY
      ]?.[2]?.[NAME],
    ).toBe(instrumentation.NODEJS_LIBRARY_NAME_PREFIX);
  });
});

function createEntry(name: string | undefined, version: string | undefined) {
  const entry = new Entry(
    {
      severity: google.logging.type.LogSeverity.DEBUG,
    },
    undefined,
  );
  if (name || version) {
    entry.data = {
      [instrumentation.DIAGNOSTIC_INFO_KEY]: {
        [instrumentation.INSTRUMENTATION_SOURCE_KEY]: [
          {
            name: name,
            version: version,
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  return entry;
}
