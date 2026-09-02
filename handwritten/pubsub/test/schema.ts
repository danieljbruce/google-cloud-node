// Copyright 2021 Google LLC
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

import {google} from '../protos/protos';
import {PubSub} from '../src/pubsub';
import {ISchema, Schema, SchemaTypes, SchemaViews} from '../src/schema';

import {v1} from '../src';
type SchemaServiceClient = v1.SchemaServiceClient;

describe('Schema', () => {
  let pubsub: PubSub;
  let schema: Schema;
  let schemaClient: SchemaServiceClient;
  const projectId = 'testProject';
  const projectName = `projects/${projectId}`;
  const schemaId = 'testSchema';
  const schemaName = `projects/${projectId}/schemas/${schemaId}`;
  const ischema: ISchema = {
    name: schemaName,
    type: SchemaTypes.Avro,
    definition: 'foo',
  };
  const encoding = google.pubsub.v1.Encoding.JSON;

  beforeEach(async () => {
    pubsub = new PubSub({
      projectId: 'testProject',
    });
    jest.spyOn(pubsub, 'getClientConfig').mockImplementation(async () => {
      pubsub.projectId = projectId;
      pubsub.name = projectName;
      return {};
    });

    // These depend on the create-on-first-call structure in PubSub.
    // If that changes, this will also need to be updated.
    schemaClient = await pubsub.getSchemaClient();
    schema = pubsub.schema(schemaName);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  it('properly sets its id', () => {
    expect(schema.id).toBe(schemaId);
  });

  it('properly sets its name', async () => {
    const name = await schema.getName();
    expect(name).toBe(schemaName);
  });

  it('calls PubSub.createSchema() when create() is called', async () => {
    let called = false;
    jest
      .spyOn(pubsub, 'createSchema')
      .mockImplementation(async (name: any, type: any, def: any, gaxOpts: any) => {
        expect(name).toBe(schemaName);
        expect(type).toBe(SchemaTypes.Avro);
        expect(def).toBe('definition');
        expect(gaxOpts).toBeTruthy();
        called = true;
        return new Schema(pubsub, name);
      });

    await schema.create(SchemaTypes.Avro, 'definition', {});
    expect(called).toBe(true);
  });

  it('calls getSchema() on the client when get() is called', async () => {
    let called = false;
    jest
      .spyOn(schemaClient, 'getSchema')
      .mockImplementation(async (params: any, gaxOpts: any) => {
        const name = await schema.getName();
        expect(params.name).toBe(name);
        expect(params.view).toBe('FULL');
        expect(gaxOpts).toEqual({});
        called = true;
        return [ischema] as any;
      });

    const result = await schema.get(SchemaViews.Full, {});
    expect(called).toBe(true);
    expect(result.name).toBe(schemaName);
    expect(result.type).toBe(SchemaTypes.Avro);
    expect(result.definition).toBe('foo');
  });

  it('defaults to FULL when get() is called', async () => {
    let called = false;
    jest.spyOn(schemaClient, 'getSchema').mockImplementation(async (params: any) => {
      expect(params.view).toBe('FULL');
      called = true;
      return [ischema] as any;
    });

    await schema.get();
    expect(called).toBe(true);
  });

  it('calls deleteSchema() on the client when delete() is called', async () => {
    let called = false;
    jest
      .spyOn(schemaClient, 'deleteSchema')
      .mockImplementation(async (params: any, gaxOpts: any) => {
        expect(params.name).toBe(schemaName);
        expect(gaxOpts).toBeTruthy();
        called = true;
        return [] as any;
      });

    await schema.delete({});
    expect(called).toBe(true);
  });

  it('calls validateMessage() on the client when validateMessage() is called on the wrapper', async () => {
    let called = false;
    jest
      .spyOn(schemaClient, 'validateMessage')
      .mockImplementation(async (params: any, gaxOpts: any) => {
        const name = await schema.getName();
        expect(params.parent).toBe(pubsub.name);
        expect(params.name).toBe(name);
        expect(params.schema).toBe(undefined);
        expect(params.message).toBe('foo');
        expect(params.encoding).toBe(encoding);
        expect(gaxOpts).toBeTruthy();
        called = true;
        return [] as any;
      });

    await schema.validateMessage('foo', encoding, {});
    expect(called).toBe(true);
  });

  it('resolves a missing project ID', async () => {
    pubsub = new PubSub();
    schema = pubsub.schema(schemaId);
    expect(pubsub.isIdResolved).toBe(false);
    expect(schema.name_).toBe(undefined);
    jest.spyOn(pubsub, 'getClientConfig').mockImplementation(async () => {
      pubsub.projectId = projectId;
      pubsub.name = projectName;
      return {};
    });
    const name = await schema.getName();
    expect(pubsub.isIdResolved).toBe(true);
    expect(name).toBe(schemaName);
  });

  it('loads metadata from a received message', () => {
    const testAttrs = {
      googclient_schemaencoding: 'JSON',
      googclient_schemarevisionid: 'revision',
      googclient_schemaname: 'foobar',
    };
    const metadata = Schema.metadataFromMessage(testAttrs);
    expect(metadata).toEqual({
      name: 'foobar',
      revision: 'revision',
      encoding: 'JSON',
    });
  });
});
