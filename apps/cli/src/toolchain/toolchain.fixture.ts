import { Injectable } from '@nestjs/common';

/**
 * Fixtures for the toolchain regression test.
 *
 * `InjectedByType` is resolved from its constructor parameter type alone, with no
 * `@Inject()` token. That requires the build to emit `design:paramtypes` metadata.
 * If the SWC config loses `decoratorMetadata`, or the build stops loading the root
 * `.swcrc`, Nest fails to resolve this and the test catches it immediately —
 * which is otherwise a confusing runtime failure far from its cause.
 */
@Injectable()
export class Dependency {
  readonly marker = 'resolved';
}

@Injectable()
export class InjectedByType {
  constructor(private readonly dependency: Dependency) {}

  markerFromDependency(): string {
    return this.dependency.marker;
  }
}
