## 2026-05-11 - Add file size limits to prevent Client-Side DoS

**Vulnerability:** The application was parsing locally uploaded MIDI files using `ArrayBuffer` without a file size limit.
**Learning:** Processing massive or malformed files could cause browser tab crashes or memory exhaustion (Client-Side DoS) due to the heavy background workers and graph-building complexity of the network visualization.
**Prevention:** Added a 5MB maximum file size limit validation check in the `handleFileSelection` upload handler to drop files before reading them into memory.
