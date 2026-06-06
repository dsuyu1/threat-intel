export class KqlError extends Error {
  name = "KqlError";
  pos: number | null;

  constructor(message: string, pos: number | null = null) {
    super(message);
    this.pos = pos;
  }
}

