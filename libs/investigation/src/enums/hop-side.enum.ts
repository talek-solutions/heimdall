/** Which end of a dependency a logs or traces check reads: the caller's client side, or the target's server side. */
export enum HopSide {
  Caller = 'caller',
  Target = 'target',
}
