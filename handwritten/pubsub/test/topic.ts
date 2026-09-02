
jest.mock('@google-cloud/paginator', () => ({
  paginator: {
    extend: (klass: Function, methods: string[]) => {},
    streamify: (methodName: string) => 'getSubscriptions',
  },
}));

jest.mock('../src/iam', () => ({
  IAM: class FakeIAM {
    calledWith_: Array<{}>;
    constructor(...args: Array<{}>) {
      this.calledWith_ = args;
    }
  },
}));

jest.mock('../src/publisher', () => {
  const original = jest.requireActual('../src/publisher');
  return {
    ...original,
    Publisher: class FakePublisher {
      calledWith_: Array<{}>;
      published_!: Array<{}>;
      options_!: object;
      constructor(...args: Array<{}>) {
        this.calledWith_ = args;
      }
      publishMessage(...args: Array<{}>) {
        this.published_ = args;
      }
      publishWhenReady(...args: Array<{}>) {
        this.published_ = args;
      }
      setOptions(options: object) {
        this.options_ = options;
      }
      getOptionDefaults() {
        return this.options_;
      }
    },
  };
});
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

import {CallOptions, ServiceError} from 'google-gax';

import {google} from '../protos/protos';
import {ExistsCallback, RequestCallback, RequestConfig} from '../src/pubsub';
import {
  CreateSubscriptionOptions,
  Subscription,
  SubscriptionOptions,
} from '../src/subscription';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {GetTopicMetadataCallback, Topic} from '../src/topic';
import * as util from '../src/util';

