export enum ConfigErrorCode {
  ConfigFileNotFound = 'CONFIG_FILE_NOT_FOUND',
  ConfigFileUnreadable = 'CONFIG_FILE_UNREADABLE',
  ConfigParseFailed = 'CONFIG_PARSE_FAILED',
  ConfigInvalid = 'CONFIG_INVALID',
  ConfigUnsupportedVersion = 'CONFIG_UNSUPPORTED_VERSION',
  ConfigContextNotFound = 'CONFIG_CONTEXT_NOT_FOUND',
  ConfigWriteFailed = 'CONFIG_WRITE_FAILED',
}
