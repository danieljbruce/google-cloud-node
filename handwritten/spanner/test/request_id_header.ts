/**
 * Copyright 2025 Google LLC. All Rights Reserved.
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

/* eslint-disable prefer-rest-params */
import {
  RequestIDError,
  X_GOOG_SPANNER_REQUEST_ID_HEADER,
  craftRequestId,
  injectRequestIDIntoError,
  injectRequestIDIntoHeaders,
  newAtomicCounter,
  nextNthRequest,
  randIdForProcess,
} from "../src/request_id_header";

describe("RequestId", () => {
  describe("AtomicCounter", () => {
    it("Constructor with initialValue", () => {
      const ac0 = newAtomicCounter();
      expect(ac0.value()).toBe(0);
      expect(ac0.increment(2)).toBe(2);
      expect(ac0.value()).toBe(2);

      const ac1 = newAtomicCounter(1);
      expect(ac1.value()).toBe(1);
      expect(ac1.increment(1 << 27)).toBe((1 << 27) + 1);
      expect(ac1.value()).toBe((1 << 27) + 1);
    });

    it("reset", () => {
      const ac0 = newAtomicCounter(1);
      ac0.increment();
      expect(ac0.value()).toBe(2);
      ac0.reset();
      expect(ac0.value()).toBe(0);
    });

    it("toString", () => {
      const ac0 = newAtomicCounter(1);
      ac0.increment();
      expect(ac0.value()).toBe(2);
      expect(ac0.toString()).toBe("2");
      expect(`${ac0}`).toBe("2");
    });
  });

  describe("craftRequestId", () => {
    it("has a 32-bit hex-formatted process-id", () => {
      expect(randIdForProcess).toMatch(/^[0-9A-Fa-f]{8}$/);
    });

    it("with attempts", () => {
      expect(craftRequestId(1, 2, 3, 4)).toBe(
        `1.${randIdForProcess}.1.2.3.4`
      );
    });
  });

  describe("injectRequestIDIntoError", () => {
    it("with non-null error", () => {
      const err: Error = new Error("this one");
      const config: any = {headers: {}};
      config.headers[X_GOOG_SPANNER_REQUEST_ID_HEADER] = "1.2.3.4.5.6";
      injectRequestIDIntoError(config, err);
      expect((err as RequestIDError).requestID).toBe("1.2.3.4.5.6");
    });
  });

  describe("injectRequestIDIntoHeaders", () => {
    it("with null session", () => {
      const hdrs = {};
      injectRequestIDIntoHeaders(hdrs, null, 2, 1);
    });

    it("with nthRequest explicitly passed in", () => {
      const session = {
        parent: {
          _nextNthRequest: () => {
            return 5;
          },
        },
      };
      const got = injectRequestIDIntoHeaders({}, session as any, 2, 5);
      const want = {
        "x-goog-spanner-request-id": `1.${randIdForProcess}.1.1.2.5`,
      };
      expect(got).toEqual(want);
    });

    it("infer nthRequest from session", () => {
      const session = {
        parent: {
          _nextNthRequest: () => {
            return 5;
          },
        },
      };

      const inputHeaders: {[k: string]: string} = {};
      const got = injectRequestIDIntoHeaders(inputHeaders, session as any);
      const want = {
        "x-goog-spanner-request-id": `1.${randIdForProcess}.1.1.5.1`,
      };
      expect(got).toEqual(want);
    });
  });

  describe("nextNthRequest", () => {
    it("should infer value properly", () => {
      const fauxDatabase = {};
      expect(nextNthRequest(fauxDatabase)).toBe(1);

      Object.assign(fauxDatabase, {
        _nextNthRequest: () => {
          return 4;
        },
      });
      expect(nextNthRequest(fauxDatabase)).toBe(4);
    });
  });
});
