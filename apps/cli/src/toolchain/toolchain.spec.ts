import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { ExitCode } from '@heimdall/core';
import { Dependency, InjectedByType } from './toolchain.fixture';

describe('toolchain', () => {
  it('emits decorator metadata so Nest can inject by constructor type', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Dependency, InjectedByType],
    }).compile();

    const subject = moduleRef.get(InjectedByType);

    assert.equal(subject.markerFromDependency(), 'resolved');
  });

  it('compiles TypeScript enums', () => {
    assert.equal(ExitCode.NoSignal, 3);
    assert.equal(ExitCode.Success, 0);
  });

  it('resolves cross-package imports through workspace exports', () => {
    assert.equal(typeof ExitCode, 'object');
  });
});
