export class ObjectPool {
    constructor(createFn, resetFn, releaseFn, maxActive = Infinity) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.releaseFn = releaseFn;
        this.maxActive = maxActive;
        this.pool = [];
        this.active = [];
    }

    acquire(...args) {
        if (this.active.length >= this.maxActive) {
            this.releaseIndex(0); // Recycle oldest if full
        }

        let item;
        if (this.pool.length > 0) {
            item = this.pool.pop();
        } else {
            item = this.createFn(...args);
        }

        if (this.resetFn) {
            this.resetFn(item, ...args);
        }

        this.active.push(item);
        return item;
    }

    release(item) {
        const index = this.active.indexOf(item);
        if (index !== -1) {
            this.releaseIndex(index);
        }
    }

    releaseIndex(index) {
        const item = this.active[index];
        if (this.releaseFn) {
            this.releaseFn(item);
        }
        this.pool.push(item);
        this.active.splice(index, 1);
    }

    clear(disposeFn) {
        if (disposeFn) {
            this.active.forEach(disposeFn);
            this.pool.forEach(disposeFn);
        }
        this.active = [];
        this.pool = [];
    }
}
