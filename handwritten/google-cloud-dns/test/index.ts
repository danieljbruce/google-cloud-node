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

import {
  Service,
  ServiceConfig,
  ServiceOptions,
} from '@google-cloud/common';
import * as promisify from '@google-cloud/promisify';
import {CoreOptions, OptionsWithUri, Response} from 'request';

let extended = false;
let promisified = false;

jest.mock('@google-cloud/common', () => {
  const common = jest.requireActual('@google-cloud/common');
  return {
    ...common,
    Service: class FakeService extends common.Service {
      calledWith_: unknown[];
      constructor(config: ServiceConfig, options?: ServiceOptions) {
        super(config, options);
        this.calledWith_ = [config, options];
      }
    },
  };
});

jest.mock('@google-cloud/paginator', () => {
  return {
    paginator: {
      extend(esClass: Function, methods: string[]) {
        if (esClass.name !== 'DNS') {
          return;
        }
        extended = true;
        const arr = Array.isArray(methods) ? methods : [methods];
        expect(esClass.name).toBe('DNS');
        expect(arr).toEqual(['getZones']);
      },
      streamify(methodName: string) {
        return methodName;
      },
    },
  };
});

jest.mock('@google-cloud/promisify', () => {
  return {
    promisifyAll(esClass: Function, options?: promisify.PromisifyAllOptions) {
      if (esClass.name !== 'DNS') {
        return;
      }
      promisified = true;
      expect(options?.exclude).toEqual(['zone']);
    },
  };
});

jest.mock('../src/zone', () => {
  return {
    Zone: class FakeZone {
      calledWith_: unknown[];
      constructor(...args: unknown[]) {
        this.calledWith_ = args;
      }
    },
  };
});

import {DNS, Zone} from '../src';

