import { ManifestApiVersion, ManifestKind } from '../../enums';
import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestResourceV1, IManifestV1, ISystemV1 } from '../../interfaces/v1';
import { documentLocation } from '../document-location';
import type { IParsedResource } from '../manifest.parser';
import { ManifestIndexV1 } from './manifest-index-v1';

type ResourceOfKind<K extends ManifestKind> = Extract<IManifestResourceV1, { readonly kind: K }>;

export type ManifestAssemblyV1 =
  | { readonly valid: false; readonly issues: readonly IManifestIssue[] }
  | { readonly valid: true; readonly manifest: IManifestV1; readonly index: ManifestIndexV1 };

/** Turns well-formed documents into one manifest: one System, and resources that belong to it. */
export class ManifestV1Assembler {
  assemble(resources: readonly IParsedResource<IManifestResourceV1>[]): ManifestAssemblyV1 {
    const systems = resources.filter(
      (parsed): parsed is IParsedResource<ISystemV1> =>
        parsed.resource.kind === ManifestKind.System,
    );
    const system = systems[0];
    const issues = [
      ...this.checkSystems(systems),
      ...(system === undefined ? [] : this.checkMembership(system.resource, resources)),
      ...this.findDuplicates(resources),
    ];

    if (system === undefined || issues.length > 0) {
      return { valid: false, issues };
    }
    const manifest: IManifestV1 = {
      apiVersion: ManifestApiVersion.V1,
      system: system.resource,
      components: this.ofKind(resources, ManifestKind.Component),
      functionalities: this.ofKind(resources, ManifestKind.Functionality),
      flows: this.ofKind(resources, ManifestKind.Flow),
    };
    return { valid: true, manifest, index: new ManifestIndexV1(manifest) };
  }

  private checkSystems(systems: readonly IParsedResource<ISystemV1>[]): IManifestIssue[] {
    const [first, ...others] = systems;

    if (first === undefined) {
      return [
        {
          location: 'manifest',
          message: `no ${ManifestKind.System} document; a manifest describes exactly one system`,
        },
      ];
    }
    return others.map(({ position, resource }) => ({
      location: this.locate(position, resource),
      message: `a manifest describes exactly one system; document ${first.position} already declares ${ManifestKind.System}/${first.resource.metadata.name}`,
    }));
  }

  private checkMembership(
    system: ISystemV1,
    resources: readonly IParsedResource<IManifestResourceV1>[],
  ): IManifestIssue[] {
    return resources.flatMap(({ position, resource }) =>
      resource.kind === ManifestKind.System || resource.metadata.system === system.metadata.name
        ? []
        : [
            {
              location: `${this.locate(position, resource)} metadata.system`,
              message: `'${resource.metadata.system}' is not this manifest's system '${system.metadata.name}'`,
            },
          ],
    );
  }

  // Systems are left to checkSystems, which already reports every one after the first.
  private findDuplicates(
    resources: readonly IParsedResource<IManifestResourceV1>[],
  ): IManifestIssue[] {
    const firstSeen = new Map<string, number>();

    return resources.flatMap(({ position, resource }) => {
      const identity = `${resource.kind}/${resource.metadata.name}`;
      const first = firstSeen.get(identity);

      if (resource.kind === ManifestKind.System) {
        return [];
      }
      if (first === undefined) {
        firstSeen.set(identity, position);
        return [];
      }
      return [
        { location: this.locate(position, resource), message: `duplicates document ${first}` },
      ];
    });
  }

  private ofKind<K extends ManifestKind>(
    resources: readonly IParsedResource<IManifestResourceV1>[],
    kind: K,
  ): ResourceOfKind<K>[] {
    return resources
      .map(({ resource }) => resource)
      .filter((resource): resource is ResourceOfKind<K> => resource.kind === kind);
  }

  private locate(position: number, resource: IManifestResourceV1): string {
    return documentLocation(position, resource.kind, resource.metadata.name);
  }
}
