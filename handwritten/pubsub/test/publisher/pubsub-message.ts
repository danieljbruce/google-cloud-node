/*!
 * Copyright 2021 Google LLC
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

import {PubsubMessage} from '../../src/publisher';
import * as pm from '../../src/publisher/pubsub-message';

describe('PubsubMessage', () => {
  it('should calculate properly for blank messages', () => {
    const blank: PubsubMessage = {};
    const size = pm.calculateMessageSize(blank);
    expect(size).toBe(0);
    expect(blank.calculatedSize).toBe(size);
  });

  it('should calculate properly for a data only message', () => {
    const dataOnly: PubsubMessage = {data: Buffer.from('test')};
    const size = pm.calculateMessageSize(dataOnly);
    expect(size).toBe(4);
    expect(dataOnly.calculatedSize).toBe(size);
  });

  it('should calculate properly for an attr only message', () => {
    const attrOnly: PubsubMessage = {
      attributes: {
        foo: 'bar',
      },
    };
    const size = pm.calculateMessageSize(attrOnly);
    expect(size).toBe(6);
    expect(attrOnly.calculatedSize).toBe(size);
  });

  it('should calculate properly for a both message', () => {
    const both: PubsubMessage = {
      data: Buffer.from('test'),
      attributes: {
        foo: 'bar',
        baz: 'quux',
      },
    };
    const size = pm.calculateMessageSize(both);
    expect(size).toBe(17);
    expect(both.calculatedSize).toBe(size);
  });

  // This isn't really part of the spec, but it might happen.
  it('should handle undefined attributes', () => {
    const weird: PubsubMessage = {
      attributes: {
        foo: undefined as unknown as string,
      },
    };
    const size = pm.calculateMessageSize(weird);
    expect(size).toBe(3);
    expect(weird.calculatedSize).toBe(size);
  });
});
