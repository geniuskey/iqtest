'use strict';

// 아주 단순한 JSON 파일 저장소. 트래픽이 늘면 SQLite/Postgres 등으로 교체하면 된다.
const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['sessions', 'results', 'orders'];

class Store {
  constructor(file) {
    this.file = file;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
    this.timer = null;
    if (file && fs.existsSync(file)) {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) this.data[c] = loaded[c] || {};
    }
  }

  get(col, id) {
    return Object.prototype.hasOwnProperty.call(this.data[col], id) ? this.data[col][id] : undefined;
  }

  put(col, id, value) {
    this.data[col][id] = value;
    this.scheduleSave();
    return value;
  }

  values(col) {
    return Object.values(this.data[col]);
  }

  count(col) {
    return Object.keys(this.data[col]).length;
  }

  scheduleSave() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
