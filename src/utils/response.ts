import { Request, Response, NextFunction } from 'express';

export type SuccessMeta = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type SuccessEnvelope<T = unknown> = {
  data: T;
  meta: SuccessMeta;
};

export type ErrorPayload = {
  code: string;
  message: string;
};

export type ErrorEnvelope = {
  error: ErrorPayload;
};

export const ok = <T>(data: T, meta: SuccessMeta): SuccessEnvelope<T> => ({
  data,
  meta,
});

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

export const isApiError = (err: unknown): err is ApiError => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as ApiError;
  return typeof e.status === 'number' && typeof e.code === 'string' && typeof e.message === 'string';
};
