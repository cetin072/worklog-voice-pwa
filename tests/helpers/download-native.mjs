/** Only Expo filesystem and network boundaries are simulated. Production transfer code is imported. */
export const fs = {
  files: new Map(), reads: [], requests: [], beforeMove: null,
  reset() { this.files.clear(); this.reads = []; this.requests = []; this.beforeMove = null; Paths.availableDiskSpace = 10 ** 9; this.reply = () => { throw new Error('unexpected network'); }; },
  reply: () => { throw new Error('unexpected network'); },
};
const path = (args) => args.map(x => typeof x === 'string' ? x.replace(/\/$/, '') : x.uri).join('/');
export class Directory { constructor(...args) { this.uri = path(args); this.exists = true; } create() { this.exists = true; } }
export const Paths = { document: 'file:///test', availableDiskSpace: 10 ** 9 };
export class File {
  constructor(...args) { this.uri = path(args); }
  get exists() { return fs.files.has(this.uri); }
  get size() { return fs.files.get(this.uri)?.length || 0; }
  write(value, opts = {}) { const bytes = Buffer.from(value); fs.files.set(this.uri, opts.append ? Buffer.concat([fs.files.get(this.uri) || Buffer.alloc(0), bytes]) : bytes); }
  async text() { return (fs.files.get(this.uri) || Buffer.alloc(0)).toString(); }
  delete() { fs.files.delete(this.uri); }
  move(target) { fs.beforeMove?.(this.uri, target.uri); fs.files.set(target.uri, fs.files.get(this.uri)); fs.files.delete(this.uri); this.uri = target.uri; }
  readableStream() { fs.reads.push(this.uri); const bytes = new Uint8Array(fs.files.get(this.uri)); return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }); }
}
export async function fetch(url, opts) { fs.requests.push({ url, opts }); return fs.reply(url, opts); }
