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

import {EventEmitter} from 'events';
import {JobOptions} from '../src/job';
import {ServiceObject, util} from '@google-cloud/common';

let promisified = false;
let isCustomTypeOverride: Function | null = null;

jest.mock('@google-cloud/promisify', () => {
  const actual = jest.requireActual('@google-cloud/promisify');
  return {
    ...actual,
    promisifyAll: (c: Function, options: any) => {
      if (c.name === 'Model') {
        promisified = true;
      }
      return actual.promisifyAll(c, options);
    },
  };
});

jest.mock('@google-cloud/common', () => {
  const actual = jest.requireActual('@google-cloud/common');
  class FakeServiceObject extends actual.ServiceObject {
    _calledWith: IArguments;
    constructor(config: any) {
      super(config);
      // eslint-disable-next-line prefer-rest-params
      this._calledWith = arguments;
    }
  }
  return {
    ...actual,
    ServiceObject: FakeServiceObject,
    util: {
      ...actual.util,
      isCustomType: (...args: Array<{}>) => {
        return (isCustomTypeOverride || actual.util.isCustomType)(...args);
      },
      noop: () => {},
    },
  };
});

import {Model} from '../src/model';

describe('BigQuery/Model', () => {
  const MODEL_ID = 'my_model';

  const DATASET = {
    id: 'dataset-id',
    projectId: 'project-id',
    createTable: util.noop,
    bigQuery: {
      job: (id: string) => {
        return {id};
      },
      apiEndpoint: 'bigquery.googleapis.com',
      request: util.noop,
    },
  } as unknown as any;

  let model: any;

  beforeEach(() => {
    isCustomTypeOverride = null;
    model = new Model(DATASET, MODEL_ID);
    model.bigQuery.request = util.noop;
    model.bigQuery.createJob = util.noop;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should inherit from ServiceObject', () => {
      expect(model instanceof ServiceObject).toBe(true);
      const [config] = model._calledWith;
      expect(config.parent).toBe(DATASET);
      expect(config.baseUrl).toBe('/models');
      expect(config.id).toBe(MODEL_ID);
      expect(config.methods).toEqual({
        delete: true,
        exists: true,
        get: true,
        getMetadata: true,
        setMetadata: true,
      });
    });
  });

  describe('createExtractJob', () => {
    const URI = 'gs://bucket-name/model-export';

    const FILE = {
      name: 'model-export',
      bucket: {
        name: 'bucket-name',
      },
    };

    beforeEach(() => {
      isCustomTypeOverride = () => {
        return false;
      };

      model.bigQuery.job = jest.fn();
      model.bigQuery.createJob = jest.fn();
    });

    it('should call createJob correctly', done => {
      model.bigQuery.createJob = (reqOpts: JobOptions) => {
        try {
          expect(reqOpts.configuration!.extract!.sourceModel).toEqual({
            datasetId: model.dataset.id,
            projectId: model.dataset.projectId,
            modelId: model.id,
          });
          done();
        } catch (e) {
          done(e);
        }
      };

      model.createExtractJob(URI, (err: any) => {
        if (err) done(err);
      });
    });

    it('should accept just a destination and a callback', done => {
      model.bigQuery.createJob = (reqOpts: JobOptions, callback: Function) => {
        callback(null, {jobReference: {jobId: 'job-id'}});
      };

      model.createExtractJob(URI, done);
    });

    describe('formats', () => {
      it('should accept ML_TF_SAVED_MODEL', done => {
        model.bigQuery.createJob = (reqOpts: JobOptions) => {
          try {
            const extract = reqOpts.configuration!.extract!;
            expect(extract.destinationFormat).toBe('ML_TF_SAVED_MODEL');
            done();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(
          URI,
          {format: 'ml_tf_saved_model'},
          (err: any) => {
            if (err) done(err);
          },
        );
      });

      it('ML_XGBOOST_BOOSTER', done => {
        model.bigQuery.createJob = (reqOpts: JobOptions) => {
          try {
            const extract = reqOpts.configuration!.extract!;
            expect(extract.destinationFormat).toBe('ML_XGBOOST_BOOSTER');
            done();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(
          URI,
          {format: 'ml_xgboost_booster'},
          (err: any) => {
            if (err) done(err);
          },
        );
      });

      it('should parse out full gs:// urls from files', done => {
        isCustomTypeOverride = () => {
          return true;
        };

        model.bigQuery.createJob = (reqOpts: JobOptions) => {
          try {
            expect(reqOpts.configuration!.extract!.destinationUris).toEqual([
              'gs://' + FILE.bucket.name + '/' + FILE.name,
            ]);
            done();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(FILE, (err: any) => {
          if (err) done(err);
        });
      });

      it('should check if a destination is a File', done => {
        isCustomTypeOverride = (dest: {}, type: string) => {
          try {
            expect(dest).toBe(FILE);
            expect(type).toBe('storage/file');
            setImmediate(done);
            return true;
          } catch (e) {
            done(e);
            return true;
          }
        };

        model.createExtractJob(FILE, (err: any) => {
          if (err) done(err);
        });
      });

      it('should throw if a destination is not a string or a File', () => {
        isCustomTypeOverride = () => {
          return false;
        };

        expect(() => {
          model.createExtractJob({}, util.noop);
        }).toThrow(/Destination must be a string or a File object/);

        expect(() => {
          model.createExtractJob([FILE, {}], util.noop);
        }).toThrow(/Destination must be a string or a File object/);
      });

      it('should throw if a provided format is not recognized', () => {
        expect(() => {
          model.createExtractJob(
            URI,
            {format: 'interpretive_dance'},
            util.noop,
          );
        }).toThrow(/Destination format not recognized/);
      });

      it('should accept a job prefix', done => {
        const fakeJobPrefix = 'abc-';
        const options = {
          jobPrefix: fakeJobPrefix,
        };

        model.bigQuery.createJob = (
          reqOpts: JobOptions,
          callback: Function,
        ) => {
          try {
            expect(reqOpts.jobPrefix).toBe(fakeJobPrefix);
            expect(
              (reqOpts.configuration!.extract as any).jobPrefix,
            ).toBeUndefined();
            callback();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(URI, options, done);
      });

      it('should accept a reservation id', done => {
        const options = {
          reservation: 'reservation/1',
        };

        model.bigQuery.createJob = (
          reqOpts: JobOptions,
          callback: Function,
        ) => {
          try {
            expect(reqOpts.configuration?.reservation).toBe('reservation/1');
            callback();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(URI, options, done);
      });

      it('should accept a job id', done => {
        const jobId = 'job-id';
        const options = {jobId};

        model.bigQuery.createJob = (
          reqOpts: JobOptions,
          callback: Function,
        ) => {
          try {
            expect(reqOpts.jobId).toBe(jobId);
            expect(
              (reqOpts.configuration!.extract as any).jobId,
            ).toBeUndefined();
            callback();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(URI, options, done);
      });

      it('should pass the callback to createJob', done => {
        model.bigQuery.createJob = (
          reqOpts: JobOptions,
          callback: Function,
        ) => {
          try {
            expect(callback).toBe(done);
            callback();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(URI, {}, done);
      });

      it('should optionally accept options', done => {
        model.bigQuery.createJob = (
          reqOpts: JobOptions,
          callback: Function,
        ) => {
          try {
            expect(callback).toBe(done);
            callback();
          } catch (e) {
            done(e);
          }
        };

        model.createExtractJob(URI, done);
      });
    });
  });

  describe('extract', () => {
    let fakeJob: any;

    beforeEach(() => {
      fakeJob = new EventEmitter();
      model.createExtractJob = (
        destination: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(null, fakeJob);
      };
    });

    it('should pass the arguments to createExtractJob', done => {
      const fakeDestination = {};
      const fakeMetadata = {};

      model.createExtractJob = (destination: {}, metadata: {}) => {
        try {
          expect(destination).toBe(fakeDestination);
          expect(metadata).toBe(fakeMetadata);
          done();
        } catch (e) {
          done(e);
        }
      };

      model.extract(fakeDestination, fakeMetadata, (err: any) => {
        if (err) done(err);
      });
    });

    it('should optionally accept metadata', done => {
      model.createExtractJob = (destination: {}, metadata: {}) => {
        try {
          expect(metadata).toEqual({});
          done();
        } catch (e) {
          done(e);
        }
      };

      model.extract({}, (err: any) => {
        if (err) done(err);
      });
    });

    it('should return any createExtractJob errors', done => {
      const error = new Error('err');
      const response = {};

      model.createExtractJob = (
        destination: {},
        metadata: {},
        callback: Function,
      ) => {
        callback(error, null, response);
      };

      model.extract({}, (err: Error, resp: {}) => {
        try {
          expect(err).toBe(error);
          expect(resp).toBe(response);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should return any job errors', done => {
      const error = new Error('err');

      model.extract({}, (err: Error) => {
        try {
          expect(err).toBe(error);
          done();
        } catch (e) {
          done(e);
        }
      });

      fakeJob.emit('error', error);
    });

    it('should return the metadata on complete', done => {
      const metadata = {};

      model.extract({}, (err: Error, resp: {}) => {
        try {
          expect(err).toBeFalsy();
          expect(resp).toBe(metadata);
          done();
        } catch (e) {
          done(e);
        }
      });

      fakeJob.emit('complete', metadata);
    });
  });
});
