// A very small tutorial: one short tip at a time in a corner box, each cleared by doing what
// it says (plant, refill, visit the obelisk, build). Progress is kept per world in the save.

export type TipFlag = 'planted' | 'refilled' | 'shopped' | 'zoomed' | 'built';

export interface Tip {
  /** What to say (words for keys or taps already filled in). */
  text: () => string;
  /** Show it only once this holds (e.g. low on seeds); it waits quietly till then. */
  when?: () => boolean;
  /** The flag that clears it. */
  done: TipFlag;
}

/** Past the last tip: tips are finished for this world. */
export const TIPS_DONE = 99;

export class Tips {
  step = 0;
  private flags = new Set<TipFlag>();
  private box: HTMLElement;
  private textEl: HTMLElement;
  private shown = '';
  private doneAt = 0; // when the closing line went up

  constructor(private tips: Tip[]) {
    this.box = document.getElementById('tip')!;
    this.textEl = this.box.querySelector('.tip-text')!;
    this.box.querySelector('.tip-skip')!.addEventListener('click', () => this.skip());
  }

  /** Something happened that a tip may be waiting for. */
  flag(f: TipFlag) {
    this.flags.add(f);
  }

  skip() {
    this.step = TIPS_DONE;
    this.hide();
  }

  /** Start a world's tips where its save left them (a fresh world starts at the beginning). */
  reset(step: number) {
    this.step = step;
    this.flags.clear();
    this.doneAt = 0;
    this.hide();
  }

  private hide() {
    this.box.classList.add('hidden');
    this.shown = '';
  }

  private show(text: string, last = false) {
    if (text !== this.shown) {
      this.shown = text;
      this.textEl.innerHTML = text;
      this.box.classList.remove('hidden');
      this.box.classList.toggle('last', last);
      // A little pop each time a new tip appears.
      this.box.classList.remove('pop');
      void this.box.offsetWidth;
      this.box.classList.add('pop');
    }
  }

  /** Call a few times a second while playing. */
  update(paused: boolean) {
    if (this.step >= TIPS_DONE) return;
    if (paused) return this.hide();
    // Clear every tip whose flag is already set (things done early count).
    while (this.step < this.tips.length && this.flags.has(this.tips[this.step].done)) this.step++;
    if (this.step >= this.tips.length) {
      // One closing line, then the box goes for good.
      if (!this.doneAt) this.doneAt = performance.now();
      if (performance.now() - this.doneAt > 7000) {
        this.step = TIPS_DONE;
        return this.hide();
      }
      return this.show("That's all you need. Restore the planet, one glade at a time.", true);
    }
    const tip = this.tips[this.step];
    if (tip.when && !tip.when()) return this.hide();
    this.show(tip.text());
  }
}
