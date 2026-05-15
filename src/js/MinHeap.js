export class MinHeap {
    constructor() {
        this.data = [];
        this.priorities = [];
    }

    push(val) {
        this.data.push(val[0]);
        this.priorities.push(val[1]);

        let idx = this.data.length - 1;
        while (idx > 0) {
            let p = (idx - 1) >> 1;
            if (this.priorities[p] <= this.priorities[idx]) break;

            const tempD = this.data[p];
            this.data[p] = this.data[idx];
            this.data[idx] = tempD;

            const tempP = this.priorities[p];
            this.priorities[p] = this.priorities[idx];
            this.priorities[idx] = tempP;

            idx = p;
        }
    }

    pop() {
        if (this.data.length === 0) return undefined;
        if (this.data.length === 1) {
            return [this.data.pop(), this.priorities.pop()];
        }

        const topData = this.data[0];
        const topPriority = this.priorities[0];

        this.data[0] = this.data.pop();
        this.priorities[0] = this.priorities.pop();

        let idx = 0;
        const len = this.data.length;

        while (true) {
            let left = (idx << 1) + 1,
                right = left + 1,
                min = idx;

            if (left < len && this.priorities[left] < this.priorities[min])
                min = left;
            if (right < len && this.priorities[right] < this.priorities[min])
                min = right;
            if (min === idx) break;

            const tempD = this.data[idx];
            this.data[idx] = this.data[min];
            this.data[min] = tempD;

            const tempP = this.priorities[idx];
            this.priorities[idx] = this.priorities[min];
            this.priorities[min] = tempP;

            idx = min;
        }

        return [topData, topPriority];
    }

    get length() {
        return this.data.length;
    }
}
