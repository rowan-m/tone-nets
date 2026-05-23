## 2026-05-22 - Fast-Firing Event Early Returns
**Learning:** `dragover` events fire continuously per frame during a drag operation. Running a linear loop or property checks on the `dataTransfer` object on every frame incurs unnecessary overhead.
**Action:** Implemented an early exit check using `classList.contains()` to bypass the array iteration once the visual state has been applied.
