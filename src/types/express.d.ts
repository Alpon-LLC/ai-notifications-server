declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      requestId: string;
    }
  }
}

export {};
