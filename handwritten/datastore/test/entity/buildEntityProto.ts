// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {Entities, EntityObject, EntityProto} from '../../src/entity';
import {buildEntityProto} from '../../src/utils/entity/buildEntityProto';
import {
  entityObject,
  expectedEntityProto,
} from '../fixtures/entityObjectAndProto';

describe('buildEntityProto', () => {
  const testCases: {
    name: string;
    skipped: boolean;
    entityObject: EntityObject;
    expectedProto: EntityProto;
  }[] = [
    {
      name: 'should format an entity',
      entityObject: {
        data: {
          name: 'Stephen',
        },
      },
      expectedProto: {
        key: null,
        properties: {
          name: {
            stringValue: 'Stephen',
          },
        },
      },
      skipped: false,
    },
    {
      name: 'should format an entity array',
      entityObject: {
        data: [
          {
            name: 'Stephen',
            value: 'Stephen value',
          },
        ],
      },
      expectedProto: {
        properties: {
          Stephen: {
            stringValue: 'Stephen value',
          },
        },
      },
      skipped: false,
    },
    {
      name: 'should respect excludeFromIndexes',
      skipped: false,
      entityObject: entityObject,
      expectedProto: expectedEntityProto,
    },
  ];

  for (const test of testCases) {
    (test.skipped ? it.skip : it)(test.name, () => {
      expect(buildEntityProto(test.entityObject)).toEqual(test.expectedProto);
    });
  }
});
