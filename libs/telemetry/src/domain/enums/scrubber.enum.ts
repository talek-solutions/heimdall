/** Secret shapes scrubbed from field values that pass the allowlist (ADR 0008). */
export enum Scrubber {
  Jwt = 'jwt',
  AwsAccessKey = 'awsAccessKey',
  ConnectionString = 'connectionString',
  PrivateKey = 'privateKey',
  Email = 'email',
  BearerToken = 'bearerToken',
}
