import type {
  ComponentType,
  Criticality,
  IndicatorRole,
  InteractionMode,
  LabelSemantic,
  MemberRole,
  ReplicaRouting,
  Transport,
} from '../../manifest/enums';
import type {
  DependencyConfigValue,
  IExpectationV1,
  ITelemetryIdentityV1,
} from '../../manifest/interfaces/v1';
import type { IndicatorProvenance, VertexType } from '../enums';

/** Label meaning → value, as in a flow step's `match`. */
export type ISemanticSelector = Readonly<Partial<Record<LabelSemantic, string>>>;

interface IVertex<T extends VertexType> {
  /** `<type>:<key>`, e.g. `dependency:services-2/orders-db`. */
  readonly id: string;
  readonly type: T;
}

export interface IFunctionalityVertex extends IVertex<VertexType.Functionality> {
  readonly name: string;
  readonly description?: string | undefined;
}

export interface IFlowVertex extends IVertex<VertexType.Flow> {
  readonly name: string;
  readonly mode: InteractionMode;
  readonly propagatesTraceContext: boolean;
  readonly correlationKey?: string | undefined;
  readonly description?: string | undefined;
}

export interface IStepVertex extends IVertex<VertexType.Step> {
  /** Flow name. */
  readonly flow: string;
  /** 1-based, in execution order. */
  readonly position: number;
  /** Id of the dependency vertex the step travels over. */
  readonly dependency: string;
  readonly match: ISemanticSelector;
  readonly description?: string | undefined;
}

export interface IDependencyVertex extends IVertex<VertexType.Dependency> {
  /** Name of the calling component. */
  readonly caller: string;
  readonly name: string;
  /** Name of the called component. */
  readonly target: string;
  readonly transport: Transport;
  readonly mode: InteractionMode;
  readonly criticality: Criticality;
  readonly operations: readonly string[];
  readonly topic?: string | undefined;
  readonly consumerGroup?: string | undefined;
  readonly role?: string | undefined;
  readonly writeTo?: ReplicaRouting | undefined;
  readonly readFrom?: ReplicaRouting | undefined;
  readonly config: Readonly<Record<string, DependencyConfigValue>>;
  readonly description?: string | undefined;
}

export interface IComponentVertex extends IVertex<VertexType.Component> {
  readonly name: string;
  readonly componentType: ComponentType;
  readonly engine?: string | undefined;
  readonly description?: string | undefined;
  readonly telemetry: ITelemetryIdentityV1;
}

export interface IMemberVertex extends IVertex<VertexType.Member> {
  /** Name of the owning component. */
  readonly component: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly telemetry: ITelemetryIdentityV1;
}

export interface IQualifiedRatio {
  readonly numerator: string;
  readonly denominator: string;
}

/** Metric references are always qualified here: `component/metric`. */
export interface IIndicatorVertex extends IVertex<VertexType.Indicator> {
  /** Id of the vertex the indicator measures. */
  readonly subject: string;
  readonly metric?: string | undefined;
  readonly ratio?: IQualifiedRatio | undefined;
  /** A derived indicator can serve several roles, e.g. a histogram's throughput and latency. */
  readonly roles: readonly IndicatorRole[];
  readonly expect: IExpectationV1;
  /** Narrows the metric to the subject; a step's `match`, empty otherwise. */
  readonly selector: ISemanticSelector;
  readonly provenance: IndicatorProvenance;
  readonly query?: string | undefined;
  readonly description?: string | undefined;
}

export type IGraphVertex =
  | IFunctionalityVertex
  | IFlowVertex
  | IStepVertex
  | IDependencyVertex
  | IComponentVertex
  | IMemberVertex
  | IIndicatorVertex;

export type IVertexOfType<T extends VertexType> = Extract<IGraphVertex, { readonly type: T }>;
