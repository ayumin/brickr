export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
