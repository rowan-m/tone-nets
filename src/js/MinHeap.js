export class MinHeap {
    constructor() {
        this.data = [];
    }
    push(val) {
        this.data.push(val);
        let idx = this.data.length - 1;
        while (idx > 0) {
            let p = (idx - 1) >> 1;
            if (this.data[p][1] <= this.data[idx][1]) break;
            [this.data[p], this.data[idx]] = [this.data[idx], this.data[p]];
            idx = p;
        }
    }
    pop() {
        if (this.data.length === 0) return undefined;
        if (this.data.length === 1) return this.data.pop();
        const top = this.data[0];
        this.data[0] = this.data.pop();
        let idx = 0;
        const len = this.data.length;
        while (true) {
            let left = (idx << 1) + 1,
                right = left + 1,
                min = idx;
            if (left < len && this.data[left][1] < this.data[min][1])
                min = left;
            if (right < len && this.data[right][1] < this.data[min][1])
                min = right;
            if (min === idx) break;
            [this.data[idx], this.data[min]] = [this.data[min], this.data[idx]];
            idx = min;
        }
        return top;
    }
    get length() {
        return this.data.length;
    }
}
