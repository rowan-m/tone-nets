## 2024-05-24 - File Upload Accessibility & Disabled State

**Learning:** `display: none` removes file inputs from keyboard navigation and screen readers entirely. Furthermore, `<label>` elements acting as buttons don't receive `:disabled` styling automatically when their associated input is disabled.
**Action:** Use visually hidden styles for file inputs, place the `<input>` immediately before the `<label>` in HTML to use adjacent sibling selectors (`+`) for focus-visible and disabled states on the label.
