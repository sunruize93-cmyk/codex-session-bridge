// 所有前台动作全局串行；人工接管期间暂停调度。不同账号也不抢焦点。
export class Scheduler {
  private tail: Promise<void> = Promise.resolve();
  pending = 0;
  run<T>(f: () => Promise<T>): Promise<T> {
    this.pending++;
    const p = this.tail.then(f);
    this.tail = p.then(
      () => {},
      () => {},
    );
    return p.finally(() => {
      this.pending--;
    });
  }
}
