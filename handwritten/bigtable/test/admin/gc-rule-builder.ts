// Copyright 2026 Google LLC
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

import * as gc from '../../src/admin/gc-rule-builder';
import {GcRuleBuilder} from '../../src/admin/gc-rule-builder';

describe('GcRuleBuilder', () => {
  it('has working TypeScript types', () => {
    // Not really much to do here at runtime, but this will break
    // if one of them is wrong.
    const union: gc.GcUnion = {
      union: {},
    };
    const intersection: gc.GcIntersection = {
      intersection: {},
    };

    const grouping: gc.GcGrouping = {
      union: {},
    };

    const ruleItem: gc.GcRuleItem = {
      maxNumVersions: 10,
    };

    expect(union).toBeTruthy();
    expect(intersection).toBeTruthy();
    expect(grouping).toBeTruthy();
    expect(ruleItem).toBeTruthy();
  });

  it('makes basic rules', () => {
    // This is a no-op outside of checking, which is tested below.
    GcRuleBuilder.rule({
      maxNumVersions: 1,
    });
  });

  it('has working union building', () => {
    const rule = GcRuleBuilder.union(
      GcRuleBuilder.rule({
        maxNumVersions: 1,
      }),
      GcRuleBuilder.rule({
        maxAge: {
          seconds: 1,
        },
      }),
    );

    expect(rule).toEqual({
      union: {
        rules: [
          {
            maxNumVersions: 1,
          },
          {
            maxAge: {
              seconds: 1,
            },
          },
        ],
      },
    });
  });

  it('has working intersection building', () => {
    const rule = GcRuleBuilder.intersection(
      GcRuleBuilder.rule({
        maxNumVersions: 1,
      }),
      GcRuleBuilder.rule({
        maxAge: {
          seconds: 1,
        },
      }),
    );

    expect(rule).toEqual({
      intersection: {
        rules: [
          {
            maxNumVersions: 1,
          },
          {
            maxAge: {
              seconds: 1,
            },
          },
        ],
      },
    });
  });

  it('can nest', () => {
    const rule = GcRuleBuilder.intersection(
      GcRuleBuilder.union(
        GcRuleBuilder.rule({
          maxNumVersions: 10,
        }),
      ),
      GcRuleBuilder.rule({
        maxNumVersions: 1,
      }),
      GcRuleBuilder.rule({
        maxAge: {
          seconds: 1,
        },
      }),
    );

    expect(rule).toEqual({
      intersection: {
        rules: [
          {
            union: {
              rules: [
                {
                  maxNumVersions: 10,
                },
              ],
            },
          },
          {
            maxNumVersions: 1,
          },
          {
            maxAge: {
              seconds: 1,
            },
          },
        ],
      },
    });
  });

  it('catches invalid groupings', () => {
    // Both a union and intersection
    expect(() => {
      GcRuleBuilder.union({
        union: {},
        intersection: {},
      });
    }).toThrow();

    // Union/intersection + rules
    expect(() => {
      GcRuleBuilder.union({
        union: {},
        maxNumVersions: 1,
      });
    }).toThrow();

    // Union/intersection as rule
    expect(() => {
      GcRuleBuilder.rule(
        GcRuleBuilder.union({
          maxNumVersions: 1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
    }).toThrow();
  });

  it('catches invalid rules', () => {
    // Unfortunately, limitations in TypeScript keep us from doing a really
    // thorough check on rule validity (no runtime types). We can at least check
    // that the user didn't pass more than one thing.
    expect(() => {
      // TS won't compile this.
      GcRuleBuilder.rule({
        maxNumVersions: 1,
        maxAge: {
          seconds: 1,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }).toThrow();
  });
});
