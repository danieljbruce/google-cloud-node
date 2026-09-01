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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {Query} = require('../src/query');
// eslint-disable-next-line @typescript-eslint/no-var-requires
import {Datastore} from '../src';
import {AggregateField, AggregateQuery} from '../src/aggregate';
import {PropertyFilter, EntityFilter, or} from '../src/filter';
import {entity} from '../src/entity';
const SECOND_DATABASE_ID = 'multidb-test';

describe('Query', () => {
  const SCOPE = {} as Datastore;
  const NAMESPACE = 'Namespace';
  const KINDS = ['Kind'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any;

  beforeEach(() => {
    query = new Query(SCOPE, NAMESPACE, KINDS);
  });

  describe('instantiation', () => {
    it('should localize the scope', () => {
      expect(query.scope).toBe(SCOPE);
    });

    it('should localize the namespace', () => {
      expect(query.namespace).toBe(NAMESPACE);
    });

    it('should localize the kind', () => {
      expect(query.kinds).toBe(KINDS);
    });

    it('should use null for all falsy namespace values', () => {
      [
        new Query(SCOPE, '', KINDS),
        new Query(SCOPE, null, KINDS),
        new Query(SCOPE, undefined, KINDS),
        new Query(SCOPE, 0 as {} as string, KINDS),
        new Query(SCOPE, KINDS),
      ].forEach(query => {
        expect(query.namespace).toBeNull();
      });
    });

    describe('Aggregation queries', () => {
      it('should create a query with a count aggregation', () => {
        const query = new Query(['kind1']);
        const firstAggregation = AggregateField.count().alias('total');
        const secondAggregation = AggregateField.count().alias('total2');
        const aggregate = new AggregateQuery(query).addAggregations([
          firstAggregation,
          secondAggregation,
        ]);
        const aggregate2 = new AggregateQuery(query)
          .count('total')
          .count('total2');
        expect(aggregate.aggregations).toEqual(aggregate2.aggregations);
        expect(aggregate.aggregations).toEqual([
          firstAggregation,
          secondAggregation,
        ]);
      });

      describe('AggregateField toProto', () => {
        it('should produce the right proto with a count aggregation', () => {
          expect(AggregateField.count().alias('alias1').toProto()).toEqual({
            alias: 'alias1',
            count: {},
          });
        });
        it('should produce the right proto with a sum aggregation', () => {
          expect(
            AggregateField.sum('property1').alias('alias1').toProto(),
          ).toEqual({
            alias: 'alias1',
            operator: 'sum',
            sum: {
              property: {
                name: 'property1',
              },
            },
          });
        });
        it('should produce the right proto with an average aggregation', () => {
          expect(
            AggregateField.average('property1').alias('alias1').toProto(),
          ).toEqual({
            alias: 'alias1',
            avg: {
              property: {
                name: 'property1',
              },
            },
            operator: 'avg',
          });
        });
      });

      describe('comparing equivalent aggregation queries', () => {
        function generateAggregateQuery() {
          return new AggregateQuery(new Query(['kind1']));
        }

        function compareAggregations(
          aggregateQuery: AggregateQuery,
          aggregateFields: AggregateField[],
        ) {
          const addAggregationsAggregate = generateAggregateQuery();
          addAggregationsAggregate.addAggregations(aggregateFields);
          const addAggregationAggregate = generateAggregateQuery();
          aggregateFields.forEach(aggregateField =>
            addAggregationAggregate.addAggregation(aggregateField),
          );
          expect(aggregateQuery.aggregations).toEqual(
            addAggregationsAggregate.aggregations,
          );
          expect(aggregateQuery.aggregations).toEqual(
            addAggregationAggregate.aggregations,
          );
          expect(aggregateQuery.aggregations).toEqual(aggregateFields);
        }
        describe('comparing aggregations with an alias', () => {
          it('should compare equivalent count aggregation queries', () => {
            compareAggregations(
              generateAggregateQuery().count('total1').count('total2'),
              ['total1', 'total2'].map(alias =>
                AggregateField.count().alias(alias),
              ),
            );
          });
          it('should compare equivalent sum aggregation queries', () => {
            compareAggregations(
              generateAggregateQuery()
                .sum('property1', 'alias1')
                .sum('property2', 'alias2'),
              [
                AggregateField.sum('property1').alias('alias1'),
                AggregateField.sum('property2').alias('alias2'),
              ],
            );
          });
          it('should compare equivalent average aggregation queries', () => {
            compareAggregations(
              generateAggregateQuery()
                .average('property1', 'alias1')
                .average('property2', 'alias2'),
              [
                AggregateField.average('property1').alias('alias1'),
                AggregateField.average('property2').alias('alias2'),
              ],
            );
          });
        });
        describe('comparing aggregations without an alias', () => {
          it('should compare equivalent count aggregation queries', () => {
            compareAggregations(
              generateAggregateQuery().count().count(),
              ['total1', 'total2'].map(() => AggregateField.count()),
            );
          });
          it('should compare equivalent sum aggregation queries', () => {
            compareAggregations(
              generateAggregateQuery().sum('property1').sum('property2'),
              [
                AggregateField.sum('property1'),
                AggregateField.sum('property2'),
              ],
            );
          });
          it('should compare equivalent average aggregation queries', () => {
            compareAggregations(
              generateAggregateQuery()
                .average('property1')
                .average('property2'),
              [
                AggregateField.average('property1'),
                AggregateField.average('property2'),
              ],
            );
          });
        });
      });
    });
  });

  describe('filter', () => {
    it('should issue a warning when a Filter instance is not provided', () => {
      const spy = jest.spyOn(process, 'emitWarning').mockImplementation();
      new Query(['kind1']).filter('name', 'Stephen');
      expect(spy).toHaveBeenCalledWith(
        'Providing Filter objects like Composite Filter or Property Filter is recommended when using .filter',
      );
    });
    it('should not issue a warning again when a Filter instance is not provided', () => {
      const spy = jest.spyOn(process, 'emitWarning').mockImplementation();
      new Query(['kind1']).filter('name', 'Stephen');
      expect(spy).not.toHaveBeenCalled();
    });
    it('should support filtering', () => {
      const now = new Date();
      const query = new Query(['kind1']).filter('date', '<=', now);
      const filter = query.filters[0];

      expect(filter.name).toBe('date');
      expect(filter.op).toBe('<=');
      expect(filter.val).toBe(now);
    });

    it('should recognize all the different operators', () => {
      const now = new Date();
      const query = new Query(['kind1'])
        .filter('date', '<=', now)
        .filter('name', '=', 'Title')
        .filter('count', '>', 20)
        .filter('size', '<', 10)
        .filter('something', '>=', 11)
        .filter('neProperty', '!=', 12)
        .filter('inProperty', 'IN', 13)
        .filter('notInProperty', 'NOT_IN', 14);

      expect(query.filters[0].name).toBe('date');
      expect(query.filters[0].op).toBe('<=');
      expect(query.filters[0].val).toBe(now);

      expect(query.filters[1].name).toBe('name');
      expect(query.filters[1].op).toBe('=');
      expect(query.filters[1].val).toBe('Title');

      expect(query.filters[2].name).toBe('count');
      expect(query.filters[2].op).toBe('>');
      expect(query.filters[2].val).toBe(20);

      expect(query.filters[3].name).toBe('size');
      expect(query.filters[3].op).toBe('<');
      expect(query.filters[3].val).toBe(10);

      expect(query.filters[4].name).toBe('something');
      expect(query.filters[4].op).toBe('>=');
      expect(query.filters[4].val).toBe(11);

      expect(query.filters[5].name).toBe('neProperty');
      expect(query.filters[5].op).toBe('!=');
      expect(query.filters[5].val).toBe(12);

      expect(query.filters[6].name).toBe('inProperty');
      expect(query.filters[6].op).toBe('IN');
      expect(query.filters[6].val).toBe(13);

      expect(query.filters[7].name).toBe('notInProperty');
      expect(query.filters[7].op).toBe('NOT_IN');
      expect(query.filters[7].val).toBe(14);
    });

    it('should remove any whitespace surrounding the filter name', () => {
      const query = new Query(['kind1']).filter('   count    ', '>', 123);

      expect(query.filters[0].name).toBe('count');
    });

    it('should remove any whitespace surrounding the operator', () => {
      const query = new Query(['kind1']).filter(
        'count',
        '       <        ',
        123,
      );

      expect(query.filters[0].op).toBe('<');
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.filter('count', '<', 5);

      expect(query).toBe(nextQuery);
    });

    it('should default the operator to "="', () => {
      const query = new Query(['kind1']).filter('name', 'Stephen');
      const filter = query.filters[0];

      expect(filter.name).toBe('name');
      expect(filter.op).toBe('=');
      expect(filter.val).toBe('Stephen');
    });
  });
  it('should not issue a warning when an EntityFilter instance is provided', () => {
    const spy = jest.spyOn(process, 'emitWarning').mockImplementation();
    new Query(['kind1']).filter(new PropertyFilter('name', '=', 'Stephen'));
    expect(spy).not.toHaveBeenCalled();
  });
  describe('filter with Filter class', () => {
    it('should support filter with Filter', () => {
      const now = new Date();
      const query = new Query(['kind1']).filter(
        new PropertyFilter('date', '<=', now),
      );
      const filter = query.entityFilters[0];

      expect(filter.name).toBe('date');
      expect(filter.op).toBe('<=');
      expect(filter.val).toBe(now);
    });
    it('should support filter with OR', () => {
      const now = new Date();
      const query = new Query(['kind1']).filter(
        or([
          new PropertyFilter('date', '<=', now),
          new PropertyFilter('name', '=', 'Stephen'),
        ]),
      );
      const filter = query.entityFilters[0];
      expect(filter.op).toBe('OR');
      // Check filters
      const filters = filter.filters;
      expect(filters.length).toBe(2);
      expect(filters[0].name).toBe('date');
      expect(filters[0].op).toBe('<=');
      expect(filters[0].val).toBe(now);
      expect(filters[1].name).toBe('name');
      expect(filters[1].op).toBe('=');
      expect(filters[1].val).toBe('Stephen');
    });
    it('should accept null as value', () => {
      expect(
        new Query(['kind1']).filter('status', null).filters.pop()?.val,
      ).toBeNull();
      expect(
        new Query(['kind1']).filter('status', '=', null).filters.pop()?.val,
      ).toBeNull();
    });
  });

  describe('hasAncestor', () => {
    it('should support ancestor filtering', () => {
      const query = new Query(['kind1']).hasAncestor(['kind2', 123]);

      expect(query.filters[0].name).toBe('__key__');
      expect(query.filters[0].op).toBe('HAS_ANCESTOR');
      expect(query.filters[0].val).toEqual(['kind2', 123]);
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.hasAncestor(['kind2', 123]);

      expect(query).toBe(nextQuery);
    });
  });

  describe('order', () => {
    it('should default ordering to ascending', () => {
      const query = new Query(['kind1']).order('name');

      expect(query.orders[0].name).toBe('name');
      expect(query.orders[0].sign).toBe('+');
    });

    it('should support ascending order', () => {
      const query = new Query(['kind1']).order('name');

      expect(query.orders[0].name).toBe('name');
      expect(query.orders[0].sign).toBe('+');
    });

    it('should support descending order', () => {
      const query = new Query(['kind1']).order('count', {descending: true});

      expect(query.orders[0].name).toBe('count');
      expect(query.orders[0].sign).toBe('-');
    });

    it('should support both ascending and descending', () => {
      const query = new Query(['kind1'])
        .order('name')
        .order('count', {descending: true});

      expect(query.orders[0].name).toBe('name');
      expect(query.orders[0].sign).toBe('+');
      expect(query.orders[1].name).toBe('count');
      expect(query.orders[1].sign).toBe('-');
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.order('name');

      expect(query).toBe(nextQuery);
    });
  });

  describe('groupBy', () => {
    it('should store an array of properties to group by', () => {
      const query = new Query(['kind1']).groupBy(['name', 'size']);

      expect(query.groupByVal).toEqual(['name', 'size']);
    });

    it('should convert a single property into an array', () => {
      const query = new Query(['kind1']).groupBy('name');

      expect(query.groupByVal).toEqual(['name']);
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.groupBy(['name', 'size']);

      expect(query).toBe(nextQuery);
    });
  });

  describe('select', () => {
    it('should store an array of properties to select', () => {
      const query = new Query(['kind1']).select(['name', 'size']);

      expect(query.selectVal).toEqual(['name', 'size']);
    });

    it('should convert a single property into an array', () => {
      const query = new Query(['kind1']).select('name');

      expect(query.selectVal).toEqual(['name']);
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.select(['name', 'size']);

      expect(query).toBe(nextQuery);
    });
  });

  describe('start', () => {
    it('should capture the starting cursor value', () => {
      const query = new Query(['kind1']).start('X');

      expect(query.startVal).toBe('X');
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.start('X');

      expect(query).toBe(nextQuery);
    });
  });

  describe('end', () => {
    it('should capture the ending cursor value', () => {
      const query = new Query(['kind1']).end('Z');

      expect(query.endVal).toBe('Z');
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.end('Z');

      expect(query).toBe(nextQuery);
    });
  });

  describe('limit', () => {
    it('should capture the number of results to limit to', () => {
      const query = new Query(['kind1']).limit(20);

      expect(query.limitVal).toBe(20);
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.limit(20);

      expect(query).toBe(nextQuery);
    });
  });

  describe('offset', () => {
    it('should capture the number of results to offset by', () => {
      const query = new Query(['kind1']).offset(100);

      expect(query.offsetVal).toBe(100);
    });

    it('should return the query instance', () => {
      const query = new Query(['kind1']);
      const nextQuery = query.offset(100);

      expect(query).toBe(nextQuery);
    });
  });

  describe('run', () => {
    it('should call the parent instance runQuery correctly', done => {
      const args = [{}, () => {}];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query.scope.runQuery = function (...thisArgs: any[]) {
        try {
          expect(this).toBe(query.scope);
          expect(thisArgs[0]).toBe(query);
          expect(thisArgs[1]).toBe(args[0]);
          done();
        } catch (e) {
          done(e as Error);
        }
      };

      query.run(...args);
    });
  });

  describe('runStream', () => {
    it('should not require options', () => {
      const runQueryReturnValue = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query.scope.runQueryStream = function (...args: any[]) {
        expect(this).toBe(query.scope);
        expect(args[0]).toBe(query);
        return runQueryReturnValue;
      };

      const results = query.runStream();
      expect(results).toBe(runQueryReturnValue);
    });

    it('should call the parent instance runQueryStream correctly', () => {
      const options = {
        consistency: 'string',
        gaxOptions: {},
        wrapNumbers: true,
      };
      const runQueryReturnValue = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query.scope.runQueryStream = function (...args: any[]) {
        expect(this).toBe(query.scope);
        expect(args[0]).toBe(query);
        expect(args[1]).toBe(options);
        return runQueryReturnValue;
      };

      const results = query.runStream(options);
      expect(results).toBe(runQueryReturnValue);
    });
  });

  it('should pass the database id to the generated layer', async () => {
    const options = {
      namespace: `${Date.now()}`,
      databaseId: SECOND_DATABASE_ID,
      projectId: 'test-project-id',
    };
    const clientName = 'DatastoreClient';
    const otherDatastore = new Datastore(options);
    const postKey = new entity.Key({path: ['Post', 'post1']});
    // Initialize the generated client so that we can mock it out
    const gapic = Object.freeze({
      v1: require('../src/v1'),
    });
    otherDatastore.clients_.set(clientName, new gapic.v1[clientName](options));
    const dataClient = otherDatastore.clients_.get(clientName);
    const projectId = await otherDatastore.getProjectId();
    if (dataClient) {
      dataClient['commit'] = (
        request: any,
        options: any,
        callback: (err?: unknown) => void,
      ) => {
        try {
          expect(request.databaseId).toBe(SECOND_DATABASE_ID);
          expect(request.projectId).toBe(projectId);
          expect(options.headers['google-cloud-resource-prefix']).toBe(
            `projects/${projectId}`,
          );
        } catch (e) {
          callback(e);
        }
        callback();
      };
    }
    await otherDatastore.save({key: postKey, data: {title: 'test'}});
  });
});
