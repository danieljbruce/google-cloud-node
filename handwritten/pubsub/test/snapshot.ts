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

import {ServiceError} from 'google-gax';
import {PubSub, RequestConfig} from '../src/pubsub';
import * as snapTypes from '../src/snapshot';
import {Snapshot} from '../src/snapshot';
import {Subscription} from '../src/subscription';

describe('Snapshot', () => {
  let snapshot: snapTypes.Snapshot;

  const SNAPSHOT_NAME = 'a';
  const PROJECT_ID = 'grape-spaceship-123';

  const PUBSUB = {
    projectId: PROJECT_ID,
  } as {} as PubSub;

  const SUBSCRIPTION = {
    projectId: PROJECT_ID,
    pubsub: PUBSUB,
    api: {},
    createSnapshot() {},
    seek() {},
  } as {} as Subscription;

  beforeEach(() => {
    snapshot = new Snapshot(SUBSCRIPTION, SNAPSHOT_NAME);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    const FULL_SNAPSHOT_NAME = 'a/b/c/d';
    let formatName_: (projectId: string, name: string) => string;

    beforeEach(() => {
      formatName_ = Snapshot.formatName_;
      Snapshot.formatName_ = () => {
        return FULL_SNAPSHOT_NAME;
      };
    });

    afterEach(() => {
      Snapshot.formatName_ = formatName_;
    });

    it('should localize the parent', () => {
      expect(snapshot.parent).toBe(SUBSCRIPTION);
    });

    describe('name', () => {
      it('should create and cache the full name', () => {
        Snapshot.formatName_ = (projectId: string, name: string) => {
          expect(projectId).toBe(PROJECT_ID);
          expect(name).toBe(SNAPSHOT_NAME);
          return FULL_SNAPSHOT_NAME;
        };

        const snapshot = new Snapshot(SUBSCRIPTION, SNAPSHOT_NAME);
        expect(snapshot.name).toBe(FULL_SNAPSHOT_NAME);
      });

      it('should pull the projectId from parent object', () => {
        Snapshot.formatName_ = (projectId: string, name: string) => {
          expect(projectId).toBe(PROJECT_ID);
          expect(name).toBe(SNAPSHOT_NAME);
          return FULL_SNAPSHOT_NAME;
        };

        const snapshot = new Snapshot(SUBSCRIPTION, SNAPSHOT_NAME);
        expect(snapshot.name).toBe(FULL_SNAPSHOT_NAME);
      });
    });

    describe('with Subscription parent', () => {
      let pubsub: PubSub;
      let subscription: Subscription;
      beforeEach(() => {
        pubsub = new PubSub({projectId: PROJECT_ID});
        subscription = pubsub.subscription('test');
      });

      describe('create', () => {
        beforeEach(() => {
          snapshot = new Snapshot(subscription, SNAPSHOT_NAME);
        });

        it('should call createSnapshot', done => {
          const fakeOpts = {};
          jest
            .spyOn(subscription, 'createSnapshot')
            .mockImplementation(((name: any, options: any) => {
              expect(name).toBe(FULL_SNAPSHOT_NAME);
              expect(options).toBe(fakeOpts);
              done();
            }) as any);

          snapshot.create(fakeOpts, () => {});
        });

        it('should return any request errors', done => {
          const fakeError = new Error('err');
          const fakeResponse = {};
          const stub = jest.spyOn(subscription, 'createSnapshot');

          snapshot.create(((err: any, snap: any, resp: any) => {
            expect(err).toBe(fakeError);
            expect(snap).toBeNull();
            expect(resp).toBe(fakeResponse);
            done();
          }) as any);

          const callback = (stub as any).mock.calls[stub.mock.calls.length - 1][2];
          setImmediate(callback, fakeError as ServiceError, null, fakeResponse);
        });

        it('should return the correct snapshot', done => {
          const fakeSnapshot = new Snapshot(SUBSCRIPTION, SNAPSHOT_NAME);
          const fakeResponse = {};
          const stub = jest.spyOn(subscription, 'createSnapshot');

          snapshot.create(((err: any, snap: any, resp: any) => {
            expect(err).toBeNull();
            expect(snap).toBe(snapshot);
            expect(resp).toBe(fakeResponse);
            done();
          }) as any);

          const callback = (stub as any).mock.calls[stub.mock.calls.length - 1][2];
          setImmediate(callback, null, fakeSnapshot, fakeResponse);
        });
      });

      it('should call the seek method', done => {
        jest.spyOn(subscription, 'seek').mockImplementation(((snap: any) => {
          expect(snap).toBe(FULL_SNAPSHOT_NAME);
          done();
        }) as any);
        const snapshot = new Snapshot(subscription, SNAPSHOT_NAME);
        snapshot.seek(() => {});
      });
    });

    describe('with PubSub parent', () => {
      beforeEach(() => {
        snapshot = new Snapshot(PUBSUB, SNAPSHOT_NAME);
      });

      it('should throw on create method', async () => {
        await expect(snapshot.create()).rejects.toThrow(
          /This is only available if you accessed this object through Subscription#snapshot/,
        );
      });

      it('should throw on seek method', async () => {
        await expect(snapshot.seek()).rejects.toThrow(
          /This is only available if you accessed this object through Subscription#snapshot/,
        );
      });
    });
  });

  describe('formatName_', () => {
    const EXPECTED = 'projects/' + PROJECT_ID + '/snapshots/' + SNAPSHOT_NAME;

    it('should format the name', () => {
      const name = Snapshot.formatName_(PROJECT_ID, SNAPSHOT_NAME);
      expect(name).toBe(EXPECTED);
    });

    it('should not re-format the name', () => {
      const name = Snapshot.formatName_(PROJECT_ID, EXPECTED);
      expect(name).toBe(EXPECTED);
    });
  });

  describe('delete', () => {
    it('should make the correct request', done => {
      snapshot.parent.request = (config: RequestConfig, callback: Function) => {
        expect(config.client).toBe('SubscriberClient');
        expect(config.method).toBe('deleteSnapshot');
        expect(config.reqOpts).toEqual({snapshot: snapshot.name});
        callback(); // the done fn
      };

      snapshot.delete(done);
    });
  });
});
