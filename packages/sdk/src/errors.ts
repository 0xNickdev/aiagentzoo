/** Base class for every error the SDK throws on purpose. */
export class ZooError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** An agent tried to use something its species is not allowed to touch. */
export class PermissionDenied extends ZooError {
  constructor(
    readonly agent: string,
    readonly capability: string,
  ) {
    super(`agent "${agent}" lacks capability "${capability}"`, "permission_denied");
  }
}

/** The session budget ran out. The runtime stops the agent; nobody is punished. */
export class BudgetExceeded extends ZooError {
  constructor(
    readonly agent: string,
    readonly resource: string,
  ) {
    super(`agent "${agent}" exhausted its ${resource} budget`, "budget_exceeded");
  }
}

/** The keeper behind an enclosure has no feed left to pay for a cycle or a signal. */
export class InsufficientFeed extends ZooError {
  constructor(
    readonly account: string,
    readonly needed: number,
    readonly available: number,
  ) {
    super(`account "${account}" needs ${needed} feed, has ${available}`, "insufficient_feed");
  }
}

/** An inbound event failed signature verification. */
export class InvalidSignature extends ZooError {
  constructor(reason: string) {
    super(`invalid event signature: ${reason}`, "invalid_signature");
  }
}

/** An inbound signal did not match the recipient species' schema. */
export class SignalRejected extends ZooError {
  constructor(reason: string) {
    super(`signal rejected: ${reason}`, "signal_rejected");
  }
}
