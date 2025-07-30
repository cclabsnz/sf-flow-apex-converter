export class FlowBulkificationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowBulkificationException';
  }
}