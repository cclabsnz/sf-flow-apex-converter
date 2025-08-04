export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

import fs from 'fs';
import path from 'path';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

export class Logger {
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logEnabled: boolean = true;
  private static consoleEnabled: boolean = false;
  private static logFile: string = path.join(process.cwd(), 'sf-flow-apex-converter.log');
  private static detailedLogFile: string = path.join(process.cwd(), 'sf-flow-apex-converter-details.json');
  private static detailedLogs: any[] = [];

  static setLogLevel(level: LogLevel) {
    Logger.logLevel = level;
  }

  static enableLogs(enabled: boolean) {
    Logger.logEnabled = enabled;
  }

  static enableConsoleOutput(enabled: boolean) {
    Logger.consoleEnabled = enabled;
  }

  private static shouldLog(level: LogLevel): boolean {
    if (!Logger.logEnabled) return false;
    
    const levels = Object.values(LogLevel);
    const currentLevelIndex = levels.indexOf(Logger.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex >= currentLevelIndex;
  }

  private static getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return COLORS.cyan;
      case LogLevel.INFO: return COLORS.green;
      case LogLevel.WARN: return COLORS.yellow;
      case LogLevel.ERROR: return COLORS.red;
      default: return COLORS.reset;
    }
  }

  private static formatConsoleMessage(level: LogLevel, context: string, message: string): string {
    const color = this.getLevelColor(level);
    const timestamp = new Date().toLocaleTimeString();
    return `${color}${COLORS.bright}[${timestamp}]${COLORS.reset} ${color}${level.padEnd(5)}${COLORS.reset} ${COLORS.blue}[${context}]${COLORS.reset} ${message}`;
  }

  private static formatFileMessage(level: LogLevel, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${level.padEnd(5)} [${context}] ${message}`;
  }

  private static writeToFile(message: string) {
    fs.appendFileSync(this.logFile, message + '\n');
  }

  private static writeDetailedLog(level: string, context: string, data: any) {
    const timestamp = new Date().toISOString();
    this.detailedLogs.push({
      timestamp,
      level,
      context,
      data
    });
    // Write to detailed log file immediately
    fs.writeFileSync(
      this.detailedLogFile,
      JSON.stringify(this.detailedLogs, null, 2)
    );
  }

  private static log(level: LogLevel, context: string, message: string, data?: any) {
    if (this.shouldLog(level)) {
      const consoleMessage = this.formatConsoleMessage(level, context, message);
      const fileMessage = this.formatFileMessage(level, context, message);

      // Log to console if enabled
      if (this.consoleEnabled) {
        console.log(consoleMessage);
        
        // For DEBUG level, we might want to show some data in console
        if (level === LogLevel.DEBUG && data !== undefined) {
          const preview = typeof data === 'object' ? 
            JSON.stringify(data, null, 2).slice(0, 200) + '...' : 
            String(data);
          console.log(COLORS.dim + preview + COLORS.reset);
        }
      }

      // Log to main log file
      this.writeToFile(fileMessage);
      
      // Log detailed data to JSON file
      if (data !== undefined) {
        this.writeDetailedLog(level.toLowerCase(), context, data);
      }
    }
  }

  static debug(context: string, message: string, data?: any) {
    this.log(LogLevel.DEBUG, context, message, data);
  }

  static info(context: string, message: string, data?: any) {
    this.log(LogLevel.INFO, context, message, data);
  }

  static warn(context: string, message: string, data?: any) {
    this.log(LogLevel.WARN, context, message, data);
  }

  static error(context: string, message: string, error?: Error | any) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const consoleMessage = this.formatConsoleMessage(LogLevel.ERROR, context, message);
      const fileMessage = this.formatFileMessage(LogLevel.ERROR, context, message);

      // Log to console if enabled
      if (this.consoleEnabled) {
        console.error(consoleMessage);
        if (error && error instanceof Error) {
          console.error(COLORS.red + error.message + COLORS.reset);
        }
      }

      // Log to file
      this.writeToFile(fileMessage);
      if (error) {
        const errorDetails = error instanceof Error ? 
          { message: error.message, stack: error.stack } : error;
        this.writeToFile(JSON.stringify(errorDetails, null, 2));
        this.writeDetailedLog('error', context, { error: errorDetails });
      }
    }
  }

  static progress(context: string, message: string, current: number, total: number) {
    if (this.shouldLog(LogLevel.INFO)) {
      const percentage = Math.round((current / total) * 100);
      const progressBar = this.createProgressBar(percentage);
      const consoleMessage = this.formatConsoleMessage(LogLevel.INFO, context, `${message} ${progressBar} ${percentage}%`);
      if (this.consoleEnabled) {
        console.log(consoleMessage);
      }
    }
  }

  private static createProgressBar(percentage: number): string {
    const width = 20;
    const completed = Math.floor((width * percentage) / 100);
    const remaining = width - completed;
    const bar = COLORS.green + '█'.repeat(completed) + COLORS.dim + '█'.repeat(remaining) + COLORS.reset;
    return `[${bar}]`;
  }
}