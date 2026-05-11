## 2025-05-11 - File Upload Button Keyboard Accessibility

**Learning:** In standard HTML file uploads hidden with `display: none` for custom styling (like buttons), keyboard users cannot focus the input, breaking accessibility.
**Action:** Use visually hidden CSS techniques (`position: absolute`, `width: 1px`, `clip: rect(0,0,0,0)`, etc.) instead of `display: none` to keep the element focusable. Use the adjacent sibling combinator (`:focus-visible + .btn`) to visually outline the adjacent label/button to show keyboard focus.