describe('Topic', () => {


  const PROJECT_ID = 'test-project';
  const TOPIC_NAME = 'projects/' + PROJECT_ID + '/topics/test-topic';
  const TOPIC_UNFORMATTED_NAME = TOPIC_NAME.split('/').pop();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PUBSUB: any = {
    projectId: PROJECT_ID,
    createTopic: util.noop,
    request: util.noop,
  };

  let topic: any;

  beforeEach(() => {
    topic = new Topic(PUBSUB, TOPIC_NAME);
    topic.parent = PUBSUB;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
it('should streamify the correct methods', () => {
      expect(topic.getSubscriptionsStream).toBe('getSubscriptions');
    });
it('should format the name', () => {
      const formattedName = 'a/b/c/d';

      const formatName_ = Topic.formatName_;
      Topic.formatName_ = (projectId: string, name: string) => {
        expect(projectId).toBe(PROJECT_ID);
        expect(name).toBe(TOPIC_NAME);

        Topic.formatName_ = formatName_;

        return formattedName;
      };

      const topic = new Topic(PUBSUB, TOPIC_NAME);
      expect(topic.name).toBe(formattedName);
    });

    it('should create a publisher', () => {
      const fakeOptions = {};
      const topic = new Topic(PUBSUB, TOPIC_NAME, fakeOptions);

      const [t, options] = (topic.publisher as any).calledWith_;

      expect(t).toBe(topic);
      expect(options).toBe(fakeOptions);
    });

    it('should localize the parent object', () => {
      expect(topic.parent).toBe(PUBSUB);
      expect(topic.pubsub).toBe(PUBSUB);
    });

    it('should localize the request function', done => {
      PUBSUB.request = () => {
        done();
      };

      const topic = new Topic(PUBSUB, TOPIC_NAME);
      topic.request({} as any, () => {});
    });

    it('should create an iam object', () => {
      expect((topic.iam as any).calledWith_).toEqual([PUBSUB, topic]);
    });
  });

  describe('formatName_', () => {
    it('should format name', () => {
      const formattedName = Topic.formatName_(
        PROJECT_ID,
        TOPIC_UNFORMATTED_NAME!,
      );
      expect(formattedName).toBe(TOPIC_NAME);
    });

    it('should format name when given a complete name', () => {
      const formattedName = Topic.formatName_(PROJECT_ID, TOPIC_NAME);
      expect(formattedName).toBe(TOPIC_NAME);
    });
  });

  describe('create', () => {
    it('should call the parent createTopic method', done => {
      const options_ = {};

      PUBSUB.createTopic = (name: string, options: CallOptions) => {
        expect(name).toBe(topic.name);
        expect(options).toBe(options_);
        done();
      };

      topic.create(options_, () => {});
    });
  });

  describe('createSubscription', () => {
    it('should call the parent createSubscription method', done => {
      const NAME = 'sub-name';
      const OPTIONS = {a: 'a'};

      PUBSUB.createSubscription = (
        topic_: Topic,
        name: string,
        options: CreateSubscriptionOptions,
      ) => {
        expect(topic_).toBe(topic);
        expect(name).toBe(NAME);
        expect(options).toBe(OPTIONS);
        done();
      };

      topic.createSubscription(NAME, OPTIONS, () => {});
    });
  });

  describe('delete', () => {
    it('should make the proper request', done => {
      topic.request = (config: RequestConfig) => {
        expect(config.client).toBe('PublisherClient');
        expect(config.method).toBe('deleteTopic');
        expect(config.reqOpts).toEqual({topic: topic.name});
        done();
      };

      topic.delete(() => {});
    });

    it('should optionally accept gax options', done => {
      const options = {};

      topic.request = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(options);
        done();
      };

      topic.delete(options, () => {});
    });
  });

  describe('get', () => {
    it('should delete the autoCreate option', done => {
      const options = {
        autoCreate: true,
        a: 'a',
      };

      topic.getMetadata = (gaxOpts: CallOptions) => {
        expect(gaxOpts).toBe(options);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((gaxOpts as any).autoCreate).toBe(undefined);
        done();
      };

      topic.get(options, () => {});
    });

    describe('success', () => {
      const fakeMetadata = {};

      beforeEach(() => {
        topic.getMetadata = (
          gaxOpts: CallOptions,
          callback: RequestCallback<google.pubsub.v1.ITopic>,
        ) => {
          callback(null, fakeMetadata);
        };
      });

      it('should call through to getMetadata', done => {
        topic.get(
          (err: Error, _topic: Topic, resp: google.pubsub.v1.ITopic) => {
            expect(err).toBeNull();
            expect(_topic).toBe(topic);
            expect(resp).toBe(fakeMetadata);
            done();
          },
        );
      });

      it('should optionally accept options', done => {
        const options = {};

        topic.getMetadata = (gaxOpts: CallOptions) => {
          expect(gaxOpts).toBe(options);
          done();
        };

        topic.get(options, () => {});
      });
    });

    describe('error', () => {
      it('should pass back errors when not auto-creating', done => {
        const error = {code: 4} as ServiceError;
        const apiResponse = {} as Topic;

        topic.getMetadata = (
          gaxOpts: CallOptions,
          callback: GetTopicMetadataCallback,
        ) => {
          callback(error, apiResponse);
        };

        topic.get(
          (err: Error, _topic: Topic, resp: google.pubsub.v1.ITopic) => {
            expect(err).toBe(error);
            expect(_topic).toBe(null);
            expect(resp).toBe(apiResponse);
            done();
          },
        );
      });

      it('should pass back 404 errors if autoCreate is false', done => {
        const error = {code: 5} as ServiceError;
        const apiResponse = {} as Topic;

        topic.getMetadata = (
          gaxOpts: CallOptions,
          callback: GetTopicMetadataCallback,
        ) => {
          callback(error, apiResponse);
        };

        topic.get(
          (err: Error, _topic: Topic, resp: google.pubsub.v1.ITopic) => {
            expect(err).toBe(error);
            expect(_topic).toBe(null);
            expect(resp).toBe(apiResponse);
            done();
          },
        );
      });

      it('should create the topic if 404 + autoCreate is true', done => {
        const error = {code: 5} as ServiceError;
        const apiResponse = {} as Topic;

        const fakeOptions = {
          autoCreate: true,
        };

        topic.getMetadata = (
          gaxOpts: CallOptions,
          callback: GetTopicMetadataCallback,
        ) => {
          callback(error, apiResponse);
        };

        topic.create = (options: CallOptions) => {
          expect(options).toBe(fakeOptions);
          done();
        };

        topic.get(fakeOptions, () => {});
      });
    });
  });

  describe('exists', () => {
    it('should return true if it finds metadata', done => {
      topic.getMetadata = (callback: GetTopicMetadataCallback) => {
        callback(null, {});
      };

      topic.exists((err: Error, exists: ExistsCallback) => {
        expect(err).toBeNull();
        expect(exists).toBeTruthy();
        done();
      });
    });

    it('should return false if a not found error occurs', done => {
      const error = {code: 5} as ServiceError;
      topic.getMetadata = (callback: GetTopicMetadataCallback) => {
        callback(error);
      };

      topic.exists((err: Error, exists: ExistsCallback) => {
        expect(err).toBeNull();
        expect(exists).toBe(false);
        done();
      });
    });

    it('should pass back any other type of error', done => {
      const error = {code: 4} as ServiceError;

      topic.getMetadata = (callback: GetTopicMetadataCallback) => {
        callback(error);
      };

      topic.exists((err: Error, exists: ExistsCallback) => {
        expect(err).toBe(error);
        expect(exists).toBe(undefined);
        done();
      });
    });
  });

  describe('getMetadata', () => {
    it('should make the proper request', done => {
      topic.request = (config: RequestConfig) => {
        expect(config.client).toBe('PublisherClient');
        expect(config.method).toBe('getTopic');
        expect(config.reqOpts).toEqual({topic: topic.name});
        done();
      };

      topic.getMetadata(() => {});
    });

    it('should optionally accept gax options', done => {
      const options = {};

      topic.request = (config: RequestConfig) => {
        expect(config.gaxOpts).toBe(options);
        done();
      };

      topic.getMetadata(options, () => {});
    });

    it('should pass back any errors that occur', done => {
      const error = new Error('err') as ServiceError;
      const apiResponse = {};

      topic.request = (
        config: RequestConfig,
        callback: GetTopicMetadataCallback,
      ) => {
        callback(error, apiResponse);
      };

      topic.getMetadata((err: Error, metadata: google.pubsub.v1.ITopic) => {
        expect(err).toBe(error);
        expect(metadata).toBe(apiResponse);
        done();
      });
    });

    it('should set the metadata if no error occurs', done => {
      const apiResponse = {};

      topic.request = (
        config: RequestConfig,
        callback: GetTopicMetadataCallback,
      ) => {
        callback(null, apiResponse);
      };

      topic.getMetadata((err: Error, metadata: google.pubsub.v1.ITopic) => {
        expect(err).toBeNull();
        expect(metadata).toBe(apiResponse);
        expect(topic.metadata).toBe(apiResponse);
        done();
      });
    });
  });

  describe('getSubscriptions', () => {
    it('should make the correct request', done => {
      interface testOptions {
        a: string;
        b: string;
        gaxOpts?: {
          e: string;
        };
        autoPaginate?: boolean;
      }
      const options: testOptions = {
        a: 'a',
        b: 'b',
        gaxOpts: {
          e: 'f',
        },
        autoPaginate: false,
      };

      const expectedOptions = Object.assign(
        {
          topic: topic.name,
        },
        options,
      );

      const expectedGaxOpts = Object.assign(
        {
          autoPaginate: options.autoPaginate,
        },
        options.gaxOpts,
      );

      delete expectedOptions.gaxOpts;
      delete expectedOptions.autoPaginate;

      topic.request = (config: RequestConfig) => {
        expect(config.client).toBe('PublisherClient');
        expect(config.method).toBe('listTopicSubscriptions');
        expect(config.reqOpts).toEqual(expectedOptions);
        expect(config.gaxOpts).toEqual(expectedGaxOpts);
        done();
      };

      topic.getSubscriptions(options, () => {});
    });

    it('should accept only a callback', done => {
      topic.request = (config: RequestConfig) => {
        expect(config.reqOpts).toEqual({topic: topic.name});
        expect(config.gaxOpts).toEqual({autoPaginate: undefined});
        done();
      };

      topic.getSubscriptions(() => {});
    });

    it('should create subscription objects', done => {
      const fakeSubs = ['a', 'b', 'c'];

      topic.subscription = (name: string) => {
        return {
          name,
        };
      };

      topic.request = (
        config: RequestConfig,
        callback: RequestCallback<string[]>,
      ) => {
        callback(null, fakeSubs);
      };

      topic.getSubscriptions((err: Error, subscriptions: Subscription[]) => {
        expect(err).toBeNull();
        expect(subscriptions).toEqual( [
          {name: 'a'},
          {name: 'b'},
          {name: 'c'},
        ]);
        done();
      });
    });

    it('should pass all params to the callback', done => {
      const err_ = new Error('err');
      const subs_ = undefined;
      const nextQuery_ = {};
      const apiResponse_ = {};

      topic.request =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config: RequestConfig, callback: (...args: any[]) => void) => {
          callback(err_, subs_, nextQuery_, apiResponse_);
        };

      topic.getSubscriptions(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: Error, subs: boolean, nextQuery: any, apiResponse: any) => {
          expect(err).toBe(err_);
          expect(subs).toEqual(subs_);
          expect(nextQuery).toBe(nextQuery_);
          expect(apiResponse).toBe(apiResponse_);
          done();
        },
      );
    });
  });

  describe('publish', () => {
    it('should call through to Topic#publishMessage', () => {
      const fdata = Buffer.from('Hello, world!');
      const fattributes = {};
      const fcallback = () => {};

      const stub = jest.spyOn(topic, 'publishMessage');

      topic.publish(fdata, fattributes, fcallback);

      const [{data, attributes}, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(data).toBe(fdata);
      expect(attributes).toBe(fattributes);
      expect(callback).toBe(fcallback);
    });
  });

  describe('publishJSON', () => {
    it('should throw an error for non-object types', () => {
      const expectedError = /First parameter should be an object\./;

      expect(() => topic.publishJSON('hi')).toThrow(expectedError);
    });

    it('should pass along the attributes and callback', () => {
      const stub = jest.spyOn(topic, 'publishMessage');
      const fakeAttributes = {};
      const fakeCallback = () => {};

      topic.publishJSON({}, fakeAttributes, fakeCallback);

      const [{attributes}, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(attributes).toBe(fakeAttributes);
      expect(callback).toBe(fakeCallback);
    });
  });

  describe('publishMessage', () => {
    it('should call through to Publisher#publishMessage', () => {
      const stub = jest.spyOn(topic.publisher, 'publishMessage');

      const fdata = Buffer.from('Hello, world!');
      const fattributes = {};
      const fcallback = () => {};

      topic.publish(fdata, fattributes, fcallback);

      const [{data, attributes}, callback] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(data).toBe(fdata);
      expect(attributes).toBe(fattributes);
      expect(callback).toBe(fcallback);
    });

    it('should transform JSON into a Buffer', () => {
      const json = {foo: 'bar'};
      const expectedBuffer = Buffer.from(JSON.stringify(json));
      const stub = jest.spyOn(topic.publisher, 'publishMessage');

      topic.publishMessage({json});

      const [{data}] = (stub as any).mock.calls[(stub as any).mock.calls.length - 1];
      expect(data).toEqual(expectedBuffer);
    });

    it('should return the return value of Publisher#publishMessage', () => {
      const fakePromise = Promise.resolve();
      jest.spyOn(topic.publisher, 'publishMessage').mockReturnValue(fakePromise);

      const promise = topic.publishMessage({data: Buffer.from('hi')});
      expect(promise).toBe(fakePromise);
    });
  });

  describe('setMetadata', () => {
    const METADATA = {
      labels: {yee: 'haw'},
      messageRetentionDuration: {moo: 'cows'},
    };

    let requestStub: any;

    beforeEach(() => {
      requestStub = jest.spyOn(topic, 'request');
    });

    it('should call the correct rpc', () => {
      topic.setMetadata(METADATA, () => {});

      const [{client, method}] = (requestStub as any).mock.calls[(requestStub as any).mock.calls.length - 1];
      expect(client).toBe('PublisherClient');
      expect(method).toBe('updateTopic');
    });

    it('should send the correct request options', () => {
      topic.setMetadata(METADATA, () => {});

      const expectedTopic = Object.assign({name: topic.name}, METADATA);
      const expectedUpdateMask = {
        paths: ['labels', 'message_retention_duration'],
      };

      const [{reqOpts}] = (requestStub as any).mock.calls[(requestStub as any).mock.calls.length - 1];
      expect(reqOpts.topic).toEqual(expectedTopic);
      expect(reqOpts.updateMask).toEqual(expectedUpdateMask);
    });

    it('should accept call options', () => {
      const callOptions = {};

      topic.setMetadata(METADATA, callOptions, () => {});

      const [{gaxOpts}] = (requestStub as any).mock.calls[(requestStub as any).mock.calls.length - 1];
      expect(gaxOpts).toBe(callOptions);
    });

    it('should pass the user callback to request', () => {
      const spy = jest.fn();

      topic.setMetadata(METADATA, spy);

      const [, callback] = (requestStub as any).mock.calls[(requestStub as any).mock.calls.length - 1];
      expect(callback).toBe(spy);
    });
  });

  describe('setPublishOptions', () => {
    it('should call through to Publisher#setOptions', () => {
      const fakeOptions = {};
      const stub = jest.spyOn(topic.publisher, 'setOptions')
        ;

      topic.setPublishOptions(fakeOptions);

      expect((stub as any).mock.calls.length).toBe(1);
    });

    it('should call through to Publisher#getOptionDefaults', () => {
      topic.publisher.options_ = {};
      const defaults = topic.getPublishOptionDefaults();
      expect(defaults).toBe(topic.publisher.options_);
    });
  });

  describe('subscription', () => {
    it('should pass correct arguments to pubsub#subscription', done => {
      const subscriptionName = 'subName';
      const opts = {};

      topic.parent.subscription = (
        name: string,
        options: SubscriptionOptions,
      ) => {
        expect(name).toBe(subscriptionName);
        expect(options).toEqual(opts);
        done();
      };

      topic.subscription(subscriptionName, opts);
    });

    it('should attach the topic instance to the options', done => {
      topic.parent.subscription = (
        name: string,
        options: SubscriptionOptions,
      ) => {
        expect(options.topic).toBe(topic);
        done();
      };

      topic.subscription();
    });

    it('should return the result', done => {
      topic.parent.subscription = () => {
        return done;
      };

      const doneFn = topic.subscription();
      doneFn();
    });
  });
});
