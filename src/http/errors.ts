export type SourceErrorCode = 'CONFIG' | 'NOT_FOUND' | 'BLOCKED' | 'PARSE' | 'NETWORK'

export class SourceError extends Error {
  constructor(
    message: string,
    public readonly code: SourceErrorCode
  ) {
    super(message)
    this.name = 'SourceError'
  }
}
