// Copyright 2019 Google LLC
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

/* eslint-disable prefer-rest-params */
/* eslint-disable prefer-spread */

import * as extend from "extend";

let promisified = false;
class FakeServiceObject {
  calledWith_: any[];
  constructor(...args: any[]) {
    this.calledWith_ = args;
  }
}

jest.mock("@google-cloud/common", () => {
  const actual = jest.requireActual("@google-cloud/common");
  return {
    ...actual,
    ServiceObject: FakeServiceObject,
  };
});

jest.mock("@google-cloud/promisify", () => {
  const actual = jest.requireActual("@google-cloud/promisify");
  return {
    ...actual,
    promisifyAll: (klass: any) => {
      if (klass.name === "GrpcServiceObject") {
        promisified = true;
      }
    },
  };
});

import {GrpcServiceObject} from "../../src/common-grpc/service-object";

describe("GrpcServiceObject", () => {
  let grpcServiceObject: any;

  const CONFIG = {};
  const PROTO_OPTS = {};
  const REQ_OPTS = {};

  beforeEach(() => {
    grpcServiceObject = new GrpcServiceObject(CONFIG as any);

    grpcServiceObject.methods = {
      delete: {
        protoOpts: PROTO_OPTS,
        reqOpts: REQ_OPTS,
      },
      getMetadata: {
        protoOpts: PROTO_OPTS,
        reqOpts: REQ_OPTS,
      },
      setMetadata: {
        protoOpts: PROTO_OPTS,
        reqOpts: REQ_OPTS,
      },
    };
  });

  describe("instantiation", () => {
    it("should inherit from ServiceObject", () => {
      expect(grpcServiceObject instanceof FakeServiceObject).toBeTruthy();

      const calledWith = grpcServiceObject.calledWith_;
      expect(calledWith[0]).toBe(CONFIG);
    });

    it("should promisify all the things", () => {
      expect(promisified).toBeTruthy();
    });
  });

  describe("delete", () => {
    it("should make the correct request", done => {
      grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
        try {
          const deleteMethod = grpcServiceObject.methods.delete;
          expect(protoOpts).toBe(deleteMethod.protoOpts);
          expect(reqOpts).toBe(deleteMethod.reqOpts);
          done();
        } catch (e) {
          done(e);
        }
      };

      grpcServiceObject.delete(done);
    });

    it("should not require a callback", done => {
      grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
        try {
          expect(callback).not.toThrow();
          done();
        } catch (e) {
          done(e);
        }
      };

      grpcServiceObject.delete();
    });
  });

  describe("getMetadata", () => {
    it("should make the correct request", done => {
      grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
        try {
          const getMetadataMethod = grpcServiceObject.methods.getMetadata;
          expect(protoOpts).toBe(getMetadataMethod.protoOpts);
          expect(reqOpts).toBe(getMetadataMethod.reqOpts);
          done();
        } catch (e) {
          done(e);
        }
      };

      grpcServiceObject.getMetadata(done);
    });

    describe("error", () => {
      const error = new Error("Error.");
      const apiResponse = {};

      beforeEach(() => {
        grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
          callback(error, apiResponse);
        };
      });

      it("should execute callback with error & API response", done => {
        grpcServiceObject.getMetadata((err: any, metadata: any, apiResponse_: any) => {
          try {
            expect(err).toBe(error);
            expect(metadata).toBeNull();
            expect(apiResponse_).toBe(apiResponse);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    describe("success", () => {
      const apiResponse = {};

      beforeEach(() => {
        grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
          callback(null, apiResponse);
        };
      });

      it("should exec callback with metadata & API response", done => {
        grpcServiceObject.getMetadata((err: any, metadata: any, apiResponse_: any) => {
          try {
            expect(err).toBeFalsy();
            expect(metadata).toBe(apiResponse);
            expect(apiResponse_).toBe(apiResponse);
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      it("should update the metadata on the instance", done => {
        grpcServiceObject.getMetadata((err: any) => {
          try {
            expect(err).toBeFalsy();
            expect(grpcServiceObject.metadata).toBe(apiResponse);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });

  describe("setMetadata", () => {
    const DEFAULT_REQ_OPTS = {a: "b"};
    const METADATA = {a: "c"};

    it("should make the correct request", done => {
      const setMetadataMethod = grpcServiceObject.methods.setMetadata;
      const expectedReqOpts = extend(true, {}, DEFAULT_REQ_OPTS, METADATA);

      grpcServiceObject.methods.setMetadata.reqOpts = DEFAULT_REQ_OPTS;

      grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
        try {
          expect(protoOpts).toBe(setMetadataMethod.protoOpts);
          expect(reqOpts).toEqual(expectedReqOpts);
          done();
        } catch (e) {
          done(e);
        }
      };

      grpcServiceObject.setMetadata(METADATA, done);
    });

    it("should not require a callback", done => {
      grpcServiceObject.request = (protoOpts: any, reqOpts: any, callback: any) => {
        try {
          expect(callback).not.toThrow();
          done();
        } catch (e) {
          done(e);
        }
      };

      grpcServiceObject.setMetadata(METADATA);
    });
  });

  describe("request", () => {
    it("should call the parent instance request method", () => {
      const args = [1, 2, 3];
      const expectedReturnValue = {};

      grpcServiceObject.parent = {
        request() {
          expect(this).toBe(grpcServiceObject.parent);
          expect([].slice.call(arguments)).toEqual(args);
          return expectedReturnValue;
        },
      };

      const ret = grpcServiceObject.request.apply(grpcServiceObject, args);
      expect(ret).toBe(expectedReturnValue);
    });
  });

  describe("requestStream", () => {
    it("should call the parent instance requestStream method", () => {
      const args = [1, 2, 3];
      const expectedReturnValue = {};

      grpcServiceObject.parent = {
        requestStream() {
          expect(this).toBe(grpcServiceObject.parent);
          expect([].slice.call(arguments)).toEqual(args);
          return expectedReturnValue;
        },
      };

      const ret = grpcServiceObject.requestStream.apply(
        grpcServiceObject,
        args,
      );
      expect(ret).toBe(expectedReturnValue);
    });
  });

  describe("requestWritableStream", () => {
    it("should call the parent requestWritableStream method", () => {
      const args = [1, 2, 3];
      const expectedReturnValue = {};

      grpcServiceObject.parent = {
        requestWritableStream() {
          expect(this).toBe(grpcServiceObject.parent);
          expect([].slice.call(arguments)).toEqual(args);
          return expectedReturnValue;
        },
      };

      const ret = grpcServiceObject.requestWritableStream.apply(
        grpcServiceObject,
        args,
      );
      expect(ret).toBe(expectedReturnValue);
    });
  });
});
