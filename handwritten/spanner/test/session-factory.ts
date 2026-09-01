/*!
 * Copyright 2024 Google LLC. All Rights Reserved.
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

import {Database, Session, SessionPool} from '../src';
import {SessionFactory} from '../src/session-factory';
import {MultiplexedSession} from '../src/multiplexed-session';
import {util} from '@google-cloud/common';
import * as db from '../src/database';
import {ReleaseError} from '../src/session-pool';

class FakeTransaction {
  options;
  constructor(options?: any) {
    this.options = options;
  }
  async begin(): Promise<void> {}
}

describe('SessionFactory', () => {
  let sessionFactory;
  let fakeSession;
  let fakeMuxSession;
  const NAME = 'table-name';
  const POOL_OPTIONS = {};
  function noop() {}
  const DATABASE = {
    createSession: noop,
    batchCreateSessions: noop,
    databaseRole: 'parent_role',
  } as unknown as Database;

  const createMuxSession = (name = 'id', props?): Session => {
    props = props || {};

    const muxSession = Object.assign(new Session(DATABASE, name), props, {
      create: jest.fn().mockResolvedValue(undefined as any),
      transaction: jest.fn().mockReturnValue(new FakeTransaction() as any),
    });

    muxSession.metadata = {
      multiplexed: true,
    };

    return muxSession;
  };

  const createSession = (name = 'id', props?): Session => {
    props = props || {};

    const session = Object.assign(new Session(DATABASE, name), props, {
      create: jest.fn().mockResolvedValue(undefined as any),
      transaction: jest.fn().mockReturnValue(new FakeTransaction() as any),
    });

    session.metadata = {multiplexed: false};

    return session;
  };

  beforeEach(() => {
    fakeSession = createSession();
    fakeMuxSession = createMuxSession();
    jest.spyOn(DATABASE, 'batchCreateSessions').mockImplementation(() => {
      return Promise.resolve([[fakeSession, fakeSession, fakeSession]]);
    });
    jest.spyOn(DATABASE, 'createSession').mockImplementation((opts?: any) => {
      return Promise.resolve([fakeMuxSession]) as any;
    });
    sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
    sessionFactory.parent = DATABASE;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    describe('when multiplexed session is disabled', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
      });

      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
      });

      it('should create a SessionPool object', () => {
        expect(sessionFactory.pool_ instanceof SessionPool).toBeTruthy();
      });

      it('should accept a custom Pool class', () => {
        function FakePool() {}
        FakePool.prototype.on = util.noop;
        FakePool.prototype.open = util.noop;

        const sessionFactory = new SessionFactory(
          DATABASE,
          NAME,
          FakePool as {} as db.SessionPoolConstructor,
        );
        expect(sessionFactory.pool_ instanceof FakePool).toBeTruthy();
      });

      it('should open the pool', () => {
        const openStub = jest.spyOn(SessionPool.prototype, 'open')
          .mockImplementation(() => {});

        new SessionFactory(DATABASE, NAME, POOL_OPTIONS);

        expect(openStub.mock.calls.length).toBe(1);
      });

      it('should correctly initialize the isMultiplexedEnabled field when GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS is disabled', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexed).toBe(false);
      });
    });

    describe('when multiplexed session is default', () => {
      it('should create a MultiplexedSession object', () => {
        expect(
          sessionFactory.multiplexedSession_ instanceof MultiplexedSession,
        ).toBeTruthy();
      });

      it('should initiate the multiplexed session creation', () => {
        const createSessionStub = jest.spyOn(MultiplexedSession.prototype, 'createSession')
          .mockImplementation(() => {});

        new SessionFactory(DATABASE, NAME, POOL_OPTIONS);

        expect(createSessionStub.mock.calls.length).toBe(1);
      });

      it('should correctly initialize the isMultiplexedEnabled field when GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS is enabled', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexed).toBe(true);
      });
    });

    describe('when multiplexed session is disabled for r/w', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS_FOR_RW = 'false';
      });

      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS_FOR_RW;
      });

      it('should correctly initialize the isMultiplexedRW field', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexedRW).toBe(false);
      });
    });

    describe('when multiplexed session is default for r/w', () => {
      it('should correctly initialize the isMultiplexedRW field', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexedRW).toBe(true);
      });
    });
  });

  describe('getSession', () => {
    describe('when multiplexed session is disabled', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
      });

      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
      });

      it('should retrieve a regular session from the pool', done => {
        (
          jest.spyOn(sessionFactory.pool_, 'getSession') as any
        ).mockImplementation(callback => callback(null, fakeSession));
        sessionFactory.getSession((err, resp) => {
          expect(err).toBe(null);
          expect(resp).toBe(fakeSession);
          done();
        });
      });

      it('should propagate errors when regular session retrieval fails', done => {
        const fakeError = new Error();
        (
          jest.spyOn(sessionFactory.pool_, 'getSession') as any
        ).mockImplementation(callback => callback(fakeError, null));
        sessionFactory.getSession((err, resp) => {
          expect(err).toBe(fakeError);
          expect(resp).toBe(null);
          done();
        });
      });
    });

    describe('when multiplexed session is default', () => {
      it('should return the multiplexed session', done => {
        (
          jest.spyOn(
            sessionFactory.multiplexedSession_, 'getSession',
          ) as any
        ).mockImplementation(callback => callback(null, fakeMuxSession));
        sessionFactory.getSession((err, resp) => {
          expect(err).toBe(null);
          expect(resp).toBe(fakeMuxSession);
          expect(resp?.metadata.multiplexed).toBe(true);
          expect(fakeMuxSession.metadata.multiplexed).toBe(true);
          done();
        });
      });

      it('should propagate error when multiplexed session return fails', done => {
        const fakeError = new Error();
        (
          jest.spyOn(
            sessionFactory.multiplexedSession_, 'getSession',
          ) as any
        ).mockImplementation(callback => callback(fakeError, null));
        sessionFactory.getSession((err, resp) => {
          expect(err).toBe(fakeError);
          expect(resp).toBe(null);
          done();
        });
      });
    });
  });

  describe('getSessionForReadWrite', () => {
    describe('when multiplexed session for r/w disabled', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS_FOR_RW = 'false';
      });

      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS_FOR_RW;
      });

      it('should retrieve a regular session from the pool', done => {
        (
          jest.spyOn(sessionFactory.pool_, 'getSession') as any
        ).mockImplementation(callback => callback(null, fakeSession));
        sessionFactory.getSessionForReadWrite((err, resp) => {
          expect(err).toBe(null);
          expect(resp).toBe(fakeSession);
          done();
        });
      });

      it('should propagate errors when regular session retrieval fails', done => {
        const fakeError = new Error();
        (
          jest.spyOn(sessionFactory.pool_, 'getSession') as any
        ).mockImplementation(callback => callback(fakeError, null));
        sessionFactory.getSessionForReadWrite((err, resp) => {
          expect(err).toBe(fakeError);
          expect(resp).toBe(null);
          done();
        });
      });
    });

    describe('when multiplexed session for r/w not disabled', () => {
      it('should return the multiplexed session', done => {
        (
          jest.spyOn(
            sessionFactory.multiplexedSession_, 'getSession',
          ) as any
        ).mockImplementation(callback => callback(null, fakeMuxSession));
        sessionFactory.getSessionForReadWrite((err, resp) => {
          expect(err).toBe(null);
          expect(resp).toBe(fakeMuxSession);
          expect(resp?.metadata.multiplexed).toBe(true);
          expect(fakeMuxSession.metadata.multiplexed).toBe(true);
          done();
        });
      });

      it('should propagate error when multiplexed session return fails', done => {
        const fakeError = new Error();
        (
          jest.spyOn(
            sessionFactory.multiplexedSession_, 'getSession',
          ) as any
        ).mockImplementation(callback => callback(fakeError, null));
        sessionFactory.getSessionForReadWrite((err, resp) => {
          expect(err).toBe(fakeError);
          expect(resp).toBe(null);
          done();
        });
      });
    });
  });

  describe('getPool', () => {
    it('should return the session pool object', () => {
      const pool = sessionFactory.getPool();
      expect(pool instanceof SessionPool).toBeTruthy();
      expect(pool).toEqual(sessionFactory.pool_);
    });
  });

  describe('release', () => {
    describe('when GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS is not disabled', () => {
      it('should not call the release method', () => {
        const releaseStub = jest.spyOn(sessionFactory.pool_, 'release').mockImplementation(() => {});
        const fakeMuxSession = createMuxSession();
        sessionFactory.release(fakeMuxSession);
        expect(releaseStub).toHaveBeenCalledTimes(0);
      });
    });

    describe('when GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS is disabled', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
      });

      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
      });

      it('should call the release method to release a regular session', () => {
        const releaseStub = jest.spyOn(sessionFactory.pool_, 'release').mockImplementation(() => {});
        const fakeSession = createSession();
        sessionFactory.release(fakeSession);
        expect(releaseStub).toHaveBeenCalledTimes(1);
      });

      it('should propagate an error when release fails', () => {
        const fakeSession = createSession();
        try {
          sessionFactory.release(fakeSession);
          fail('Expected error was not thrown');
        } catch (error) {
          expect(
            (error as ReleaseError).message).toBe('Unable to release unknown resource.',
          );
          expect((error as ReleaseError).resource).toBe(fakeSession);
        }
      });
    });
  });

  describe('isMultiplexedEnabled', () => {
    describe('when GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS is not disabled', () => {
      it('should have enabled the multiplexed', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexedEnabled()).toBe(true);
      });
    });

    describe('when GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS is disabled', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
      });
      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
      });
      it('should not have enabled the multiplexed', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexedEnabled()).toBe(false);
      });
    });
  });

  describe('isMultiplexedEnabledForRW', () => {
    describe('when multiplexed session is not disabled for read/write transactions', () => {
      it('should have enabled the multiplexed', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexedEnabledForRW()).toBe(true);
      });
    });

    describe('when multiplexed session is disabled for read/write transactions', () => {
      beforeAll(() => {
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS = 'false';
        process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS_FOR_RW = 'false';
      });
      afterAll(() => {
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS;
        delete process.env.GOOGLE_CLOUD_SPANNER_MULTIPLEXED_SESSIONS_FOR_RW;
      });
      it('should not have enabled the multiplexed', () => {
        const sessionFactory = new SessionFactory(DATABASE, NAME, POOL_OPTIONS);
        expect(sessionFactory.isMultiplexedEnabledForRW()).toBe(false);
      });
    });
  });
});
