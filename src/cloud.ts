import { SLOT_COUNT, slotKey } from './slots';

// Cloud saves: worlds copied to the game's server so they survive a cleared browser and can be
// carried to another device. There are no accounts: turning it on makes a private code, and
// typing that code on another device links it to the same worlds. Each world syncs on its own
// by save time (the newer copy wins); the server keeps the version before each overwrite.

const API = '/api/cloud';
const CODE_KEY = 'dg-cloud-code';
const SYNCED_KEY = 'dg-cloud-synced';
/** How often a world being played is uploaded (it saves locally every 10 s). */
const UPLOAD_EVERY = 30_000;

export type CloudState = 'off' | 'idle' | 'syncing' | 'error';

function get(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage full or blocked */
  }
}

function savedAt(raw: string | null) {
  if (!raw) return 0;
  try {
    return Number(JSON.parse(raw).savedAt) || 0;
  } catch {
    return 0;
  }
}

/** Codes are typed loosely (any case, with or without dashes); store them as XXXX-XXXX-XXXX. */
export function tidyCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 12 ? c.match(/.{4}/g)!.join('-') : null;
}

class CloudError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function call(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, cache: 'no-store' });
  } catch {
    throw new CloudError("Couldn't reach the server (offline?)");
  }
  if (res.status === 404 && path !== '/new') throw new CloudError("That code doesn't match any cloud save", 404);
  if (res.status === 429) throw new CloudError('The server is busy, try again in a minute', 429);
  if (!res.ok && res.status !== 409) throw new CloudError(`Server error (${res.status})`, res.status);
  return res;
}

export class Cloud {
  code = get(CODE_KEY);
  state: CloudState = this.code ? 'idle' : 'off';
  error = '';
  lastSync = Number(get(SYNCED_KEY)) || 0;
  /** Called whenever the state above changes (to redraw the panel and status line). */
  onChange: () => void = () => {};
  private dirty = new Set<number>();
  private lastUpload = 0;
  private busy: Promise<unknown> = Promise.resolve();

  get on() {
    return !!this.code;
  }

  private setState(s: CloudState, error = '') {
    this.state = s;
    this.error = error;
    if (s === 'idle') {
      this.lastSync = Date.now();
      set(SYNCED_KEY, String(this.lastSync));
    }
    this.onChange();
  }

  /** One thing at a time, so uploads and syncs never cross. */
  private queue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.busy.then(job, job);
    this.busy = run.catch(() => {});
    return run;
  }

  private async guard<T>(job: () => Promise<T>): Promise<T> {
    this.setState('syncing');
    try {
      const r = await job();
      this.setState(this.code ? 'idle' : 'off');
      return r;
    } catch (e) {
      this.setState(this.code ? 'error' : 'off', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /** Turn cloud save on with a new code, uploading every world on this device. */
  create() {
    return this.queue(() =>
      this.guard(async () => {
        const { code } = await (await call('/new', { method: 'POST' })).json();
        this.code = code;
        set(CODE_KEY, code);
        await this.syncAll();
        return code as string;
      }),
    );
  }

  /**
   * Link this device to an existing code. The cloud's worlds replace this device's in the same
   * slots (each replaced one is kept in this browser as a backup); worlds only here are uploaded.
   */
  link(code: string) {
    return this.queue(() =>
      this.guard(async () => {
        const c = tidyCode(code);
        if (!c) throw new CloudError('A code is 12 letters and numbers, like ABCD-EFGH-JKMN');
        await call(`/${c}`); // throws if it isn't a real code
        this.code = c;
        set(CODE_KEY, c);
        await this.syncAll(true);
      }),
    );
  }

  /** Stop syncing on this device. Worlds stay here and in the cloud. */
  unlink() {
    this.code = null;
    set(CODE_KEY, null);
    this.dirty.clear();
    this.setState('off');
  }

  /** Bring this device and the cloud level: the newer copy of each world wins. */
  sync() {
    if (!this.code) return Promise.resolve();
    return this.queue(() => this.guard(() => this.syncAll()));
  }

  private async syncAll(cloudWins = false) {
    const index: { slots: Record<string, { savedAt: number }> } = await (await call(`/${this.code}`)).json();
    for (let i = 0; i < SLOT_COUNT; i++) {
      const local = get(slotKey(i));
      const mine = savedAt(local);
      const theirs = index.slots[String(i)]?.savedAt ?? 0;
      if (theirs && (!local || cloudWins || theirs > mine)) {
        if (theirs === mine) continue;
        const raw = await (await call(`/${this.code}/slot/${i}`)).text();
        if (local) set(`dg-cloud-backup-s${i}`, local); // just in case
        set(slotKey(i), raw);
      } else if (local && mine > theirs) await this.put(i, local);
    }
  }

  private async put(i: number, raw: string) {
    await call(`/${this.code}/slot/${i}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
  }

  /** A world was just saved locally; it goes up with the next upload. */
  saved(slot: number) {
    if (this.code) this.dirty.add(slot);
  }

  /** Upload changed worlds if it's been long enough (call often), or now with force. */
  tick(force = false) {
    if (!this.code || !this.dirty.size || this.state === 'syncing') return Promise.resolve();
    if (!force && Date.now() - this.lastUpload < UPLOAD_EVERY) return Promise.resolve();
    this.lastUpload = Date.now();
    const slots = [...this.dirty];
    this.dirty.clear();
    return this.queue(() =>
      this.guard(async () => {
        for (const i of slots) {
          const raw = get(slotKey(i));
          if (raw) await this.put(i, raw);
        }
      }),
    ).catch(() => slots.forEach((i) => this.dirty.add(i))); // try again next time
  }

  /** A world was deleted on this device: remove it from the cloud too (the server keeps a copy). */
  deleted(slot: number) {
    if (!this.code) return;
    this.dirty.delete(slot);
    void this.queue(() => this.guard(() => call(`/${this.code}/slot/${slot}`, { method: 'DELETE' }))).catch(() => {});
  }
}
