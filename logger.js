import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.js';

const logFile = fs.createWriteStream(path.join(DIRS.logs, 'apon.log'), { flags: 'a' });

function fmt(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return `${ts} | RTF | ${level} | ${msg}`;
}

export const logger = {
  info:  (m) => { const s = fmt('INFO ', m);  console.log(s);  logFile.write(s + '\n'); },
  warn:  (m) => { const s = fmt('WARN ', m);  console.warn(s); logFile.write(s + '\n'); },
  error: (m) => { const s = fmt('ERROR', m);  console.error(s);logFile.write(s + '\n'); },
  debug: (m) => { const s = fmt('DEBUG', m);  console.log(s);  },
};
