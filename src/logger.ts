import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.join(__dirname, '..', 'app', 'logs');

const createDailyRotateTransport = (level: string) =>
  new winston.transports.DailyRotateFile({
    level,
    dirname: logDir,
    filename: `${level}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
    ),
  });

const logger = winston.createLogger({
  level: 'debug',
  transports: [
    createDailyRotateTransport('debug'),
    createDailyRotateTransport('error'),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

import type { Request } from 'express';

export function logTransportWithDirection(
  direction: 'to' | 'from',
  clientIp: string,
  req: Request,
  data: unknown
) {
  logger.debug(`${direction} ${clientIp} ${req.method} ${req.originalUrl} - ${JSON.stringify(data)}`);
}

export default logger;