export class StringBuilder {
  private parts: string[] = [];

  append(text: string): void {
    this.parts.push(text);
  }

  appendLine(text: string): void {
    this.parts.push(text + '\n');
  }

  toString(): string {
    return this.parts.join('');
  }
}