describe('DNS', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dns: any;

  const PROJECT_ID = 'project-id';

  beforeEach(() => {
    dns = new DNS({
      projectId: PROJECT_ID,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should extend the correct methods', () => {
      expect(extended).toBe(true);
    });

    it('should streamify the correct methods', () => {
      expect(dns.getZonesStream).toBe('getZones');
    });

    it('should promisify all the things', () => {
      expect(promisified).toBe(true);
    });

    it('should inherit from Service', () => {
      expect(dns).toBeInstanceOf(Service);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calledWith = (dns as any).calledWith_[0];

      const baseUrl = 'https://dns.googleapis.com/dns/v1';
      expect(calledWith.baseUrl).toBe(baseUrl);
      expect(calledWith.scopes).toEqual([
        'https://www.googleapis.com/auth/ndev.clouddns.readwrite',
        'https://www.googleapis.com/auth/cloud-platform',
      ]);
      expect(calledWith.packageJson).toEqual(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../../package.json')
      );
    });

    it('should enable apiEndpoint override', () => {
      const apiEndpoint = 'fake.endpoint';
      dns = new DNS({
        projectId: PROJECT_ID,
        apiEndpoint,
      });
      const calledWith = dns.calledWith_[0];
      expect(calledWith.apiEndpoint).toBe(apiEndpoint);
      expect(calledWith.baseUrl).toBe(`https://${apiEndpoint}/dns/v1`);
    });
  });

  describe('createZone', () => {
    const zoneName = 'zone-name';
    const config = {dnsName: 'dns-name'};

    it('should throw if a zone name is not provided', () => {
      expect(() => {
        dns.createZone();
      }).toThrow(/A zone name is required/);
    });

    it('should throw if a zone dnsname is not provided', () => {
      expect(() => {
        dns.createZone(zoneName);
      }).toThrow(/A zone dnsName is required/);

      expect(() => {
        dns.createZone(zoneName, {});
      }).toThrow(/A zone dnsName is required/);
    });

    it('should use a provided description', done => {
      const cfg = Object.assign({}, config, {description: 'description'});

      dns.request = (reqOpts: CoreOptions) => {
        try {
          expect(reqOpts.json.description).toBe(cfg.description);
          done();
        } catch (e) {
          done(e);
        }
      };

      dns.createZone(zoneName, cfg, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should default a description to ""', done => {
      dns.request = (reqOpts: CoreOptions) => {
        try {
          expect(reqOpts.json.description).toBe('');
          done();
        } catch (e) {
          done(e);
        }
      };

      dns.createZone(zoneName, config, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should make the correct API request', done => {
      dns.request = (reqOpts: OptionsWithUri) => {
        try {
          expect(reqOpts.method).toBe('POST');
          expect(reqOpts.uri).toBe('/managedZones');
          const expectedBody = Object.assign({}, config, {
            name: zoneName,
            description: '',
          });
          expect(reqOpts.json).toEqual(expectedBody);
          done();
        } catch (e) {
          done(e);
        }
      };

      dns.createZone(zoneName, config, (err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {a: 'b', c: 'd'};

      beforeEach(() => {
        dns.request = (reqOpts: {}, callback: Function) => {
          callback(error, apiResponse);
        };
      });

      it('should execute callback with error and API response', done => {
        dns.createZone(
          zoneName,
          config,
          (err: Error, zone: Zone, apiResponse_: Response) => {
            try {
              expect(err).toBe(error);
              expect(zone).toBeNull();
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });

    describe('success', () => {
      const apiResponse = {name: zoneName};
      const zone = {metadata: null};

      beforeEach(() => {
        dns.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponse);
        };

        dns.zone = () => {
          return zone;
        };
      });

      it('should create a zone from the response', done => {
        dns.zone = (name: string) => {
          try {
            expect(name).toBe(apiResponse.name);
            setImmediate(done);
          } catch (e) {
            done(e);
          }
          return zone;
        };

        dns.createZone(zoneName, config, (err: unknown) => {
          if (err) done(err);
        });
      });

      it('should execute callback with zone and API response', done => {
        dns.createZone(
          zoneName,
          config,
          (err: Error, zone_: Zone, apiResponse_: Response) => {
            try {
              expect(err).toBeNull();
              expect(zone_).toBe(zone);
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });

      it('should set the metadata to the response', done => {
        dns.createZone(zoneName, config, (err: Error, zone: Zone) => {
          try {
            expect(err).toBeNull();
            expect(zone.metadata).toBe(apiResponse);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });

  describe('getZones', () => {
    it('should make the correct request', done => {
      const query = {a: 'b', c: 'd'};

      dns.request = (reqOpts: OptionsWithUri) => {
        try {
          expect(reqOpts.uri).toBe('/managedZones');
          expect(reqOpts.qs).toBe(query);
          done();
        } catch (e) {
          done(e);
        }
      };

      dns.getZones(query, (err: unknown) => {
        if (err) done(err);
      });
    });

    it('should use an empty query if one was not provided', done => {
      dns.request = (reqOpts: CoreOptions) => {
        try {
          expect(Object.keys(reqOpts.qs).length).toBe(0);
          done();
        } catch (e) {
          done(e);
        }
      };

      dns.getZones((err: unknown) => {
        if (err) done(err);
      });
    });

    describe('error', () => {
      const error = new Error('Error.');
      const apiResponse = {a: 'b', c: 'd'};

      beforeEach(() => {
        dns.request = (reqOpts: {}, callback: Function) => {
          callback(error, apiResponse);
        };
      });

      it('should execute callback with error and API response', done => {
        dns.getZones(
          {},
          (
            err: Error,
            zones: Zone[],
            nextQuery: {},
            apiResponse_: Response
          ) => {
            try {
              expect(err).toBe(error);
              expect(zones).toBeNull();
              expect(nextQuery).toBeNull();
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });
    });

    describe('success', () => {
      const zone = {name: 'zone-1', a: 'b', c: 'd', metadata: null};
      const apiResponse = {managedZones: [zone]};

      beforeEach(() => {
        dns.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponse);
        };

        dns.zone = () => {
          return zone;
        };
      });

      it('should create zones from the response', done => {
        dns.zone = (zoneName: string) => {
          try {
            expect(zoneName).toBe(zone.name);
            setImmediate(done);
          } catch (e) {
            done(e);
          }
          return zone;
        };

        dns.getZones({}, (err: unknown) => {
          if (err) done(err);
        });
      });

      it('should set a nextQuery if necessary', done => {
        const apiResponseWithNextPageToken = Object.assign({}, apiResponse, {
          nextPageToken: 'next-page-token',
        });

        const query = {a: 'b', c: 'd'};
        const originalQuery = Object.assign({}, query);

        dns.request = (reqOpts: {}, callback: Function) => {
          callback(null, apiResponseWithNextPageToken);
        };

        dns.getZones(query, (err: Error, zones: Zone[], nextQuery: {}) => {
          try {
            expect(err).toBeNull();
            // Check the original query wasn't modified.
            expect(query).toEqual(originalQuery);
            expect(nextQuery).toEqual(
              Object.assign({}, query, {
                pageToken: apiResponseWithNextPageToken.nextPageToken,
              })
            );
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      it('should execute callback with zones and API response', done => {
        dns.getZones(
          {},
          (
            err: Error,
            zones: Zone[],
            nextQuery: {},
            apiResponse_: Response
          ) => {
            try {
              expect(err).toBeNull();
              expect(zones[0]).toBe(zone);
              expect(nextQuery).toBeNull();
              expect(apiResponse_).toBe(apiResponse);
              done();
            } catch (e) {
              done(e);
            }
          }
        );
      });

      it('should assign metadata to zones', done => {
        dns.getZones({}, (err: Error, zones: Zone[]) => {
          try {
            expect(err).toBeNull();
            expect(zones[0].metadata).toBe(zone);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });

  describe('zone', () => {
    it('should throw if a name is not provided', () => {
      expect(() => {
        dns.zone();
      }).toThrow(/A zone name is required/);
    });

    it('should return a Zone', () => {
      const newZoneName = 'new-zone-name';
      const newZone = dns.zone(newZoneName);
      expect(newZone).toBeInstanceOf(Zone);
      expect(newZone.calledWith_[0]).toBe(dns);
      expect(newZone.calledWith_[1]).toBe(newZoneName);
    });
  });
});
