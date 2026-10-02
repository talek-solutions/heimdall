import { Inject, Injectable } from '@nestjs/common';
import type { SystemGraph } from '@heimdall/core/graph';
import type { IClock, IInvestigationConfig } from '../config/investigation-config.model';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import type { IInvestigationRequest, IInvestigationWindow, IPlanEnvironment } from '../interfaces';
import { CLOCK, INVESTIGATION_CONFIG } from '../investigation.tokens';
import { parseDuration } from './duration';

export interface IIntake {
  readonly query: string;
  readonly environment: IPlanEnvironment | undefined;
  readonly window: IInvestigationWindow;
}

/** Turns a request into a query, an environment of the manifest's System and a window. */
@Injectable()
export class InvestigationIntake {
  constructor(
    @Inject(CLOCK) private readonly clock: IClock,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {}

  resolve(graph: SystemGraph, request: IInvestigationRequest): IIntake {
    const query = request.query.trim();

    if (query === '') {
      throw new InvestigationError(
        InvestigationErrorCode.EmptyQuery,
        'describe the issue to investigate, e.g. "checkouts are not working"',
      );
    }
    return {
      query,
      environment: this.environment(graph, request.environment),
      window: this.window(request.since),
    };
  }

  private environment(graph: SystemGraph, name: string | undefined): IPlanEnvironment | undefined {
    const { environments } = graph.system;
    const names = environments.map((environment) => environment.name).join(', ');

    if (name === undefined) {
      if (environments.length > 1) {
        throw new InvestigationError(
          InvestigationErrorCode.EnvironmentUnknown,
          `system ${graph.system.name} has several environments; choose one of ${names}`,
        );
      }
      const [only] = environments;
      return only === undefined ? undefined : { name: only.name, context: only.context };
    }
    const environment = environments.find((candidate) => candidate.name === name);

    if (environment === undefined) {
      throw new InvestigationError(
        InvestigationErrorCode.EnvironmentUnknown,
        environments.length === 0
          ? `system ${graph.system.name} declares no environments, so '${name}' cannot be used`
          : `system ${graph.system.name} has no environment '${name}'; expected one of ${names}`,
      );
    }
    return { name: environment.name, context: environment.context };
  }

  private window(since: string | undefined): IInvestigationWindow {
    const lookbackMs = since === undefined ? this.config.lookbackMs : parseDuration(since);

    if (lookbackMs === undefined) {
      throw new InvestigationError(
        InvestigationErrorCode.InvalidWindow,
        `'${since ?? ''}' is not a duration such as 30m, 2h or 1d`,
      );
    }
    const end = this.clock.now();
    const start = new Date(end.getTime() - lookbackMs);

    return {
      start,
      end,
      baseline: { start: new Date(start.getTime() - lookbackMs), end: start },
    };
  }
}
