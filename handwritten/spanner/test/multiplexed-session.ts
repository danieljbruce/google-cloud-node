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

import * as events from "events";
import {Database} from "../src/database";
import {Session} from "../src/session";
import {MultiplexedSession} from "../src/multiplexed-session";
import {Transaction} from "../src/transaction";
import {grpc} from "google-gax";

class FakeTransaction {
  options: any;
  _affinityKey: any;
  constructor(options?: any) {
    this.options = options;
  }
  async begin(): Promise<void> {}
}

describe("MultiplexedSession", () => {
  let multiplexedSession: any;

  function noop() {}
  const DATABASE = {
    createSession: noop,
    databaseRole: "parent_role",
  } as unknown as Database;

  let fakeMuxSession: any;
  let createSessionStub: any;

  const createSession = (name = "id", props?: any): Session => {
    props = props || {multiplexed: true};

    return Object.assign(new Session(DATABASE, name), props, {
      create: jest.fn().mockResolvedValue(undefined as any),
      transaction: jest.fn().mockImplementation(() => {
        const txn = new FakeTransaction();
        txn._affinityKey = "mock-uuid";
        return txn;
      }),
    });
  };

  beforeEach(() => {
    fakeMuxSession = createSession();
    createSessionStub = jest
      .spyOn(DATABASE, "createSession")
      .mockImplementation((opts?: any) => {
        return Promise.resolve([fakeMuxSession]) as any;
      });
    multiplexedSession = new MultiplexedSession(DATABASE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("instantiation", () => {
    it("should correctly initialize the fields", () => {
      expect(multiplexedSession.database).toBe(DATABASE);
      expect(multiplexedSession.refreshRate).toBe(7);
      expect(multiplexedSession._multiplexedSession).toBeNull();
      expect(multiplexedSession instanceof events.EventEmitter).toBeTruthy();
      expect(
        (multiplexedSession as MultiplexedSession)._sharedMuxSessionWaitPromise,
      ).toBeNull();
    });
  });

  describe("createSession", () => {
    let _createSessionStub: any;
    let _maintainStub: any;

    beforeEach(() => {
      _maintainStub = jest.spyOn(multiplexedSession, "_maintain").mockImplementation(() => {});
      _createSessionStub = jest
        .spyOn(multiplexedSession, "_createSession")
        .mockResolvedValue(undefined as any);
    });

    it("should create mux session", () => {
      multiplexedSession.createSession();
      expect(_createSessionStub).toHaveBeenCalledTimes(1);
    });

    it("should start housekeeping", done => {
      multiplexedSession.createSession();
      setImmediate(() => {
        try {
          expect(_maintainStub).toHaveBeenCalledTimes(1);
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it("should not throw error when database not found", async () => {
      const error = {
        code: grpc.status.NOT_FOUND,
        message: "Database not found",
      } as grpc.ServiceError;
      const multiplexedSession = new MultiplexedSession(DATABASE);
      jest.spyOn(multiplexedSession, "_createSession").mockRejectedValue(error);

      try {
        await multiplexedSession.createSession();
      } catch (err) {
        expect(err).toBeFalsy();
      }
    });
  });

  describe("_maintain", () => {
    let createSessionStub: any;

    beforeEach(() => {
      createSessionStub = jest
        .spyOn(multiplexedSession, "_createSession")
        .mockResolvedValue(undefined as any);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should set an interval to refresh mux sessions", () => {
      const expectedInterval =
        multiplexedSession.refreshRate! * 24 * 60 * 60000;

      multiplexedSession._maintain();
      jest.advanceTimersByTime(expectedInterval);
      expect(createSessionStub).toHaveBeenCalledTimes(1);
    });
  });

  describe("_createSession", () => {
    it("should create the mux sessions with multiplexed option", async () => {
      await multiplexedSession._createSession();
      expect(createSessionStub).toHaveBeenCalledTimes(1);
      expect(createSessionStub.mock.calls[createSessionStub.mock.calls.length - 1][0]).toEqual({
        multiplexed: true,
      });
    });

    it("should reject with any request errors", async () => {
      const error = new Error("create session error");
      createSessionStub.mockRejectedValue(error);

      try {
        await multiplexedSession._createSession();
        throw new Error("Should not make it this far.");
      } catch (e) {
        expect(e).toBe(error);
      }
    });
  });

  describe("getSession", () => {
    it("should acquire a session", done => {
      jest.spyOn(multiplexedSession, "_getSession").mockResolvedValue(fakeMuxSession as any);
      multiplexedSession.getSession((err: any, session: any) => {
        try {
          expect(err).toBeFalsy();
          expect(session).toBe(fakeMuxSession);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it("should pass any errors to the callback", done => {
      const error = new Error("err");
      jest.spyOn(multiplexedSession, "_getSession").mockRejectedValue(error);
      multiplexedSession.getSession((err: any) => {
        try {
          expect(err).toBe(error);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it("should pass back the session and txn with affinity key", done => {
      jest.spyOn(multiplexedSession, "_getSession").mockResolvedValue(fakeMuxSession as any);
      multiplexedSession.getSession((err: any, session: any, txn: any) => {
        try {
          expect(err).toBeFalsy();
          expect(session).toBe(fakeMuxSession);
          expect(txn).toBeTruthy();
          expect(txn._affinityKey).toBeTruthy();
          expect(typeof txn._affinityKey).toBe("string");
          expect(txn._affinityKey.length > 0).toBeTruthy();
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  describe("_getSession", () => {
    it("should return a session if one is available (Cache Hit)", async () => {
      const createSessionStub = jest
        .spyOn(multiplexedSession, "_createSession")
        .mockResolvedValue(fakeMuxSession as any);
      multiplexedSession._multiplexedSession = fakeMuxSession;
      const session = await multiplexedSession._getSession();
      expect(session).toBe(fakeMuxSession);
      // ensure _createSession was not called
      expect(createSessionStub).not.toHaveBeenCalled();
    });

    it("should wait for a pending session to become available (Join Existing)", async () => {
      const multiplexedSession = new MultiplexedSession(DATABASE);

      // create a manual lock to simulate another request currently running
      let resolveLock!: () => void;
      const pendingLock = new Promise<void>(resolve => {
        resolveLock = resolve;
      });

      // inject the lock into the class
      multiplexedSession._sharedMuxSessionWaitPromise = pendingLock;

      // stub _createSession to verify it is NOT called (since we are joining an existing one)
      const createSessionStub = jest
        .spyOn(multiplexedSession, "_createSession")
        .mockResolvedValue(undefined as any);

      // call _getSession() but do not await it yet
      // it will hit the "await this._sharedMuxSessionWaitPromise" line and pause there
      const getSessionPromise = multiplexedSession._getSession();

      // now, simulate the "other" request finishing successfully:
      // set the session (as if the background task finished)
      multiplexedSession._multiplexedSession = fakeMuxSession;

      // now resolve the lock to wake up _getSession
      resolveLock();

      // wait for the method to finish
      const session = await getSessionPromise;
      expect(session).toBe(fakeMuxSession);

      // ensure _createSession was not called
      expect(createSessionStub).not.toHaveBeenCalled();
    });

    it("should create a new session if none exists and no creation is in progress", async () => {
      // ensure _multiplexedSession & _sharedMuxSessionWaitPromise is null
      multiplexedSession._multiplexedSession = null;
      multiplexedSession._sharedMuxSessionWaitPromise = null;

      // stub _createSession to simulate success
      const createSessionStub = jest
        .spyOn(multiplexedSession, "_createSession")
        .mockImplementation(async () => {
          multiplexedSession._multiplexedSession = fakeMuxSession;
        });

      const session = await multiplexedSession._getSession();
      expect(session).toBe(fakeMuxSession);

      // ensure _createSession was called
      expect(createSessionStub).toHaveBeenCalledTimes(1);
    });

    it("should propagate errors if session creation fails", async () => {
      const fakeError = new Error("Network Error");
      // ensure that _multiplexedSession is null
      multiplexedSession._multiplexedSession = null;

      // stub creation to fail
      const createSessionStub = jest
        .spyOn(multiplexedSession, "_createSession")
        .mockRejectedValue(fakeError);

      try {
        await multiplexedSession._getSession();
      } catch (err) {
        expect(err).toBe(fakeError);
      }
      // ensure _createSession was called
      expect(createSessionStub).toHaveBeenCalledTimes(1);
    });
  });
});
