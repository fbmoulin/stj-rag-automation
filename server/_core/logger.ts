import pino from "pino";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;
const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "silent" : "info"),
  base: { pid: false },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});
