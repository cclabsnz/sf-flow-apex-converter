export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

import fs from 'fs';
import path from 'path';

export class Logger {
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logEnabled: boolean = true;
  private static logFile: string = path.join(process.cwd(), 'sf-flow-apex-converter.log');

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

  private static writeToFile(message: string) {
    fs.appendFileSync(this.logFile, message + '\n');
  }

  static debug(context: string, message: string, data?: any) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const logMessage = this.formatMessage(LogLevel.DEBUG, context, message);
      if (data !== undefined) {
        this.writeToFile(`${logMessage}\n${JSON.stringify(data, null, 2)}`);
      } else {
        this.writeToFile(logMessage);
      }
    }
  }

  static info(context: string, message: string, data?: any) {
    if (this.shouldLog(LogLevel.INFO)) {
      const logMessage = this.formatMessage(LogLevel.INFO, context, message);
      if (data !== undefined) {
        this.writeToFile(`${logMessage}\n${JSON.stringify(data, null, 2)}`);
      } else {
        this.writeToFile(logMessage);
      }
    }
  }

  static warn(context: string, message: string, data?: any) {
    if (this.shouldLog(LogLevel.WARN)) {
      const logMessage = this.formatMessage(LogLevel.WARN, context, message);
      if (data !== undefined) {
        this.writeToFile(`${logMessage}\n${JSON.stringify(data, null, 2)}`);
      } else {
        this.writeToFile(logMessage);
      }
    }
  }

  static error(context: string, message: string, error?: Error | any) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const logMessage = this.formatMessage(LogLevel.ERROR, context, message);
      this.writeToFile(logMessage);
      if (error) {
        if (error instanceof Error) {
          this.writeToFile(error.stack || error.message);
        } else {
          this.writeToFile(JSON.stringify(error, null, 2));
        }
      }
    }
  }
}