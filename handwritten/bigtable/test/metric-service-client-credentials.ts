// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {grpc} from 'google-gax';
import * as monitoring from '@google-cloud/monitoring';
import * as exporterModule from '../src/client-side-metrics/exporter';
import {Bigtable} from '../src';

describe('Bigtable/MetricServiceClientCredentials', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should pass the credentials and universe domain to the exporter', done => {
    const clientOptions = {
      metricsEnabled: true,
      sslCreds: grpc.credentials.createInsecure(),
      universeDomain: 'some-universe-domain.com',
    };
    jest
      .spyOn(exporterModule, 'CloudMonitoringExporter')
      .mockImplementation((options: any) => {
        try {
          expect(options).toEqual(clientOptions);
          done();
        } catch (e) {
          done(e);
        }
        return {} as any;
      });
    new Bigtable(clientOptions);
  });

  it('should use second project for the metric service client', async () => {
    const SECOND_PROJECT_ID = 'second-project-id';
    const clientOptions = {metricsEnabled: true, projectId: SECOND_PROJECT_ID};
    let savedOptions: any = {};
    jest
      .spyOn(exporterModule, 'CloudMonitoringExporter')
      .mockImplementation((options: any) => {
        savedOptions = options;
        return {} as any;
      });
    new Bigtable(clientOptions);
    const client = new monitoring.MetricServiceClient(savedOptions);
    const projectIdUsed = await client.getProjectId();
    expect(projectIdUsed).toBe(SECOND_PROJECT_ID);
  });

  it('should pass the credentials and universe domain to the metric service client', done => {
    const clientOptions = {
      metricsEnabled: true,
      sslCreds: grpc.credentials.createInsecure(),
      universeDomain: 'some-universe-domain.com',
    };
    jest
      .spyOn(monitoring, 'MetricServiceClient')
      .mockImplementation((options: any) => {
        try {
          expect(options).toEqual(clientOptions);
          done();
        } catch (e) {
          done(e);
        }
        return {} as any;
      });
    new Bigtable(clientOptions);
  });
});
