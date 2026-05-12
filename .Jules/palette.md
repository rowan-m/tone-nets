## 2025-05-12 - Making DOM-based Charts Accessible

**Learning:** Visual bar charts constructed with DOM elements (`div`s with CSS heights) are completely opaque to screen readers by default. Providing summary metrics isn't enough if a visual representation holds key insights.
**Action:** Use `role="meter"` on elements that represent a percentage or known range. Attach `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and a descriptive `aria-label`. Ensure the elements are focusable (`tabindex="0"`) so screen reader users can navigate through the data points just as sighted users would visually scan them.

## 2025-05-12 - Announcing Background Status Updates

**Learning:** When a modal shows loading progress (like calculating a topological layout or downloading a soundfont), updating the text content visually doesn't alert screen reader users, leaving them wondering if the app has frozen.
**Action:** Add `aria-live="polite"` and `aria-atomic="true"` to status text containers that undergo periodic updates during async operations.
