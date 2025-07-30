export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export class Logger {
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logEnabled: boolean = true;

  static setLogLevel(level: LogLevel) {
    Logger.logLevel = level;
  }

  static enableLogs(enabled: boolean) {
    Logger.logEnabled = enabled;
  }

  private static shouldLog(level: LogLevel): boolean {
    if (!Logger.logEnabled) return false;
    
    const levels = Object.values(LogLevel);
    const currentLevelIndex = levels.indexOf(Logger.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex >= currentLevelIndex;
  }

  private static formatMessage(level: LogLevel, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${level.padEnd(5)} [${context}] ${message}`;
  }

  static debug(context: string, message: string, data?: any) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const logMessage = this.formatMessage(LogLevel.DEBUG, context, message);
      if (data !== undefined) {
        console.debug(`${logMessage}\n`, data);
      } else {
        console.debug(logMessage);
      }
    }
  }

  static info(context: string, message: string, data?: any) {
    if (this.shouldLog(LogLevel.INFO)) {
      const logMessage = this.formatMessage(LogLevel.INFO, context, message);
      if (data !== undefined) {
        console.info(`${logMessage}\n`, data);
      } else {
        console.info(logMessage);
      }
    }
  }

  static warn(context: string, message: string, data?: any) {
    if (this.shouldLog(LogLevel.WARN)) {
      const logMessage = this.formatMessage(LogLevel.WARN, context, message);
      if (data !== undefined) {
        console.warn(`${logMessage}\n`, data);
      } else {
        console.warn(logMessage);
      }
    }
  }

  static error(context: string, message: string, error?: Error | any) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const logMessage = this.formatMessage(LogLevel.ERROR, context, message);
      console.error(logMessage);
      if (error) {
        if (error instanceof Error) {
          console.error(error.stack);
        } else {
          console.error(error);
        }
      }
    }
  }
}