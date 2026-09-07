/**
 * Thrown when a caller tries to construct an Apex tree that could not compile.
 *
 * The point of raising at construction is that the mistake surfaces in the
 * converter's own test run, not as a deploy error in a customer's org.
 */
export class ApexTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApexTypeError';
  }
}
