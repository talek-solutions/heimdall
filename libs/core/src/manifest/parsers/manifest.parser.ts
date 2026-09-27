import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import type { ManifestApiVersion, ManifestKind } from '../enums';
import { ManifestError, ManifestErrorCode } from '../errors';
import type { IManifestDocument } from '../interfaces/manifest-document.interface';
import type { IManifestIssue } from '../interfaces/manifest-issue.interface';
import { documentLocation } from './document-location';

const MAX_REPORTED_ISSUES = 10;

export interface IParsedResource<T> {
  readonly position: number;
  readonly resource: T;
}

/**
 * Validates in stages, each only once the previous one passed, so a malformed document
 * is reported as itself rather than as broken references everywhere else. Shape — each
 * document on its own — is checked here; `build` assembles and checks references.
 */
export abstract class ManifestParser<TResource extends object, TManifest> {
  abstract readonly version: ManifestApiVersion;
  protected abstract readonly schemas: ReadonlyMap<ManifestKind, ClassConstructor<TResource>>;

  async parse(documents: readonly IManifestDocument[]): Promise<TManifest> {
    return this.build(await this.validateShapes(documents));
  }

  protected abstract build(resources: readonly IParsedResource<TResource>[]): TManifest;

  protected invalid(issues: readonly IManifestIssue[]): ManifestError {
    const reported = issues
      .slice(0, MAX_REPORTED_ISSUES)
      .map(({ location, message }) => `${location}: ${message}`);
    const omitted = issues.length - reported.length;

    return new ManifestError(
      ManifestErrorCode.ManifestInvalid,
      omitted > 0 ? `${reported.join('; ')} (and ${omitted} more)` : reported.join('; '),
    );
  }

  private async validateShapes(
    documents: readonly IManifestDocument[],
  ): Promise<IParsedResource<TResource>[]> {
    const issues: IManifestIssue[] = [];
    const resources: IParsedResource<TResource>[] = [];

    for (const { position, content } of documents) {
      const kind = content['kind'];
      const schema = this.schemas.get(kind as ManifestKind);

      if (schema === undefined) {
        issues.push({
          location: documentLocation(position, undefined, undefined),
          message: `kind ${kind === undefined ? 'is required' : `'${String(kind)}' is not supported`}; expected one of ${[...this.schemas.keys()].join(', ')}`,
        });
        continue;
      }
      const resource = plainToInstance(schema, content, { exposeDefaultValues: true });
      const errors = await validate(resource, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      });
      const metadata = content['metadata'] as Readonly<Record<string, unknown>> | undefined;
      const location = documentLocation(position, kind, metadata?.['name']);

      issues.push(
        ...this.flatten(errors).map(({ path, message }) => ({
          location: `${location} ${path}`,
          message,
        })),
      );
      resources.push({ position, resource });
    }

    if (issues.length > 0) {
      throw this.invalid(issues);
    }
    return resources;
  }

  private flatten(
    errors: readonly ValidationError[],
    parent = '',
  ): { readonly path: string; readonly message: string }[] {
    return errors.flatMap((error) => {
      const path = parent === '' ? error.property : `${parent}.${error.property}`;
      const own = Object.values(error.constraints ?? {}).map((message) => ({ path, message }));
      return [...own, ...this.flatten(error.children ?? [], path)];
    });
  }
}
